// Telegram bridge review-loop wiring tests.
// Run with: node --test test/telegram-review.test.mjs
//
// Unit-level but through the real WhaleTelegram class: the session controller
// and the LLM are fakes, no Telegram network, no DSH process. These pin the
// behaviour the owner asked for after the live incident:
//   - no review while the owner is active or the shared session is busy;
//   - one tool-less model call when it does run, and the message is sent;
//   - a SKIP starts the cooldown (a second tick right away does nothing);
//   - every tick is written to ~/.dsh/whale-maid.log with time/decision/reason;
//   - startReview() never schedules a second timer or kickoff.
import { test, after } from 'node:test'
import assert from 'node:assert/strict'
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const HOME = mkdtempSync(join(tmpdir(), 'whm-tg-review-'))
process.env.DSH_HOME = HOME
process.env.WHM_MEMORY_DIR = join(HOME, 'memory')
writeFileSync(
  join(HOME, 'whale-maid.json'),
  `${JSON.stringify({ cwd: HOME, personaName: 'Cala', reviewEnabled: true }, null, 2)}\n`,
  'utf8',
)

const { WhaleTelegram } = await import('../dsh/telegram.js')

const LOG = join(HOME, 'whale-maid.log')

after(() => rmSync(HOME, { recursive: true, force: true }))

const MIN = 60 * 1000
const logLines = () => (existsSync(LOG) ? readFileSync(LOG, 'utf8').split('\n').filter(Boolean) : [])

function fakeLlm(reply = 'hola') {
  const calls = []
  return {
    calls,
    stream(options) {
      calls.push(options)
      return (async function* generate() {
        if (reply === null) {
          await new Promise(() => {})
          return
        }
        yield { type: 'text-delta', text: reply }
        yield { type: 'finish', reason: { kind: 'stop' } }
      })()
    },
  }
}

/** A bridge wired to a fake scope, with control over the shared session state. */
function makeBridge({ userAgoMs = 20 * MIN, status = 'idle', pending = 0, reply = 'hola' } = {}) {
  const now = Date.now()
  const events = [
    { type: 'user/message', time: now - userAgoMs, data: { content: [{ type: 'text', text: 'hola' }] } },
    {
      type: 'assistant/message',
      time: now - userAgoMs + 1000,
      data: { message: { content: [{ type: 'text', text: 'hola, Dario' }] } },
    },
    { type: 'turn/end', time: now - userAgoMs + 2000, data: {} },
  ]
  const agent = {
    id: 'whale-maid',
    status,
    session: { snapshotEvents: () => events },
    inbox: {
      nextTurn: Array.from({ length: pending }, (_, index) => ({ id: `queued-${index}` })),
      nextStep: [],
    },
  }
  const llm = fakeLlm(reply)
  const scope = {
    sessionController: {
      async resolveAgent(sessionId) {
        return sessionId === 'whale-maid' ? { agent } : null
      },
    },
    get(name) {
      return name === 'llm' ? llm : undefined
    },
    logger: { info() {}, warn() {} },
    on() {
      return () => {}
    },
  }
  const bridge = new WhaleTelegram(scope, { cwd: HOME, reviewEnabled: true, personaName: 'Cala' })
  bridge.allowed = new Set([4242])
  bridge.sent = []
  bridge.bot = {
    async sendMessage(chatId, text) {
      bridge.sent.push({ chatId, text })
      return { message_id: 1 }
    },
  }
  return { bridge, llm, agent, events }
}

test('no review while the owner wrote less than 10 minutes ago', async () => {
  const { bridge, llm } = makeBridge({ userAgoMs: 9 * MIN })
  const before = logLines().length
  const result = await bridge.reviewTick('test')
  assert.equal(result.run, false)
  assert.equal(result.reason, 'user-active')
  assert.equal(llm.calls.length, 0, 'no model call')
  assert.equal(bridge.sent.length, 0, 'nothing sent')
  const fresh = logLines().slice(before)
  assert.equal(fresh.length, 1)
  assert.match(fresh[0], /\[review\] tick trigger=test decision=skip reason=user-active/)
})

