// Desktop companion window for the mascot.
//
// The in-page pet only exists while the browser surface is visible. This module
// adds a second face: a frameless, transparent, always-on-top window that
// renders nothing but her sprite, so she can stay on the monitor while
// DeepSeek Harness runs behind the scenes.
//
// The DSH host is a plain Node process, not the Electron main process, so it
// cannot create a BrowserWindow. Instead this module launches a small Windows
// Presentation Foundation window (assets/desktop-window.ps1) as a child
// process: true per-pixel transparency, drag by grabbing her, native context
// menu, and drag position persisted in ~/.dsh/whale-maid.json.
//
// Every failure is contained: the plugin keeps working with the in-page mascot.
import { appendFileSync, existsSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { spawn } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { join } from 'node:path'
import { DSH_HOME, configPath, loadConfig, readJson, writeJsonQuietly } from './config.js'

const ASSETS = new URL('../assets/', import.meta.url)
const SPRITES = { a: 'mascot_a.png', b: 'mascot_b.png', c: 'mascot_c.png' }
const WINDOW_SCRIPT = fileURLToPath(new URL('desktop-window.ps1', ASSETS))
const PID_FILE = join(DSH_HOME, 'whale-maid.desktop.pid')
const MIN_WIDTH = 120
const MAX_WIDTH = 720

let child = null

function log(message) {
  const line = `${new Date().toISOString()} [desktop] ${message}\n`
  try {
    console.warn(`[whale-maid-mascot] desktop: ${message}`)
  } catch {
    /* logging is best effort */
  }
  try {
    appendFileSync(join(DSH_HOME, 'whale-maid.log'), line, 'utf8')
  } catch {
    /* logging is best effort */
  }
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value))
}

function running() {
  return Boolean(child && child.exitCode === null)
}

/** Persist a partial config patch without dropping keys written by other faces. */
function patchConfig(patch) {
  try {
    const file = configPath()
    const current = readJson(file, {}) ?? {}
    writeJsonQuietly(file, { ...current, ...patch })
  } catch {
    /* best effort: the window still works for this run */
  }
}

/** Kill a window left behind by a previous host run (pid file from last time). */
function killStale() {
  try {
    if (!existsSync(PID_FILE)) return
    const pid = Number(readFileSync(PID_FILE, 'utf8').trim())
    if (Number.isInteger(pid) && pid > 0 && pid !== process.pid) {
      try {
        process.kill(pid)
      } catch {
        /* already gone */
      }
    }
    rmSync(PID_FILE, { force: true })
  } catch {
    /* best effort */
  }
}

/** Current state for the HTTP route and the status line. */
export function desktopStatus() {
  const config = loadConfig()
  return {
    ok: true,
    open: running(),
    mode: config.desktopMode === true,
    width: Number(config.desktopWidth) || 220,
    sprite: typeof config.desktopSprite === 'string' ? config.desktopSprite : 'a',
    alwaysOnTop: config.desktopAlwaysOnTop !== false,
  }
}

/** Open the transparent companion window. Never throws. */
export async function openDesktopWindow() {
  try {
    if (running()) return { ok: true, open: true, reused: true }
    if (!existsSync(WINDOW_SCRIPT)) return { ok: false, error: 'desktop-window.ps1 no encontrado' }
    const config = loadConfig()
    const spriteKey = typeof config.desktopSprite === 'string' && SPRITES[config.desktopSprite] ? config.desktopSprite : 'a'
    const spritePath = fileURLToPath(new URL(SPRITES[spriteKey], ASSETS))
    if (!existsSync(spritePath)) return { ok: false, error: 'sprite no encontrado' }
    const width = clamp(Math.round(Number(config.desktopWidth) || 220), MIN_WIDTH, MAX_WIDTH)
    killStale()
    const args = [
      '-NoProfile',
      '-STA',
      '-ExecutionPolicy',
      'Bypass',
      '-File',
      WINDOW_SCRIPT,
      '-Sprite',
      spritePath,
      '-Width',
      String(width),
      '-ConfigPath',
      configPath(),
    ]
    if (config.desktopAlwaysOnTop === false) args.push('-NoTopMost')
    child = spawn('powershell.exe', args, { windowsHide: true, stdio: 'ignore' })
    const spawned = child
    spawned.on('exit', (code) => {
      if (child === spawned) child = null
      try {
        rmSync(PID_FILE, { force: true })
      } catch {
        /* best effort */
      }
      log(`window closed (exit ${String(code)})`)
    })
    spawned.on('error', (error) => {
      if (child === spawned) child = null
      log(`spawn failed: ${error && error.message ? error.message : String(error)}`)
    })
    try {
      writeFileSync(PID_FILE, String(spawned.pid ?? ''), 'utf8')
    } catch {
      /* best effort */
    }
    log(`window spawned pid=${String(spawned.pid)} width=${String(width)} sprite=${spriteKey}`)
    return { ok: true, open: true, width }
  } catch (error) {
    child = null
    const message = String(error && error.message ? error.message : error)
    log(`open failed: ${message}`)
    return { ok: false, error: message }
  }
}

/** Close the window; `disableMode` also turns the persisted mode off. */
export function closeDesktopWindow(disableMode = false) {
  if (disableMode) patchConfig({ desktopMode: false })
  try {
    if (running()) child.kill()
  } catch {
    /* best effort */
  }
  child = null
  try {
    rmSync(PID_FILE, { force: true })
  } catch {
    /* best effort */
  }
  return { ok: true, open: false, mode: disableMode ? false : loadConfig().desktopMode === true }
}

/** Change the width, keeping the sprite aspect ratio, and persist it. */
export async function resizeDesktopWindow(width) {
  const next = clamp(Math.round(Number(width) || 220), MIN_WIDTH, MAX_WIDTH)
  patchConfig({ desktopWidth: next })
  if (running()) {
    closeDesktopWindow(false)
    await new Promise((resolve) => setTimeout(resolve, 250))
    return openDesktopWindow()
  }
  return { ok: true, open: false, width: next }
}

/** Turn the desktop companion on or off and persist the choice. */
export async function setDesktopMode(enabled) {
  const next = enabled === true
  patchConfig({ desktopMode: next })
  if (next) return openDesktopWindow()
  return closeDesktopWindow(false)
}

/** Flip the mode. */
export async function toggleDesktopWindow() {
  return setDesktopMode(!running())
}

/** Desktop bubbles are rendered by the window script itself; kept for callers. */
export function sayInDesktop() {
  return false
}
