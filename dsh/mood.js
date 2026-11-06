/**
 * Mood automation: derive Whale-chan's *image* from what the shared session is
 * actually doing. This module is pure (events + clock in, mood out) so the
 * decision table, its priority order and the anti-flicker hysteresis are unit
 * tested without a running harness.
 *
 * Rules follow `assets/chan/personalidades.txt`; the image is the only thing
 * automated here — the persona text, sessions and memory are untouched.
 */
export const MOOD_IMAGE_PREFIX = '/whale-maid-mascot/chan/'

export const MOODS = {
  'base': { file: 'base-saludando.png', priority: 0 },
  'esperando-aburrida': { file: 'esperando-aburrida.png', priority: 1 },
  'flotando-sonando': { file: 'flotando-sonando.png', priority: 2 },
  'descansando-en-la-playa': { file: 'descansando-en-la-playa.png', priority: 3 },
  'dudando-pensativa': { file: 'dudando-pensativa.png', priority: 4 },
  'tomando-notas': { file: 'tomando-notas.png', priority: 5 },
  'comiendo-tokens': { file: 'comiendo-tokens.png', priority: 6 },
  'analizando-con-lentes': { file: 'analizando-con-lentes.png', priority: 7 },
  'cocinando': { file: 'cocinando.png', priority: 8 },
  'seria-formal': { file: 'seria-formal.png', priority: 9 },
  'celebrando-de-novia': { file: 'celebrando-de-novia.png', priority: 10 },
}

/** Ordered priority for audits/tests (highest last, base is the fallback). */
export const MOOD_PRIORITY = Object.entries(MOODS)
  .sort((a, b) => a[1].priority - b[1].priority)
  .map(([mood]) => mood)

export const MOOD_DEFAULTS = {
  idleMinutes: 6,
  minHoldMs: 9000,
  longTaskMinutes: 3,
  longTaskTools: 8,
  longTaskRecentMs: 5 * 60 * 1000,
  questionWindowMs: 10 * 60 * 1000,
  typingWindowMs: 25 * 1000,
  longUserChars: 240,
  casualTurns: 8,
  celebrationRecentMs: 2 * 60 * 1000,
}

// Delicate topics: only these force `seria-formal`, never a default.
const DELICATE = /(legal|abogad|demanda|juicio|contrato|médic|medic|salud|enfermed|diagnóst|diagnostic|clínic|clinic|dinero|financ|banco|inversi|impuesto|deuda|préstamo|prestamo|hipotec|seguro|sunat|tribut)/i
// Explicit milestones only: this is intentionally rare.
const CELEBRATION = /(lo logramos|hemos terminado|terminamos (el|la) (proyecto|misión|mision)|hito|misión cumplida|mision cumplida|a celebrar|celebrarlo)/i
const READ_TOOL = /^(read|read_file|readfile|read_image|readimage|view|open|cat|head|tail|grep|glob|search|list|ls|tree|stat|file|workspace)/i

function numberOption(value, fallback) {
  const parsed = Number(value)
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : fallback
}

/** Normalizes the mood knobs (overridable in `~/.dsh/whale-maid.json`). */
export function moodConfig(config = {}) {
  return {
    idleMs: Math.max(60000, numberOption(config.moodIdleMinutes, MOOD_DEFAULTS.idleMinutes) * 60000),
    minHoldMs: Math.max(2000, numberOption(config.moodMinHoldMs, MOOD_DEFAULTS.minHoldMs)),
    longTaskMs: Math.max(30000, numberOption(config.moodLongTaskMinutes, MOOD_DEFAULTS.longTaskMinutes) * 60000),
    longTaskTools: Math.max(2, numberOption(config.moodLongTaskTools, MOOD_DEFAULTS.longTaskTools)),
    longTaskRecentMs: Math.max(60000, numberOption(config.moodLongTaskRecentMs, MOOD_DEFAULTS.longTaskRecentMs)),
    questionWindowMs: Math.max(60000, numberOption(config.moodQuestionWindowMs, MOOD_DEFAULTS.questionWindowMs)),
    typingWindowMs: Math.max(5000, numberOption(config.moodTypingWindowMs, MOOD_DEFAULTS.typingWindowMs)),
    longUserChars: Math.max(40, numberOption(config.moodLongUserChars, MOOD_DEFAULTS.longUserChars)),
    casualTurns: Math.max(2, numberOption(config.moodCasualTurns, MOOD_DEFAULTS.casualTurns)),
    celebrationRecentMs: Math.max(30000, numberOption(config.moodCelebrationRecentMs, MOOD_DEFAULTS.celebrationRecentMs)),
  }
}

