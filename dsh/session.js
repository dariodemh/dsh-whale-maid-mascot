/**
 * One shared DSH agent session behind every Whale-chan surface.
 *
 * The in-page mascot chat and the Telegram bridge both call these helpers, so a
 * message sent from one place is part of the same conversation (and the same
 * tools) as a message sent from the other. The persona section is bound once per
 * live agent, no matter which surface reached it first.
 */
import { lightSessionId, loadConfig, loadState, ownerName, personaText, sharedSessionId } from './config.js'

const personaBound = new Set()
const personaDisposers = []

function permissionPresets(scope) {
  try {
    if (typeof scope.get === 'function') return scope.get('permissionPresets')
    return scope.permissionPresets
  } catch {
    return undefined
  }
}

function bindPersona(agent, config) {
  if (!agent?.ctx?.systemPrompt || typeof agent.ctx.systemPrompt.section !== 'function') return
  const id = String(agent.id)
  if (personaBound.has(id)) return
  personaBound.add(id)
  try {
    const dispose = agent.ctx.systemPrompt.section({
      name: 'whale-maid-persona',
      order: 5,
      interpolate: false,
      text: () => personaText(loadConfig()),
    })
    personaDisposers.push(dispose)
  } catch {
    /* the section may already exist on this agent */
  }
}

function waitTurn(scope, sessionId, timeoutMs) {
  let cancel = () => {}
  const promise = new Promise(resolve => {
    let settled = false
    let off = null
    const finish = value => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      try {
        if (typeof off === 'function') off()
      } catch {
        /* released */
      }
      resolve(value)
    }
    cancel = () => finish('cancel')
    const timer = setTimeout(() => finish('timeout'), Math.max(1000, timeoutMs))
    try {
      off = scope.on('session/event', (session, event) => {
        if (String(session?.id) !== String(sessionId)) return
        if (event?.type === 'turn/end') finish('end')
      })
    } catch {
      finish('error')
    }
  })
  // Lets the caller stop waiting (and drop the timer) when the prompt itself fails.
  promise.cancel = cancel
  return promise
}

// --- per-session mutex -------------------------------------------------------
// Every turn the plugin starts (review, Telegram, in-page chat) takes this lock
// for its session before prompting. Two turns in the same session therefore run
// one after the other instead of both calling `prompt()` and letting the DSH
// inbox splice them into the same conversation. The lock is a promise chain, so
// it needs no native primitive and it releases even when the turn throws.
const sessionChains = new Map()

function lockKey(sessionId) {
  return String(sessionId)
}

/** True while a plugin turn is running or queued for that session. */
export function isSessionBusy(sessionId) {
  return sessionChains.has(lockKey(sessionId))
}

/** How many plugin turns are queued for that session (0 when idle). */
export function sessionQueueDepth(sessionId) {
  const entry = sessionChains.get(lockKey(sessionId))
  return entry ? entry.depth : 0
}

/**
 * Serializes `task` after every turn already queued for `sessionId`. Resolves
 * or rejects with the task's own value; it never swallows the turn's error.
 */
export function withSessionLock(sessionId, task) {
  const key = lockKey(sessionId)
  const previous = sessionChains.get(key)
  const depth = previous ? previous.depth + 1 : 0
  let next
  next = (previous ? previous.promise.catch(() => {}) : Promise.resolve())
    .then(task)
    .finally(() => {
      const current = sessionChains.get(key)
      if (current && current.promise === next) sessionChains.delete(key)
    })
  sessionChains.set(key, { promise: next, depth })
  return next
}

/** Takes the lock only if the session is free; otherwise reports `{ locked: true }`. */
export async function tryWithSessionLock(sessionId, task) {
  if (isSessionBusy(sessionId)) return { locked: true }
  const value = await withSessionLock(sessionId, task)
  return { locked: false, value }
}

// --- session introspection ---------------------------------------------------
async function resolveAgentQuiet(scope, sessionId) {
  if (!scope?.sessionController) return null
  try {
    const resolved = await scope.sessionController.resolveAgent(sessionId)
    if (resolved && typeof resolved === 'object' && !('error' in resolved) && resolved.agent) {
      return resolved.agent
    }
  } catch {
    /* a missing/racing session is reported as "not busy" */
  }
  return null
}

/** Messages waiting in the DSH agent inbox: user text and follow-ups queued. */
function pendingMessages(agent) {
  const inbox = agent?.inbox
  if (!inbox) return 0
  let count = 0
  for (const key of ['nextTurn', 'nextStep']) {
    if (Array.isArray(inbox[key])) count += inbox[key].length
  }
  if (typeof inbox.size === 'function') {
    try {
      count = Math.max(count, Number(inbox.size()) || 0)
    } catch {
      /* optional probe */
    }
  }
  return count
}

function agentStatus(agent) {
  return typeof agent?.status === 'string' ? agent.status : 'idle'
}

