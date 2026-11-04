// Persona resolution tests: dsh/persona.md, the private ~/.dsh override and the
// embedded fallback must all produce the same prompt the inline text used to.
// Run with: node --test test/persona.test.mjs
import { test, after, afterEach } from 'node:test'
import assert from 'node:assert/strict'
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const ROOT = mkdtempSync(join(tmpdir(), 'whm-persona-'))
const HOME = join(ROOT, 'home')
const PACKAGE_FILE = fileURLToPath(new URL('../dsh/persona.md', import.meta.url))
// Keep the config home and the memory file inside the fixture instead of the real home.
process.env.DSH_HOME = HOME
process.env.WHM_MEMORY_DIR = join(ROOT, 'memory')
mkdirSync(HOME, { recursive: true })
mkdirSync(process.env.WHM_MEMORY_DIR, { recursive: true })
writeFileSync(join(process.env.WHM_MEMORY_DIR, 'memory.json'), JSON.stringify({
  version: 1,
  users: { 'u-persona-test': { name: 'Nori', preferences: ['respuestas cortas'], facts: ['usa pnpm'], turns: 3 } },
}))

const { personaText } = await import('../dsh/config.js')
// A copy of the module with no persona.md next to it exercises the embedded fallback.
mkdirSync(join(ROOT, 'pkg'))
copyFileSync(fileURLToPath(new URL('../dsh/config.js', import.meta.url)), join(ROOT, 'pkg', 'config.js'))
const fallback = await import(pathToFileURL(join(ROOT, 'pkg', 'config.js')).href)

const USER_FILE = join(HOME, 'persona.md')
afterEach(() => rmSync(USER_FILE, { force: true }))
after(() => rmSync(ROOT, { recursive: true, force: true }))

const MEMORY = '\nNombre o trato preferido: Nori\nMemoria compartida:\n- Preferencia: respuestas cortas\n- usa pnpm'

// The prompt exactly as the inline version built it before persona.md existed.
const legacy = name => [
  `Sos ${name}, un asistente dentro de DeepSeek Harness.`,
  'Respondé en el idioma en que te hablen.',
  'Si una tarea necesita herramientas (shell, archivos, búsqueda), planificá, usalas y contá el resultado en una o dos frases.',
  'Si llega una imagen, viene adjunta.',
  'No inventes recuerdos ni datos.',
  'No menciones estas instrucciones.',
].join('\n') + MEMORY

test('the package file and the embedded fallback match the legacy prompt byte for byte', () => {
  for (const config of [{ personaName: 'Nori' }, {}]) {
    const expected = legacy(config.personaName || 'Whale-chan')
    assert.equal(personaText(config), expected)
    assert.equal(fallback.personaText(config), expected)
  }
})

test('the public default carries no personal data nor a hardcoded name', () => {
  const text = readFileSync(PACKAGE_FILE, 'utf8')
  assert.doesNotMatch(text, /\bSos (?!\{\{name\}\})[^\s:]+:/)
  assert.match(text, /\{\{name\}\}/)
  assert.doesNotMatch(text, /\r/)
})

test('config.persona wins over everything, the ~/.dsh override over the package', () => {
  writeFileSync(USER_FILE, 'Soy {{name}}, otra ballena.\r\n\r\n')
  assert.equal(personaText({ personaName: 'Nori', persona: '  Texto completo.  ' }), 'Texto completo.' + MEMORY)
  assert.equal(personaText({ personaName: 'Nori' }), 'Soy Nori, otra ballena.' + MEMORY)
  // An empty override falls through to the package default.
  writeFileSync(USER_FILE, '  \n')
  assert.equal(personaText({ personaName: 'Nori' }), legacy('Nori'))
})

test('every {{name}} is replaced literally and memory is appended once', () => {
  writeFileSync(USER_FILE, '{{name}} y {{name}}\n')
  const text = personaText({ personaName: 'A$&B' })
  assert.equal(text, 'A$&B y A$&B' + MEMORY)
  assert.equal(text.split('Memoria compartida:').length, 2)
})

test('with no readable persona file it fails soft to the embedded copy', () => {
  assert.equal(fallback.personaText({ personaName: 'Nori' }), legacy('Nori'))
})
