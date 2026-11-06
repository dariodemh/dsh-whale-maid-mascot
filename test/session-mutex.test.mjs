// Per-session mutex regression tests.
// Run with: node --test test/session-mutex.test.mjs
//
// These pin the fix for the crossed-messages bug: every turn the plugin starts
// (review, Telegram, in-page chat) goes through askSession(), which now takes a
// per-session mutex, waits for the agent to be idle *inside* the lock and only
// then calls prompt(). Two turns on the same session can no longer overlap, and
// an opportunistic turn (`ifBusy: 'skip'`) never queues behind a live one.
//
// No DSH process and no real provider: the session controller is an in-memory
// fake with the same surface the plugin uses (resolveAgent / create / prompt).
import { test, after } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const HOME = mkdtempSync(join(tmpdir(), 'whm-mutex-'))
process.env.DSH_HOME = HOME
process.env.WHM_MEMORY_DIR = join(HOME, 'memory')

const {
  askSession,
  isSessionBusy,
  sessionQueueDepth,
  sessionSnapshot,
  lastUserActivityAt,
} = await import('../dsh/session.js')

after(() => rmSync(HOME, { recursive: true, force: true }))

const text = value => [{ type: 'text', text: value }]
const wait = ms => new Promise(resolve => setTimeout(resolve, ms))

function makeHarness() {
  const state = {
    events: new Map(),
    agents: new Map(),
    listeners: new Set(),
    calls: [],
    active: 0,
    maxActive: 0,
    delayMs: 0,
    failPrompt: false,
    promptTimes: [],
  }

  const emit = (event, ...args) => {
    for (const entry of [...state.listeners]) if (entry.event === event) entry.cb(...args)
  }

  const controller = {
    async resolveAgent(sessionId) {
      const agent = state.agents.get(sessionId)
      return agent ? { agent } : null
    },
    async create(request) {
      const events = state.events.get(request.sessionId) ?? []
      state.events.set(request.sessionId, events)
      state.agents.set(request.sessionId, {
        id: request.sessionId,
        status: 'idle',
        inbox: { nextTurn: [], nextStep: [] },
        session: { snapshotEvents: () => state.events.get(request.sessionId) ?? [] },
      })
    },
    async prompt(request) {
      if (state.failPrompt) throw new Error('prompt failed')
      state.active += 1
      state.maxActive = Math.max(state.maxActive, state.active)
      state.calls.push(request)
      state.promptTimes.push(Date.now())
      try {
        if (state.delayMs > 0) await wait(state.delayMs)
        const events = state.events.get(request.sessionId) ?? []
        const body = (request.content ?? []).filter(part => part?.type === 'text').map(part => part.text).join(' ')
        events.push({ type: 'user/message', time: Date.now(), data: { content: request.content } })
        events.push({
          type: 'assistant/message',
          time: Date.now(),
          data: { message: { content: [{ type: 'text', text: `eco:${body}` }] } },
        })
        emit('session/event', { id: request.sessionId }, { type: 'turn/end' })
      } finally {
        state.active -= 1
      }
    },
  }

  const scope = {
    sessionController: controller,
    get() {
      return undefined
    },
    on(event, cb) {
      const entry = { event, cb }
      state.listeners.add(entry)
      return () => state.listeners.delete(entry)
    },
  }

  return { state, scope, emit }
}

/** Creates the session eagerly so a test can look at the live agent object. */
async function seed(harness, sessionId = 'whale-maid', status = 'idle') {
  await harness.scope.sessionController.create({ sessionId, cwd: 'C:\\tmp\\ws' })
  const agent = harness.state.agents.get(sessionId)
  agent.status = status
  return { agent, events: harness.state.events.get(sessionId) }
}

test('two turns in the same session are serialized, never overlapped', async () => {
  const h = makeHarness()
  h.state.delayMs = 30
  const [first, second] = await Promise.all([
    askSession(h.scope, text('uno')),
    askSession(h.scope, text('dos')),
  ])
  assert.equal(h.state.calls.length, 2)
  assert.equal(h.state.maxActive, 1, 'only one prompt() at a time')
  assert.deepEqual(h.state.calls.map(call => call.content[0].text), ['uno', 'dos'])
  assert.match(first.text, /eco:uno/)
  assert.match(second.text, /eco:dos/)
  assert.equal(isSessionBusy('whale-maid'), false)
})

test('different sessions still run concurrently', async () => {
  const h = makeHarness()
  h.state.delayMs = 30
  await Promise.all([
    askSession(h.scope, text('a'), { sessionId: 's-uno' }),
    askSession(h.scope, text('b'), { sessionId: 's-dos' }),
  ])
  assert.equal(h.state.calls.length, 2)
  assert.equal(h.state.maxActive, 2, 'the lock is per session, not global')
})