export function moodImageUrl(mood) {
  const entry = MOODS[mood] || MOODS.base
  return `${MOOD_IMAGE_PREFIX}${entry.file}`
}

function textOf(event) {
  const content = Array.isArray(event?.data?.content)
    ? event.data.content
    : (Array.isArray(event?.data?.message?.content) ? event.data.message.content : [])
  return content
    .filter(block => block && block.type === 'text' && typeof block.text === 'string')
    .map(block => block.text)
    .join('\n')
    .trim()
}

function lastIndexWhere(events, predicate) {
  for (let index = events.length - 1; index >= 0; index -= 1) {
    if (predicate(events[index])) return index
  }
  return -1
}

/**
 * Reduces the durable session events into the small, explicit activity snapshot
 * the decision table consumes. `status` is the live agent status (`idle`,
 * `running`, …).
 */
export function summarizeSessionInput(events = [], status = 'idle', now = Date.now()) {
  const list = Array.isArray(events) ? events : []
  const userIndex = lastIndexWhere(list, event => event?.type === 'user/message')
  const assistantIndex = lastIndexWhere(list, event => event?.type === 'assistant/message')
  const userEvent = userIndex >= 0 ? list[userIndex] : null
  const assistantEvent = assistantIndex >= 0 ? list[assistantIndex] : null
  const userText = userEvent ? textOf(userEvent) : ''
  const assistantText = assistantEvent ? textOf(assistantEvent) : ''
  const lastUserAt = Number(userEvent?.time) || 0
  const lastAssistantAt = Number(assistantEvent?.time) || 0

  const lastStart = lastIndexWhere(list, event => event?.type === 'turn/start')
  const lastEnd = lastIndexWhere(list, event => event?.type === 'turn/end')
  const startEvent = lastStart >= 0 ? list[lastStart] : null
  const endEvent = lastEnd >= 0 ? list[lastEnd] : null
  const turnActive = String(status) === 'running' || lastStart > lastEnd
  const turnStartedAt = Number(startEvent?.time) || 0

  // Tool calls of the running turn (or of the last completed one).
  const toolNames = []
  if (turnActive && lastStart >= 0) {
    for (let index = lastStart + 1; index < list.length; index += 1) {
      if (list[index]?.type !== 'tool/call') continue
      const name = typeof list[index]?.data?.name === 'string' ? list[index].data.name : ''
      if (name) toolNames.push(name)
    }
  }

  let lastTurnToolCalls = 0
  let lastTurnDurationMs = 0
  let lastTurnEndedAt = 0
  if (!turnActive && lastStart >= 0 && lastEnd >= 0 && lastStart < lastEnd) {
    lastTurnEndedAt = Number(endEvent?.time) || 0
    lastTurnDurationMs = lastTurnEndedAt - (Number(startEvent?.time) || 0)
    for (let index = lastStart; index <= lastEnd; index += 1) {
      if (list[index]?.type === 'tool/call') lastTurnToolCalls += 1
    }
  }

  // Trailing chat-only stretch (no tools) for the "long casual chat" mood.
  let trailingMessages = 0
  for (let index = list.length - 1; index >= 0; index -= 1) {
    const type = list[index]?.type
    if (type === 'tool/call') break
    if (type === 'turn/start' || type === 'turn/end') {
      if (trailingMessages === 0) continue
      break
    }
    if (type === 'user/message' || type === 'assistant/message') trailingMessages += 1
  }

  return {
    now,
    status: String(status),
    hasEvents: list.length > 0,
    turnActive,
    turnStartedAt,
    toolNames,
    toolCalls: toolNames.length,
    lastTurnToolCalls,
    lastTurnDurationMs,
    lastTurnEndedAt,
    lastUserText: userText,
    lastUserAt,
    lastAssistantText: assistantText,
    lastAssistantAt,
    assistantEndsQuestion: /[?¿]\s*$/.test(assistantText),
    lastUserIsRecentAnswer: lastAssistantAt > 0 && lastUserAt > lastAssistantAt,
    trailingMessages,
  }
}

/**
 * The decision table. Order is the priority order: the first rule that matches
 * wins, and `base` is always the fallback when nothing is certain.
 */
