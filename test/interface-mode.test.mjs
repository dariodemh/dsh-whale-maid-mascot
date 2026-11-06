// Interface-mode tests (2.8.0).
// Run with: node --test test/interface-mode.test.mjs
//
// Pins the host half of the "mascot as the main view" feature: the config
// default stays `classic`, the value is normalized, and the route the browser
// reads on load answers { mode, personaName } without leaking anything else.
// The client half moves real DOM inside the harness, so it is covered by the
// manual steps in docs/interface-mode.md rather than by a browserless unit test.
import { test, after } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const HOME = mkdtempSync(join(tmpdir(), 'whm-interface-'))
process.env.DSH_HOME = HOME
process.env.WHM_MEMORY_DIR = join(HOME, 'memory')

const { DEFAULTS, interfaceModeOf, loadConfig } = await import('../dsh/config.js')
const { handleInterface } = await import('../dsh/index.js')

after(() => rmSync(HOME, { recursive: true, force: true }))

function writeConfig(values) {
  writeFileSync(join(HOME, 'whale-maid.json'), `${JSON.stringify(values, null, 2)}\n`, 'utf8')
}

function callRoute(method = 'GET') {
  const result = { status: 0, headers: null, body: '' }
  const res = {
    writeHead(status, headers) {
      result.status = status
      result.headers = headers || null
      return res
    },
    end(chunk) {
      if (typeof chunk === 'string') result.body += chunk
      return res
    },
  }
  handleInterface({ method }, res)
  return result
}

test('classic is the default and anything unknown normalizes to classic', () => {
  assert.equal(DEFAULTS.interfaceMode, 'classic')
  assert.equal(interfaceModeOf({}), 'classic')
  assert.equal(interfaceModeOf(null), 'classic')
  assert.equal(interfaceModeOf({ interfaceMode: 'fullscreen' }), 'fullscreen')
  assert.equal(interfaceModeOf({ interfaceMode: 'FULLSCREEN' }), 'classic')
  assert.equal(interfaceModeOf({ interfaceMode: 'weird' }), 'classic')
})

test('the route answers the configured mode and the persona name', () => {
  const classic = callRoute('GET')
  assert.equal(classic.status, 200)
  const classicBody = JSON.parse(classic.body)
  assert.deepEqual(classicBody, { mode: 'classic', personaName: DEFAULTS.personaName })

  writeConfig({ personaName: 'Cala', interfaceMode: 'fullscreen' })
  const fullscreen = callRoute('GET')
  assert.equal(fullscreen.status, 200)
  assert.deepEqual(JSON.parse(fullscreen.body), { mode: 'fullscreen', personaName: 'Cala' })

  // only the two fields, nothing about tokens or paths
  assert.deepEqual(Object.keys(JSON.parse(fullscreen.body)).sort(), ['mode', 'personaName'])

  writeConfig({ interfaceMode: 'nope' })
  assert.equal(JSON.parse(callRoute('GET').body).mode, 'classic')
})

test('the route only accepts GET', () => {
  const post = callRoute('POST')
  assert.equal(post.status, 405)
  assert.equal(post.body, '')
})

test('loadConfig keeps interfaceMode alongside the existing keys', () => {
  writeConfig({ interfaceMode: 'fullscreen', personaName: 'Cala', ownerName: 'Alex' })
  const config = loadConfig()
  assert.equal(config.interfaceMode, 'fullscreen')
  assert.equal(config.personaName, 'Cala')
  assert.equal(interfaceModeOf(config), 'fullscreen')
})
