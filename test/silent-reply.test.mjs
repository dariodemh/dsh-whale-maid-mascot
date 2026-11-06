// Silent-reply (SKIP) tests for the Telegram bridge.
// Run with: node --test test/silent-reply.test.mjs
//
// The convention is: when a turn needs no answer, the agent replies exactly
// "SKIP". That must be real silence on Telegram: no final message, no streamed
// leak while the turn is still running, and no typing indicator.
import { test, after } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const HOME = mkdtempSync(join(tmpdir(), 'whm-silent-'))
process.env.DSH_HOME = HOME
process.env.WHM_MEMORY_DIR = join(HOME, 'memory')

const { WhaleTelegram, isSilentReply } = await import('../dsh/telegram.js')

after(() => rmSync(HOME, { recursive: true, force: true }))

test('isSilentReply accepts only an exact, trimmed, case-insensitive SKIP', () => {
  for (const text of ['SKIP', 'skip', 'Skip', ' SKIP ', '\nskip\t', '  sKiP  ']) {
    assert.equal(isSilentReply(text), true, JSON.stringify(text))
  }
  for (const text of ['SKIP algo', 'SKIP algo\n', 'skip.', 'no SKIP', 'SKIPP', 'hola', '', '   ', null, undefined, 0]) {
    assert.equal(isSilentReply(text), false, JSON.stringify(text))
  }
})

/** A bridge wired to a fake scope and bot; no network, no DSH process. */
function makeBridge({ streamReplies = true } = {}) {
  const handlers = []
  const scope = {
    logger: { info() {}, warn() {} },
    on(event, handler) {
      const entry = { event, handler }
      handlers.push(entry)
      return () => {
        const index = handlers.indexOf(entry)
        if (index >= 0) handlers.splice(index, 1)
      }
    },
  }
  const bridge = new WhaleTelegram(scope, { cwd: HOME, streamReplies })
  const sent = []
  const actions = []
  bridge.bot = {
    async sendMessage(chatId, text) {
      sent.push({ chatId, text })
      return { message_id: sent.length }
    },
    async editMessageText(chatId, messageId, text) {
      sent.push({ chatId, text, edit: true })
    },
    async sendChatAction(chatId, action) {
      actions.push({ chatId, action })
    },
  }
  const emit = frame => {
    for (const entry of handlers.slice()) {
      if (entry.event === 'agent/assistant-stream') {
        entry.handler({ agent: { id: 'sess-1' }, frame })
      }
    }
  }
  return { bridge, sent, actions, emit }
}

test('a streamed SKIP never leaks to Telegram', async () => {
  const { bridge, sent, emit } = makeBridge()
  const stream = bridge.startStream('42', 'sess-1')
  emit({ type: 'chunk', chunk: { type: 'text-delta', text: 'SK' } })
  emit({ type: 'chunk', chunk: { type: 'text-delta', text: 'IP' } })
  const shown = await stream.finish('SKIP')
  assert.deepEqual(shown, { sent: false, silent: true })
  assert.equal(sent.length, 0, 'no message was sent')
})

test('typing only starts once there is real text to show', async () => {
  const { bridge, emit } = makeBridge()
  let activity = 0
  const silent = bridge.startStream('42', 'sess-1', () => { activity += 1 })
  emit({ type: 'chunk', chunk: { type: 'text-delta', text: 'SKIP' } })
  await silent.finish('SKIP')
  assert.equal(activity, 0, 'a silent turn never starts typing')

  const normal = bridge.startStream('42', 'sess-1', () => { activity += 1 })
  emit({ type: 'chunk', chunk: { type: 'text-delta', text: 'Hola' } })
  await normal.finish('Hola')
  assert.ok(activity > 0, 'real text does start typing')
})

test('normal replies and "SKIP algo" are still sent', async () => {
  const normal = makeBridge()
  const normalStream = normal.bridge.startStream('42', 'sess-1')
  normal.emit({ type: 'chunk', chunk: { type: 'text-delta', text: 'Hola' } })
  const shown = await normalStream.finish('Hola')
  assert.equal(shown.silent, false)
  assert.equal(shown.sent, true)
  assert.equal(normal.sent[0].text, 'Hola')

  const notSilent = makeBridge()
  const otherStream = notSilent.bridge.startStream('42', 'sess-1')
  notSilent.emit({ type: 'chunk', chunk: { type: 'text-delta', text: 'SKIP algo' } })
  const other = await otherStream.finish('SKIP algo')
  assert.equal(other.silent, false)
  assert.equal(other.sent, true)
  assert.equal(notSilent.sent[0].text, 'SKIP algo')
})

test('sendText refuses a silent reply and still sends real text', async () => {
  const { bridge, sent } = makeBridge()
  await bridge.sendText('42', 'SKIP')
  await bridge.sendText('42', '  skip  ')
  assert.equal(sent.length, 0)
  await bridge.sendText('42', 'SKIP algo')
  assert.equal(sent.length, 1)
  assert.equal(sent[0].text, 'SKIP algo')
})
