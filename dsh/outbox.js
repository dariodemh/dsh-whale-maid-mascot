/**
 * Local outbox: a mirror of images the assistant sends out (today the
 * `telegram_photo` tool, and anything else that goes through the bridge's
 * `sendPhoto`).
 *
 * Why this exists: the DSH session transcript only carries text events, so a
 * photo uploaded to Telegram left no trace in the shared history that the
 * in-page chat and the desktop window render. This module keeps a small,
 * restart-safe record of those sends — **path + metadata, never base64** — and
 * the host merges it into `GET /whale-maid-mascot/history` as a normal `user`
 * message with an `image` descriptor. Both surfaces then paint it with the
 * image renderers they already have.
 *
 * The record is local-only: nothing here talks to Telegram, so a photo is never
 * sent twice.
 */
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  statSync,
  unlinkSync,
} from 'node:fs'
import { basename, extname, join, resolve } from 'node:path'
import { DSH_HOME, readJson, writeJsonQuietly } from './config.js'

export const OUTBOX_FILE = join(DSH_HOME, 'whale-maid.outbox.json')
export const OUTBOX_DIR = join(DSH_HOME, 'whale-maid-outbox')
export const OUTBOX_LIMIT = 40
export const OUTBOX_MAX_BYTES = 8 * 1024 * 1024
export const OUTBOX_PLACEHOLDER = '📷 Foto enviada por Telegram'

const MIME_BY_EXT = {
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.gif': 'image/gif',
}

function normalizeEntry(raw) {
  if (!raw || typeof raw !== 'object') return null
  const id = typeof raw.id === 'string' ? raw.id.trim() : ''
  const path = typeof raw.path === 'string' ? raw.path : ''
  const name = typeof raw.name === 'string' ? raw.name : ''
  const mediaType = typeof raw.mediaType === 'string' ? raw.mediaType : ''
  const at = Number(raw.at)
  if (!id || !path || !name || !mediaType || !Number.isFinite(at)) return null
  if (!Object.values(MIME_BY_EXT).includes(mediaType)) return null
  return {
    id,
    at,
    name: name.slice(0, 160),
    mediaType,
    path,
    caption: typeof raw.caption === 'string' ? raw.caption.slice(0, 500) : '',
    source: typeof raw.source === 'string' ? raw.source.slice(0, 40) : 'telegram_photo',
    chatId: raw.chatId === null || raw.chatId === undefined ? null : String(raw.chatId),
    messageId: Number.isFinite(Number(raw.messageId)) ? Number(raw.messageId) : null,
  }
}

/** Entries persisted on disk that still have their file, oldest first. */
export function readOutboxEntries() {
  const raw = readJson(OUTBOX_FILE, null)
  const list = Array.isArray(raw?.entries) ? raw.entries : []
  return list
    .map(normalizeEntry)
    .filter(entry => entry !== null)
    .filter(entry => existsSync(entry.path))
    .sort((a, b) => a.at - b.at)
}

function writeOutboxEntries(entries) {
  writeJsonQuietly(OUTBOX_FILE, { version: 1, entries })
}

function removeStoredFile(entry) {
  try {
    if (!entry?.path) return
    const normalized = resolve(entry.path)
    if (!normalized.startsWith(resolve(OUTBOX_DIR))) return
    if (existsSync(normalized)) unlinkSync(normalized)
  } catch {
    /* a file we cannot delete is not worth failing the send for */
  }
}

/**
 * Copies one outgoing image into the outbox directory and records it.
 * Returns `{ ok, id, entry }` or `{ ok: false, error }`.
 * `maxBytes` is injectable for tests; production uses OUTBOX_MAX_BYTES.
 */
