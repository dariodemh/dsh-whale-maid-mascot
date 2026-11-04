/**
 * Smoke test for the Telegram side of Whale-chan (`dsh/telegram.js`) without DSH
 * or Telegram: mocks the host context and fetch, then drives pairing, a streamed
 * turn, a native image, the shared mascot memory and the commands.
 *
 * Run: node test/telegram.smoke.mjs
 */
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import assert from 'node:assert'

const home = mkdtempSync(join(tmpdir(), 'whale-test-'))
process.env.DSH_HOME = home

mkdirSync(join(home, 'whale-maid-mascot'), { recursive: true })
const memoryFile = join(home, 'whale-maid-mascot', 'memory.json')
writeFileSync(memoryFile, JSON.stringify({
  version: 1,
  users: {
    'u-1': { name: 'Nori', facts: ['Trabaja en un plugin de ballena.'], preferences: ['llamar a la mascota Whale-chan'], turns: 39 },
  },
}, null, 2))

const sent = []
const edits = []
const prompts = []
const sessions = new Map()
const listeners = []
const sections = []
const tools = []
const events = []
const json = (value) => new Response(JSON.stringify(value), { status: 200, headers: { 'content-type': 'application/json' } })
const jpeg = () => new Response(new Uint8Array([0xff, 0xd8, 0xff, 0xe0]), { status: 200 })

let updates = []
const pushUpdate = (update) => { updates.push(update) }

globalThis.fetch = async (url, init = {}) => {
  const target = String(url)
  if (target.includes('/file/bot')) return jpeg()
  const method = target.split('/').pop()
  if (method === 'getUpdates') {
    const batch = updates.splice(0, updates.length)
    if (batch.length === 0) await new Promise(resolve => setTimeout(resolve, 30))
    return json({ ok: true, result: batch })
  }
  if (method === 'sendMessage') { sent.push(JSON.parse(init.body)); return json({ ok: true, result: { message_id: 100 + sent.length } }) }
  if (method === 'editMessageText') { edits.push(JSON.parse(init.body)); return json({ ok: true, result: { message_id: 100 } }) }
  if (method === 'sendChatAction') return json({ ok: true, result: true })
  if (method === 'getFile') return json({ ok: true, result: { file_path: 'photos/1.jpg' } })
  return json({ ok: false, description: 'unexpected ' + method })
}

const makeAgent = (id) => ({
  id,
  status: 'idle',
  ctx: {
    systemPrompt: { section: (options) => { sections.push(options); return () => undefined } },
    tools: { register: (spec) => { tools.push(spec); return () => undefined } },
  },
  session: { id, snapshotEvents: () => events },
})

const ctx = {
  logger: { info: () => {}, warn: () => {} },
  on: (name, callback) => {
    const entry = { name, callback }
    listeners.push(entry)
    return () => { const index = listeners.indexOf(entry); if (index >= 0) listeners.splice(index, 1) }
  },
  effect: (fn) => fn(),
  get: (name) => (name === 'tools' ? { register: (spec) => { tools.push(spec); return () => undefined } } : undefined),
  inject: (_services, callback) => callback(ctx),
  sessionController: {
    async resolveAgent(id) {
      const live = sessions.get(id)
      return live ? { agent: live } : { error: { code: 'session/not-found' } }
    },
    async create(request) {
      sessions.set(request.sessionId, makeAgent(request.sessionId))
      return { sessionId: request.sessionId }
    },
    async rename() { return { title: 'x', seq: 1 } },
    async selectModel(request) { return { selected: { provider: request.provider, model: request.model } } },
    async modelCatalog() {
      return { default: { provider: 'opencode-go', model: 'deepseek-v4.1-flash' }, groups: [{ id: 'opencode-go', name: 'OpenCode Go', models: [{ id: 'deepseek-v4.1-flash' }, { id: 'deepseek-v4.1' }] }] }
    },
    async prompt(request) {
      prompts.push(request)
      const agent = sessions.get(request.sessionId)
      for (const entry of [...listeners]) {
        if (entry.name === 'agent/assistant-stream') entry.callback({ agent, frame: { type: 'chunk', chunk: { type: 'text-delta', index: 0, text: 'Hola, soy ' } } })
      }
      events.push({ type: 'assistant/message', data: { message: { content: [{ type: 'text', text: 'Hola, soy Whale-chan.' }] } } })
      setTimeout(() => {
        for (const entry of [...listeners]) {
          if (entry.name === 'agent/assistant-stream') entry.callback({ agent, frame: { type: 'chunk', chunk: { type: 'text-delta', index: 1, text: 'Whale-chan.' } } })
        }
        for (const entry of [...listeners]) {
          if (entry.name === 'session/event') entry.callback({ id: request.sessionId }, { type: 'turn/end', data: {} })
        }
      }, 30)
      return { accepted: true }
    },
    cancel() { return { accepted: true } },
  },
}

