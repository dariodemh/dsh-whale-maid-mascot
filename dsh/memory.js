// Long-term, local memory for Whale-chan.
//
// The mascot keeps a small JSON file per DSH installation so she can remember
// stable, user-shared facts (a preferred name, how someone likes to be talked
// to, recurring projects) across sessions. Memory is entirely local, keyed by a
// random per-browser user id the client stores in localStorage, and can be
// cleared from the mascot menu at any time.
//
// Design constraints:
// - never throw into request handlers: every public function fails soft and
//   returns empty/default data instead;
// - bounded: max users, facts, preferences and text length;
// - atomic writes (temporary file + rename) and one in-process queue so
//   concurrent chat requests cannot corrupt the file.
import { promises as fs } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'

const MEMORY_VERSION = 1
const LIMITS = {
  users: 20,
  facts: 40,
  preferences: 20,
  self: 30,
  journal: 12,
  threads: 20,
  name: 40,
  text: 200,
}

export function memoryDir() {
  return process.env.WHM_MEMORY_DIR || join(homedir(), '.dsh', 'whale-maid-mascot')
}

export function memoryFile() {
  return join(memoryDir(), 'memory.json')
}

export function validUserId(userId) {
  return typeof userId === 'string' && /^[A-Za-z0-9_-]{8,80}$/.test(userId)
}

function emptyStore() {
  return { version: MEMORY_VERSION, users: {} }
}

function nowIso() {
  return new Date().toISOString()
}

function cleanText(value, max = LIMITS.text) {
  return String(value == null ? '' : value)
    .replace(/[\u0000-\u001f\u007f]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, max)
}

function cleanList(list, max) {
  if (!Array.isArray(list)) return []
  const seen = new Set()
  const out = []
  for (const item of list) {
    const text = cleanText(item)
    if (!text) continue
    const key = text.toLowerCase()
    if (seen.has(key)) continue
    seen.add(key)
    out.push(text)
    if (out.length >= max) break
  }
  return out
}

function normalizeUser(user) {
  const base = {
    name: '',
    facts: [],
    preferences: [],
    selfFacts: [],
    journal: [],
    turns: 0,
    createdAt: nowIso(),
    updatedAt: nowIso(),
  }
  if (!user || typeof user !== 'object') return base
  return {
    name: cleanText(user.name, LIMITS.name),
    facts: cleanList(user.facts, LIMITS.facts),
    preferences: cleanList(user.preferences, LIMITS.preferences),
    selfFacts: cleanList(user.selfFacts, LIMITS.self),
    journal: cleanList(user.journal, LIMITS.journal),
    turns: Number.isFinite(user.turns) ? Math.max(0, Math.floor(user.turns)) : 0,
    createdAt: typeof user.createdAt === 'string' ? user.createdAt : base.createdAt,
    updatedAt: typeof user.updatedAt === 'string' ? user.updatedAt : base.updatedAt,
  }
}

function normalizeStore(raw) {
  const store = emptyStore()
  if (!raw || typeof raw !== 'object' || !raw.users || typeof raw.users !== 'object') return store
  for (const [userId, user] of Object.entries(raw.users)) {
    if (!validUserId(userId)) continue
    store.users[userId] = normalizeUser(user)
    if (Object.keys(store.users).length >= LIMITS.users) break
  }
  return store
}

async function readStore() {
  try {
    const raw = await fs.readFile(memoryFile(), 'utf8')
    return normalizeStore(JSON.parse(raw))
  } catch (error) {
    if (error && error.code === 'ENOENT') return emptyStore()
    console.warn('[whale-maid-mascot] memory read failed:', error && error.message)
    return emptyStore()
  }
}

async function writeStore(store) {
  await fs.mkdir(memoryDir(), { recursive: true })
  const tmp = `${memoryFile()}.${process.pid}.${Date.now()}.tmp`
  await fs.writeFile(tmp, `${JSON.stringify(store, null, 2)}\n`, 'utf8')
  await fs.rename(tmp, memoryFile())
}

// Serialize read-modify-write cycles within this process.
let queue = Promise.resolve()
function serialize(work) {
  const next = queue.then(work, work)
  queue = next.then(() => undefined, () => undefined)
  return next
}

function publicUser(user) {
  return {
    name: user.name,
    facts: [...user.facts],
    preferences: [...user.preferences],
    selfFacts: [...user.selfFacts],
    journal: [...user.journal],
    turns: user.turns,
    updatedAt: user.updatedAt,
  }
}

