// Host-route regression tests for the whale-maid mascot plugin.
// Run with: node --test test/host-routes.test.mjs
//
// The harness' LLM service is mocked as an async chunk stream, so these tests
// pin the request shape, the mood tag parsing and the fail-soft behavior
// without touching a real provider or the running DSH app.
import { test, after } from 'node:test'
import assert from 'node:assert/strict'
import { Readable } from 'node:stream'
import { mkdirSync, writeFileSync, rmSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { apply } from '../dsh/index.js'

const TEST_DIR = dirname(fileURLToPath(import.meta.url))
const FIXTURE = join(TEST_DIR, '..', 'tmp-workspace-fixture')

// Workspace fixture used by the scanning/preview tests.
const PNG_1PX = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8/x8AAwMCAO+ip1sAAAAASUVORK5CYII=',
  'base64',
)
mkdirSync(join(FIXTURE, 'proyecto', 'sub'), { recursive: true })
writeFileSync(join(FIXTURE, 'proyecto', 'notas.md'), '# hola mundo\n')
writeFileSync(join(FIXTURE, 'proyecto', 'datos.csv'), 'a,b\n1,2\n')
writeFileSync(join(FIXTURE, 'proyecto', 'sub', 'app.py'), 'print("hi")\n')
writeFileSync(join(FIXTURE, 'entrega_final.pdf'), '%PDF-1.4 test')
writeFileSync(join(FIXTURE, 'logo.png'), PNG_1PX)
after(() => rmSync(FIXTURE, { recursive: true, force: true }))

function harness(replyChunks) {
  const routes = new Map()
  const scope = {
    webServer: {
      register(route) {
        routes.set(route.path, route.handler)
      },
    },
    llm: {
      stream(options) {
        scope.lastStreamOptions = options
        return Readable.from(replyChunks)
      },
    },
  }
  apply({ inject: (services, fn) => { fn(scope) } })
  return { routes, scope }
}

function post(handler, body) {
  let status = 0
  let payload = ''
  const res = {
    writeHead(code) { status = code },
    end(text) { payload = text || '' },
  }
  const req = Readable.from([Buffer.from(JSON.stringify(body))])
  req.method = 'POST'
  return Promise.resolve(handler(req, res)).then(() => ({ status, body: JSON.parse(payload) }))
}

function get(handler, url) {
  let status = 0
  let headers = {}
  let payload = Buffer.alloc(0)
  const res = {
    writeHead(code, h) { status = code; headers = h || {} },
    end(value) { payload = Buffer.isBuffer(value) ? value : Buffer.from(String(value || '')) },
  }
  const req = { method: 'GET', url }
  return Promise.resolve(handler(req, res)).then(() => ({ status, headers, body: payload }))
}

const chunks = (text, finishKind = 'stop') => [
  { type: 'block-start', index: 0, blockType: 'text' },
  ...text.split(/(?= )/).filter(Boolean).map((part) => ({ type: 'text-delta', index: 0, text: part })),
  { type: 'block-end', index: 0, block: { type: 'text', text } },
  { type: 'finish', reason: { kind: finishKind } },
]

test('poses manifest always advertises the known moods', async () => {
  const { routes } = harness(chunks('hola'))
  const handler = routes.get('/whale-maid-mascot/poses.json')
  assert.ok(handler, 'manifest route registered')
  let payload = ''
  await handler({ method: 'GET' }, { writeHead() {}, end: (text) => { payload = text } })
  const manifest = JSON.parse(payload)
  assert.ok(manifest.moods.includes('shy'))
  assert.ok(manifest.moods.includes('love'))
  assert.equal(typeof manifest.poses, 'object')
  // The shipped, licensed outfit sprites are published for the client to use.
  assert.match(manifest.poses.school_front, /\/whale-maid-mascot\/poses\/school_front\.png$/)
  assert.match(manifest.poses.hoodie_side, /\/whale-maid-mascot\/poses\/hoodie_side\.png$/)
})