const { apply } = await import('../dsh/telegram.js')
let dispose = () => {}
ctx.effect = (fn) => { dispose = fn(); return dispose }

apply(ctx, { token: '123:test', personaName: 'Whale-chan' })
const wait = (ms) => new Promise(resolve => setTimeout(resolve, ms))

const pairingFile = join(home, 'whale-maid.pairing.txt')
assert.ok(existsSync(pairingFile), 'pairing file written')
const code = /Código:\s*([0-9a-f]+)/i.exec(readFileSync(pairingFile, 'utf8'))[1]

pushUpdate({ update_id: 1, message: { message_id: 10, from: { id: 42, is_bot: false }, chat: { id: 42 }, text: `/pair ${code}` } })
await wait(250)
pushUpdate({ update_id: 2, message: { message_id: 11, from: { id: 42, is_bot: false }, chat: { id: 42 }, text: 'hola' } })
await wait(700)
assert.equal(prompts.length, 1)
assert.ok(sent.some(m => String(m.text).startsWith('Hola, soy')), 'stream starts')
assert.ok(edits.some(m => String(m.text).includes('Hola, soy Whale-chan')), 'stream completes')
assert.ok(sections.length >= 1, 'persona bound once')
assert.match(sections[0].text(), /Nori/)

pushUpdate({ update_id: 3, message: { message_id: 12, from: { id: 42, is_bot: false }, chat: { id: 42 }, photo: [{ file_id: 'f1', file_size: 900 }], caption: 'mirá' } })
await wait(700)
const imagePrompt = prompts.at(-1)
assert.equal(imagePrompt.content[0].type, 'image')
assert.equal(imagePrompt.content[0].mediaType, 'image/jpeg')
assert.match(imagePrompt.content[1].text, /mirá/)

const remember = tools.find(t => t.name === 'whale_remember')
assert.ok(remember, 'whale_remember registered')
assert.ok(tools.find(t => t.name === 'telegram_send'), 'telegram_send registered')
assert.equal((await remember.execute({ kind: 'fact', value: 'Prefiere respuestas cortas.' })).remembered, true)
assert.ok(JSON.parse(readFileSync(memoryFile, 'utf8')).users['u-1'].facts.includes('Prefiere respuestas cortas.'))

pushUpdate({ update_id: 4, message: { message_id: 13, from: { id: 42, is_bot: false }, chat: { id: 42 }, text: '/memory' } })
await wait(300)
assert.ok(sent.some(m => String(m.text).includes('Nori')), '/memory works')

pushUpdate({ update_id: 5, message: { message_id: 14, from: { id: 42, is_bot: false }, chat: { id: 42 }, text: '/models' } })
await wait(300)
assert.ok(sent.some(m => String(m.text).includes('deepseek-v4.1')), '/models works')

const state = JSON.parse(readFileSync(join(home, 'whale-maid.state.json'), 'utf8'))
assert.equal(typeof state.sharedSession, 'string')

dispose()
console.log('telegram smoke OK')
console.log('sent:', sent.length, 'edits:', edits.length, 'prompts:', prompts.length, 'sections:', sections.length)
