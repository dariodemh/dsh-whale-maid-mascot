// Boot guard for the client half of the plugin.
//
// DSH audits the client entries while the web app boots and aborts the whole
// application when the first one is not `active`:
//
//   web boot: 1 entry did not activate
//   dsh-whale-maid-mascot: failed
//
// A hard `inject = ['workspaces', 'sessions', ...]` in dsh/client.js is the only
// known way this plugin can end up there: the fiber stays `loading`/`failed`
// until those services publish, and the audit runs long before that.
//
// The bundle already resolves services defensively (adoptServices/serviceOf)
// and declares `inject = []`. This guard is the belt to that suspenders: if an
// edit (human or model) puts a non-empty inject list back, it is neutralized on
// the host side before the renderer asks for the bundle, and the change is
// recorded in ~/.dsh/whale-maid.log with a backup next to the file.
import { appendFileSync, copyFileSync, readFileSync, writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { join } from 'node:path'
import { DSH_HOME } from './config.js'

const CLIENT = fileURLToPath(new URL('./client.js', import.meta.url))
// Only arrays that actually list something (quoted service names); comments and
// the empty form above are left untouched.
const INJECT_LIST = /exports\.inject\s*=\s*\[[^\]]*['"][^\]]*\]/g

function log(message) {
  try {
    appendFileSync(join(DSH_HOME, 'whale-maid.log'), `${new Date().toISOString()} [boot-guard] ${message}\n`, 'utf8')
  } catch {
    /* logging is best effort */
  }
}

/**
 * Rewrite a non-empty `exports.inject = [...]` in dsh/client.js to `[]`.
 * Returns { ok, changed, count? } and never throws.
 */
export function guardClientInject(file = CLIENT) {
  let source
  try {
    source = readFileSync(file, 'utf8')
  } catch (error) {
    log(`no se pudo leer client.js: ${error && error.message ? error.message : String(error)}`)
    return { ok: false, changed: false }
  }
  const hits = source.match(INJECT_LIST) ?? []
  if (hits.length === 0) return { ok: true, changed: false }
  try {
    copyFileSync(file, `${file}.bak-boot-guard`)
    writeFileSync(file, source.replace(INJECT_LIST, 'exports.inject = []'), 'utf8')
  } catch (error) {
    log(`no se pudo neutralizar el inject: ${error && error.message ? error.message : String(error)}`)
    return { ok: false, changed: false }
  }
  log(`inject neutralizado (${hits.length}): ${hits.join(' | ')}`)
  return { ok: true, changed: true, count: hits.length }
}
