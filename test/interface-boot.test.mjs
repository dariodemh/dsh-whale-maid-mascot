// Client boot contract tests (2.8.0 hotfix).
// Run with: node --test test/interface-boot.test.mjs
//
// Regression guard for the boot crash:
//   `web boot: 1 entry did not activate — dsh-whale-maid-mascot: loading`
// The client entry must ACTIVATE synchronously. Waiting on a slot or service
// that the harness never declares (`ctx.slots.inject('main')`, `ctx.inject([
// 'layout'])`) leaves the fiber in `loading` and aborts the whole web boot.
// These tests load the real dsh/client.js inside a sandbox with the loader
// protocol the renderer uses, and pin the contract:
//   - apply() returns undefined (not a promise);
//   - the global panel is registered directly with ctx.slots.register;
//   - no slot/service is awaited, even when the slot is missing;
//   - the plugin survives a harness without slots/layout.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import vm from 'node:vm'

const SOURCE = readFileSync(fileURLToPath(new URL('../dsh/client.js', import.meta.url)), 'utf8')

// The client sets up watchers (intervals) while activating. In the sandbox they
// must not keep the test process alive: only their scheduling matters here.
function stubTimer() { return 0 }

function element() {
  return {
    style: {},
    dataset: {},
    classList: { add() {}, remove() {}, contains() { return false }, toggle() {} },
    children: [],
    innerHTML: '',
    textContent: '',
    appendChild(child) { this.children.push(child); return child },
    removeChild() {},
    remove() {},
    addEventListener() {},
    removeEventListener() {},
    setAttribute() {},
    removeAttribute() {},
    getAttribute() { return null },
    hasAttribute() { return false },
    querySelector() { return null },
    querySelectorAll() { return [] },
    focus() {},
    blur() {},
    click() {},
  }
}

/** Loads the real client.js exactly like the renderer's Module Loader does. */
function loadClient() {
  let definition = null
  const documentStub = {
    readyState: 'loading',
    head: element(),
    body: element(),
    documentElement: element(),
    addEventListener() {},
    removeEventListener() {},
    querySelector() { return null },
    querySelectorAll() { return [] },
    createElement() { return element() },
    createTextNode() { return {} },
    createDocumentFragment() { return element() },
  }
  const localStorage = { getItem() { return null }, setItem() {}, removeItem() {}, clear() {} }
  const windowStub = {
    __ModuleLoader__: { load(value) { definition = value } },
    localStorage,
    addEventListener() {},
    removeEventListener() {},
    innerWidth: 1280,
    innerHeight: 800,
    matchMedia() { return { matches: false, addEventListener() {}, removeEventListener() {} } },
    fetch() { return Promise.resolve({ ok: true, json: () => Promise.resolve({ mode: 'classic' }) }) },
    location: { href: 'http://127.0.0.1/', search: '', hash: '' },
    setTimeout: stubTimer,
    clearTimeout() {},
    setInterval: stubTimer,
    clearInterval() {},
    requestAnimationFrame: stubTimer,
    cancelAnimationFrame() {},
  }
  const sandbox = {
    window: windowStub,
    document: documentStub,
    console: { log() {}, warn() {}, error() {}, info() {}, debug() {} },
    fetch: windowStub.fetch,
    localStorage,
    setTimeout: stubTimer,
    clearTimeout() {},
    setInterval: stubTimer,
    clearInterval() {},
    Promise,
    Date,
    Math,
    JSON,
    Object,
    Array,
    String,
    Number,
    Boolean,
    Error,
    RegExp,
    Map,
    Set,
    WeakMap,
    Symbol,
    AbortController,
    TextEncoder,
    URL,
    URLSearchParams,
  }
  sandbox.globalThis = sandbox
  vm.createContext(sandbox)
  vm.runInContext(SOURCE, sandbox, { filename: 'client.js' })

  assert.ok(definition && typeof definition.factory === 'function', 'client loaded through window.__ModuleLoader__')
  const react = {
    createElement() { return {} },
    Fragment: 'fragment',
    useRef() { return { current: null } },
    useEffect() {},
    useState(value) { return [value, function () {}] },
    useMemo(fn) { return fn() },
    useCallback(fn) { return fn },
  }
  const module = definition.factory((name) => {
    if (name === 'react') return react
    throw new Error('unexpected require: ' + name)
  })
  assert.equal(typeof module.apply, 'function')
  assert.ok(Array.isArray(module.inject))
  return module
}

function makeCtx({ registerThrows = false, slots = true } = {}) {
  const calls = { inject: [], register: [], effect: 0 }
  const ctx = {
    workspaces: {},
    sessions: {},
    uiWorkspace: {},
    get() { return undefined },
    on() { return () => {} },
    effect(fn) {
      calls.effect += 1
      try {
        const dispose = fn()
        return () => { if (typeof dispose === 'function') dispose() }
      } catch {
        return () => {}
      }
    },
    inject(names) {
      calls.inject.push(names.join(','))
      return () => {}
    },
  }
  if (slots) {
    ctx.slots = {
      inject(name) {
        calls.inject.push('slot:' + name)
        return () => {}
      },
      register(options, component) {
        calls.register.push({ options, component })
        if (registerThrows) throw new Error('no such slot: ' + options.name)
        return () => {}
      },
      entries() { return [] },
    }
  }
  return { ctx, calls }
}

test('apply returns undefined (never a promise) so the loader can activate', () => {
  const { ctx } = makeCtx()
  const result = loadClient().apply(ctx)
  assert.equal(result, undefined)
  assert.equal(result && result.then, undefined)
})

test('the main panel is registered directly, with no slots.inject("main") waiter', () => {
  const { ctx, calls } = makeCtx()
  loadClient().apply(ctx)
  assert.equal(calls.inject.includes('slot:main'), false, 'must not wait on the main slot')
  assert.equal(calls.inject.includes('slot:layout'), false, 'must not wait on layout')
  assert.equal(calls.inject.includes('layout'), false)
  const main = calls.register.find(entry => entry.options && entry.options.name === 'main')
  assert.ok(main, 'global panel registered directly')
  assert.equal(main.options.key, 'whale-maid')
})

test('a missing main slot is skipped, never waited on', () => {
  const { ctx, calls } = makeCtx({ registerThrows: true })
  const result = loadClient().apply(ctx)
  assert.equal(result, undefined)
  assert.equal(calls.inject.includes('slot:main'), false)
  assert.ok(calls.register.some(entry => entry.options.name === 'main'), 'the registration attempt is contained')
})

test('apply survives a harness without slots or layout', () => {
  const { ctx } = makeCtx({ slots: false })
  assert.equal(loadClient().apply(ctx), undefined)
})

test('apply survives a minimal context (no slots service at all)', () => {
  const ctx = { on() { return () => {} }, get() { return undefined } }
  assert.equal(loadClient().apply(ctx), undefined)
})