test('chat replies with the mood tag stripped and a canonical mood', async () => {
  const { routes, scope } = harness(chunks('[shy] ¡Q-qué vergüenza... no me mires tanto!'))
  const handler = routes.get('/whale-maid-mascot/chat')
  const { status, body } = await post(handler, { message: 'hola', love: 2, sessionId: 'whale-chan-test-1' })
  assert.equal(status, 200)
  assert.equal(body.line, '¡Q-qué vergüenza... no me mires tanto!')
  assert.equal(body.mood, 'shy')
  // The request must be a real one-shot generate with a generous token budget.
  assert.equal(scope.lastStreamOptions.provider, 'opencode-go')
  assert.ok(scope.lastStreamOptions.maxTokens >= 512)
  assert.ok(String(scope.lastStreamOptions.system).includes('Whale-chan'))
  // OpenCode Go rejects requests without this conversation routing id.
  assert.equal(scope.lastStreamOptions.sessionId, 'whale-chan-test-1')
})

test('chat always sends a sessionId even when the browser omits it', async () => {
  const { routes, scope } = harness(chunks('[neutral] Hola.'))
  const handler = routes.get('/whale-maid-mascot/chat')
  const { status } = await post(handler, { message: 'hola' })
  assert.equal(status, 200)
  assert.match(String(scope.lastStreamOptions.sessionId), /^whale-maid-mascot-/)
})

test('body-tap events reach the model with their zone-specific prompt', async () => {
  const { routes, scope } = harness(chunks('[shy] ¡Ah! No mires tanto...'))
  const handler = routes.get('/whale-maid-mascot/line')
  const { status, body } = await post(handler, { event: 'chest-poke', love: 2, sessionId: 'whale-chan-test-2' })
  assert.equal(status, 200)
  assert.equal(body.mood, 'shy')
  const userText = scope.lastStreamOptions.messages[0].content[0].text
  assert.match(userText, /pecho/)
})

test('chat forwards recent history and current user text', async () => {
  const { routes, scope } = harness(chunks('[happy] ¡Qué bien! Me encanta hablar contigo.'))
  const handler = routes.get('/whale-maid-mascot/chat')
  await post(handler, {
    message: '¿te acuerdas de mí?',
    history: [
      { role: 'user', text: 'hola, me llamo D' },
      { role: 'assistant', text: '¡Hola D! Jeje~' },
    ],
  })
  const userText = scope.lastStreamOptions.messages[0].content[0].text
  assert.ok(userText.startsWith('¿te acuerdas de mí?'))
  assert.ok(userText.includes('Usuario: hola, me llamo D'))
  assert.ok(userText.includes('Whale-chan: ¡Hola D! Jeje~'))
})

test('chat rejects an empty message without calling the model', async () => {
  const { routes } = harness(chunks('nunca'))
  const handler = routes.get('/whale-maid-mascot/chat')
  const { status } = await post(handler, { message: '   ' })
  assert.equal(status, 400)
})

test('a provider error finish becomes a visible 500 instead of an empty line', async () => {
  const { routes } = harness([{ type: 'finish', reason: { kind: 'error', failure: { message: 'quota exceeded' } } }])
  const handler = routes.get('/whale-maid-mascot/chat')
  const { status, body } = await post(handler, { message: 'hola' })
  assert.equal(status, 500)
  assert.match(body.error, /quota exceeded/)
})

test('an empty model reply is reported as an error', async () => {
  const { routes } = harness([{ type: 'finish', reason: { kind: 'stop' } }])
  const handler = routes.get('/whale-maid-mascot/chat')
  const { status, body } = await post(handler, { message: 'hola' })
  assert.equal(status, 500)
  assert.match(body.error, /empty/)
})

test('ambient line route also returns a mood for the sprite', async () => {
  const { routes } = harness(chunks('[happy] ¡Mi amo ha vuelto~!'))
  const handler = routes.get('/whale-maid-mascot/line')
  const { status, body } = await post(handler, { event: 'idle', love: 1 })
  assert.equal(status, 200)
  assert.equal(body.line, '¡Mi amo ha vuelto~!')
  assert.equal(body.mood, 'happy')
})

// --- workspace awareness ------------------------------------------------------