export function deriveMood(input = {}, config = {}) {
  const cfg = moodConfig(config)
  const now = Number(input.now) || Date.now()
  if (!input.hasEvents) return { mood: 'base', reason: 'no-events' }

  // 1. Explicit milestone, right after the turn ended: the rare celebration.
  if (
    CELEBRATION.test(input.lastAssistantText || '') &&
    input.lastAssistantAt > 0 &&
    now - input.lastAssistantAt <= cfg.celebrationRecentMs
  ) {
    return { mood: 'celebrando-de-novia', reason: 'explicit-milestone' }
  }

  // 2. Delicate topic in the owner's message: serious, never by default.
  if (
    input.lastUserText &&
    DELICATE.test(input.lastUserText) &&
    input.lastUserAt > 0 &&
    now - input.lastUserAt <= cfg.questionWindowMs
  ) {
    return { mood: 'seria-formal', reason: 'delicate-topic' }
  }

  // 3. Running turn: what the tools are doing is the real activity.
  if (input.turnActive) {
    const tools = Array.isArray(input.toolNames) ? input.toolNames : []
    if (tools.length > 0) {
      const lastTool = tools[tools.length - 1] || ''
      if (READ_TOOL.test(lastTool)) return { mood: 'analizando-con-lentes', reason: `reading:${lastTool}` }
      return { mood: 'cocinando', reason: `working:${lastTool || 'tool'}` }
    }
    const longRequest =
      (input.lastUserText || '').length >= cfg.longUserChars &&
      input.turnStartedAt > 0 &&
      now - input.turnStartedAt <= cfg.typingWindowMs
    if (longRequest) return { mood: 'tomando-notas', reason: 'long-request' }
    return { mood: 'comiendo-tokens', reason: 'waiting-model' }
  }

  // 4. No running turn: look at what the last one left behind.
  if (
    input.lastTurnEndedAt > 0 &&
    now - input.lastTurnEndedAt <= cfg.longTaskRecentMs &&
    (input.lastTurnDurationMs >= cfg.longTaskMs || input.lastTurnToolCalls >= cfg.longTaskTools)
  ) {
    return { mood: 'descansando-en-la-playa', reason: 'big-task-finished' }
  }

  const questionPending =
    input.assistantEndsQuestion &&
    !input.lastUserIsRecentAnswer &&
    input.lastAssistantAt > 0 &&
    now - input.lastAssistantAt <= cfg.questionWindowMs
  if (questionPending) return { mood: 'dudando-pensativa', reason: 'waiting-answer' }

  const lastActivityAt = Math.max(input.lastUserAt || 0, input.lastAssistantAt || 0)
  if (lastActivityAt > 0 && now - lastActivityAt > cfg.idleMs) {
    return { mood: 'esperando-aburrida', reason: 'idle' }
  }

  if (
    (input.trailingMessages || 0) >= cfg.casualTurns &&
    (input.lastTurnToolCalls || 0) === 0 &&
    !DELICATE.test(input.lastUserText || '')
  ) {
    return { mood: 'flotando-sonando', reason: 'long-casual-chat' }
  }

  return { mood: 'base', reason: 'default' }
}

/**
 * Anti-flicker: keeps each mood for at least `minHoldMs` before switching.
 * The first decision is adopted immediately (so boot does not sit on `base`),
 * repeated decisions update the reason without touching `since`.
 */
export class MoodTracker {
  constructor(options = {}) {
    this.minHoldMs = numberOption(options.minHoldMs, MOOD_DEFAULTS.minHoldMs)
    this.mood = 'base'
    this.since = Date.now()
    this.reason = 'init'
    this.last = this.snapshot()
  }

  update(decision, now = Date.now(), minHoldMs = this.minHoldMs) {
    const hold = Math.max(0, numberOption(minHoldMs, this.minHoldMs))
    const mood = decision && typeof decision.mood === 'string' && MOODS[decision.mood] ? decision.mood : null
    if (mood === null) return this.last
    if (mood === this.mood) {
      this.reason = decision.reason || this.reason
      this.last = this.snapshot()
      return this.last
    }
    if (now - this.since < hold) return this.last
    this.mood = mood
    this.since = now
    this.reason = decision.reason || ''
    this.last = this.snapshot()
    return this.last
  }

  snapshot() {
    return { mood: this.mood, image: moodImageUrl(this.mood), since: this.since, reason: this.reason }
  }

  /** Last known snapshot, or plain `base`: the route never fails. */
  fallback() {
    return this.last || { mood: 'base', image: moodImageUrl('base'), since: 0, reason: 'fallback' }
  }
}
