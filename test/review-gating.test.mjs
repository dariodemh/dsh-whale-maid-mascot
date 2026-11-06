// Proactive-review gating regression tests.
// Run with: node --test test/review-gating.test.mjs
//
// Pins the 2.7.0 review rules:
//   - it is ONE tool-less model call (no agent turn, no shell/file tools);
//   - it never fires while the owner is active (10 min guard, configurable) or
//     while the shared session has an active/queued turn;
//   - a SKIP also starts a cooldown, so empty turns are not repeated;
//   - the prompt carries the digest and the recent files, and nothing else.
import { test, after } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const HOME = mkdtempSync(join(tmpdir(), 'whm-review-'))
process.env.DSH_HOME = HOME
process.env.WHM_MEMORY_DIR = join(HOME, 'memory')

const { DEFAULTS, loadConfig } = await import('../dsh/config.js')
const {
  REVIEW_DEFAULTS,
  decideReview,
  isReviewSkip,
  reviewConfig,
  reviewPrompt,
  reviewReply,
  reviewSystem,
} = await import('../dsh/review.js')

after(() => rmSync(HOME, { recursive: true, force: true }))

const MIN = 60 * 1000

function cfg() {
  return reviewConfig(loadConfig())
}

test('the activity guard defaults to 10 minutes and is configurable', () => {
  assert.equal(REVIEW_DEFAULTS.activityGuardMs, 10 * MIN)
  assert.equal(DEFAULTS.reviewActivityGuardMs, 10 * MIN)
  assert.equal(cfg().activityGuardMs, 10 * MIN)
  assert.equal(reviewConfig({ reviewActivityGuardMs: 90 * 1000 }).activityGuardMs, 90 * 1000)
  assert.deepEqual(
    reviewConfig({ reviewActivityGuardMs: 'no-num' }).activityGuardMs,
    10 * MIN,
    'a bad value falls back to the default',
  )
  // the rest of the budget knobs are normalized too: at most one review an hour
  assert.equal(cfg().everyMs, 60 * MIN)
  assert.equal(cfg().cooldownMs, 60 * MIN)
  assert.equal(cfg().skipCooldownMs, 60 * MIN, 'skip cooldown falls back to the send cooldown')
  assert.equal(reviewConfig({ reviewEveryMs: 5 * MIN }).everyMs, 60 * MIN, 'the hour is a floor')
  assert.equal(reviewConfig({ reviewCooldownMs: 5 * MIN }).cooldownMs, 5 * MIN)
  assert.equal(cfg().maxSteps, 2)
  assert.equal(reviewConfig({ reviewMaxTokens: 1 }).maxTokens, 80)
})

test('a recent user message (< 10 min) makes the review skip', () => {
  const now = 10_000_000
  const recent = decideReview({ now, cfg: cfg(), userActivityAt: now - 9 * MIN })
  assert.equal(recent.run, false)
  assert.equal(recent.reason, 'user-active')
  const exactly = decideReview({ now, cfg: cfg(), userActivityAt: now - 10 * MIN })
  assert.equal(exactly.run, true, 'the guard is "less than", not "less or equal"')
  assert.equal(exactly.reason, 'due')
  const longAgo = decideReview({ now, cfg: cfg(), userActivityAt: now - 11 * MIN })
  assert.equal(longAgo.run, true)
})

test('the activity guard honours the configured value', () => {
  const now = 10_000_000
  const config = reviewConfig({ reviewActivityGuardMs: 2 * MIN })
  assert.equal(decideReview({ now, cfg: config, userActivityAt: now - 1 * MIN }).reason, 'user-active')
  assert.equal(decideReview({ now, cfg: config, userActivityAt: now - 3 * MIN }).run, true)
})

test('an active or queued turn in the shared session blocks the review', () => {
  const now = 10_000_000
  assert.equal(decideReview({ now, cfg: cfg(), sharedBusy: true }).reason, 'shared-session-busy')
  // it wins over the activity guard so the log says the real reason
  assert.equal(
    decideReview({ now, cfg: cfg(), sharedBusy: true, userActivityAt: now - 20 * MIN }).reason,
    'shared-session-busy',
  )
})

test('cooldowns: after sending, after a silent SKIP, and while unchanged', () => {
  const now = 10_000_000
  const base = { now, cfg: cfg() }
  assert.equal(decideReview({ ...base, lastProactiveAt: now - 5 * MIN }).reason, 'cooldown-sent')
  assert.equal(decideReview({ ...base, lastProactiveAt: now - 70 * MIN }).run, true)
  assert.equal(
    decideReview({ ...base, lastProbeAt: now - 5 * MIN, lastOutcome: 'skip' }).reason,
    'cooldown-skip',
    'a SKIP starts a cooldown too',
  )
  assert.equal(decideReview({ ...base, lastProbeAt: now - 70 * MIN, lastOutcome: 'skip' }).run, true)
  assert.equal(
    decideReview({
      ...base,
      fingerprint: 'misma',
      lastFingerprint: 'misma',
      lastProbeAt: now - 5 * MIN,
      lastOutcome: 'sent',
    }).reason,
    'unchanged',
  )
  assert.equal(
    decideReview({
      ...base,
      fingerprint: 'misma',
      lastFingerprint: 'misma',
      lastProbeAt: now - 40 * MIN,
      lastOutcome: 'sent',
    }).run,
    true,
    'after the dedupe window an unchanged context may be reviewed again',
  )
})