test('workspace summary lists projects, recent files and deliverables', async () => {
  const { routes } = harness(chunks('[happy] Hola.'))
  const handler = routes.get('/whale-maid-mascot/workspace')
  assert.ok(handler, 'workspace route registered')
  const { status, body } = await get(handler, `/whale-maid-mascot/workspace?root=${encodeURIComponent(FIXTURE)}`)
  assert.equal(status, 200)
  const summary = JSON.parse(body.toString('utf8'))
  assert.equal(summary.name, 'tmp-workspace-fixture')
  assert.ok(summary.totals.files >= 5)
  assert.ok(summary.projects.some((p) => p.name === 'proyecto'))
  assert.ok(summary.recent.some((f) => f.name === 'notas.md'))
  assert.ok(summary.artifacts.some((f) => f.name === 'logo.png'))
  assert.ok(summary.artifacts.some((f) => f.name === 'entrega_final.pdf'))
  assert.ok(summary.totals.kinds.image >= 1)
})

test('workspace file preview serves text and images, rejects escapes', async () => {
  const { routes } = harness(chunks('ok'))
  const handler = routes.get('/whale-maid-mascot/workspace/file')
  const base = `/whale-maid-mascot/workspace/file?root=${encodeURIComponent(FIXTURE)}`

  const text = await get(handler, `${base}&path=${encodeURIComponent('proyecto/notas.md')}`)
  assert.equal(text.status, 200)
  assert.match(text.headers['content-type'], /text\/plain/)
  assert.match(text.body.toString('utf8'), /hola mundo/)

  const image = await get(handler, `${base}&path=${encodeURIComponent('logo.png')}`)
  assert.equal(image.status, 200)
  assert.match(image.headers['content-type'], /image\/png/)
  assert.deepEqual([...image.body.subarray(0, 4)], [0x89, 0x50, 0x4e, 0x47])

  const escape = await get(handler, `${base}&path=${encodeURIComponent('../package.json')}`)
  assert.equal(escape.status, 403)

  const missing = await get(handler, `${base}&path=${encodeURIComponent('nope.txt')}`)
  assert.equal(missing.status, 404)
})

test('workspace routes refuse roots outside the home folder', async () => {
  const { routes } = harness(chunks('ok'))
  const summary = routes.get('/whale-maid-mascot/workspace')
  const file = routes.get('/whale-maid-mascot/workspace/file')
  const outside = 'C:\\Windows'
  const one = await get(summary, `/whale-maid-mascot/workspace?root=${encodeURIComponent(outside)}`)
  assert.equal(one.status, 403)
  const two = await get(file, `/whale-maid-mascot/workspace/file?root=${encodeURIComponent(outside)}&path=x.txt`)
  assert.equal(two.status, 403)
})

test('chat passes the work context to the model', async () => {
  const { routes, scope } = harness(chunks('[happy] ¡Qué bonito tu proyecto!'))
  const handler = routes.get('/whale-maid-mascot/chat')
  const { status } = await post(handler, {
    message: '¿qué opinas de mi trabajo?',
    context: {
      workspace: 'default-workspace',
      session: 'Entrega del informe',
      projects: ['analisis_sv', 'whalechan-plugin'],
      recent: [{ name: 'informe.docx' }, { name: 'grafico.png' }],
      artifacts: [{ name: 'presentacion.pptx' }],
    },
  })
  assert.equal(status, 200)
  const userText = scope.lastStreamOptions.messages[0].content[0].text
  assert.match(userText, /Contexto del trabajo/)
  assert.match(userText, /analisis_sv/)
  assert.match(userText, /informe\.docx/)
  assert.match(userText, /presentacion\.pptx/)
})

test('body-tap lines also receive the work context', async () => {
  const { routes, scope } = harness(chunks('[love] ¡Qué trabajador mi amo!'))
  const handler = routes.get('/whale-maid-mascot/line')
  await post(handler, {
    event: 'artifact',
    love: 2,
    context: { artifacts: [{ name: 'entrega_final.pdf' }] },
  })
  const userText = scope.lastStreamOptions.messages[0].content[0].text
  assert.match(userText, /entrega_final\.pdf/)
})
