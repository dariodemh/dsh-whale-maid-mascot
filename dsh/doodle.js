// -----------------------------------------------------------------------------
// Whale-chan doodle engine
// -----------------------------------------------------------------------------
// Self-contained, deterministic SVG renderer for the DSH whale-maid mascot.
// No dependencies, no filesystem, no network, no clocks: the same input always
// produces a byte-identical SVG. Sprites are referenced through the plugin's
// own relative routes, never through remote URLs.
//
// API:
//   DOODLE_KINDS                       -> ['progress', 'celebrate', 'sticker', 'doodle']
//   renderDoodle(kind, data)           -> { svg, width, height }
//   escapeXml(text)                    -> XML-safe string
//
// Data contract:
//   {
//     title?: string,        // headline / caption (defaults depend on kind)
//     subtitle?: string,     // secondary line for progress cards
//     date?: string|number,  // already formatted by the caller; rendered as-is
//     footer?: string,       // small footer line for progress/celebrate
//     items?: Array<{ name: string, kind?: string, bytes?: number }>,
//     lines?: string[],      // 1-3 supporting lines for celebrate
//     mood?: 'neutral'|'happy'|'shy'|'sad'|'thinking'|'sleepy',
//     style?: 'a'|'d'|'e'|'f' // decorative variant only, not a sprite override
//   }
//
// Text is normalized, capped and XML-escaped. title <= 80 chars, each line
// <= 120 chars, each item name <= 60 chars, at most 10 items and 3 lines.
// User-facing strings are Spanish.
// -----------------------------------------------------------------------------

/**
 * @typedef {Object} DoodleItem
 * @property {string} [name]   Deliverable name (capped at 60 characters).
 * @property {string} [kind]   Optional file kind, e.g. "pdf", "image", "code".
 * @property {number} [bytes]  Optional size in bytes.
 */

/**
 * @typedef {Object} DoodleData
 * @property {string} [title]
 * @property {string} [subtitle]
 * @property {string|number} [date]
 * @property {string} [footer]
 * @property {DoodleItem[]} [items]
 * @property {string[]} [lines]
 * @property {'neutral'|'happy'|'shy'|'sad'|'thinking'|'sleepy'} [mood]
 * @property {'a'|'d'|'e'|'f'} [style]
 */

export const DOODLE_KINDS = ['progress', 'celebrate', 'sticker', 'doodle']

const SIZES = Object.freeze({
  progress: [720, 480],
  celebrate: [720, 480],
  sticker: [480, 480],
  doodle: [480, 480],
})

const SPRITES = Object.freeze({
  base: '/whale-maid-mascot/a.png',
  hoodie: '/whale-maid-mascot/poses/hoodie_front.png',
})

const FONT = "ui-sans-serif, system-ui, -apple-system, 'Segoe UI', Roboto, Arial, sans-serif"

const MOODS = Object.freeze({
  neutral: { dark: '#7dd3fc', light: '#0369a1', mid: '#38bdf8' },
  happy: { dark: '#fcd34d', light: '#b45309', mid: '#f59e0b' },
  shy: { dark: '#f9a8d4', light: '#be185d', mid: '#ec4899' },
  sad: { dark: '#93c5fd', light: '#1d4ed8', mid: '#3b82f6' },
  thinking: { dark: '#c4b5fd', light: '#6d28d9', mid: '#8b5cf6' },
  sleepy: { dark: '#a5b4fc', light: '#4338ca', mid: '#6366f1' },
})

const MOOD_KEYS = Object.freeze(Object.keys(MOODS))
const STYLE_KEYS = Object.freeze(['a', 'd', 'e', 'f'])

const DEFAULT_CELEBRATE_LINES = Object.freeze([
  'Todo quedó en su sitio.',
  'Puedes revisarlo cuando quieras.',
])

// Character cap per field. These are hard maximums, independent of layout.
const CAPS = Object.freeze({
  title: 80,
  subtitle: 120,
  date: 40,
  footer: 120,
  line: 120,
  name: 60,
  items: 10,
  lines: 3,
})