/**
 * What a session is doing right now. `busy` is true when a turn is running, when
 * the DSH inbox has queued work, or when the plugin itself holds its lock.
 */
export async function sessionSnapshot(scope, sessionId) {
  const agent = await resolveAgentQuiet(scope, sessionId)
  const status = agentStatus(agent)
  const pending = pendingMessages(agent)
  let lastUserAt = 0
  let events = 0
  if (agent) {
    try {
      const list = agent.session.snapshotEvents()
      if (Array.isArray(list)) {
        events = list.length
        for (let index = list.length - 1; index >= 0; index -= 1) {
          if (list[index]?.type !== 'user/message') continue
          const time = Number(list[index].time ?? 0)
          lastUserAt = Number.isFinite(time) ? time : 0
          break
        }
      }
    } catch {
      /* a cold session has no snapshot yet */
    }
  }
  return {
    exists: Boolean(agent),
    status,
    pending,
    events,
    lastUserAt,
    running: status !== 'idle',
    locked: isSessionBusy(sessionId),
    busy: status !== 'idle' || pending > 0,
  }
}

/** Epoch ms of the last `user/message` in a session, or 0 if unknown. */
export async function lastUserActivityAt(scope, sessionId) {
  const snapshot = await sessionSnapshot(scope, sessionId)
  return snapshot.lastUserAt
}

/**
 * Waits (inside the mutex) until the session is really idle: no running turn and
 * no queued inbox work. Returns the fresh agent, or null when the budget runs out.
 */
async function waitUntilIdle(scope, sessionId, timeoutMs) {
  const deadline = Date.now() + Math.max(1000, timeoutMs)
  let agent = await resolveAgentQuiet(scope, sessionId)
  for (;;) {
    if (agentStatus(agent) === 'idle' && pendingMessages(agent) === 0) return agent
    const remaining = deadline - Date.now()
    if (remaining <= 0) return null
    const outcome = await waitTurn(scope, sessionId, Math.min(remaining, 10000))
    if (outcome === 'error') return null
    agent = await resolveAgentQuiet(scope, sessionId)
  }
}

function lastAssistantText(events) {
  for (let index = events.length - 1; index >= 0; index -= 1) {
    const event = events[index]
    if (event?.type !== 'assistant/message') continue
    const content = event?.data?.message?.content
    if (!Array.isArray(content)) continue
    const text = content
      .filter(block => block && block.type === 'text' && typeof block.text === 'string')
      .map(block => block.text)
      .join('\n')
      .trim()
    if (text) return text
  }
  return ''
}

/** Prompt content from a message plus `{ mimeType | mediaType, dataBase64 | data, name }` images. */
export function promptParts(message, images) {
  const parts = []
  for (const image of Array.isArray(images) ? images : []) {
    const mediaType = String(image?.mediaType || image?.mimeType || '').toLowerCase()
    const data = String(image?.dataBase64 || image?.data || '').replace(/^data:[^;]+;base64,/, '').replace(/\s+/g, '')
    if (!data || !['image/png', 'image/jpeg', 'image/webp', 'image/gif'].includes(mediaType)) continue
    const part = { type: 'image', mediaType, data }
    if (typeof image?.name === 'string' && image.name) part.name = image.name.slice(0, 120)
    parts.push(part)
  }
  parts.push({ type: 'text', text: message || 'Te envío una imagen.' })
  return parts
}

/** Resolve or create a session; applies the permission preset and persona. */
export async function ensureSession(scope, options = {}) {
  if (!scope?.sessionController) throw new Error('sessionController unavailable')
  const config = loadConfig()
  const state = loadState()
  const sessionId = typeof options.sessionId === 'string' && options.sessionId
    ? options.sessionId
    : sharedSessionId(config, state)
  const controller = scope.sessionController
  const cwd = typeof options.cwd === 'string' && options.cwd ? options.cwd : config.cwd

  let agent = null
  const existing = await controller.resolveAgent(sessionId)
  if (existing && typeof existing === 'object' && !('error' in existing) && existing.agent) {
    agent = existing.agent
  } else {
    const request = { sessionId, cwd }
    if (config.agentPreset) request.agentPreset = config.agentPreset
    await controller.create(request)
    const created = await controller.resolveAgent(sessionId)
    if (created && typeof created === 'object' && !('error' in created) && created.agent) agent = created.agent
  }
  if (!agent) throw new Error(`la sesión ${sessionId} no está disponible`)

  try {
    const presets = permissionPresets(scope)
    if (presets && typeof presets.set === 'function') presets.set(agent.session, config.permissionPreset)
  } catch {
    /* keep the profile default */
  }
  bindPersona(agent, config)
  return { agent, sessionId, config, state }
}