test('hard guards: stopped, no bot, already running, no recipient', () => {
  const now = 10_000_000
  const base = { now, cfg: cfg() }
  assert.equal(decideReview({ ...base, stopped: true }).reason, 'stopped')
  assert.equal(decideReview({ ...base, hasBot: false }).reason, 'no-bot')
  assert.equal(decideReview({ ...base, busy: true }).reason, 'already-running')
  assert.equal(decideReview({ ...base, hasTarget: false }).reason, 'no-target')
})

test('the review prompt is tool-less and carries only the precomputed context', () => {
  const prompt = reviewPrompt({
    personaName: 'Cala',
    digest: 'Dario: hola\nCala: hola',
    files: ['notas.md (2 KB, hace 3 min)'],
    now: Date.UTC(2026, 10, 5, 20, 0, 0),
    maxSteps: 2,
  })
  assert.match(prompt, /Cala/)
  assert.match(prompt, /SKIP/)
  assert.match(prompt, /Dario: hola/)
  assert.match(prompt, /notas\.md/)
  assert.match(prompt, /NO tiene herramientas/)
  assert.match(prompt, /no podés leer archivos, correr comandos/)
  assert.doesNotMatch(prompt, /Podés usar tus herramientas/)
  assert.doesNotMatch(prompt, /shell, archivos, búsqueda/)
  assert.match(prompt, /máximo 2/)
})

test('the review system prompt is the character persona (with her memory)', () => {
  const system = reviewSystem(loadConfig())
  assert.equal(typeof system, 'string')
  assert.ok(system.length > 0)
})

function fakeLlm(chunks, { hang = false } = {}) {
  const calls = []
  return {
    calls,
    stream(options) {
      calls.push(options)
      return (async function* generate() {
        for (const chunk of chunks) yield chunk
        if (hang) await new Promise(() => {})
      })()
    },
  }
}

test('reviewReply makes exactly one tool-less model call', async () => {
  const llm = fakeLlm([
    { type: 'text-delta', text: 'hola ' },
    { type: 'text-delta', text: 'Dario' },
    { type: 'finish', reason: { kind: 'stop' } },
  ])
  const reply = await reviewReply({
    llm,
    cfg: reviewConfig({}),
    system: 'sistema',
    prompt: 'prompt',
    sessionId: 'test-review',
  })
  assert.equal(llm.calls.length, 1, 'one turn, no retries')
  assert.equal(reply.timedOut, false)
  assert.equal(reply.text, 'hola Dario')
  assert.equal(reply.steps, 0, 'the review does not execute tool steps')
  const options = llm.calls[0]
  assert.equal('tools' in options, false, 'no tools are offered to the model')
  assert.equal(options.maxTokens, reviewConfig({}).maxTokens)
  assert.equal(options.sessionId, 'test-review')
  assert.ok(options.signal, 'passes an AbortSignal so an over-budget call can be aborted')
})

test('reviewReply aborts a call that exceeds the time budget and reports SKIP', async () => {
  const llm = fakeLlm([], { hang: true })
  const started = Date.now()
  const reply = await reviewReply({
    llm,
    cfg: { timeoutMs: 50, maxTokens: 100, provider: 'p', model: 'm' },
    system: 'sistema',
    prompt: 'prompt',
  })
  const elapsed = Date.now() - started
  assert.equal(reply.timedOut, true)
  assert.equal(reply.text, '')
  assert.ok(elapsed < 2000, `timed out quickly (took ${elapsed} ms)`)
})

test('reviewReply surfaces model errors and missing llm as errors (the caller logs SKIP)', async () => {
  const failing = fakeLlm([{ type: 'finish', reason: { kind: 'error', failure: { message: 'boom' } } }])
  await assert.rejects(
    () => reviewReply({ llm: failing, cfg: reviewConfig({}), system: 's', prompt: 'p' }),
    /model error: boom/,
  )
  await assert.rejects(() => reviewReply({ llm: null, cfg: reviewConfig({}) }), /llm service unavailable/)
})

test('isReviewSkip accepts SKIP, skip and empty replies only', () => {
  assert.equal(isReviewSkip('SKIP'), true)
  assert.equal(isReviewSkip(' skip.'), true)
  assert.equal(isReviewSkip('SKIP porque no hay nada'), true, 'a meta reply never reaches the owner')
  assert.equal(isReviewSkip(''), true)
  assert.equal(isReviewSkip('   '), true)
  assert.equal(isReviewSkip('Che, mirá esto'), false)
  assert.equal(isReviewSkip('no, mejor no te escribo'), false)
})
