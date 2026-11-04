/**
 * One shared DSH agent session behind every Whale-chan surface.
 *
 * The in-page mascot chat and the Telegram bridge both call these helpers, so a
 * message sent from one place is part of the same conversation (and the same
 * tools) as a message sent from the other. The persona section is bound once per
 * live agent, no matter which surface reached it first.
 */
import { loadConfig, loadState, personaText, sharedSessionId } from './config.js'

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
  return new Promise(resolve => {
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

/** Resolve or create the shared session; applies the permission preset and persona. */
export async function ensureSession(scope) {
  if (!scope?.sessionController) throw new Error('sessionController unavailable')
  const config = loadConfig()
  const state = loadState()
  const sessionId = sharedSessionId(config, state)
  const controller = scope.sessionController

  let agent = null
  const existing = await controller.resolveAgent(sessionId)
  if (existing && typeof existing === 'object' && !('error' in existing) && existing.agent) {
    agent = existing.agent
  } else {
    const request = { sessionId, cwd: config.cwd }
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

/** Runs one turn in the shared session and returns its final assistant text. */
export async function askSession(scope, parts) {
  const { agent, sessionId, config } = await ensureSession(scope)
  if (agent.status && agent.status !== 'idle') await waitTurn(scope, sessionId, 10 * 60 * 1000)

  const before = agent.session.snapshotEvents().length
  const ended = waitTurn(scope, sessionId, config.turnTimeoutMs)
  const requestId = `whale-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`
  const request = { requestId, sessionId, mode: 'queue', content: parts }

  try {
    await scope.sessionController.prompt(request, new AbortController().signal)
  } catch (error) {
    const textOnly = Array.isArray(parts) ? parts.filter(part => part?.type === 'text') : []
    if (textOnly.length === 0 || textOnly.length === parts.length) throw error
    await scope.sessionController.prompt({ ...request, content: textOnly }, new AbortController().signal)
  }

  const outcome = await ended
  return { outcome, text: lastAssistantText(agent.session.snapshotEvents().slice(before)), sessionId }
}

/** Recent transcript of the shared session, for the in-page chat panel. */
export async function historyJson(scope) {
  if (!scope?.sessionController) return { messages: [] }
  try {
    const config = loadConfig()
    const state = loadState()
    const sessionId = sharedSessionId(config, state)
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
