// DeepSeek Harness (dsh) host half of the whale-maid mascot plugin.
//
// The browser half (dsh/client.js) fetches the character PNGs from here and
// talks to the two AI routes below:
//   POST /whale-maid-mascot/line  -> one short ambient line for an event
//   POST /whale-maid-mascot/chat  -> a conversational reply + mood
// Both use the harness' own LLM service (the user's configured provider and
// credentials), so no key ever reaches the browser. Anything optional fails
// soft: if the model is unavailable the client keeps using its fixed lines.
//
// It also serves the optional expression poses in assets/poses/<mood>.png and
// a small manifest (GET /whale-maid-mascot/poses.json) so the browser can swap
// the sprite by mood whenever the artwork exists.
//
// Workspace awareness:
//   GET /whale-maid-mascot/workspace?root=<session cwd>  -> projects + recent files
//   GET /whale-maid-mascot/workspace/file?root=&path=    -> safe preview (image/text/pdf)
// The mascot uses that summary to talk about the user's work and to render the
// "Mis trabajos" panel. Roots must live under the user's home folder.
import { readFileSync, readdirSync, existsSync, statSync, realpathSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { join, resolve, relative, sep, extname } from 'node:path'
import { homedir } from 'node:os'
import { renderDoodle, DOODLE_KINDS } from './doodle.js'
import {
  getMemory,
  remember,
  clearMemory,
  bumpTurns,
  memoryPrompt,
  validUserId,
} from './memory.js'

export const name = 'whale-maid-mascot'
export const inject = []

const ASSETS = [
  { route: '/whale-maid-mascot/a.png', file: new URL('../assets/mascot_a.png', import.meta.url) },
  { route: '/whale-maid-mascot/b.png', file: new URL('../assets/mascot_b.png', import.meta.url) },
  { route: '/whale-maid-mascot/c.png', file: new URL('../assets/mascot_c.png', import.meta.url) },
]

const POSES_DIR = fileURLToPath(new URL('../assets/poses/', import.meta.url))
const POSES_ROUTE = '/whale-maid-mascot/poses/'
const POSE_EXT = /\.(png|webp)$/i

// Generated drawings ("doodles"): the model can ask for a card, the host renders
// an SVG and keeps it in memory for a while, and the browser loads it back by id.
const DRAW_ROUTE = '/whale-maid-mascot/draw'
const DRAW_SVG_ROUTE = '/whale-maid-mascot/draw.svg'
const DRAW_CACHE_TTL = 2 * 60 * 60 * 1000
const DRAW_CACHE_MAX = 200
const drawCache = new Map()

// Long-term memory routes and extraction. Memory is local (see dsh/memory.js);
// only stable, user-shared facts are kept, and the user can clear them.
const MEMORY_ROUTE = '/whale-maid-mascot/memory'
const MEMORY_TURN_CONSOLIDATION = 6
const MEMORY_KINDS = new Set(['name', 'fact', 'preference'])
const MEMORY_PATTERNS = [
  {
    kind: 'name',
    re: /\b(?:me llamo|mi nombre es|puedes llamarme|llámame|llamame)\s+([A-Za-zÁÉÍÓÚÜÑáéíóúüñ][\wÁÉÍÓÚÜÑáéíóúüñ.'-]{1,30})/i,
  },
  {
    kind: 'fact',
    re: /\b(?:recuerda que|acuérdate de que|acuerdate de que|ten en cuenta que|no olvides que|no te olvides de que)\s+(.{3,180})/i,
  },
  {
    kind: 'preference',
    re: /\b(?:prefiero|me gusta más|me gusta mas|no me gusta|no me gustan|evita|no uses|no quiero que)\s+(.{3,160})/i,
  },
]

const MEMORY_SYSTEM = [
  'Eres el sistema de memoria de una mascota compañera local.',
  'Extrae SOLO datos estables y útiles para adaptar su comportamiento al usuario: nombre o trato preferido, preferencias claras de trato o formato, y hechos duraderos sobre su trabajo o proyectos.',
  'Ignora estados de ánimo pasajeros, peticiones de una sola vez, datos sensibles (salud, política, religión, orientación sexual, credenciales, direcciones) y cualquier cosa que ya esté en la memoria actual.',
  'Responde SOLO con líneas con el formato "nombre: X", "hecho: X" o "preferencia: X" (máximo 3 líneas, sin numeración ni explicación). Si no hay nada nuevo, responde "nada".',
].join(' ')

function memoryCandidates(message) {
  const text = String(message || '').slice(0, 800)
  const found = []
  for (const pattern of MEMORY_PATTERNS) {
    const match = text.match(pattern.re)
    if (!match) continue
    const value = String(match[1] || '')
      .replace(/[.,;:!?]+$/, '')
      .trim()
      .slice(0, 200)
    if (value.length < 2) continue
    found.push({ kind: pattern.kind, text: value })
    if (found.length >= 3) break
  }
  return found
}

async function rememberFromMessage(userId, message) {
  if (!validUserId(userId)) return
  for (const candidate of memoryCandidates(message)) {
    await remember(userId, candidate.kind, candidate.text)
  }
}

/**
 * Once in a while ask the model to distil stable memories from the recent chat.
 * Runs after the reply is sent, is bounded, and fails soft: memory must never
 * break the conversation.
 */
async function consolidateMemory(scope, userId, history) {
  if (!validUserId(userId) || !Array.isArray(history) || history.length === 0) return
  try {
    const current = await getMemory(userId)
    const currentText = current
      ? [
        current.name ? `nombre: ${current.name}` : '',
        ...(current.facts || []).map((fact) => `hecho: ${fact}`),
        ...(current.preferences || []).map((preference) => `preferencia: ${preference}`),
      ].filter(Boolean).join('\n')
      : ''
    const lines = history
      .filter((turn) => turn && typeof turn.text === 'string' && turn.text.trim())
      .slice(-10)
      .map((turn) => `${turn.role === 'user' ? 'Usuario' : 'Whale-chan'}: ${String(turn.text).replace(/\s+/g, ' ').trim().slice(0, 300)}`)
    if (!lines.length) return
    const prompt = `Memoria actual:\n${currentText || '(vacía)'}\n\nConversación reciente:\n${lines.join('\n')}\n\nExtrae lo nuevo, si hay algo.`
    const reply = await generate(scope, MEMORY_SYSTEM, [{ type: 'text', text: prompt }], `whale-memory-${userId}`)
    const rows = String(reply.text || '').split(/\r?\n/).slice(0, 6)
    for (const row of rows) {
      const match = row.match(/^\s*(nombre|hecho|preferencia)\s*:\s*(.+)$/i)
      if (!match) continue
      const kind = match[1].toLowerCase() === 'hecho'
        ? 'fact'
        : match[1].toLowerCase() === 'preferencia' ? 'preference' : 'name'
      await remember(userId, kind, match[2])
    }
  } catch (error) {
    console.warn('[whale-maid-mascot] memory consolidation skipped:', error && error.message)
  }
}

function makeDrawId() {
  return globalThis.crypto && typeof globalThis.crypto.randomUUID === 'function'
    ? globalThis.crypto.randomUUID()
    : `draw-${Date.now()}-${Math.random().toString(16).slice(2)}`
}

function storeDraw(svg) {
  const now = Date.now()
  for (const [key, value] of drawCache) {
    if (now - value.at > DRAW_CACHE_TTL) drawCache.delete(key)
  }
  while (drawCache.size >= DRAW_CACHE_MAX) {
    const first = drawCache.keys().next().value
    drawCache.delete(first)
  }
  const id = makeDrawId()
  drawCache.set(id, { svg, at: now })
  return id
}

function drawUrl(id) {
  return `${DRAW_SVG_ROUTE}?id=${encodeURIComponent(id)}`
}

// Image uploads. The mascot chat can carry up to three images per turn; the
// host stores them through the DSH attachment service so the model receives real
// ImageBlocks and the browser can show the uploaded image back.
const CHAT_IMAGE_MIME = new Set(['image/png', 'image/jpeg', 'image/webp', 'image/gif'])
const MAX_CHAT_IMAGES = 3
const imageCache = new Map()
const IMAGE_CACHE_MAX = 120

function cacheImageRef(ref) {
  if (!ref || typeof ref.attachmentId !== 'string') return null
  imageCache.set(ref.attachmentId, { ref, at: Date.now() })
  while (imageCache.size > IMAGE_CACHE_MAX) {
    const first = imageCache.keys().next().value
    imageCache.delete(first)
  }
  return `/whale-maid-mascot/image?id=${encodeURIComponent(ref.attachmentId)}`
}

async function admitChatImages(scope, images) {
  const list = Array.isArray(images) ? images.slice(0, MAX_CHAT_IMAGES) : []
  const result = { blocks: [], refs: [], noVision: false, unavailable: false }
  if (!list.length) return result
  if (!scope || !scope.attachments || typeof scope.attachments.admitPromptContent !== 'function') {
    result.unavailable = true
    return result
  }
  const info = typeof scope.llm?.resolveModelInfo === 'function'
    ? await scope.llm.resolveModelInfo(PROVIDER, MODEL).catch(() => undefined)
    : undefined
  if (info && info.inputModalities !== undefined && !info.inputModalities.includes('image')) {
    result.noVision = true
    return result
  }
  const limits = scope.attachments.imageLimits || {}
  const allowed = new Set(limits.mediaTypes || [...CHAT_IMAGE_MIME])
  const parts = []
  for (const image of list) {
    if (!image || typeof image !== 'object') continue
    const mediaType = String(image.mimeType || '').toLowerCase()
    const data = String(image.dataBase64 || '')
      .replace(/^data:[^;]+;base64,/, '')
      .replace(/\s+/g, '')
    if (!allowed.has(mediaType) || !data) continue
    const maxBytes = Number(limits.maxImageBytes) || 20 * 1024 * 1024
    if (Math.ceil(data.length / 4) * 3 > maxBytes + 2) continue
    const part = { type: 'image', data, mediaType }
    if (typeof image.name === 'string' && image.name) part.name = image.name.slice(0, 120)
    parts.push(part)
  }
  if (!parts.length) return result
  const blocks = await scope.attachments.admitPromptContent(parts)
  for (const block of Array.isArray(blocks) ? blocks : []) {
    if (block && block.type === 'image' && block.attachment) {
      result.blocks.push(block)
      result.refs.push(block.attachment)
    }
  }
  return result
}

// --- workspace awareness ------------------------------------------------------
// The browser sends the current session cwd; the host scans that folder so the
// mascot can talk about the user's projects and deliverables, and serve safe
// previews of individual files. Roots are limited to the user's home folder and
// every resolved path must stay inside the requested workspace.
const WORKSPACE_ROUTE = '/whale-maid-mascot/workspace'
const WORKSPACE_FILE_ROUTE = '/whale-maid-mascot/workspace/file'
const IGNORED_DIRS = new Set([
  'node_modules', '.git', '.pnpm-store', '.cache', '.next', '.nuxt', '.venv', 'venv',
  '__pycache__', 'dist', 'build', 'out', 'tmp', 'temp', '.idea', '.vscode', '.dsh',
])
const MAX_SCAN_FILES = 4000
const MAX_SCAN_DEPTH = 3
const PREVIEW_TEXT_LIMIT = 200 * 1024
const PREVIEW_IMAGE_LIMIT = 8 * 1024 * 1024
const PREVIEW_PDF_LIMIT = 25 * 1024 * 1024
const WORKSPACE_CACHE_TTL = 8000

const IMAGE_EXT = new Set(['png', 'jpg', 'jpeg', 'webp', 'gif', 'svg', 'bmp', 'avif'])
const TEXT_EXT = new Set([
  'txt', 'md', 'markdown', 'json', 'jsonc', 'js', 'mjs', 'cjs', 'jsx', 'ts', 'tsx',
  'py', 'rb', 'go', 'rs', 'java', 'c', 'h', 'cpp', 'hpp', 'cs', 'php', 'sh', 'ps1',
  'html', 'htm', 'css', 'scss', 'xml', 'yml', 'yaml', 'toml', 'ini', 'cfg', 'env',
  'sql', 'log', 'csv', 'tsv', 'tex', 'r', 'lua', 'kt', 'swift', 'dart', 'vue', 'svelte',
])
const KIND_BY_EXT = {
  pdf: 'pdf',
  docx: 'doc', doc: 'doc', odt: 'doc', rtf: 'doc',
  pptx: 'slides', ppt: 'slides', odp: 'slides',
  xlsx: 'sheet', xls: 'sheet', ods: 'sheet',
  zip: 'archive', rar: 'archive', '7z': 'archive', tar: 'archive', gz: 'archive',
  mp3: 'audio', wav: 'audio', ogg: 'audio', flac: 'audio', m4a: 'audio',
  mp4: 'video', webm: 'video', mov: 'video', mkv: 'video',
  md: 'text', txt: 'text', csv: 'text',
}

function kindOf(name) {
  const ext = String(name).split('.').pop().toLowerCase()
  if (IMAGE_EXT.has(ext)) return 'image'
  if (KIND_BY_EXT[ext]) return KIND_BY_EXT[ext]
  if (TEXT_EXT.has(ext)) return 'code'
  return 'other'
}

function isArtifact(name) {
  const kind = kindOf(name)
  return kind === 'image' || kind === 'pdf' || kind === 'doc' || kind === 'slides' ||
    kind === 'sheet' || kind === 'archive' || kind === 'video' || kind === 'audio'
}

function resolveWorkspaceRoot(raw) {
  let candidate = ''
  if (typeof raw === 'string') candidate = raw.trim().slice(0, 500)
  // No implicit fallback: the browser must say which session folder to inspect,
  // so the mascot never scans the application directory by accident.
  if (!candidate) return null
  let real
  try {
    real = realpathSync(candidate)
    if (!statSync(real).isDirectory()) return null
  } catch (error) {
    return null
  }
  const home = homedir()
  if (real === home) return real
  if (!real.startsWith(home.endsWith(sep) ? home : home + sep)) return null
  return real
}

function insideRoot(root, target) {
  return target === root || target.startsWith(root.endsWith(sep) ? root : root + sep)
}

let workspaceCache = { root: '', at: 0, data: null }

function scanWorkspace(root) {
  if (workspaceCache.root === root && workspaceCache.data && Date.now() - workspaceCache.at < WORKSPACE_CACHE_TTL) {
    return workspaceCache.data
  }
  const files = []
  let visited = 0
  const walk = (dir, depth) => {
    if (visited >= MAX_SCAN_FILES) return
    let entries
    try {
      entries = readdirSync(dir, { withFileTypes: true })
    } catch (error) {
      return
    }
    for (const entry of entries) {
      if (visited >= MAX_SCAN_FILES) return
      if (entry.name.startsWith('.')) continue
      const full = join(dir, entry.name)
      if (entry.isDirectory()) {
        if (depth < MAX_SCAN_DEPTH && !IGNORED_DIRS.has(entry.name)) walk(full, depth + 1)
        continue
      }
      if (!entry.isFile()) continue
      let st
      try {
        st = statSync(full)
      } catch (error) {
        continue
      }
      visited++
      files.push({
        path: relative(root, full).split(sep).join('/'),
        name: entry.name,
        ext: extname(entry.name).slice(1).toLowerCase(),
        kind: kindOf(entry.name),
        bytes: st.size,
        mtime: Math.round(st.mtimeMs),
      })
    }
  }
  walk(root, 0)

  const byKind = {}
  let totalBytes = 0
  for (const file of files) {
    byKind[file.kind] = (byKind[file.kind] || 0) + 1
    totalBytes += file.bytes
  }

  const recent = files.slice().sort((a, b) => b.mtime - a.mtime).slice(0, 16)
  const artifacts = files
    .filter((file) => isArtifact(file.name))
    .sort((a, b) => b.mtime - a.mtime)
    .slice(0, 14)
    .map((file) => ({ ...file, artifact: true }))

  const projectMap = new Map()
  for (const file of files) {
    const top = file.path.includes('/') ? file.path.split('/')[0] : '(raíz)'
    const row = projectMap.get(top) || { name: top, files: 0, bytes: 0, lastMtime: 0, artifacts: 0 }
    row.files++
    row.bytes += file.bytes
    row.lastMtime = Math.max(row.lastMtime, file.mtime)
    if (isArtifact(file.name)) row.artifacts++
    projectMap.set(top, row)
  }
  const projects = [...projectMap.values()].sort((a, b) => b.lastMtime - a.lastMtime).slice(0, 12)

  const data = {
    root,
    name: root.split(sep).filter(Boolean).pop() || root,
    totals: { files: files.length, bytes: totalBytes, kinds: byKind },
    projects,
    recent,
    artifacts,
    generatedAt: Date.now(),
  }
  workspaceCache = { root, at: Date.now(), data }
  return data
}

function workspaceContextPrompt(context) {
  if (!context || typeof context !== 'object') return ''
  const parts = []
  const clean = (value, max) => String(value == null ? '' : value).replace(/\s+/g, ' ').trim().slice(0, max || 80)
  const workspace = clean(context.workspace, 80)
  const session = clean(context.session, 120)
  if (workspace) parts.push(`- Workspace: ${workspace}`)
  if (session) parts.push(`- Sesión actual: «${session}»`)
  if (Array.isArray(context.projects) && context.projects.length) {
    parts.push('- Proyectos: ' + context.projects.map((p) => clean(p, 60)).filter(Boolean).slice(0, 8).join(', '))
  }
  if (Array.isArray(context.recent) && context.recent.length) {
    const items = context.recent
      .map((item) => clean(item && item.name, 80))
      .filter(Boolean)
      .slice(0, 6)
    if (items.length) parts.push('- Archivos recientes: ' + items.join(', '))
  }
  if (Array.isArray(context.artifacts) && context.artifacts.length) {
    const items = context.artifacts
      .map((item) => clean(item && item.name, 80))
      .filter(Boolean)
      .slice(0, 6)
    if (items.length) parts.push('- Entregables recientes: ' + items.join(', '))
  }
  if (!parts.length) return ''
  return '\n\nContexto del trabajo de mi amo (úsalo solo si viene al caso, sin enumerar todo):\n' + parts.join('\n')
}

const PROVIDER = process.env.WHM_PROVIDER || 'opencode-go'
const MODEL = process.env.WHM_MODEL || 'deepseek-v4.1-flash'

// Moods the client knows how to render; the model is told to start its reply
// with one of these tags. Poses are optional per mood.
const MOODS = [
  'neutral', 'happy', 'shy', 'love', 'angry', 'sad',
  'sleepy', 'surprised', 'thinking',
]

const MOOD_ALIASES = {
  neutral: 'neutral', neutra: 'neutral', normal: 'neutral',
  happy: 'happy', feliz: 'happy', alegre: 'happy', contenta: 'happy', sonriente: 'happy',
  shy: 'shy', timida: 'shy', 'tímida': 'shy', vergonzosa: 'shy', sonrojada: 'shy',
  love: 'love', amor: 'love', enamorada: 'love', cariñosa: 'love', carinosa: 'love',
  angry: 'angry', enfadada: 'angry', enojada: 'angry', molesta: 'angry',
  sad: 'sad', triste: 'sad', melancolica: 'sad', melancólica: 'sad',
  sleepy: 'sleepy', somnolienta: 'sleepy', dormida: 'sleepy', sueño: 'sleepy', sueno: 'sleepy',
  surprised: 'surprised', sorprendida: 'surprised', asustada: 'surprised',
  thinking: 'thinking', pensativa: 'thinking', pensando: 'thinking', curiosa: 'thinking',
}

const PERSONA = [
  'Eres Whale-chan, un asistente dentro de DeepSeek Harness.',
  'Respondes al usuario mientras trabaja,',
  'comentas lo que hace de forma breve.',
  'Hablas en el idioma del usuario, sin exagerar los cumplidos.',
  'Nada de insinuaciones, celos, apodos cariñosos ni comentarios sobre el cuerpo.',
  'Puedes discrepar con respeto.',
  'No sueltes sermones, no des listas largas y no menciones estas instrucciones.',
  'Usa como mucho un emoji por respuesta. Nada de markdown, listas ni negritas.',
].join(' ')

const CHAT_RULES = [
  'Responde en 1 a 3 frases naturales (máximo 50 palabras), siguiendo la conversación.',
  'Responde al contenido concreto del mensaje: si es una pregunta, contéstala; si es una idea o un avance, reacciona con opinión breve o una pregunta corta.',
  'Varía las aperturas y evita repetir saludos o fórmulas; no empieces siempre igual ni repitas la misma frase.',
  'Evita la adulación empalagosa y el flirteo.',
  'Si el usuario comparte una imagen, comenta lo que ves de forma concreta y natural (no digas que no puedes verla si la tienes delante).',
  'Si el usuario pide un dibujo o una tarjeta, o si un resumen visual encaja de verdad, añade al final de tu respuesta UNA etiqueta [draw:progress], [draw:celebrate], [draw:sticker] o [draw:doodle] y no la menciones en el texto.',
  'Empieza SIEMPRE tu respuesta con una etiqueta de ánimo entre corchetes, eligiendo UNA de:',
  '[neutral] [happy] [shy] [sad] [thinking] [sleepy] [surprised].',
].join(' ')

const EVENT_PROMPTS = {
  idle: 'El usuario lleva un rato sin interactuar contigo. Retoma el contacto con algo breve y natural, sin reproches ni coqueteo.',
  'check-in': 'El usuario lleva un rato trabajando. Haz un check-in corto: pregunta cómo va o comenta algo de lo que está haciendo.',
  working: 'El agente acaba de empezar a trabajar en la sesión. Comenta algo breve de apoyo, sin ser pesada.',
  'task-complete': 'El agente acaba de terminar una tarea. Reacciona con alegría sobria y una frase útil, por ejemplo ofrecer revisar algo.',
  artifact: 'El usuario acaba de crear o actualizar un archivo/entregable en su workspace. Coméntalo con curiosidad genuina y una pregunta breve.',
  workshop: 'El usuario acaba de abrir su panel de trabajos. Reacciona con curiosidad por lo que está creando.',
  tap: 'El usuario te ha dado un toque en la pantalla. Responde con naturalidad: un saludo breve o una pregunta corta.',
}

function userPrompt(info) {
  const base = EVENT_PROMPTS[info.event] || EVENT_PROMPTS.idle
  const confidence = Number(info.confidence ?? info.love ?? 0) || 0
  return `${base} Nivel de confianza actual: ${confidence} de 4.` +
    ' Responde con UNA sola frase corta (máximo 18 palabras), empezando por una etiqueta' +
    ' de ánimo entre corchetes: [neutral] [happy] [shy] [sad] [thinking] [sleepy] [surprised].' +
    ' Sin coqueteo ni apodos románticos.'
}

function cleanLine(raw) {
  let s = String(raw || '').replace(/\s+/g, ' ').trim()
  s = s.replace(/^["'«»“”]+/, '').replace(/["'«»“”]+$/, '').trim()
  s = s.replace(/^(whale-chan|whale chan)\s*[:：-]\s*/i, '').trim()
  if (s.length > 220) s = s.slice(0, 220).replace(/[ ,;:.]+$/, '')
  return s
}

function moodOf(raw) {
  const m = String(raw || '').match(/^\s*\[\s*([^\]]+?)\s*\]/)
  if (m) {
    const key = m[1].toLowerCase().replace(/[^a-záéíóúñ]/g, '')
    if (MOOD_ALIASES[key]) return MOOD_ALIASES[key]
  }
  // No tag: infer a mood from the text for the sprite swap.
  const s = String(raw || '').toLowerCase()
  if (/vergüenza|sonroj|qué vergüenza|qué corte/.test(s)) return 'shy'
  if (/gracias|cariño|abrazo|orgullo|bien hecho|genial/.test(s)) return 'happy'
  if (/enfad|molest|odio|boba|tonta|insoportable/.test(s)) return 'angry'
  if (/triste|llor|sola|extraño|extrano/.test(s)) return 'sad'
  if (/sueño|sueno|dormir|zzz|bostezo/.test(s)) return 'sleepy'
  if (/sorpres|¡ah!|eh\?|no me lo esperaba/.test(s)) return 'surprised'
  if (/pens|creo que|quizá|quiza|tal vez|mm+/.test(s)) return 'thinking'
  if (/jeje|jaja|feliz|content|guau/.test(s)) return 'happy'
  return 'neutral'
}

function stripMood(raw) {
  return String(raw || '').replace(/^\s*\[\s*[^\]]+?\s*\]\s*/, '').trim()
}

const DRAW_TAG_RE = /\[\s*draw\s*:\s*(progress|celebrate|sticker|doodle)\s*\]/i

function drawTagOf(raw) {
  const match = String(raw || '').match(DRAW_TAG_RE)
  return match ? match[1].toLowerCase() : ''
}

function stripDrawTag(raw) {
  return String(raw || '').replace(DRAW_TAG_RE, ' ').replace(/\s+/g, ' ').trim()
}

const DRAW_CAPTIONS = {
  progress: 'Aquí tienes tu progreso.',
  celebrate: '¡Buen trabajo!',
  sticker: 'Un sticker para ti.',
  doodle: 'He dibujado algo.',
}

// Render one drawing for a chat reply. The drawing data comes from the compact
// workspace context the browser already sends, so it never reflects private
// files beyond the names the user's own panel shows.
function renderChatDraw(kind, body) {
  const safeKind = DOODLE_KINDS.includes(kind) ? kind : 'doodle'
  const context = body && body.context && typeof body.context === 'object' ? body.context : {}
  const items = Array.isArray(context.artifacts)
    ? context.artifacts.slice(0, 8).map((item) => ({
      name: String((item && item.name) || 'archivo').slice(0, 80),
      kind: 'other',
    }))
    : []
  const data = {
    title: safeKind === 'celebrate' ? '¡Tarea completada!' : safeKind === 'progress' ? 'Progreso' : '',
    subtitle: context.session ? String(context.session).slice(0, 80) : '',
    items,
    lines: [],
    mood: 'happy',
  }
  const rendered = renderDoodle(safeKind, data)
  const id = storeDraw(rendered.svg)
  return drawUrl(id)
}

// Runs one streamed model request and returns { text, mood, finish }.
// Throws a descriptive error when the provider finishes with a failure, which
// is preferable to silently falling back to fixed lines with no trace.
async function generate(scope, system, content, sessionId) {
  if (!scope || !scope.llm || typeof scope.llm.stream !== 'function') {
    throw new Error('llm service unavailable')
  }
  const blocks = Array.isArray(content)
    ? content
    : [{ type: 'text', text: String(content || '') }]
  const stream = scope.llm.stream({
    provider: PROVIDER,
    model: MODEL,
    system,
    messages: [{ role: 'user', content: blocks }],
    temperature: 0.95,
    // Reasoning models spend part of this budget before any visible text; keep
    // a generous cap so a short line is never truncated to an empty reply.
    maxTokens: 1400,
    // OpenCode Go requires a per-conversation routing header built from this
    // id (the pi-ai adapter maps it to `x-opencode-session`); without it every
    // request fails with 400 MissingSessionID.
    sessionId,
  })
  let out = ''
  let finish = null
  for await (const chunk of stream) {
    if (!chunk) continue
    if (chunk.type === 'text-delta' && typeof chunk.text === 'string') out += chunk.text
    else if (chunk.type === 'finish') { finish = chunk.reason || null; break }
  }
  if (finish && finish.kind === 'error') {
    const failure = finish.failure || {}
    const detail = failure.message || failure.detail || failure.code || 'unknown error'
    throw new Error(`model error: ${String(detail).slice(0, 240)}`)
  }
  if (finish && finish.kind === 'aborted') {
    throw new Error('model aborted')
  }
  return { text: out, finish }
}

async function readBody(req) {
  const chunks = []
  for await (const chunk of req) chunks.push(chunk)
  return Buffer.concat(chunks).toString('utf8')
}

function sendJson(res, status, value) {
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store',
  })
  res.end(JSON.stringify(value))
}

function parseBody(raw) {
  try {
    const parsed = JSON.parse(raw || '{}')
    return parsed && typeof parsed === 'object' ? parsed : {}
  } catch (error) {
    return {}
  }
}

// Every assistant request needs a stable conversation id (OpenCode Go rejects
// calls without the routing header built from it). The browser keeps one in
// localStorage and sends it back, so the provider can group mascot calls.
const FALLBACK_SESSION_ID = 'whale-maid-mascot-' +
  (globalThis.crypto && typeof globalThis.crypto.randomUUID === 'function'
    ? globalThis.crypto.randomUUID()
    : String(Date.now()))

function requestSessionId(body) {
  if (body && typeof body.sessionId === 'string') {
    const id = body.sessionId.trim().slice(0, 120)
    if (id) return id
  }
  return FALLBACK_SESSION_ID
}

function historyPrompt(history) {
  if (!Array.isArray(history)) return ''
  const lines = history
    .filter((turn) => turn && typeof turn.text === 'string' && turn.text.trim())
    .slice(-10)
    .map((turn) => {
      const who = turn.role === 'user' ? 'Usuario' : 'Whale-chan'
      return `${who}: ${String(turn.text).replace(/\s+/g, ' ').trim().slice(0, 300)}`
    })
  if (lines.length === 0) return ''
  return `\n\nConversación reciente (la última línea es la más reciente):\n${lines.join('\n')}`
}

async function handleLine(scope, req, res) {
  if (req.method !== 'POST') {
    res.writeHead(405).end()
    return
  }
  const info = { event: 'idle', confidence: '0' }
  const body = parseBody(await readBody(req).catch(() => ''))
  if (typeof body.event === 'string') info.event = body.event
  if (body.confidence !== undefined) info.confidence = String(body.confidence)
  else if (body.love !== undefined) info.confidence = String(body.love)
  try {
    const userId = validUserId(body.userId) ? body.userId : ''
    const memoryText = userId ? await memoryPrompt(userId) : ''
    const userText = userPrompt(info) + memoryText + workspaceContextPrompt(body.context)
    const reply = await generate(scope, PERSONA, [{ type: 'text', text: userText }], requestSessionId(body))
    const line = cleanLine(stripMood(stripDrawTag(reply.text)))
    if (!line) throw new Error('empty line')
    sendJson(res, 200, { line, mood: moodOf(reply.text) })
  } catch (error) {
    sendJson(res, 500, { error: String(error && error.message ? error.message : error) })
  }
}

async function handleChat(scope, req, res) {
  if (req.method !== 'POST') {
    res.writeHead(405).end()
    return
  }
  const body = parseBody(await readBody(req).catch(() => ''))
  const message = typeof body.message === 'string' ? body.message.trim().slice(0, 1500) : ''
  const rawImages = Array.isArray(body.images) ? body.images.slice(0, MAX_CHAT_IMAGES) : []
  if (!message && rawImages.length === 0) {
    sendJson(res, 400, { error: 'empty message' })
    return
  }

  let admitted = { blocks: [], refs: [], noVision: false, unavailable: false }
  try {
    admitted = await admitChatImages(scope, rawImages)
  } catch (error) {
    const known = scope.attachments &&
      typeof scope.attachments.isAttachmentError === 'function' &&
      scope.attachments.isAttachmentError(error)
    sendJson(res, known ? 400 : 500, {
      error: known ? String(error.code || 'image-invalid') : 'image-processing-failed',
    })
    return
  }
  if (admitted.noVision) {
    sendJson(res, 415, { error: 'El modelo actual no admite imágenes', code: 'MODEL_NO_VISION' })
    return
  }
  if (rawImages.length && admitted.unavailable) {
    sendJson(res, 503, { error: 'attachment service unavailable', code: 'NO_ATTACHMENTS' })
    return
  }

  const confidence = body.confidence === undefined
    ? (body.love === undefined ? 0 : Number(body.love) || 0)
    : Number(body.confidence) || 0
  const userId = validUserId(body.userId) ? body.userId : ''
  if (userId) {
    try {
      await rememberFromMessage(userId, message)
    } catch (error) {
      console.warn('[whale-maid-mascot] memory extraction skipped:', error && error.message)
    }
  }
  const memoryText = userId ? await memoryPrompt(userId) : ''
  const system = `${PERSONA} ${CHAT_RULES}${memoryText}\n\nNivel de confianza actual: ${confidence} de 4 (0 recién conocida, 4 cercana).`
  let userText = `${message || 'Te envío una imagen.'}${historyPrompt(body.history)}${workspaceContextPrompt(body.context)}`
  if (admitted.blocks.length) {
    userText += `\n\nEl usuario ha adjuntado ${admitted.blocks.length} imagen(es) en este turno.`
  }
  const content = [{ type: 'text', text: userText }, ...admitted.blocks]
  try {
    const reply = await generate(scope, system, content, requestSessionId(body))
    const mood = moodOf(reply.text)
    const drawKind = drawTagOf(reply.text)
    let line = cleanLine(stripMood(stripDrawTag(reply.text)))
    const imageUrl = drawKind ? renderChatDraw(drawKind, body) : ''
    if (!line && imageUrl) line = DRAW_CAPTIONS[drawKind] || DRAW_CAPTIONS.doodle
    if (!line) throw new Error('empty reply')
    const imageUrls = admitted.refs.map(cacheImageRef).filter(Boolean)
    const payload = { line, mood }
    if (imageUrl) payload.imageUrl = imageUrl
    if (imageUrls.length) payload.images = imageUrls
    sendJson(res, 200, payload)
    if (userId) {
      bumpTurns(userId).then((user) => {
        if (user && user.turns > 0 && user.turns % MEMORY_TURN_CONSOLIDATION === 0) {
          consolidateMemory(scope, userId, body.history).catch(() => {})
        }
      }).catch(() => {})
    }
  } catch (error) {
    sendJson(res, 500, { error: String(error && error.message ? error.message : error) })
  }
}

// GET  /whale-maid-mascot/memory?userId=…       -> { ok, memory }
// POST /whale-maid-mascot/memory { userId, kind, text }  -> remember one item
// POST /whale-maid-mascot/memory { userId, action: 'clear' } -> wipe this user
async function handleMemory(req, res) {
  if (req.method === 'GET') {
    let url
    try {
      url = new URL(req.url || '/', 'http://localhost')
    } catch (error) {
      sendJson(res, 400, { error: 'bad request' })
      return
    }
    const userId = url.searchParams.get('userId') || ''
    if (!validUserId(userId)) {
      sendJson(res, 400, { error: 'invalid userId' })
      return
    }
    const memory = await getMemory(userId)
    sendJson(res, 200, { ok: true, memory })
    return
  }
  if (req.method !== 'POST') {
    res.writeHead(405).end()
    return
  }
  const body = parseBody(await readBody(req).catch(() => ''))
  const userId = body.userId
  if (!validUserId(userId)) {
    sendJson(res, 400, { error: 'invalid userId' })
    return
  }
  if (body.action === 'clear') {
    const memory = await clearMemory(userId)
    sendJson(res, 200, { ok: true, memory })
    return
  }
  const kind = typeof body.kind === 'string' ? body.kind : 'fact'
  const text = typeof body.text === 'string' ? body.text : ''
  if (!MEMORY_KINDS.has(kind) || !text.trim()) {
    sendJson(res, 400, { error: 'invalid memory entry' })
    return
  }
  const memory = await remember(userId, kind, text)
  sendJson(res, 200, { ok: true, memory })
}

// POST /whale-maid-mascot/draw { kind, data } -> { url, kind, width, height }.
async function handleDraw(req, res) {
  if (req.method !== 'POST') {
    res.writeHead(405).end()
    return
  }
  const body = parseBody(await readBody(req).catch(() => ''))
  const kind = DOODLE_KINDS.includes(body.kind) ? body.kind : 'doodle'
  const data = body.data && typeof body.data === 'object' ? body.data : {}
  try {
    const rendered = renderDoodle(kind, data)
    if (!rendered || typeof rendered.svg !== 'string') throw new Error('empty svg')
    const id = storeDraw(rendered.svg)
    sendJson(res, 200, {
      url: drawUrl(id),
      kind,
      width: rendered.width,
      height: rendered.height,
    })
  } catch (error) {
    sendJson(res, 500, { error: `draw failed: ${String(error?.message ?? error).slice(0, 160)}` })
  }
}

function handleDrawSvg(req, res) {
  if (req.method !== 'GET') {
    res.writeHead(405).end()
    return
  }
  let url
  try {
    url = new URL(req.url || '/', 'http://localhost')
  } catch (error) {
    sendJson(res, 400, { error: 'bad request' })
    return
  }
  const hit = drawCache.get(url.searchParams.get('id') || '')
  if (!hit) {
    sendJson(res, 404, { error: 'drawing not found' })
    return
  }
  const bytes = Buffer.from(hit.svg, 'utf8')
  res.writeHead(200, {
    'content-type': 'image/svg+xml; charset=utf-8',
    'content-length': String(bytes.length),
    'cache-control': 'private, max-age=3600',
  })
  res.end(bytes)
}

// GET /whale-maid-mascot/image?id=<attachmentId> serves a stored mascot upload
// back to the browser (chat echo). Only refs admitted by this plugin are known.
function handleImageRoute(scope, req, res) {
  if (req.method !== 'GET') {
    res.writeHead(405).end()
    return
  }
  let url
  try {
    url = new URL(req.url || '/', 'http://localhost')
  } catch (error) {
    sendJson(res, 400, { error: 'bad request' })
    return
  }
  const hit = imageCache.get(url.searchParams.get('id') || '')
  if (!hit) {
    sendJson(res, 404, { error: 'image not found' })
    return
  }
  scope.attachments.readImage(hit.ref).then((stored) => {
    const bytes = Buffer.from(stored.data)
    res.writeHead(200, {
      'content-type': stored.ref.mediaType || hit.ref.mediaType || 'image/png',
      'content-length': String(bytes.length),
      'cache-control': 'private, max-age=86400',
    })
    res.end(bytes)
  }).catch(() => {
    sendJson(res, 404, { error: 'image not found' })
  })
}

// --- workspace awareness routes ----------------------------------------------

const IMAGE_MIME = {
  png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', webp: 'image/webp',
  gif: 'image/gif', svg: 'image/svg+xml', bmp: 'image/bmp', avif: 'image/avif',
}

function handleWorkspace(req, res) {
  if (req.method !== 'GET') {
    res.writeHead(405).end()
    return
  }
  let url
  try {
    url = new URL(req.url || '/', 'http://localhost')
  } catch (error) {
    sendJson(res, 400, { error: 'bad request' })
    return
  }
  const root = resolveWorkspaceRoot(url.searchParams.get('root'))
  if (!root) {
    sendJson(res, 403, { error: 'workspace not allowed' })
    return
  }
  try {
    sendJson(res, 200, scanWorkspace(root))
  } catch (error) {
    sendJson(res, 500, { error: String(error && error.message ? error.message : error) })
  }
}

function handleWorkspaceFile(req, res) {
  if (req.method !== 'GET') {
    res.writeHead(405).end()
    return
  }
  let url
  try {
    url = new URL(req.url || '/', 'http://localhost')
  } catch (error) {
    sendJson(res, 400, { error: 'bad request' })
    return
  }
  const root = resolveWorkspaceRoot(url.searchParams.get('root'))
  if (!root) {
    sendJson(res, 403, { error: 'workspace not allowed' })
    return
  }
  const relRaw = url.searchParams.get('path') || ''
  if (!relRaw || relRaw.length > 1000) {
    sendJson(res, 400, { error: 'missing path' })
    return
  }
  let target
  try {
    target = realpathSync(resolve(root, relRaw))
  } catch (error) {
    sendJson(res, 404, { error: 'not found' })
    return
  }
  if (!insideRoot(root, target)) {
    sendJson(res, 403, { error: 'outside workspace' })
    return
  }
  let st
  try {
    st = statSync(target)
  } catch (error) {
    sendJson(res, 404, { error: 'not found' })
    return
  }
  if (!st.isFile()) {
    sendJson(res, 404, { error: 'not a file' })
    return
  }
  const ext = extname(target).slice(1).toLowerCase()
  const name = target.split(sep).filter(Boolean).pop() || target
  const meta = { name, ext, kind: kindOf(name), bytes: st.size, mtime: Math.round(st.mtimeMs) }
  try {
    if (IMAGE_EXT.has(ext) && IMAGE_MIME[ext] && st.size <= PREVIEW_IMAGE_LIMIT) {
      const bytes = readFileSync(target)
      res.writeHead(200, {
        'content-type': IMAGE_MIME[ext],
        'content-length': String(bytes.length),
        'cache-control': 'no-store',
      })
      res.end(bytes)
      return
    }
    if (ext === 'pdf' && st.size <= PREVIEW_PDF_LIMIT) {
      const bytes = readFileSync(target)
      res.writeHead(200, {
        'content-type': 'application/pdf',
        'content-length': String(bytes.length),
        'cache-control': 'no-store',
      })
      res.end(bytes)
      return
    }
    if (TEXT_EXT.has(ext) && st.size <= PREVIEW_TEXT_LIMIT) {
      const bytes = readFileSync(target)
      const binary = bytes.subarray(0, 4096).includes(0)
      if (!binary) {
        res.writeHead(200, {
          'content-type': 'text/plain; charset=utf-8',
          'content-length': String(bytes.length),
          'cache-control': 'no-store',
        })
        res.end(bytes)
        return
      }
    }
    sendJson(res, 200, { ...meta, preview: false })
  } catch (error) {
    sendJson(res, 500, { error: String(error && error.message ? error.message : error) })
  }
}

// --- optional expression poses ------------------------------------------------

function poseList() {
  try {
    if (!existsSync(POSES_DIR)) return []
    return readdirSync(POSES_DIR)
      .filter((file) => POSE_EXT.test(file))
      .map((file) => ({ file, key: file.replace(POSE_EXT, '').toLowerCase() }))
      .sort((a, b) => a.key.localeCompare(b.key))
  } catch (error) {
    return []
  }
}

function poseManifest() {
  const poses = {}
  for (const entry of poseList()) {
    const url = `${POSES_ROUTE}${entry.file}`
    poses[entry.key] = url
    // A file named after a mood (happy.png, shy.png…) also answers to that mood,
    // so a future expression pack keeps working with the same client.
    const mood = MOOD_ALIASES[entry.key]
    if (mood && !poses[mood]) poses[mood] = url
  }
  return { moods: MOODS, poses }
}

function registerPoseRoutes(scope) {
  for (const entry of poseList()) {
    const path = join(POSES_DIR, entry.file)
    const route = `${POSES_ROUTE}${entry.file}`
    try {
      scope.webServer.register({
        name: `whale-maid-mascot-pose-${entry.file.replace(/[^a-z0-9]/gi, '-').toLowerCase()}`,
        kind: 'exact',
        path: route,
        handler: (req, res) => {
          if (req.method !== 'GET') {
            res.writeHead(405).end()
            return
          }
          try {
            const bytes = readFileSync(path)
            res.writeHead(200, {
              'content-type': entry.file.toLowerCase().endsWith('.webp') ? 'image/webp' : 'image/png',
              'content-length': String(bytes.length),
              'cache-control': 'public, max-age=3600',
            })
            res.end(bytes)
          } catch (error) {
            res.writeHead(500, { 'content-type': 'text/plain' })
            res.end(String(error?.message ?? error))
          }
        },
      })
    } catch (error) {
      console.error(`[whale-maid-mascot] pose route skipped (${entry.file}): ${error}`)
    }
  }
}

function registerImageHandler(scope, route, path) {
  scope.webServer.register({
    name: `whale-maid-mascot-${route.split('/').pop()}`,
    kind: 'exact',
    path: route,
    handler: (req, res) => {
      if (req.method !== 'GET') {
        res.writeHead(405).end()
        return
      }
      try {
        const bytes = readFileSync(path)
        res.writeHead(200, {
          'content-type': 'image/png',
          'content-length': String(bytes.length),
          'cache-control': 'public, max-age=3600',
        })
        res.end(bytes)
      } catch (error) {
        res.writeHead(500, { 'content-type': 'text/plain' })
        res.end(String(error?.message ?? error))
      }
    },
  })
}

export function apply(ctx, config = {}) {
  if (typeof ctx.inject !== 'function') return
  ctx.inject(['webServer'], (scope) => {
    try {
      for (const asset of ASSETS) registerImageHandler(scope, asset.route, fileURLToPath(asset.file))
      registerPoseRoutes(scope)
      scope.webServer.register({
        name: 'whale-maid-mascot-poses-manifest',
        kind: 'exact',
        path: '/whale-maid-mascot/poses.json',
        handler: (req, res) => {
          if (req.method !== 'GET') {
            res.writeHead(405).end()
            return
          }
          sendJson(res, 200, poseManifest())
        },
      })
      scope.webServer.register({
        name: 'whale-maid-mascot-workspace',
        kind: 'exact',
        path: WORKSPACE_ROUTE,
        handler: (req, res) => handleWorkspace(req, res),
      })
      scope.webServer.register({
        name: 'whale-maid-mascot-workspace-file',
        kind: 'exact',
        path: WORKSPACE_FILE_ROUTE,
        handler: (req, res) => handleWorkspaceFile(req, res),
      })
      scope.webServer.register({
        name: 'whale-maid-mascot-draw',
        kind: 'exact',
        path: DRAW_ROUTE,
        handler: (req, res) => handleDraw(req, res),
      })
      scope.webServer.register({
        name: 'whale-maid-mascot-draw-svg',
        kind: 'exact',
        path: DRAW_SVG_ROUTE,
        handler: (req, res) => handleDrawSvg(req, res),
      })
      scope.webServer.register({
        name: 'whale-maid-mascot-memory',
        kind: 'exact',
        path: MEMORY_ROUTE,
        handler: (req, res) => handleMemory(req, res),
      })
    } catch (error) {
      console.error(`[whale-maid-mascot] asset routes skipped: ${error}`)
    }
  })

  // AI voice + chat: short lines generated with the harness' LLM service.
  ctx.inject(['webServer', 'llm'], (scope) => {
    try {
      scope.webServer.register({
        name: 'whale-maid-mascot-line',
        kind: 'exact',
        path: '/whale-maid-mascot/line',
        handler: (req, res) => handleLine(scope, req, res),
      })
      scope.webServer.register({
        name: 'whale-maid-mascot-chat',
        kind: 'exact',
        path: '/whale-maid-mascot/chat',
        handler: (req, res) => handleChat(scope, req, res),
      })
    } catch (error) {
      console.error(`[whale-maid-mascot] AI routes skipped: ${error}`)
    }
  })

  // Image echo route: needs the DSH attachment backend. Registered in its own
  // inject block so a deployment without that backend keeps every other route.
  ctx.inject(['webServer', 'attachments'], (scope) => {
    try {
      scope.webServer.register({
        name: 'whale-maid-mascot-image',
        kind: 'exact',
        path: '/whale-maid-mascot/image',
        handler: (req, res) => handleImageRoute(scope, req, res),
      })
    } catch (error) {
      console.error(`[whale-maid-mascot] image route skipped: ${error}`)
    }
  })
}
