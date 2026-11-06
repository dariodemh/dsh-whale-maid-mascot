// Outbox (local mirror of outgoing Telegram photos) tests.
// Run with: node --test test/outbox.test.mjs
//
// The shared DSH transcript only carries text events, so a photo uploaded with
// `telegram_photo` used to vanish locally. The outbox keeps a restart-safe
// record (copied file + metadata, never base64) that the host merges into
// GET /whale-maid-mascot/history and serves back through /outbox-image so the
// in-page chat and the desktop window render it. These tests pin that contract.
import { test, after, beforeEach } from 'node:test'
import assert from 'node:assert/strict'
import { existsSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const HOME = mkdtempSync(join(tmpdir(), 'whm-outbox-'))
process.env.DSH_HOME = HOME
process.env.WHM_MEMORY_DIR = join(HOME, 'memory')

const {
  OUTBOX_DIR,
  OUTBOX_PLACEHOLDER,
  mergeHistoryMessages,
  outboxHistoryMessages,
  readOutboxEntries,
  readOutboxImage,
  recordOutboxImage,
} = await import('../dsh/outbox.js')
const { handleOutboxImage } = await import('../dsh/index.js')

after(() => rmSync(HOME, { recursive: true, force: true }))

// Every test starts from an empty outbox; the module paths are fixed by
// DSH_HOME at import, so the state is shared and must be reset by hand.
beforeEach(() => {
  rmSync(join(HOME, 'whale-maid.outbox.json'), { force: true })
  rmSync(join(HOME, 'whale-maid-outbox'), { recursive: true, force: true })
})

// Enough of a PNG header for the route tests; nothing decodes the image here.
const PNG = Buffer.from('89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c489', 'hex')

function makeImage(name = 'shot.png', size = null) {
  const path = join(HOME, name)
  writeFileSync(path, size ? Buffer.alloc(size, 7) : PNG)
  return path
}

function callRoute(id, method = 'GET') {
  const result = { status: 0, headers: null, body: null }
  const res = {
    writeHead(status, headers) {
      result.status = status
      result.headers = headers || null
      return res
    },
    end(chunk) {
      if (chunk !== undefined) result.body = chunk
      return res
    },
  }
  handleOutboxImage({ method, url: `/whale-maid-mascot/outbox-image?id=${encodeURIComponent(id)}` }, res)
  return result
}

test('records an outgoing image: copies the file and persists metadata only', () => {
  const source = makeImage('captura.png')
  const result = recordOutboxImage({ path: source, caption: ' Mirá esto ', chatId: 42, messageId: 99 })
  assert.equal(result.ok, true)
  assert.ok(result.id.startsWith('img-'))
  assert.ok(existsSync(result.entry.path), 'image copied into the outbox dir')
  assert.ok(result.entry.path.startsWith(OUTBOX_DIR))
  assert.equal(result.entry.mediaType, 'image/png')
  assert.equal(result.entry.caption, ' Mirá esto ')
  assert.equal(result.entry.messageId, 99)

  const entries = readOutboxEntries()
  assert.equal(entries.length, 1)
  assert.equal(entries[0].id, result.id)
  assert.equal(entries[0].path, result.entry.path)
  // never base64 in the persisted record
  assert.equal('dataBase64' in entries[0], false)
  assert.ok(JSON.stringify(entries).length < 2048, 'the record stays small')
})

test('rejects missing, unsupported and oversized files', () => {
  assert.equal(recordOutboxImage({ path: join(HOME, 'nope.png') }).ok, false)
  const text = join(HOME, 'notas.txt')
  writeFileSync(text, 'hola')
  assert.equal(recordOutboxImage({ path: text }).ok, false)
  assert.equal(recordOutboxImage({ path: text }).error, 'unsupported image type')
  const big = makeImage('big.jpg', 2048)
  assert.equal(recordOutboxImage({ path: big, maxBytes: 1024 }).ok, false)
  assert.equal(recordOutboxImage({ path: big, maxBytes: 1024 }).error, 'file too large')
})

test('a retried send with the same Telegram message id is not stored twice', () => {
  const source = makeImage('retry.png')
  const first = recordOutboxImage({ path: source, chatId: 7, messageId: 1234 })
  const second = recordOutboxImage({ path: source, chatId: 7, messageId: 1234 })
  assert.equal(first.ok, true)
  assert.equal(second.ok, true)
  assert.equal(second.duplicate, true)
  assert.equal(second.id, first.id)
  assert.equal(readOutboxEntries().length, 1)
})

test('history messages carry role/text/image and a stable mirror URL', () => {
  const source = makeImage('hola.webp')
  const stored = recordOutboxImage({ path: source, caption: 'foto', chatId: 5, messageId: 555 })
  const messages = outboxHistoryMessages()
  assert.equal(messages.length, 1)
  const message = messages[0]
  assert.equal(message.role, 'assistant', 'the photo is Cala\'s own message in the local thread')
  assert.equal(message.at, stored.entry.at)
  assert.equal(message.text, 'foto')
  assert.equal(message.image.id, stored.id)
  assert.equal(message.image.mediaType, 'image/webp')
  assert.equal(message.image.url, `/whale-maid-mascot/outbox-image?id=${encodeURIComponent(stored.id)}`)

  const placeholder = outboxHistoryMessages([{ ...stored.entry, caption: '' }])[0]
  assert.equal(placeholder.text, OUTBOX_PLACEHOLDER)
})

test('merge keeps text and photo entries ordered, deduplicated and bounded', () => {
  const text = [
    { role: 'user', text: 'hola', at: 100 },
    { role: 'bot', text: 'respuesta', at: 200 },
    { role: 'user', text: 'otra', at: 400 },
  ]
  const photos = [
    { role: 'user', text: 'foto', at: 300, image: { id: 'img-x', url: '/u' } },
    { role: 'user', text: 'foto', at: 300, image: { id: 'img-x', url: '/u' } },
  ]
  const merged = mergeHistoryMessages(text, photos)
  assert.deepEqual(merged.map(item => item.at), [100, 200, 300, 400])
  assert.equal(merged.filter(item => item.image).length, 1, 'same image id is not duplicated')
  assert.deepEqual(mergeHistoryMessages(text, photos, 2).map(item => item.at), [300, 400])
  // a user message that already exists is not repeated by the outbox merge
  const same = mergeHistoryMessages([{ role: 'user', text: 'foto', at: 300 }], [])
  assert.equal(same.length, 1)
})

test('the outbox image route serves the stored bytes and 404s unknown ids', () => {
  const source = makeImage('ruta.jpg')
  const stored = recordOutboxImage({ path: source, chatId: 1, messageId: 1 })
  assert.equal(stored.ok, true)

  const hit = callRoute(stored.id)
  assert.equal(hit.status, 200)
  assert.equal(hit.headers['content-type'], 'image/jpeg')
  assert.equal(hit.headers['content-length'], String(PNG.length))
  assert.equal(Buffer.compare(Buffer.from(hit.body), PNG), 0)

  assert.equal(callRoute('img-nope').status, 404)
  assert.equal(callRoute(stored.id, 'POST').status, 405)

  const image = readOutboxImage(stored.id)
  assert.equal(image.mediaType, 'image/jpeg')
  assert.equal(readOutboxImage('img-nope'), null)
})