export async function getMemory(userId) {
  if (!validUserId(userId)) return null
  try {
    const store = await readStore()
    return publicUser(store.users[userId] || normalizeUser(null))
  } catch (error) {
    return null
  }
}

/**
 * Append one remembered item. `kind` is "name" (preferred name/nickname),
 * "fact" (stable fact) or "preference" (how the user likes things) — those live
 * in the user's own section. "self" (a deliberate decision/evolution of the
 * character herself) and "journal" (a periodic self-review entry) live in the
 * character's own sections, so both histories stay separate.
 */
export async function remember(userId, kind, value) {
  if (!validUserId(userId)) return null
  const text = cleanText(value, kind === 'name' ? LIMITS.name : LIMITS.text)
  if (!text) return null
  return serialize(async () => {
    try {
      const store = await readStore()
      const user = store.users[userId] || normalizeUser(null)
      const at = nowIso()
      if (kind === 'name') {
        user.name = text
      } else if (kind === 'preference') {
        if (!user.preferences.some((item) => item.toLowerCase() === text.toLowerCase())) {
          user.preferences.push(text)
          user.preferences = user.preferences.slice(-LIMITS.preferences)
        }
      } else if (kind === 'self') {
        if (!user.selfFacts.some((item) => item.toLowerCase() === text.toLowerCase())) {
          user.selfFacts.push(text)
          user.selfFacts = user.selfFacts.slice(-LIMITS.self)
        }
      } else if (kind === 'journal') {
        // Journal entries are dated snapshots, not deduplicated statements.
        user.journal.push(text)
        user.journal = user.journal.slice(-LIMITS.journal)
      } else {
        if (!user.facts.some((item) => item.toLowerCase() === text.toLowerCase())) {
          user.facts.push(text)
          user.facts = user.facts.slice(-LIMITS.facts)
        }
      }
      user.updatedAt = at
      store.users[userId] = user
      // Keep the store bounded: drop the least recently updated users.
      const entries = Object.entries(store.users)
      if (entries.length > LIMITS.users) {
        entries
          .sort((a, b) => String(a[1].updatedAt).localeCompare(String(b[1].updatedAt)))
          .slice(0, entries.length - LIMITS.users)
          .forEach(([id]) => delete store.users[id])
      }
      await writeStore(store)
      return publicUser(user)
    } catch (error) {
      console.warn('[whale-maid-mascot] memory write failed:', error && error.message)
      return null
    }
  })
}

export async function bumpTurns(userId, delta = 1) {
  if (!validUserId(userId)) return null
  return serialize(async () => {
    try {
      const store = await readStore()
      const user = store.users[userId] || normalizeUser(null)
      user.turns = Math.max(0, user.turns + Math.max(0, Math.floor(delta)))
      user.updatedAt = nowIso()
      store.users[userId] = user
      await writeStore(store)
      return publicUser(user)
    } catch (error) {
      return null
    }
  })
}

export async function clearMemory(userId) {
  if (!validUserId(userId)) return null
  return serialize(async () => {
    try {
      const store = await readStore()
      delete store.users[userId]
      await writeStore(store)
      return publicUser(normalizeUser(null))
    } catch (error) {
      return null
    }
  })
}

/** Prompt fragment with everything she should take into account. */
export async function memoryPrompt(userId) {
  const memory = await getMemory(userId)
  return memoryToPrompt(memory)
}

export function memoryToPrompt(memory) {
  if (!memory) return ''
  const lines = []
  if (memory.name) lines.push(`- Nombre o trato preferido: ${memory.name}`)
  for (const fact of (memory.facts || []).slice(-8)) lines.push(`- ${fact}`)
  for (const preference of (memory.preferences || []).slice(-8)) lines.push(`- Preferencia: ${preference}`)
  const userLines = [...lines]
  lines.length = 0
  for (const self of (memory.selfFacts || []).slice(-8)) lines.push(`- ${self}`)
  for (const entry of (memory.journal || []).slice(-2)) lines.push(`- Bitácora: ${entry}`)
  const selfLines = [...lines]
  if (userLines.length) {
    userLines.unshift(
      '\n\nMemoria persistente del usuario (adáptate a ella, no la enumeres ni inventes recuerdos que no estén aquí):',
    )
  }
  if (selfLines.length) {
    selfLines.unshift(
      '\n\nCosas propias de ti (decisiones y evolución que registraste sobre ti misma; no son datos del usuario):',
    )
  }
  return userLines.join('\n') + selfLines.join('\n')
}
