/**
 * The periodic self-review: the mascot looks around and decides, on her own,
 * whether writing to the owner is worth a message.
 *
 * Hard rule since 2.7.0: **the review never runs an agent turn**. It is one
 * bounded, tool-less model call that only sees context precomputed by the host
 * (the tail of the main conversation and the recently touched files). That is
 * what keeps it from picking up shell/file tools and from crossing the
 * conversation the owner is having in another surface at that very moment.
 *
 * Everything here is pure so the gating can be unit-tested without a DSH
 * process, a Telegram bot or a real provider.
 */
import { personaText } from './config.js'

export const REVIEW_DEFAULTS = {
  everyMs: 60 * 60 * 1000,
  cooldownMs: 60 * 60 * 1000,
  activityGuardMs: 10 * 60 * 1000,
  skipCooldownMs: 60 * 60 * 1000,
  dedupeMs: 30 * 60 * 1000,
  timeoutMs: 60 * 1000,
  maxSteps: 2,
  maxTokens: 260,
  recentFilesMinutes: 30,
}

// The review never runs more often than this, whatever the config says: a
// shorter interval is what used to fire empty turns every few minutes.
export const REVIEW_MIN_INTERVAL_MS = 60 * 60 * 1000

function num(value, fallback) {
  const parsed = Number(value)
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : fallback
}

/** Normalizes the review knobs, with the documented defaults and sane floors. */
export function reviewConfig(config = {}) {
  const cooldownMs = Math.max(60000, num(config.reviewCooldownMs, REVIEW_DEFAULTS.cooldownMs))
  return {
    enabled: config.reviewEnabled !== false,
    everyMs: Math.max(REVIEW_MIN_INTERVAL_MS, num(config.reviewEveryMs, REVIEW_DEFAULTS.everyMs)),
    cooldownMs,
    activityGuardMs: Math.max(0, num(config.reviewActivityGuardMs, REVIEW_DEFAULTS.activityGuardMs)),
    skipCooldownMs: Math.max(60000, num(config.reviewSkipCooldownMs, cooldownMs)),
    dedupeMs: Math.max(60000, num(config.reviewDedupeMs, REVIEW_DEFAULTS.dedupeMs)),
    timeoutMs: Math.max(5000, num(config.reviewTimeoutMs, REVIEW_DEFAULTS.timeoutMs)),
    maxSteps: Math.max(0, num(config.reviewMaxSteps, REVIEW_DEFAULTS.maxSteps)),
    maxTokens: Math.max(80, num(config.reviewMaxTokens, REVIEW_DEFAULTS.maxTokens)),
    recentFilesMinutes: Math.max(1, num(config.reviewRecentFilesMinutes, REVIEW_DEFAULTS.recentFilesMinutes)),
    provider: config.reviewProvider || config.model?.provider || process.env.WHM_PROVIDER || 'opencode-go',
    model: config.reviewModel || config.model?.model || process.env.WHM_MODEL || 'deepseek-v4.1-flash',
  }
}

/**
 * Decides whether this tick may run a review. Returns `{ run, reason }`; the
 * reason is what gets written to whale-maid.log so a tick can be audited later.
 *
 * Order matters: the reasons that mean "the owner is busy right now" win over
 * the cooldowns, because they are the ones that used to cause crossed messages.
 */
export function decideReview(input = {}) {
  const {
    now = Date.now(),
    cfg = REVIEW_DEFAULTS,
    stopped = false,
    hasBot = true,
    busy = false,
    hasTarget = true,
    lastProactiveAt = 0,
    lastProbeAt = 0,
    lastOutcome = '',
    lastFingerprint = '',
    fingerprint = '',
    userActivityAt = 0,
    sharedBusy = false,
  } = input

  if (stopped) return { run: false, reason: 'stopped' }
  if (!hasBot) return { run: false, reason: 'no-bot' }
  if (busy) return { run: false, reason: 'already-running' }
  if (!hasTarget) return { run: false, reason: 'no-target' }
  // An active or queued user turn in the shared session: never add a second
  // turn to that conversation, not even a "queued" one.
  if (sharedBusy) return { run: false, reason: 'shared-session-busy' }
  // The owner wrote in the last `reviewActivityGuardMs` (10 min by default).
  if (userActivityAt > 0 && now - userActivityAt < cfg.activityGuardMs) {
    return { run: false, reason: 'user-active' }
  }
  // Do not pile messages: respect the cooldown after the last sent message.
  if (lastProactiveAt > 0 && now - lastProactiveAt < cfg.cooldownMs) {
    return { run: false, reason: 'cooldown-sent' }
  }
  // A previous probe wrote nothing: wait before spending another turn.
  if (lastProbeAt > 0 && lastOutcome !== 'sent' && now - lastProbeAt < cfg.skipCooldownMs) {
    return { run: false, reason: 'cooldown-skip' }
  }
  // Nothing changed since the last probe and it was recent: stay quiet.
  if (fingerprint && fingerprint === lastFingerprint && lastProbeAt > 0 && now - lastProbeAt < cfg.dedupeMs) {
    return { run: false, reason: 'unchanged' }
  }
  return { run: true, reason: 'due' }
}

