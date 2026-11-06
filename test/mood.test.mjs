// Mood automation tests.
// Run with: node --test test/mood.test.mjs
//
// The mood is derived from the REAL activity of the shared session (turn state,
// tool calls, last messages) and follows assets/chan/personalidades.txt. These
// tests pin the decision table, the priority order (serious > work > thinking >
// waiting), the configurable thresholds and the anti-flicker hysteresis.
import { test, after } from 'node:test'
import assert from 'node:assert/strict'
import { existsSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { fileURLToPath } from 'node:url'
import { join } from 'node:path'

const HOME = mkdtempSync(join(tmpdir(), 'whm-mood-'))
process.env.DSH_HOME = HOME
process.env.WHM_MEMORY_DIR = join(HOME, 'memory')
const CHAN_DIR = fileURLToPath(new URL('../assets/chan/', import.meta.url))

const {
  MOODS,
  MOOD_PRIORITY,
  MoodTracker,
  deriveMood,
  moodConfig,
  moodImageUrl,
  summarizeSessionInput,
} = await import('../dsh/mood.js')

after(() => rmSync(HOME, { recursive: true, force: true }))

const NOW = 2_000_000_000_000
const MIN = 60 * 1000

let seq = 0
function ev(type, data = {}, time = NOW) {
  seq += 1
  return { type, seq, time, data }
}
const user = (text, time = NOW) => ev('user/message', { content: [{ type: 'text', text }] }, time)
const assistant = (text, time = NOW) => ev('assistant/message', { message: { content: [{ type: 'text', text }] } }, time)
const tool = (name, time = NOW) => ev('tool/call', { name }, time)
const turnStart = (time = NOW) => ev('turn/start', { turn: 1 }, time)
const turnEnd = (time = NOW) => ev('turn/end', { turn: 1 }, time)

/** Builds events (in order) and derives the mood at `NOW`. */
function moodFrom(events, { status = 'idle', config = {}, now = NOW } = {}) {
  const input = summarizeSessionInput(events, status, now)
  return deriveMood(input, config)
}

test('the mood table covers every Chan mood image and keeps a priority order', () => {
  assert.deepEqual(
    MOOD_PRIORITY,
    [
      'base',
      'esperando-aburrida',
      'flotando-sonando',
      'descansando-en-la-playa',
      'dudando-pensativa',
      'tomando-notas',
      'comiendo-tokens',
      'analizando-con-lentes',
      'cocinando',
      'seria-formal',
      'celebrando-de-novia',
    ],
  )
  for (const mood of Object.keys(MOODS)) {
    const file = MOODS[mood].file
    assert.ok(existsSync(join(CHAN_DIR, file)), `${mood} image missing: ${file}`)
    assert.equal(moodImageUrl(mood), `/whale-maid-mascot/chan/${file}`)
  }
})

test('an active turn using tools cooks; a read/review tool puts the glasses on', () => {
  const work = moodFrom([user('arreglá el bug'), turnStart(), tool('pwsh')], { status: 'running' })
  assert.equal(work.mood, 'cocinando')
  assert.match(work.reason, /^working:/)

  const reading = moodFrom([user('revisá el informe'), turnStart(), tool('read_file')], { status: 'running' })
  assert.equal(reading.mood, 'analizando-con-lentes')
  assert.match(reading.reason, /^reading:/)

  // The LAST tool decides: after a write, she is back to cooking.
  const mixed = moodFrom(
    [user('mirá y arreglá'), turnStart(), tool('read_file'), tool('edit')],
    { status: 'running' },
  )
  assert.equal(mixed.mood, 'cocinando')
})

test('an active turn with no tools waits the model: tokens, or notes for a long request', () => {
  const thinking = moodFrom([user('hola'), turnStart()], { status: 'running' })
  assert.equal(thinking.mood, 'comiendo-tokens')

  const longText = 'necesito que me armes un informe '.repeat(12)
  const notes = moodFrom([user(longText), turnStart(NOW - 5000)], { status: 'running' })
  assert.equal(notes.mood, 'tomando-notas')
  // The same long message with a tool already running is work, not notes.
  const withTool = moodFrom([user(longText), turnStart(), tool('pwsh')], { status: 'running' })
  assert.equal(withTool.mood, 'cocinando')
})

test('a short finished turn returns to base; a big finished task rests on the beach', () => {
  const short = moodFrom([user('hola'), turnStart(NOW - 5000), assistant('listo'), turnEnd(NOW - 1000)], { status: 'idle' })
  assert.equal(short.mood, 'base')

  const bigEvents = [user('hacé todo'), turnStart(NOW - 10 * MIN)]
  for (let index = 0; index < 8; index += 1) bigEvents.push(tool('pwsh', NOW - 9 * MIN + index * 1000))
  bigEvents.push(assistant('terminado', NOW - 2 * MIN), turnEnd(NOW - 2 * MIN))
  const beach = moodFrom(bigEvents, { status: 'idle' })
  assert.equal(beach.mood, 'descansando-en-la-playa')
  assert.equal(beach.reason, 'big-task-finished')
})

test('a pending question shows doubt; a long silence shows the bored wait', () => {
  const doubt = moodFrom([user('¿y eso?', NOW - 5 * MIN), assistant('¿querés que lo cambie?', NOW - 4 * MIN)], { status: 'idle' })
  assert.equal(doubt.mood, 'dudando-pensativa')
  assert.equal(doubt.reason, 'waiting-answer')

  const answered = moodFrom(
    [user('¿y eso?', NOW - 6 * MIN), assistant('¿querés que lo cambie?', NOW - 5 * MIN), user('sí', NOW - 4 * MIN)],
    { status: 'idle' },
  )
  assert.notEqual(answered.mood, 'dudando-pensativa')

  const idle = moodFrom([user('hola', NOW - 20 * MIN), assistant('hola', NOW - 19 * MIN)], { status: 'idle' })
  assert.equal(idle.mood, 'esperando-aburrida')
  assert.equal(idle.reason, 'idle')
})

test('delicate topics force the serious image and win over playful states', () => {
  const legal = moodFrom([user('necesito asesoría legal por el contrato y la deuda'), turnStart(), tool('pwsh')], { status: 'running' })
  assert.equal(legal.mood, 'seria-formal')
  assert.equal(legal.reason, 'delicate-topic')

  const medical = moodFrom([user('resultado médico: ¿es riesgoso?', NOW - 2 * MIN)], { status: 'idle' })
  assert.equal(medical.mood, 'seria-formal')

  // A normal message never gets the serious image by default.
  const normal = moodFrom([user('contame un chiste', NOW - 2 * MIN)], { status: 'idle' })
  assert.notEqual(normal.mood, 'seria-formal')
})

test('a long casual chat floats; an explicit milestone celebrates (rare)', () => {
  const chat = [user('hola', NOW - 30 * 1000)]
  for (let index = 0; index < 10; index += 1) {
    chat.push(index % 2 === 0 ? assistant(`charla ${index}`, NOW - 20 * 1000) : user(`sigo ${index}`, NOW - 10 * 1000))
  }
  const floating = moodFrom(chat, { status: 'idle', config: { moodCasualTurns: 8 } })
  assert.equal(floating.mood, 'flotando-sonando')

  const milestone = moodFrom(
    [user('terminamos el proyecto', NOW - 2 * MIN), assistant('¡Lo logramos! Hay que celebrarlo.', NOW - MIN)],
    { status: 'idle' },
  )
  assert.equal(milestone.mood, 'celebrando-de-novia')

  // The same kind of phrase long ago is not a celebration.
  const old = moodFrom(
    [user('terminamos el proyecto', NOW - 30 * MIN), assistant('¡Lo logramos!', NOW - 29 * MIN)],
    { status: 'idle' },
  )
  assert.notEqual(old.mood, 'celebrando-de-novia')
})

test('the idle threshold is configurable and base is the fallback', () => {
  const events = [user('hola', NOW - 90 * 1000), assistant('hola', NOW - 89 * 1000)]
  assert.equal(moodFrom(events, { status: 'idle' }).mood, 'base')
  assert.equal(moodFrom(events, { status: 'idle', config: { moodIdleMinutes: 1 } }).mood, 'esperando-aburrida')

  assert.deepEqual(deriveMood({ hasEvents: false }, {}), { mood: 'base', reason: 'no-events' })
  assert.deepEqual(deriveMood({ hasEvents: true }, {}), { mood: 'base', reason: 'default' })
})

test('summarizeSessionInput reports the real activity used by the table', () => {
  const events = [
    user('hola', NOW - 9000),
    turnStart(NOW - 8000),
    tool('read_file', NOW - 7000),
    tool('pwsh', NOW - 6000),
    assistant('ok', NOW - 3000),
    turnEnd(NOW - 2000),
  ]
  const input = summarizeSessionInput(events, 'idle', NOW)
  assert.equal(input.hasEvents, true)
  assert.equal(input.turnActive, false)
  assert.equal(input.toolCalls, 0, 'no running turn')
  assert.equal(input.lastTurnToolCalls, 2)
  assert.equal(input.lastTurnDurationMs, 6000)
  assert.equal(input.lastAssistantText, 'ok')
  assert.equal(input.assistantEndsQuestion, false)

  const running = summarizeSessionInput([user('x', NOW), turnStart(NOW - 500), tool('pwsh', NOW - 100)], 'running', NOW)
  assert.equal(running.turnActive, true)
  assert.deepEqual(running.toolNames, ['pwsh'])
})

test('hysteresis: first decision applies, switches wait for the minimum hold', () => {
  const tracker = new MoodTracker({ minHoldMs: 9000 })
  const first = tracker.update({ mood: 'cocinando', reason: 'working' }, NOW)
  assert.equal(first.mood, 'cocinando', 'boot adopts immediately')
  assert.equal(first.since, NOW)
  assert.equal(first.image, moodImageUrl('cocinando'))

  const blocked = tracker.update({ mood: 'base', reason: 'default' }, NOW + 4000)
  assert.equal(blocked.mood, 'cocinando', 'too soon: keep the current image')
  assert.equal(blocked.since, NOW)

  const allowed = tracker.update({ mood: 'base', reason: 'default' }, NOW + 9000)
  assert.equal(allowed.mood, 'base')
  assert.equal(allowed.since, NOW + 9000)
})

test('hysteresis keeps the reason fresh and tolerates bad input', () => {
  const tracker = new MoodTracker({ minHoldMs: 9000 })
  tracker.update({ mood: 'cocinando', reason: 'working:pwsh' }, NOW)
  const same = tracker.update({ mood: 'cocinando', reason: 'working:edit' }, NOW + 2000)
  assert.equal(same.mood, 'cocinando')
  assert.equal(same.reason, 'working:edit')
  assert.equal(same.since, NOW, 'same mood keeps since')

  assert.equal(tracker.update(null, NOW + 3000).mood, 'cocinando')
  assert.equal(tracker.update({ mood: 'not-a-mood' }, NOW + 3000).mood, 'cocinando')
  assert.equal(tracker.fallback().mood, 'cocinando')
})

test('moodConfig clamps the thresholds and minHoldMs never goes below 2s', () => {
  const cfg = moodConfig({ moodIdleMinutes: 2, moodMinHoldMs: 10 })
  assert.equal(cfg.idleMs, 2 * MIN)
  assert.equal(cfg.minHoldMs, 2000)
  assert.equal(moodConfig({}).idleMs, 6 * MIN)
  assert.equal(moodConfig({}).minHoldMs, 9000)
})
