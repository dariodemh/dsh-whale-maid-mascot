// Tests for the self-contained Whale-chan doodle engine.
// Run from the repo root with: node test/doodle.test.mjs
//
// The suite pins the public contract (sizes, escaping, determinism, caps and
// sprite paths) without DOM, network or extra dependencies.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { DOODLE_KINDS, renderDoodle, escapeXml } from '../dsh/doodle.js'

const KINDS = ['progress', 'celebrate', 'sticker', 'doodle']
const EXPECTED_SIZES = {
  progress: [720, 480],
  celebrate: [720, 480],
  sticker: [480, 480],
  doodle: [480, 480],
}

function sampleData(kind) {
  return {
    title: kind === 'sticker' ? 'Hola' : 'Revisión del proyecto',
    subtitle: 'Entregables de la sesión',
    date: '2026-11-03',
    footer: 'Whale-chan · DSH',
    items: [
      { name: 'informe-final.pdf', kind: 'pdf', bytes: 1_572_864 },
      { name: 'portada.png', kind: 'image', bytes: 204_800 },
      { name: 'datos.csv', kind: 'csv', bytes: 42_000 },
    ],
    lines: [
      'Todo quedó en su sitio.',
      'Puedes revisarlo cuando quieras.',
      'No hace falta que respondas ahora.',
    ],
    mood: 'happy',
    style: 'd',
  }
}

test('1. cada tipo devuelve un SVG con dimensiones enteras y viewBox coherente', () => {
  assert.deepEqual([...DOODLE_KINDS], KINDS)

  for (const kind of KINDS) {
    const result = renderDoodle(kind, sampleData(kind))
    assert.equal(typeof result.svg, 'string', `${kind}: svg must be a string`)
    assert.ok(result.svg.startsWith('<svg'), `${kind}: svg must start with <svg`)
    assert.ok(result.svg.endsWith('</svg>'), `${kind}: svg must end with </svg>`)

    const expected = EXPECTED_SIZES[kind]
    assert.deepEqual([result.width, result.height], expected, `${kind}: unexpected size`)
    assert.ok(Number.isInteger(result.width) && result.width > 0)
    assert.ok(Number.isInteger(result.height) && result.height > 0)

    const viewBox = result.svg.match(/viewBox="0 0 (\d+) (\d+)"/)
    assert.ok(viewBox, `${kind}: missing viewBox`)
    assert.equal(Number(viewBox[1]), result.width, `${kind}: viewBox width mismatch`)
    assert.equal(Number(viewBox[2]), result.height, `${kind}: viewBox height mismatch`)
  }
})

test('2. no aparecen artefactos undefined, NaN ni [object Object]', () => {
  for (const kind of KINDS) {
    const clean = renderDoodle(kind, sampleData(kind)).svg
    assert.doesNotMatch(clean, /\bundefined\b|\bNaN\b|\[object Object\]/, `${kind}: clean data leaked an artifact`)

    const hostile = renderDoodle(kind, {
      title: {},
      subtitle: [],
      date: {},
      footer: {},
      items: [{ name: {}, kind: {}, bytes: 'no-numérico' }],
      lines: [{ nope: true }],
      mood: {},
      style: {},
    }).svg
    assert.doesNotMatch(hostile, /\bundefined\b|\bNaN\b|\[object Object\]/, `${kind}: invalid data leaked an artifact`)
  }
})

test('3. escapeXml escapa los cinco caracteres y neutraliza <script>', () => {
  assert.equal(escapeXml(`< > & " '`), '&lt; &gt; &amp; &quot; &apos;')
  assert.equal(escapeXml('a & b < c'), 'a &amp; b &lt; c')

  const svg = renderDoodle('progress', {
    title: 'Entrega',
    items: [{ name: '<script>alert(1)</script>', kind: 'code', bytes: 12 }],
  }).svg

  assert.ok(!svg.includes('<script>'), 'literal <script> must not survive')
  assert.ok(!/<script/i.test(svg), 'script tag must be neutralized')
  assert.ok(svg.includes('&lt;script&gt;alert(1)&lt;/script&gt;'), 'escaped payload must be visible as text')
})

test('4. la misma entrada produce exactamente el mismo SVG', () => {
  for (const kind of KINDS) {
    const first = renderDoodle(kind, sampleData(kind)).svg
    const second = renderDoodle(kind, sampleData(kind)).svg
    assert.equal(first, second, `${kind}: output is not byte-identical`)
  }
})