test('an opportunistic turn skips instead of queueing behind a live one', async () => {
  const h = makeHarness()
  h.state.delayMs = 80
  const running = askSession(h.scope, text('turno largo'))
  await wait(30)
  assert.equal(isSessionBusy('whale-maid'), true)

  const skipped = await askSession(h.scope, text('revision'), { ifBusy: 'skip' })
  assert.equal(skipped.skipped, true)
  assert.equal(skipped.outcome, 'busy')
  assert.equal(h.state.calls.length, 1, 'the review prompt was never sent')

  await running
  assert.equal(isSessionBusy('whale-maid'), false)
})

test('ifBusy: skip still runs when the session is free', async () => {
  const h = makeHarness()
  const result = await askSession(h.scope, text('libre'), { ifBusy: 'skip' })
  assert.equal(result.skipped, undefined)
  assert.match(result.text, /eco:libre/)
  assert.equal(h.state.calls.length, 1)
})

test('the idle check happens inside the lock, right before prompt', async () => {
  const h = makeHarness()
  const { agent, events } = await seed(h, 'whale-maid', 'running')
  let idleAt = 0
  setTimeout(() => {
    agent.status = 'idle'
    idleAt = Date.now()
    events.push({ type: 'turn/end', time: idleAt, data: {} })
    h.emit('session/event', { id: 'whale-maid' }, { type: 'turn/end' })
  }, 30)

  const result = await askSession(h.scope, text('despues'))
  assert.equal(h.state.calls.length, 1)
  assert.ok(idleAt > 0, 'the turn ended')
  assert.ok(h.state.promptTimes[0] >= idleAt, 'prompt only after the session went idle')
  assert.match(result.text, /eco:despues/)
})

test('queued inbox work also blocks the prompt until it drains', async () => {
  const h = makeHarness()
  const { agent, events } = await seed(h, 'whale-maid', 'idle')
  agent.inbox.nextTurn.push({ id: 'queued-1' })
  setTimeout(() => {
    agent.inbox.nextTurn.length = 0
    events.push({ type: 'turn/end', time: Date.now(), data: {} })
    h.emit('session/event', { id: 'whale-maid' }, { type: 'turn/end' })
  }, 30)
  await askSession(h.scope, text('con cola'))
  assert.equal(h.state.calls.length, 1)
  assert.ok(h.state.promptTimes[0] > 0)
  assert.equal(agent.inbox.nextTurn.length, 0)
})

test('a failed prompt releases the lock and does not leak a turn waiter', async () => {
  const h = makeHarness()
  h.state.failPrompt = true
  await assert.rejects(() => askSession(h.scope, text('boom')), /prompt failed/)
  assert.equal(isSessionBusy('whale-maid'), false)
  h.state.failPrompt = false
  const result = await askSession(h.scope, text('ok'))
  assert.match(result.text, /eco:ok/)
})

test('queue depth counts turns waiting behind the running one', async () => {
  const h = makeHarness()
  h.state.delayMs = 40
  const first = askSession(h.scope, text('primero'))
  const second = askSession(h.scope, text('segundo'))
  await wait(10)
  assert.equal(isSessionBusy('whale-maid'), true)
  assert.equal(sessionQueueDepth('whale-maid'), 1)
  await Promise.all([first, second])
  assert.equal(sessionQueueDepth('whale-maid'), 0)
})

test('sessionSnapshot reports status, pending inbox work and last user activity', async () => {
  const h = makeHarness()
  const { agent, events } = await seed(h, 'whale-maid', 'running')
  events.push({ type: 'user/message', time: 1000, data: { content: [] } })
  events.push({ type: 'assistant/message', time: 2000, data: { message: { content: [] } } })
  events.push({ type: 'user/message', time: 5000, data: { content: [] } })
  agent.inbox.nextStep.push({ id: 'step-1' })

  const snapshot = await sessionSnapshot(h.scope, 'whale-maid')
  assert.equal(snapshot.status, 'running')
  assert.equal(snapshot.pending, 1)
  assert.equal(snapshot.lastUserAt, 5000)
  assert.equal(snapshot.running, true)
  assert.equal(snapshot.busy, true)

  assert.equal(await lastUserActivityAt(h.scope, 'whale-maid'), 5000)
  assert.equal(await lastUserActivityAt(h.scope, 'no-existe'), 0)
})

test('a cold session is not reported as busy', async () => {
  const h = makeHarness()
  const snapshot = await sessionSnapshot(h.scope, 'todavia-no-existe')
  assert.equal(snapshot.exists, false)
  assert.equal(snapshot.busy, false)
  assert.equal(snapshot.locked, false)
})
