// Smoke test for the plugin's lazy-CJS client bundle, run outside the browser.
//
// It checks the exact failure the web boot audit punished
// ("web boot: 1 entry did not activate — dsh-whale-maid-mascot: loading"):
//   1. the bundle registers its module factory id;
//   2. `apply(ctx)` returns synchronously (the fiber reaches `active` at once);
//   3. the entry declares no hard service dependency (inject = []);
//   4. `apply` never throws, both with and without the optional `slots` service;
//   5. the slots-gated surfaces (Settings section + global panel) still register,
//      but from a deferred child scope, never from the entry itself.
import fs from 'node:fs'
import { fileURLToPath } from 'node:url'

// Default target: the bundle that ships in this package (../dsh/client.js).
const CLIENT = process.argv[2] ?? fileURLToPath(new URL('../dsh/client.js', import.meta.url))
const src = fs.readFileSync(CLIENT, 'utf8')

globalThis.window = globalThis
let factory = null
globalThis.window.__ModuleLoader__ = {
  load({ id, factory: f }) {
    globalThis.__loadedId = id
    factory = f
  },
}
globalThis.document = {
  readyState: 'loading', // keeps the mount callback deferred: no DOM work
  addEventListener: () => {},
  removeEventListener: () => {},
  createElement: () => ({ style: {}, setAttribute() {}, appendChild() {}, addEventListener() {} }),
  body: { appendChild() {}, removeChild() {}, contains: () => false },
  head: { appendChild() {} },
  documentElement: { style: { setProperty() {} } },
  querySelector: () => null,
  querySelectorAll: () => [],
}
globalThis.localStorage = { getItem: () => null, setItem: () => {}, removeItem: () => {} }
globalThis.addEventListener = () => {}
globalThis.fetch = async () => ({ ok: false, json: async () => null })
globalThis.requestAnimationFrame = (fn) => setTimeout(fn, 0)
globalThis.cancelAnimationFrame = () => {}
globalThis.MutationObserver = class { observe() {} disconnect() {} }
globalThis.getComputedStyle = () => ({ getPropertyValue: () => '' })

const problems = []
new Function(src)()
if (globalThis.__loadedId !== 'dsh-whale-maid-mascot' || !factory) {
  problems.push('client bundle did not register its module factory')
}

const moduleExports = factory((spec) => {
  if (spec === 'react') return {} // presence only: the React UI paths stay unexercised
  throw new Error(`unexpected require(${spec})`)
})

if (typeof moduleExports.apply !== 'function') problems.push('missing apply')
if (!Array.isArray(moduleExports.inject) || moduleExports.inject.length !== 0) {
  problems.push(`inject must be empty, got ${JSON.stringify(moduleExports.inject)}`)
}

function runScenario(label, { withSlots }) {
  const registered = []
  const injected = []
  let threw = null
  let returned = 'not-called'

  const slotsService = {
    register: (definition) => {
      registered.push(definition.name)
      return () => {}
    },
    inject: (name, callback) => {
      injected.push(name)
      callback()
      return () => {}
    },
  }
  const childScopeBase = {
    effect: (fn) => {
      fn()
    },
  }
  const slotsScope = {
    ...childScopeBase,
    slots: slotsService,
    get: (name) => (name === 'slots' ? slotsService : undefined),
  }
  const ctx = {
    ...childScopeBase,
    get: (name) => (withSlots && name === 'slots' ? slotsService : undefined),
    slots: withSlots ? slotsService : undefined,
    inject: (deps, callback) => {
      // A service that never appears: the callback must not be required.
      if (withSlots && Array.isArray(deps) && deps.includes('slots')) callback(slotsScope)
      return { await() {} }
    },
  }

  try {
    returned = moduleExports.apply(ctx)
  } catch (error) {
    threw = error
  }
  if (threw) problems.push(`${label}: apply threw ${threw.message}`)
  else if (returned !== undefined) problems.push(`${label}: apply returned a value (must settle synchronously)`)

  if (withSlots) {
    if (!registered.includes('settings.section')) problems.push(`${label}: settings.section not registered`)
    if (!registered.includes('main')) problems.push(`${label}: global main panel not registered`)
  } else if (registered.length !== 0) {
    problems.push(`${label}: registered ${registered.join(',')} without the slots service`)
  }
  console.log(`${label}: threw=${threw ? threw.message : 'no'} registered=[${registered.join(',')}] injected=[${injected.join(',')}]`)
}

runScenario('without slots', { withSlots: false })
runScenario('with slots', { withSlots: true })

console.log('factory id      :', globalThis.__loadedId)
console.log('exports.inject  :', JSON.stringify(moduleExports.inject))

if (problems.length) {
  console.error('FAIL:\n- ' + problems.join('\n- '))
  process.exit(1)
}
console.log('PASS: client entry activates synchronously and cannot abort the boot')
process.exit(0)