// Small badge glyph + colour per deliverable kind.
const KIND_BADGES = Object.freeze({
  pdf: ['PDF', '#fb7185'],
  doc: ['DOC', '#60a5fa'],
  docx: ['DOC', '#60a5fa'],
  txt: ['TXT', '#94a3b8'],
  md: ['MD', '#a78bfa'],
  rtf: ['DOC', '#60a5fa'],
  code: ['CODE', '#34d399'],
  js: ['JS', '#facc15'],
  ts: ['TS', '#38bdf8'],
  py: ['PY', '#fbbf24'],
  json: ['JSON', '#fbbf24'],
  html: ['HTML', '#fb923c'],
  css: ['CSS', '#38bdf8'],
  image: ['IMG', '#f472b6'],
  png: ['IMG', '#f472b6'],
  jpg: ['IMG', '#f472b6'],
  jpeg: ['IMG', '#f472b6'],
  gif: ['IMG', '#f472b6'],
  svg: ['SVG', '#f472b6'],
  webp: ['IMG', '#f472b6'],
  video: ['VID', '#f97316'],
  mp4: ['VID', '#f97316'],
  mov: ['VID', '#f97316'],
  webm: ['VID', '#f97316'],
  audio: ['AUD', '#c084fc'],
  mp3: ['AUD', '#c084fc'],
  wav: ['AUD', '#c084fc'],
  ogg: ['AUD', '#c084fc'],
  data: ['DAT', '#2dd4bf'],
  csv: ['CSV', '#2dd4bf'],
  xls: ['XLS', '#22c55e'],
  xlsx: ['XLS', '#22c55e'],
  archive: ['ZIP', '#f59e0b'],
  zip: ['ZIP', '#f59e0b'],
  rar: ['ZIP', '#f59e0b'],
  sevenz: ['ZIP', '#f59e0b'],
  slide: ['PPT', '#fb923c'],
  ppt: ['PPT', '#fb923c'],
  pptx: ['PPT', '#fb923c'],
  design: ['FIG', '#e879f9'],
  fig: ['FIG', '#e879f9'],
  folder: ['DIR', '#fbbf24'],
  dir: ['DIR', '#fbbf24'],
  other: ['DOC', '#94a3b8'],
})

const KIND_ALIASES = Object.freeze({
  document: 'doc',
  text: 'txt',
  source: 'code',
  photo: 'image',
  movie: 'video',
  music: 'audio',
  spreadsheet: 'xls',
  sheet: 'xls',
  presentation: 'ppt',
  compressed: 'archive',
  directory: 'folder',
  default: 'other',
})

// -----------------------------------------------------------------------------
// Generic helpers
// -----------------------------------------------------------------------------

/**
 * Escape a value for use in SVG text nodes and attribute values.
 * Escapes the five XML-sensitive characters; order matters for `&`.
 * @param {unknown} text
 * @returns {string}
 */
export function escapeXml(text) {
  if (text === null || text === undefined) return ''
  return String(text)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;')
}

