// Light session + proactive review regression tests.
// Run with: node --test test/light-session.test.mjs
//
// These pin the wiring that keeps the in-page chat from queueing behind a heavy
// agent turn (its own `<shared>-chat` session plus a digest of the main
// conversation) and the session the periodic review runs in. No real provider,
// no running DSH app: the session controller is a small in-memory fake.
import { test, after } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const HOME = mkdtempSync(join(tmpdir(), 'whm-light-'))
process.env.DSH_HOME = HOME
process.env.WHM_MEMORY_DIR = join(HOME, 'memory')

const {
  DEFAULTS,
  lightSessionId,
  loadConfig,
  loadState,
  ownerName,
  reviewSessionId,
  sharedSessionId,
} = await import('../dsh/config.js')
const { historyJson, sharedTranscript } = await import('../dsh/session.js')

after(() => rmSync(HOME, { recursive: true, force: true }))

/** Config file used by the tests, since loadConfig() reads it from disk. */
function writeConfig(values) {
  writeFileSync(join(HOME, 'whale-maid.json'), `${JSON.stringify(values, null, 2)}\n`, 'utf8')
}

/** A session controller that only knows about the ids in `sessions`. */
function controller(sessions) {
  return {
    async resolveAgent(sessionId) {
      const events = sessions[sessionId]
      if (!events) return null
      return { agent: { session: { snapshotEvents: () => events } } }
    },
  }
}

function textEvent(type, text) {
  return { type, data: { content: [{ type: 'text', text }] } }
}

test('the light chat runs in a sibling session, not the shared one', () => {
  const config = loadConfig()
  const state = loadState()
  assert.equal(sharedSessionId(config, state), 'whale-maid')
  assert.equal(lightSessionId(config, state), 'whale-maid-chat')
  assert.notEqual(lightSessionId(config, state), sharedSessionId(config, state))
})

test('lightChat: false keeps one single session', () => {
  writeConfig({ lightChat: false })
  const config = loadConfig()
  assert.equal(config.lightChat, false)
  rmSync(join(HOME, 'whale-maid.json'))
})

test('light and review session ids follow the shared id and accept overrides', () => {
  const config = { ...DEFAULTS, sessionId: 'base' }
  const state = { sharedSession: null }
  assert.equal(lightSessionId(config, state), 'base-chat')
  assert.equal(reviewSessionId(config, state), 'base-review')
  assert.equal(lightSessionId({ ...config, lightSessionId: 'custom-chat' }, state), 'custom-chat')
  assert.equal(reviewSessionId({ ...config, reviewSessionId: 'custom-review' }, state), 'custom-review')
  assert.equal(lightSessionId({ ...config, lightSessionSuffix: '-lenta' }, state), 'base-lenta')
  // the state's pinned shared session wins over config.sessionId
  assert.equal(lightSessionId(config, { sharedSession: 'pinned' }), 'pinned-chat')
})

test('ownerName is neutral by default and takes an override', () => {
  assert.equal(ownerName({}), 'el dueño')
  assert.equal(ownerName({ ownerName: '   ' }), 'el dueño')
  assert.equal(ownerName({ ownerName: 'Ana' }), 'Ana')
})

test('sharedTranscript labels the two sides and keeps only the last turns', async () => {
  writeConfig({ ownerName: 'Ana', personaName: 'Mascota' })
  const events = []
  for (let index = 0; index < 12; index += 1) {
    events.push(textEvent(index % 2 === 0 ? 'user/message' : 'assistant/message', `linea ${index}`))
  }
  const scope = { sessionController: controller({ 'whale-maid': events }) }
  const digest = await sharedTranscript(scope, 4)
  const lines = digest.split('\n')
  assert.equal(lines.length, 4)
  assert.equal(lines[0], 'Ana: linea 8')
  assert.equal(lines[1], 'Mascota: linea 9')
  assert.equal(lines[3], 'Mascota: linea 11')
  rmSync(join(HOME, 'whale-maid.json'))
})

test('sharedTranscript collapses whitespace, truncates and fails soft', async () => {
  const long = `  hola\n\n  mundo  ${'x'.repeat(400)}  `
  const scope = { sessionController: controller({ 'whale-maid': [textEvent('user/message', long)] }) }
  const digest = await sharedTranscript(scope, 8)
  const [who, ...rest] = digest.split(': ')
  assert.equal(who, 'el dueño')
  const body = rest.join(': ')
  assert.ok(body.startsWith('hola mundo '))
  assert.ok(body.length <= 240)
  assert.equal(await sharedTranscript({}, 8), '')
  assert.equal(await sharedTranscript({ sessionController: controller({}) }, 8), '')
})

test('the transcript panel reads the light session, or the shared one when disabled', async () => {
  const chatEvents = [textEvent('user/message', 'hola desde la pagina')]
  const sharedEvents = [textEvent('user/message', 'hola desde telegram')]
  const scope = { sessionController: controller({ 'whale-maid-chat': chatEvents, 'whale-maid': sharedEvents }) }
  const light = await historyJson(scope)
  assert.deepEqual(light.messages.map(message => message.text), ['hola desde la pagina'])

  writeConfig({ lightChat: false })
  const shared = await historyJson(scope)
  assert.deepEqual(shared.messages.map(message => message.text), ['hola desde telegram'])
  rmSync(join(HOME, 'whale-maid.json'))
})