export function recordOutboxImage(options = {}) {
  try {
    const sourcePath = typeof options.path === 'string' ? options.path.trim() : ''
    if (sourcePath === '') return { ok: false, error: 'path is required' }
    const full = resolve(sourcePath)
    if (!existsSync(full)) return { ok: false, error: 'file not found' }
    const info = statSync(full)
    if (!info.isFile()) return { ok: false, error: 'not a file' }
    if (info.size <= 0) return { ok: false, error: 'empty file' }
    const maxBytes = Number(options.maxBytes) > 0 ? Number(options.maxBytes) : OUTBOX_MAX_BYTES
    if (info.size > maxBytes) return { ok: false, error: 'file too large' }
    const extension = extname(full).toLowerCase()
    const mediaType = MIME_BY_EXT[extension]
    if (!mediaType) return { ok: false, error: 'unsupported image type' }

    const caption = typeof options.caption === 'string' ? options.caption : ''
    const messageId = Number.isFinite(Number(options.messageId)) ? Number(options.messageId) : null
    const name = basename(full).slice(0, 160)

    const entries = readOutboxEntries()
    // The same Telegram message recorded twice (a retry, a double call) is not a
    // second photo: keep the existing entry.
    const existing = entries.find(entry => messageId !== null && entry.messageId === messageId && entry.name === name)
    if (existing) return { ok: true, id: existing.id, entry: existing, duplicate: true }

    const at = Date.now()
    const id = `img-${at.toString(36)}-${Math.random().toString(36).slice(2, 8)}`
    mkdirSync(OUTBOX_DIR, { recursive: true })
    const storedPath = join(OUTBOX_DIR, `${id}${extension}`)
    copyFileSync(full, storedPath)

    const entry = {
      id,
      at,
      name,
      mediaType,
      path: storedPath,
      caption: caption.slice(0, 500),
      source: typeof options.source === 'string' && options.source ? options.source.slice(0, 40) : 'telegram_photo',
      chatId: options.chatId === null || options.chatId === undefined ? null : String(options.chatId),
      messageId,
    }
    const keep = [...entries, entry].slice(-OUTBOX_LIMIT)
    const keptIds = new Set(keep.map(item => item.id))
    for (const old of entries) if (!keptIds.has(old.id)) removeStoredFile(old)
    writeOutboxEntries(keep)
    return { ok: true, id, entry }
  } catch (error) {
    return { ok: false, error: String(error?.message ?? error) }
  }
}

export function findOutboxEntry(id) {
  const wanted = typeof id === 'string' ? id.trim() : ''
  if (!wanted) return null
  return readOutboxEntries().find(entry => entry.id === wanted) ?? null
}

/** Bytes + metadata for the host's image route. `null` when unknown/unreadable. */
export function readOutboxImage(id) {
  const entry = findOutboxEntry(id)
  if (!entry) return null
  try {
    return { bytes: readFileSync(entry.path), mediaType: entry.mediaType, name: entry.name }
  } catch {
    return null
  }
}

/** Outbox entries shaped like history messages, for the shared transcript. */
export function outboxHistoryMessages(entries = readOutboxEntries()) {
  return entries.map(entry => ({
    // The photo was sent BY Cala: locally it belongs on her side of the thread.
    role: 'assistant',
    at: entry.at,
    text: entry.caption || OUTBOX_PLACEHOLDER,
    image: {
      id: entry.id,
      url: `/whale-maid-mascot/outbox-image?id=${encodeURIComponent(entry.id)}`,
      name: entry.name,
      mediaType: entry.mediaType,
    },
  }))
}

/**
 * Merges the text transcript with the outbox, oldest first, dropping exact
 * duplicates (same image id, or same role/time/text) and keeping the newest
 * `limit` entries. Pure, so it is unit-tested without a running harness.
 */
export function mergeHistoryMessages(messages = [], outbox = [], limit = 30) {
  const seen = new Set()
  const merged = []
  for (const message of [...messages, ...outbox]) {
    if (!message || typeof message.at !== 'number') continue
    const key = message.image?.id
      ? `img:${message.image.id}`
      : `txt:${message.role}:${message.at}:${message.text ?? ''}`
    if (seen.has(key)) continue
    seen.add(key)
    merged.push(message)
  }
  merged.sort((a, b) => (a.at - b.at) || ((a.image ? 1 : 0) - (b.image ? 1 : 0)))
  return merged.slice(-limit)
}