/** The review instruction. No tools, no exploration: decide with this context only. */
export function reviewPrompt({ personaName = 'Whale-chan', digest = '', files = [], now = Date.now(), maxSteps = REVIEW_DEFAULTS.maxSteps } = {}) {
  const when = new Date(now).toLocaleString(undefined, {
    weekday: 'long',
    hour: '2-digit',
    minute: '2-digit',
  })
  const lines = [
    `Sos ${personaName} en tu turno de revisión. Nadie te escribió: mirás el contexto que ya te dieron y decidís si vale la pena escribirle un mensaje por Telegram, o quedarte callada.`,
    `Ahora es: ${when}.`,
    '',
    'Este turno NO tiene herramientas: no podés leer archivos, correr comandos, buscar ni explorar. No hay pasos de herramientas disponibles y no los necesitás: decidí únicamente con lo que está en este mensaje.',
  ]
  if (digest) lines.push('', 'Último tramo de la conversación principal:', digest)
  if (files.length > 0) lines.push('', 'Archivos tocados hace poco (ya leídos por vos, no hace falta abrirlos):', ...files.map(file => `- ${file}`))
  lines.push(
    '',
    'Reglas:',
    `- Si no hay nada que realmente valga la pena, respondé exactamente: SKIP`,
    '- Si sí, escribí solo el mensaje: 1 a 3 frases, cálido y concreto, sin explicar el mecanismo ni mencionar que revisaste nada.',
    '- No inventes datos ni recuerdos. Si no estás segura, mejor SKIP.',
    '- Nada de recordatorios genéricos del tipo "¿cómo va todo?": solo cosas que viste y que merecen su atención.',
    `- Presupuesto: una sola respuesta, sin pasos de herramientas (máximo ${maxSteps}), y nada de explorar.`,
  )
  return lines.join('\n')
}

/** System prompt for the review call: the character persona plus her live memory. */
export function reviewSystem(config) {
  return personaText(config)
}

/**
 * One bounded, tool-less model call. Resolves `{ text, timedOut, steps }` and
 * never throws for a timeout: an over-budget review is a silent SKIP.
 */
export async function reviewReply({ llm, cfg = REVIEW_DEFAULTS, system = '', prompt = '', sessionId = 'whale-maid-review' } = {}) {
  if (!llm || typeof llm.stream !== 'function') throw new Error('llm service unavailable')
  const controller = new AbortController()
  let stream = null
  let timer = null
  const timeout = new Promise(resolve => {
    timer = setTimeout(() => resolve({ timedOut: true, text: '', steps: 0 }), cfg.timeoutMs)
  })
  const work = (async () => {
    stream = llm.stream({
      provider: cfg.provider,
      model: cfg.model,
      system,
      messages: [{ role: 'user', content: [{ type: 'text', text: prompt }] }],
      temperature: 0.7,
      maxTokens: cfg.maxTokens,
      sessionId,
      signal: controller.signal,
    })
    let text = ''
    for await (const chunk of stream) {
      if (!chunk) continue
      if (chunk.type === 'text-delta' && typeof chunk.text === 'string') {
        text += chunk.text
      } else if (chunk.type === 'finish') {
        const reason = chunk.reason || {}
        if (reason.kind === 'error') {
          const failure = reason.failure || {}
          const detail = failure.message || failure.detail || failure.code || 'unknown error'
          throw new Error(`model error: ${String(detail).slice(0, 240)}`)
        }
        if (reason.kind === 'aborted') throw new Error('model aborted')
        break
      }
    }
    return { text, timedOut: false, steps: 0 }
  })()
  try {
    const result = await Promise.race([work, timeout])
    if (result?.timedOut) {
      try {
        controller.abort()
      } catch {
        /* already aborted */
      }
      // Fire-and-forget: an adapter that ignores `signal` would never resolve
      // `return()` while the generator is stuck on a pending await, and the
      // timeout must stay a hard bound even then.
      try {
        if (stream && typeof stream.return === 'function') {
          const closed = stream.return()
          if (closed && typeof closed.catch === 'function') closed.catch(() => {})
        }
      } catch {
        /* the stream may already be closed */
      }
    }
    return result
  } finally {
    if (timer) clearTimeout(timer)
  }
}

/** True when the review reply is a silent skip. */
export function isReviewSkip(text) {
  const clean = String(text ?? '').trim()
  return clean === '' || /^skip\b/i.test(clean)
}