test('no review while the shared session has a running or queued turn', async () => {
  const running = makeBridge({ status: 'running' })
  assert.equal((await running.bridge.reviewTick('test')).reason, 'shared-session-busy')
  assert.equal(running.llm.calls.length, 0)

  const queued = makeBridge({ pending: 1 })
  assert.equal((await queued.bridge.reviewTick('test')).reason, 'shared-session-busy')
  assert.equal(queued.llm.calls.length, 0)
})

test('when it runs it makes one tool-less call and sends the message', async () => {
  const { bridge, llm } = makeBridge({ userAgoMs: 20 * MIN, reply: 'Che, vi que cerraste el informe.' })
  const before = logLines().length
  const result = await bridge.reviewTick('test')
  assert.equal(result.outcome, 'sent')
  assert.equal(llm.calls.length, 1, 'one turn, no retries')
  assert.equal('tools' in llm.calls[0], false, 'no tools offered')
  assert.match(llm.calls[0].messages[0].content[0].text, /Último tramo de la conversación principal/)
  assert.doesNotMatch(llm.calls[0].messages[0].content[0].text, /Podés usar tus herramientas/)
  assert.equal(bridge.sent.length, 1)
  assert.equal(bridge.sent[0].text, 'Che, vi que cerraste el informe.')
  assert.ok(bridge.lastProactiveAt > 0)
  assert.ok(bridge.lastProbeAt > 0)
  assert.equal(bridge.lastOutcome, 'sent')
  const fresh = logLines().slice(before)
  assert.match(fresh.join('\n'), /decision=run/)
  assert.match(fresh.join('\n'), /turn outcome=sent reason=ok/)
})

test('a SKIP is silent, starts the cooldown and is not repeated by the next tick', async () => {
  const { bridge, llm } = makeBridge({ userAgoMs: 20 * MIN, reply: 'SKIP' })
  const before = logLines().length
  const first = await bridge.reviewTick('test')
  assert.equal(first.outcome, 'skip')
  assert.equal(llm.calls.length, 1)
  assert.equal(bridge.sent.length, 0, 'a SKIP never reaches the owner')
  assert.equal(bridge.lastOutcome, 'skip')
  assert.ok(bridge.lastProbeAt > 0)

  const second = await bridge.reviewTick('test')
  assert.equal(second.run, false)
  assert.equal(second.reason, 'cooldown-skip')
  assert.equal(llm.calls.length, 1, 'the empty review was not repeated')
  assert.match(logLines().slice(before).join('\n'), /turn outcome=skip reason=model-skip/)
})

test('every tick is written to whale-maid.log with time, decision and reason', async () => {
  const { bridge } = makeBridge({ userAgoMs: 2 * MIN })
  const before = logLines().length
  await bridge.reviewTick('timer')
  await bridge.reviewTick('kickoff')
  const fresh = logLines().slice(before)
  assert.equal(fresh.length, 2, 'one audit line per tick')
  for (const line of fresh) {
    assert.match(line, /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z \[review\] tick /)
    assert.match(line, /decision=skip reason=user-active/)
    assert.match(line, /shared=idle pending=0/)
  }
})

test('startReview never schedules a second timer or kickoff', () => {
  const { bridge } = makeBridge()
  bridge.startReview()
  const timer = bridge.reviewTimer
  const kickoff = bridge.reviewKickoff
  assert.ok(timer, 'timer scheduled')
  assert.ok(kickoff, 'kickoff scheduled')
  bridge.startReview()
  assert.equal(bridge.reviewTimer, timer, 'same timer, not a second one')
  assert.equal(bridge.reviewKickoff, kickoff, 'same kickoff, not a second one')
  bridge.stop()
  assert.equal(bridge.reviewTimer, null)
  assert.equal(bridge.reviewKickoff, null)
})