/** Normalize whitespace and strip control characters from a display string. */
function cleanText(value) {
  return value
    .replace(/[\u0000-\u001F\u007F-\u009F]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

/** Coerce safe display values only; objects/booleans become an empty string. */
function toText(value) {
  if (typeof value === 'string') return cleanText(value)
  if (typeof value === 'number' && Number.isFinite(value)) return String(value)
  if (typeof value === 'bigint') return String(value)
  return ''
}

/** Hard-truncate to `max` Unicode code points, appending an ellipsis. */
function capText(value, max) {
  const text = toText(value)
  if (!text || max <= 0) return ''
  const chars = Array.from(text)
  if (chars.length <= max) return text
  return chars.slice(0, Math.max(0, max - 1)).join('') + '…'
}

/**
 * Character cap plus a conservative width fit. SVG has no automatic wrapping
 * for a single text node, so this keeps headings and captions inside the card.
 */
function fitText(value, maxChars, maxWidth, fontSize) {
  const capped = capText(value, maxChars)
  if (!capped) return ''
  const perChar = Math.max(2.5, fontSize * 0.56)
  const byWidth = Math.max(4, Math.floor(maxWidth / perChar))
  return byWidth < maxChars ? capText(capped, byWidth) : capped
}

/** Deterministic word wrapping; hard-splits words longer than `maxChars`. */
function wrapText(value, maxChars) {
  const text = toText(value)
  if (!text) return []
  const width = Math.max(4, Math.floor(maxChars))
  const lines = []
  let line = ''

  for (const word of text.split(' ')) {
    let rest = word
    while (rest.length > width) {
      if (line) {
        lines.push(line)
        line = ''
      }
      lines.push(rest.slice(0, width))
      rest = rest.slice(width)
    }
    if (!rest) continue
    if (!line) line = rest
    else if (line.length + 1 + rest.length <= width) line += ' ' + rest
    else {
      lines.push(line)
      line = rest
    }
  }
  if (line) lines.push(line)
  return lines
}

/** Compact deterministic number formatting for SVG coordinate attributes. */
function num(value) {
  const n = Number(value)
  return Number.isFinite(n) ? String(Math.round(n * 100) / 100) : '0'
}

/** FNV-1a 32-bit hash, used to seed deterministic "random" decoration. */
function hashString(value) {
  let hash = 2166136261
  for (let i = 0; i < value.length; i += 1) {
    hash ^= value.charCodeAt(i)
    hash = Math.imul(hash, 16777619)
  }
  return hash >>> 0
}

/** Small seeded PRNG (mulberry32); never uses Math.random. */
function mulberry32(seed) {
  let state = seed >>> 0
  return function random() {
    state = (state + 0x6d2b79f5) | 0
    let t = Math.imul(state ^ (state >>> 15), 1 | state)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

function normalizeMood(value) {
  return typeof value === 'string' && MOOD_KEYS.includes(value) ? value : 'neutral'
}

function normalizeStyle(value) {
  return typeof value === 'string' && STYLE_KEYS.includes(value) ? value : 'a'
}

function normalizeBytes(value) {
  const n =
    typeof value === 'number'
      ? value
      : typeof value === 'string' && value.trim() !== ''
        ? Number(value)
        : Number.NaN
  return Number.isFinite(n) && n >= 0 ? n : null
}

function extensionOf(name) {
  const text = toText(name).toLowerCase()
  const dot = text.lastIndexOf('.')
  if (dot < 0) return ''
  return text
    .slice(dot + 1)
    .replace(/[^a-z0-9]/g, '')
    .slice(0, 8)
}

function badgeFor(kind, name) {
  const raw = toText(kind).toLowerCase()
  const tail = raw.split(/[/.]/).pop() || raw
  const key = KIND_ALIASES[raw] || KIND_ALIASES[tail] || tail
  let badge = KIND_BADGES[key]
  if (!badge) {
    const ext = extensionOf(name)
    badge = KIND_BADGES[KIND_ALIASES[ext] || ext]
  }
  return badge || KIND_BADGES.other
}

/** Human-readable Spanish byte size. Invalid/missing sizes become an em dash. */
function formatBytes(value) {
  const n = normalizeBytes(value)
  if (n === null) return '—'
  if (n < 1024) return `${Math.round(n)} B`
  const units = ['KB', 'MB', 'GB', 'TB', 'PB', 'EB']
  let scaled = n
  let unit = -1
  while (scaled >= 1024 && unit < units.length - 1) {
    scaled /= 1024
    unit += 1
  }
  let text = scaled.toFixed(scaled >= 100 ? 0 : 1).replace('.', ',')
  text = text.replace(/,0$/, '')
  return `${text} ${units[unit]}`
}

/**
 * Validate and normalize the caller's data once per render. Invalid fields are
 * ignored rather than leaking "undefined"/NaN into the SVG.
 */
function normalizeData(data) {
  const source = data && typeof data === 'object' ? data : {}

  const items = []
  if (Array.isArray(source.items)) {
    for (const raw of source.items) {
      if (items.length >= CAPS.items) break
      if (raw === null || raw === undefined) continue
      if (typeof raw !== 'object' && typeof raw !== 'string') continue
      const record = typeof raw === 'object' ? raw : { name: raw }
      const name = capText(record.name, CAPS.name) || 'Sin nombre'
      const rawKind = capText(record.kind, 24).toLowerCase()
      items.push({
        name,
        kind: rawKind || extensionOf(name),
        bytes: normalizeBytes(record.bytes),
      })
    }
  }

  const lines = (Array.isArray(source.lines) ? source.lines : [])
    .map((line) => capText(line, CAPS.line))
    .filter(Boolean)
    .slice(0, CAPS.lines)

  return {
    title: capText(source.title, CAPS.title),
    subtitle: capText(source.subtitle, CAPS.subtitle),
    date: capText(source.date, CAPS.date),
    footer: capText(source.footer, CAPS.footer),
    items,
    lines,
    mood: normalizeMood(source.mood),
    style: normalizeStyle(source.style),
  }
}

function svgDocument(width, height, label, content) {
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" ` +
    `viewBox="0 0 ${width} ${height}" role="img" aria-label="${escapeXml(label)}">` +
    content +
    '</svg>'
  )
}

function styleIndex(style) {
  const index = STYLE_KEYS.indexOf(style)
  return index < 0 ? 0 : index
}

function textElement(className, x, y, value, options = {}) {
  const classes = className ? ` class="${className}"` : ''
  return (
    `<text${classes} x="${num(x)}" y="${num(y)}"` +
    (options.anchor ? ` text-anchor="${options.anchor}"` : '') +
    ` font-family="${FONT}" font-size="${num(options.size || 14)}"` +
    (options.weight ? ` font-weight="${options.weight}"` : '') +
    (options.spacing ? ` letter-spacing="${options.spacing}"` : '') +
    ` fill="${options.fill || '#e2e8f0'}"` +
    (options.opacity !== undefined ? ` opacity="${num(options.opacity)}"` : '') +
    `>${escapeXml(value)}</text>`
  )
}

function star(cx, cy, radius, fill, opacity, rotation) {
  // Unit eight-point star, scaled/rotated at render time.
  const d =
    'M 0 -1 L 0.28 -0.28 L 1 0 L 0.28 0.28 L 0 1 ' +
    'L -0.28 0.28 L -1 0 L -0.28 -0.28 Z'
  return (
    `<path d="${d}" fill="${fill}" opacity="${num(opacity)}" ` +
    `transform="translate(${num(cx)} ${num(cy)}) rotate(${num(rotation)}) scale(${num(radius)})"/>`
  )
}

function diamond(x, y, radius, fill, opacity) {
  return (
    `<path d="M ${num(x)} ${num(y - radius)} L ${num(x + radius * 0.62)} ${num(y)} ` +
    `L ${num(x)} ${num(y + radius)} L ${num(x - radius * 0.62)} ${num(y)} Z" ` +
    `fill="${fill}" opacity="${num(opacity)}"/>`
  )
}

/** Seeded confetti/star field used by the celebrate card. */
function confettiField(seedText, colors, style, width, height, count) {
  const random = mulberry32(hashString(seedText))
  const offset = styleIndex(style)
  const pieces = []

  for (let i = 0; i < count; i += 1) {
    const x = random() * width
    const y = random() * height * 0.92
    const size = 4 + random() * 7
    const rotation = random() * 360
    const color = colors[Math.floor(random() * colors.length)] || colors[0]
    const opacity = 0.28 + random() * 0.38
    const shape = (i + offset) % 4

    if (shape === 0) {
      pieces.push(
        `<rect x="${num(x)}" y="${num(y)}" width="${num(size)}" height="${num(size * 0.5)}" ` +
          `rx="1.5" fill="${color}" opacity="${num(opacity)}" ` +
          `transform="rotate(${num(rotation)} ${num(x)} ${num(y)})"/>`,
      )
    } else if (shape === 1) {
      pieces.push(
        `<circle cx="${num(x)}" cy="${num(y)}" r="${num(size * 0.34)}" ` +
          `fill="${color}" opacity="${num(opacity)}"/>`,
      )
    } else if (shape === 2) {
      pieces.push(diamond(x, y, size * 0.7, color, opacity))
    } else {
      pieces.push(star(x, y, size * 0.65, color, opacity, rotation))
    }
  }

  return `<g class="doodle-confetti" aria-hidden="true">${pieces.join('')}</g>`
}

/** Seeded bubbles for the doodle scene. */
function bubbleField(seedText, color, style, count) {
  const random = mulberry32(hashString(seedText))
  const shift = styleIndex(style) * 13
  const bubbles = []

  for (let i = 0; i < count; i += 1) {
    const x = 32 + ((random() * 416 + shift) % 416)
    const y = 92 + random() * 232
    const radius = 3 + random() * 9
    const opacity = 0.24 + random() * 0.3
    bubbles.push(
      `<circle cx="${num(x)}" cy="${num(y)}" r="${num(radius)}" ` +
        `fill="#ffffff" fill-opacity="${num(opacity + 0.2)}" ` +
        `stroke="${color}" stroke-opacity="${num(opacity)}" stroke-width="1.2"/>`,
    )
    if (i % 3 === 0) {
      bubbles.push(
        `<circle cx="${num(x - radius * 0.3)}" cy="${num(y - radius * 0.35)}" ` +
          `r="${num(Math.max(1, radius * 0.22))}" fill="#ffffff" opacity="0.7"/>`,
      )
    }
  }

  return `<g class="doodle-bubbles" aria-hidden="true">${bubbles.join('')}</g>`
}

/** Four corner ornaments for the sticker border. */
function stickerSparkles(color, style) {
  const offset = styleIndex(style)
  const spots = [
    [72, 90, 7],
    [408, 124, 5],
    [84, 360, 5],
    [400, 350, 7],
  ]
  return spots
    .map(([x, y, radius], index) => {
      const shape = (index + offset) % 3
      if (shape === 0) {
        return `<circle cx="${x}" cy="${y}" r="${radius}" fill="${color}" opacity="0.3"/>`
      }
      if (shape === 1) {
        return star(x, y, radius, color, 0.36, 18 + index * 24)
      }
      return diamond(x, y, radius, color, 0.34)
    })
    .join('')
}

// -----------------------------------------------------------------------------
// Kind renderers
// -----------------------------------------------------------------------------

function renderProgress(data) {
  const [width, height] = SIZES.progress
  const accent = MOODS[data.mood]
  const contextTitle =
    data.title && data.title.toLowerCase() !== 'progreso' ? data.title : ''
  const subtitleY = contextTitle ? 132 : 108
  const dateText = data.date ? fitText(data.date, CAPS.date, 190, 12) : ''
  const footerText = fitText(data.footer || 'Whale-chan te acompaña', CAPS.footer, 560, 12)
  const barWidth = 42 + styleIndex(data.style) * 5

  const rows = data.items
    .map((item, index) => {
      const badge = badgeFor(item.kind, item.name)
      const baseline = 174 + index * 23
      const name = fitText(item.name, CAPS.name, 350, 14)
      return (
        `<g class="doodle-item">` +
        `<rect x="50" y="${baseline - 14}" width="22" height="22" rx="7" ` +
        `fill="${badge[1]}" fill-opacity="0.16" stroke="${badge[1]}" stroke-opacity="0.4"/>` +
        textElement('', 61, baseline + 2, badge[0], {
          anchor: 'middle',
          size: 8,
          weight: 700,
          fill: badge[1],
        }) +
        textElement('doodle-item-name', 84, baseline + 3, name, {
          size: 14,
          fill: '#e2e8f0',
        }) +
        textElement('doodle-item-size', 500, baseline + 3, formatBytes(item.bytes), {
          anchor: 'end',
          size: 12,
          fill: '#94a3b8',
        }) +
        `</g>`
      )
    })
    .join('')

  const emptyState = data.items.length
    ? ''
    : textElement('', 276, 278, 'Aún no hay entregables nuevos', {
        anchor: 'middle',
        size: 20,
        weight: 600,
        fill: '#e2e8f0',
      }) +
      textElement('', 276, 306, 'Sin entregables nuevos por ahora.', {
        anchor: 'middle',
        size: 13,
        fill: '#94a3b8',
      })

  const svg = svgDocument(
    width,
    height,
    'Tarjeta de progreso de Whale-chan',
    `<defs>` +
      `<linearGradient id="dd-progress-bg" x1="0" y1="0" x2="1" y2="1">` +
      `<stop offset="0" stop-color="#0b1220"/>` +
      `<stop offset="1" stop-color="#1e2b45"/>` +
      `</linearGradient>` +
      `</defs>` +
      `<rect width="${width}" height="${height}" fill="url(#dd-progress-bg)"/>` +
      `<circle cx="646" cy="60" r="150" fill="${accent.dark}" opacity="0.06"/>` +
      `<circle cx="70" cy="430" r="108" fill="${accent.mid}" opacity="0.05"/>` +
      `<rect x="44" y="42" width="${barWidth}" height="4" rx="2" fill="${accent.dark}"/>` +
      textElement('', 44, 84, 'Progreso', {
        size: 34,
        weight: 800,
        spacing: '-0.5',
        fill: '#f8fafc',
      }) +
      (contextTitle
        ? textElement('doodle-context', 44, 110, fitText(contextTitle, CAPS.title, 440, 17), {
            size: 17,
            weight: 600,
            fill: '#cbd5e1',
          })
        : '') +
      (data.subtitle
        ? textElement(
            'doodle-subtitle',
            44,
            subtitleY,
            fitText(data.subtitle, CAPS.subtitle, 440, 13),
            { size: 13, fill: '#94a3b8' },
          )
        : '') +
      (dateText
        ? textElement('doodle-date', 676, 68, dateText, {
            anchor: 'end',
            size: 12,
            fill: '#94a3b8',
          })
        : '') +
      `<rect x="32" y="148" width="488" height="270" rx="20" ` +
      `fill="#ffffff" fill-opacity="0.04" stroke="#ffffff" stroke-opacity="0.09"/>` +
      rows +
      emptyState +
      `<g class="doodle-sprite">` +
      `<ellipse cx="616" cy="416" rx="94" ry="16" fill="#020617" opacity="0.35"/>` +
      `<circle cx="616" cy="286" r="92" fill="${accent.dark}" opacity="0.08"/>` +
      `<image href="${SPRITES.base}" x="548" y="150" width="145" height="260" ` +
      `preserveAspectRatio="xMidYMax meet"/>` +
      `</g>` +
      textElement('doodle-footer', 44, 454, footerText, { size: 12, fill: '#94a3b8' }),
  )

  return { svg, width, height }
}

function renderCelebrate(data) {
  const [width, height] = SIZES.celebrate
  const accent = MOODS[data.mood]
  const headline = capText(data.title || '¡Tarea completada!', CAPS.title)
  const headlineSize = headline.length > 55 ? 26 : headline.length > 32 ? 31 : 38
  const headlineLineHeight = Math.round(headlineSize * 1.18)
  const headlineChars = Math.max(10, Math.floor(455 / (headlineSize * 0.56)))
  const headlineLines = wrapText(headline, headlineChars).slice(0, 3)
  const supportSource = data.lines.length ? data.lines : DEFAULT_CELEBRATE_LINES
  const supportStart = 116 + Math.max(0, headlineLines.length - 1) * headlineLineHeight + 52
  const glowId = `dd-celebrate-glow-${data.mood}`
  const dateText = data.date ? fitText(data.date, CAPS.date, 190, 12) : ''
  const footerText = fitText(data.footer || 'Whale-chan celebra el avance', CAPS.footer, 470, 12)
  const confetti = confettiField(
    `celebrate|${data.title}|${data.lines.join('|')}|${data.mood}|${data.style}`,
    [accent.dark, '#f8fafc', '#fbbf24', '#f472b6', '#38bdf8'],
    data.style,
    width,
    height,
    18,
  )

  let supportY = supportStart
  const support = []
  for (const line of supportSource.slice(0, CAPS.lines)) {
    const wrapped = wrapText(line, 48)
    wrapped.forEach((segment, index) => {
      if (index === 0) {
        support.push(
          `<circle cx="54" cy="${supportY - 4}" r="2.5" fill="${accent.dark}" opacity="0.9"/>`,
        )
      }
      support.push(
        textElement('doodle-line', 68, supportY, segment, {
          size: 15,
          fill: '#cbd5e1',
        }),
      )
      supportY += 21
    })
  }

  const headlineMarkup = headlineLines
    .map((line, index) =>
      textElement('doodle-headline', 48, 116 + index * headlineLineHeight, line, {
        size: headlineSize,
        weight: 800,
        spacing: '-0.4',
        fill: '#f8fafc',
      }),
    )
    .join('')

  const svg = svgDocument(
    width,
    height,
    'Tarjeta de celebración de Whale-chan',
    `<defs>` +
      `<linearGradient id="dd-celebrate-bg" x1="0" y1="0" x2="1" y2="1">` +
      `<stop offset="0" stop-color="#101a2e"/>` +
      `<stop offset="1" stop-color="#1e2b45"/>` +
      `</linearGradient>` +
      `<radialGradient id="${glowId}" cx="0.5" cy="0.5" r="0.5">` +
      `<stop offset="0" stop-color="${accent.dark}" stop-opacity="0.28"/>` +
      `<stop offset="1" stop-color="${accent.dark}" stop-opacity="0"/>` +
      `</radialGradient>` +
      `</defs>` +
      `<rect width="${width}" height="${height}" fill="url(#dd-celebrate-bg)"/>` +
      `<ellipse cx="592" cy="286" rx="220" ry="220" fill="url(#${glowId})"/>` +
      confetti +
      `<rect x="48" y="42" width="42" height="4" rx="2" fill="${accent.dark}"/>` +
      (dateText
        ? textElement('doodle-date', 676, 68, dateText, {
            anchor: 'end',
            size: 12,
            fill: '#94a3b8',
          })
        : '') +
      headlineMarkup +
      support.join('') +
      `<g class="doodle-sprite">` +
      `<ellipse cx="600" cy="430" rx="74" ry="14" fill="#020617" opacity="0.35"/>` +
      `<circle cx="600" cy="292" r="94" fill="${accent.dark}" opacity="0.08"/>` +
      `<image href="${SPRITES.hoodie}" x="540" y="140" width="130" height="300" ` +
      `preserveAspectRatio="xMidYMax meet"/>` +
      `</g>` +
      textElement('doodle-footer', 48, 454, footerText, { size: 12, fill: '#94a3b8' }),
  )

  return { svg, width, height }
}

function renderSticker(data) {
  const [width, height] = SIZES.sticker
  const accent = MOODS[data.mood]
  const caption = fitText(data.title || 'Hola', CAPS.title, 360, 29)
  const sparkles = stickerSparkles(accent.light, data.style)

  const svg = svgDocument(
    width,
    height,
    'Sticker de Whale-chan',
    `<defs>` +
      `<linearGradient id="dd-sticker-bg" x1="0" y1="0" x2="0" y2="1">` +
      `<stop offset="0" stop-color="#ffffff"/>` +
      `<stop offset="1" stop-color="#edf6ff"/>` +
      `</linearGradient>` +
      `<filter id="dd-sticker-shadow" x="-30%" y="-30%" width="160%" height="160%">` +
      `<feDropShadow dx="0" dy="9" stdDeviation="11" flood-color="#0f172a" flood-opacity="0.22"/>` +
      `</filter>` +
      `</defs>` +
      `<rect x="22" y="22" width="436" height="436" rx="42" fill="url(#dd-sticker-bg)" ` +
      `stroke="${accent.light}" stroke-opacity="0.55" stroke-width="2" ` +
      `filter="url(#dd-sticker-shadow)"/>` +
      `<g aria-hidden="true">${sparkles}</g>` +
      `<circle cx="240" cy="214" r="142" fill="${accent.light}" opacity="0.08"/>` +
      `<circle cx="240" cy="214" r="112" fill="#ffffff" opacity="0.5"/>` +
      `<g class="doodle-sprite">` +
      `<image href="${SPRITES.base}" x="150" y="58" width="180" height="322" ` +
      `preserveAspectRatio="xMidYMax meet"/>` +
      `</g>` +
      textElement('doodle-caption', 240, 426, caption, {
        anchor: 'middle',
        size: 29,
        weight: 700,
        spacing: '-0.3',
        fill: '#0f172a',
      }) +
      `<rect x="216" y="440" width="48" height="4" rx="2" fill="${accent.light}" opacity="0.8"/>`,
  )

  return { svg, width, height }
}

function renderDoodleCard(data) {
  const [width, height] = SIZES.doodle
  const accent = MOODS[data.mood]
  const caption = data.title ? fitText(data.title, CAPS.title, 400, 22) : ''
  const seed = `doodle|${data.title}|${data.mood}|${data.style}`
  const shift = styleIndex(data.style) * 9
  const bubbles = bubbleField(seed, accent.light, data.style, 11)

  const svg = svgDocument(
    width,
    height,
    'Dibujo de Whale-chan',
    `<defs>` +
      `<linearGradient id="dd-doodle-bg" x1="0" y1="0" x2="0" y2="1">` +
      `<stop offset="0" stop-color="#f2f9ff"/>` +
      `<stop offset="1" stop-color="#d6ecff"/>` +
      `</linearGradient>` +
      `</defs>` +
      `<rect width="${width}" height="${height}" fill="url(#dd-doodle-bg)"/>` +
      `<circle cx="78" cy="92" r="118" fill="${accent.light}" opacity="0.07"/>` +
      `<circle cx="424" cy="220" r="96" fill="${accent.light}" opacity="0.05"/>` +
      (caption
        ? textElement('doodle-caption', 240, 54, caption, {
            anchor: 'middle',
            size: 22,
            weight: 700,
            fill: '#0f172a',
          })
        : '') +
      bubbles +
      // Water spout above the whale.
      `<g fill="none" stroke="${accent.light}" stroke-width="3" stroke-linecap="round" opacity="0.7">` +
      `<path d="M 312 214 C 304 196 292 187 280 183"/>` +
      `<path d="M 312 214 C 320 194 332 183 346 178"/>` +
      `<path d="M 312 214 C 312 194 316 180 324 169"/>` +
      `</g>` +
      `<circle cx="279" cy="182" r="3" fill="${accent.light}" opacity="0.7"/>` +
      `<circle cx="347" cy="177" r="3" fill="${accent.light}" opacity="0.7"/>` +
      `<circle cx="325" cy="168" r="3" fill="${accent.light}" opacity="0.7"/>` +
      // Simple whale silhouette: tail, body, fin and belly highlight.
      `<g class="doodle-whale">` +
      `<path d="M 137 270 C 120 244 92 230 75 242 C 64 250 69 266 85 277 ` +
      `C 72 283 66 296 75 306 C 86 318 110 307 126 287 ` +
      `C 130 282 134 276 137 270 Z" fill="#0f172a"/>` +
      `<path d="M 336 282 C 328 250 291 226 245 223 C 201 220 162 235 140 262 ` +
      `C 132 272 128 282 129 292 C 143 318 181 337 226 341 ` +
      `C 274 345 315 327 333 300 C 339 291 340 286 336 282 Z" fill="#0f172a"/>` +
      `<path d="M 236 326 C 246 345 266 357 288 358 C 276 342 269 330 266 319 Z" fill="#0f172a"/>` +
      `<path d="M 165 321 C 196 340 262 345 308 323 C 287 341 247 350 211 346 ` +
      `C 188 343 173 334 165 321 Z" fill="${accent.light}" opacity="0.18"/>` +
      `<circle cx="300" cy="270" r="4.5" fill="#f8fafc" opacity="0.95"/>` +
      `<path d="M 311 291 Q 320 298 329 290" fill="none" stroke="#f8fafc" ` +
      `stroke-width="2" stroke-linecap="round" opacity="0.45"/>` +
      `</g>` +
      // Layered waves, phase-shifted by the decorative style.
      `<path d="M -20 ${num(366 + shift)} C 60 ${num(346 + shift)} 120 ${num(386 + shift)} ` +
      `200 ${num(366 + shift)} C 280 ${num(346 + shift)} 340 ${num(386 + shift)} ` +
      `420 ${num(366 + shift)} C 442 ${num(362 + shift)} 468 ${num(366 + shift)} ` +
      `500 ${num(360 + shift)} L 500 500 L -20 500 Z" ` +
      `fill="${accent.light}" opacity="0.12"/>` +
      `<path d="M -10 ${num(398 + shift)} C 70 ${num(380 + shift)} 140 ${num(416 + shift)} ` +
      `220 ${num(398 + shift)} C 300 ${num(380 + shift)} 370 ${num(416 + shift)} ` +
      `490 ${num(392 + shift)}" fill="none" stroke="${accent.light}" stroke-width="3" opacity="0.45"/>` +
      `<path d="M -10 ${num(426 + shift)} C 80 ${num(408 + shift)} 150 ${num(444 + shift)} ` +
      `240 ${num(426 + shift)} C 330 ${num(408 + shift)} 400 ${num(442 + shift)} ` +
      `490 ${num(422 + shift)}" fill="none" stroke="#0f172a" stroke-width="2" opacity="0.12"/>` +
      `<circle cx="92" cy="${num(384 + shift)}" r="5" fill="#ffffff" opacity="0.55"/>` +
      `<circle cx="150" cy="${num(410 + shift)}" r="3" fill="#ffffff" opacity="0.45"/>` +
      `<circle cx="356" cy="${num(402 + shift)}" r="4" fill="#ffffff" opacity="0.5"/>`,
  )

  return { svg, width, height }
}

// -----------------------------------------------------------------------------
// Public entry point
// -----------------------------------------------------------------------------

/**
 * Render a deterministic SVG doodle for Whale-chan.
 * @param {'progress'|'celebrate'|'sticker'|'doodle'} kind
 * @param {DoodleData} [data]
 * @returns {{ svg: string, width: number, height: number }}
 */
export function renderDoodle(kind, data = {}) {
  if (!DOODLE_KINDS.includes(kind)) {
    throw new TypeError(`Unknown doodle kind: ${String(kind)}`)
  }
  const normalized = normalizeData(data)
  if (kind === 'progress') return renderProgress(normalized)
  if (kind === 'celebrate') return renderCelebrate(normalized)
  if (kind === 'sticker') return renderSticker(normalized)
  return renderDoodleCard(normalized)
}