/** Runs one turn in a session (the shared one by default) and returns its final assistant text. */
export async function askSession(scope, parts, options = {}) {
  if (!scope?.sessionController) throw new Error('sessionController unavailable')
  const config = loadConfig()
  const state = loadState()
  const sessionId = typeof options.sessionId === 'string' && options.sessionId
    ? options.sessionId
    : sharedSessionId(config, state)

  // `ifBusy: 'skip'` is for opportunistic turns (the periodic review): it must
  // never queue behind anything, so a busy session means "not now, no prompt".
  if (options.ifBusy === 'skip') {
    const acquired = await tryWithSessionLock(sessionId, () => runTurnLocked(scope, parts, options, sessionId))
    if (acquired.locked) return { outcome: 'busy', text: '', sessionId, skipped: true }
    return acquired.value
  }
  return withSessionLock(sessionId, () => runTurnLocked(scope, parts, options, sessionId))
}

async function runTurnLocked(scope, parts, options, sessionId) {
  const { config } = await ensureSession(scope, { ...options, sessionId })

  // The idle check happens *inside* the mutex and as late as possible: from the
  // final check to `prompt()` there is no other await in this function, so no
  // other plugin turn can slip in between.
  const idleAgent = await waitUntilIdle(scope, sessionId, Number(options.idleTimeoutMs) || config.turnTimeoutMs)
  if (!idleAgent) return { outcome: 'timeout', text: '', sessionId, skipped: true }
  if (agentStatus(idleAgent) !== 'idle' || pendingMessages(idleAgent) > 0) {
    return { outcome: 'busy', text: '', sessionId, skipped: true }
  }

  const before = idleAgent.session.snapshotEvents().length
  const ended = waitTurn(scope, sessionId, config.turnTimeoutMs)
  const requestId = `whale-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`
  const request = { requestId, sessionId, mode: 'queue', content: parts }

  try {
    await scope.sessionController.prompt(request, new AbortController().signal)
  } catch (error) {
    const textOnly = Array.isArray(parts) ? parts.filter(part => part?.type === 'text') : []
    if (textOnly.length === 0 || textOnly.length === parts.length) {
      ended.cancel()
      throw error
    }
    try {
      await scope.sessionController.prompt({ ...request, content: textOnly }, new AbortController().signal)
    } catch (retryError) {
      ended.cancel()
      throw retryError
    }
  }

  const outcome = await ended
  return { outcome, text: lastAssistantText(idleAgent.session.snapshotEvents().slice(before)), sessionId }
}

/** Recent transcript of the session the in-page chat actually uses. */
export async function historyJson(scope) {
  if (!scope?.sessionController) return { messages: [] }
  try {
    const config = loadConfig()
    const state = loadState()
    const sessionId = config.lightChat === false
      ? sharedSessionId(config, state)
      : lightSessionId(config, state)
    const resolved = await scope.sessionController.resolveAgent(sessionId)
    if (!resolved || typeof resolved !== 'object' || 'error' in resolved || !resolved.agent) return { messages: [] }
    const messages = []
    for (const event of resolved.agent.session.snapshotEvents()) {
      const text = messageText(event)
      if (!text) continue
      if (event.type === 'user/message') messages.push({ role: 'user', text, at: event.time ?? 0 })
      else if (event.type === 'assistant/message') messages.push({ role: 'bot', text, at: event.time ?? 0 })
    }
    return { messages: messages.slice(-30) }
  } catch {
    return { messages: [] }
  }
}

/**
 * A short digest of the main (shared) conversation, so a light session keeps the
 * thread without paying for the whole transcript. Returns '' when unavailable.
 */
export async function sharedTranscript(scope, limit = 8) {
  if (!scope?.sessionController) return ''
  try {
    const config = loadConfig()
    const state = loadState()
    const sessionId = sharedSessionId(config, state)
    const resolved = await scope.sessionController.resolveAgent(sessionId)
    if (!resolved || typeof resolved !== 'object' || 'error' in resolved || !resolved.agent) return ''
    const name = config.personaName || DEFAULTS_NAME
    const owner = ownerName(config)
    const turns = []
    for (const event of resolved.agent.session.snapshotEvents()) {
      if (event?.type !== 'user/message' && event?.type !== 'assistant/message') continue
      const text = messageText(event)
      if (!text) continue
      const who = event.type === 'user/message' ? owner : name
      turns.push(`${who}: ${text.replace(/\s+/g, ' ').trim().slice(0, 240)}`)
    }
    return turns.slice(-Math.max(1, limit)).join('\n')
  } catch {
    return ''
  }
}

const DEFAULTS_NAME = 'Whale-chan'

function messageText(event) {
  const content = Array.isArray(event?.data?.content)
    ? event.data.content
    : (Array.isArray(event?.data?.message?.content) ? event.data.message.content : [])
  return content
    .filter(block => block && block.type === 'text' && typeof block.text === 'string')
    .map(block => block.text)
    .join('\n')
    .trim()
}