test('5. progress limita a 10 filas y muestra el estado vacío', () => {
  const items = Array.from({ length: 12 }, (_, index) => ({
    name: `entrega-${index + 1}.pdf`,
    kind: 'pdf',
    bytes: 1024 * (index + 1),
  }))
  const full = renderDoodle('progress', { items }).svg
  const rows = full.match(/<g class="doodle-item"/g) || []
  assert.equal(rows.length, 10, 'only the first 10 items must be rendered')

  const empty = renderDoodle('progress', { items: [] }).svg
  assert.match(empty, /Aún no hay entregables nuevos/)
  assert.match(empty, /Sin entregables nuevos por ahora/)
})

test('6. sticker y celebrate incluyen el sprite correcto', () => {
  for (const kind of ['sticker', 'celebrate']) {
    const svg = renderDoodle(kind, sampleData(kind)).svg
    assert.ok(
      svg.includes('<image href="/whale-maid-mascot/'),
      `${kind}: missing /whale-maid-mascot/ sprite reference`,
    )
  }
  assert.ok(
    renderDoodle('progress', sampleData('progress')).svg.includes('/whale-maid-mascot/a.png'),
    'progress: base sprite reference missing',
  )
  assert.ok(
    renderDoodle('celebrate', sampleData('celebrate')).svg.includes('/whale-maid-mascot/poses/hoodie_front.png'),
    'celebrate: hoodie sprite reference missing',
  )
})

test('7. textos enormes se truncan por debajo de los límites', () => {
  const huge = 'x'.repeat(600)
  const svg = renderDoodle('progress', {
    title: huge,
    subtitle: huge,
    footer: huge,
    items: [{ name: huge, kind: 'pdf', bytes: 2048 }],
  }).svg

  assert.ok(!svg.includes(huge), 'the untruncated input must not appear')

  const context = svg.match(/<text class="doodle-context"[^>]*>([\s\S]*?)<\/text>/)
  assert.ok(context, 'progress context title missing')
  assert.ok(Array.from(context[1]).length <= 80, 'title exceeds 80 characters')

  const itemName = svg.match(/<text class="doodle-item-name"[^>]*>([\s\S]*?)<\/text>/)
  assert.ok(itemName, 'item name missing')
  assert.ok(Array.from(itemName[1]).length <= 60, 'item name exceeds 60 characters')

  for (const [index, match] of [...svg.matchAll(/<text\b[^>]*>([\s\S]*?)<\/text>/g)].entries()) {
    const visible = match[1].replace(/&(?:amp|lt|gt|quot|apos);/g, 'x')
    assert.ok(Array.from(visible).length <= 120, `text node ${index} exceeds 120 characters`)
  }

  const celebrate = renderDoodle('celebrate', { title: huge, lines: [huge, huge, huge] }).svg
  assert.ok(!celebrate.includes(huge), 'celebrate headline must be truncated')
  for (const match of celebrate.matchAll(/<text\b[^>]*>([\s\S]*?)<\/text>/g)) {
    const visible = match[1].replace(/&(?:amp|lt|gt|quot|apos);/g, 'x')
    assert.ok(Array.from(visible).length <= 120, 'celebrate text line exceeds 120 characters')
  }
})

test('8. la salida es XML razonable y no usa recursos externos', () => {
  for (const kind of KINDS) {
    const svg = renderDoodle(kind, sampleData(kind)).svg

    assert.equal((svg.match(/<svg\b/g) || []).length, 1, `${kind}: expected exactly one <svg>`)
    assert.equal((svg.match(/<\/svg>/g) || []).length, 1, `${kind}: expected exactly one </svg>`)

    const images = svg.match(/<image\b/g) || []
    assert.ok(images.length >= 0 && images.length <= 3, `${kind}: unreasonable <image> count`)

    assert.doesNotMatch(svg, /<(?:script|foreignObject|iframe)\b/i, `${kind}: forbidden element`)
    assert.doesNotMatch(
      svg,
      /&(?!amp;|lt;|gt;|quot;|apos;|#\d+;|#x[0-9a-fA-F]+;)/,
      `${kind}: unescaped ampersand`,
    )

    const hrefs = [...svg.matchAll(/href="([^"]*)"/g)].map((match) => match[1])
    for (const href of hrefs) {
      assert.ok(href.startsWith('/whale-maid-mascot/'), `${kind}: external href ${href}`)
    }

    const withoutNamespace = svg.replace('xmlns="http://www.w3.org/2000/svg"', '')
    assert.doesNotMatch(withoutNamespace, /https?:\/\//, `${kind}: external URL found`)
  }
})
