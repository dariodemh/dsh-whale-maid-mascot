/**
 * Whale-chan on Telegram: a DSH bundle layer that long-polls the Telegram Bot
 * API and answers each authorized chat from the *shared* Whale-chan session, so
 * the browser mascot and the phone talk to the same character with the same
 * tools and the same conversation.
 *
 * Setup: create a bot with @BotFather, put its token in `~/.dsh/whale-maid.token`
 * (or the TELEGRAM_BOT_TOKEN env var), restart DSH, then send `/pair <code>`
 * with the code from `~/.dsh/whale-maid.pairing.txt`.
 */
import { appendFileSync, mkdirSync, readdirSync, statSync, writeFileSync } from 'node:fs'
import { join, relative, sep } from 'node:path'
import { randomBytes } from 'node:crypto'
import {
  DSH_HOME,
  chunkText,
  loadConfig,
  loadState,
  personaText,
  reviewSessionId,
  readMascotMemory,
  rememberInMascot,
  resolveToken,
  saveState,
  sharedSessionId,
} from './config.js'
import { askSession, ensureSession, isSessionBusy, sessionSnapshot, sharedTranscript } from './session.js'
import { recordOutboxImage } from './outbox.js'
import { decideReview, isReviewSkip, reviewConfig, reviewPrompt, reviewReply, reviewSystem } from './review.js'
import { TelegramBot } from './telegram-api.js'

const SKIP_DIRS = new Set(['node_modules', '.git', '.pnpm-store', 'dist', 'build', 'coverage'])

const SILENT_REPLY = 'skip'

/**
 * True when a turn's final text is the silence convention: exactly "SKIP",
 * case-insensitive and ignoring surrounding whitespace. "SKIP algo" is a real
 * message, not silence, so it must still be sent.
 */
export function isSilentReply(text) {
  return String(text ?? '').trim().toLowerCase() === SILENT_REPLY
}

/**
 * True while streamed text could still turn into the silence convention
 * ("S", "SK", "SKI", "SKIP"). Such a partial reply is held back: sending it
 * live would leak "SKIP" to Telegram before the turn knows it is silent.
 */
function couldBecomeSilentReply(text) {
  const clean = String(text ?? '').trim().toLowerCase()
  return clean !== '' && SILENT_REPLY.startsWith(clean)
}

/** Files touched in the last `minutes`, newest first, as short readable lines. */
function recentWorkspaceFiles(root, minutes, limit = 10) {
  const cutoff = Date.now() - Math.max(1, minutes) * 60 * 1000
  const found = []
  const walk = (dir, depth) => {
    let entries = []
    try {
      entries = readdirSync(dir, { withFileTypes: true })
    } catch {
      return
    }
    for (const entry of entries.slice(0, 400)) {
      if (SKIP_DIRS.has(entry.name) || entry.name.startsWith('.')) continue
      const full = join(dir, entry.name)
      try {
        if (entry.isDirectory()) {
          if (depth > 0) walk(full, depth - 1)
          continue
        }
        const info = statSync(full)
        if (info.mtimeMs < cutoff) continue
        found.push({ full, mtime: info.mtimeMs, size: info.size })
      } catch {
        /* a racing delete is not interesting */
      }
    }
  }
  walk(root, 2)
  found.sort((a, b) => b.mtime - a.mtime)
  return found.slice(0, limit).map(file => {
    const minutesAgo = Math.max(0, Math.round((Date.now() - file.mtime) / 60000))
    const rel = relative(root, file.full).split(sep).join('/')
    return `${rel} (${Math.max(1, Math.round(file.size / 1024))} KB, hace ${minutesAgo} min)`
  })
}

export const name = 'whale-maid-telegram'
export const inject = []

export class WhaleTelegram {
  constructor(scope, rowConfig) {
    this.scope = scope
    this.config = { ...loadConfig(), ...(rowConfig ?? {}) }
    this.state = loadState()

    const configured = Array.isArray(this.config.allowedUserIds)
      ? this.config.allowedUserIds.map(Number).filter(Number.isFinite)
      : []
    const owner = Number(this.config.ownerUserId)
    if (Number.isFinite(owner) && owner > 0) configured.push(owner)
    this.allowed = new Set([...configured, ...this.state.allowed])
    this.state.allowed = [...this.allowed]

    this.pairing = this.state.pairing ?? randomBytes(3).toString('hex')
    this.state.pairing = this.pairing
    this.state.sharedSession = this.state.sharedSession
      || (typeof this.config.sessionId === 'string' && this.config.sessionId ? this.config.sessionId : 'whale-maid')

    this.bot = null
    this.abort = new AbortController()
    this.chains = new Map()
    this.typingTimers = new Map()
    this.stopped = false
    this.reviewTimer = null
    this.reviewKickoff = null
    this.reviewBusy = false
    this.lastReviewAt = 0
    this.lastReviewFingerprint = ''
    this.lastProbeAt = 0
    this.lastOutcome = ''
    this.lastProactiveAt = 0
  }

  log(message) {
    try {
      this.scope.logger.info('whale-maid-telegram: %s', String(message))
    } catch {
      /* logger is optional */
    }
  }

  warn(message) {
    try {
      this.scope.logger.warn('whale-maid-telegram: %s', String(message))
    } catch {
      /* logger is optional */
    }
  }

  save() {
    this.state.allowed = [...this.allowed]
    this.state.pairing = this.pairing
    saveState(this.state)
  }

  start() {
    const token = resolveToken(this.config)
    if (!token) {
      this.warn(`sin token: Telegram desactivado. Creá un bot con @BotFather y poné el token en ${this.config.tokenFile} (o definí ${this.config.tokenEnv}).`)
      return () => {}
    }
    try {
      this.bot = new TelegramBot(token)
    } catch (error) {
      this.warn(`token inválido: ${error?.message ?? error}`)
      return () => {}
    }
    if (this.allowed.size === 0) this.writePairingHint()
    this.registerTools()
    this.log(`escuchando. cwd=${this.config.cwd} autorizados=${this.allowed.size}`)
    void this.loop()
    this.startReview()
    return () => this.stop()
  }

  stop() {
    this.stopped = true
    try {
      this.abort.abort()
    } catch {
      /* already aborted */
    }
    for (const timer of this.typingTimers.values()) clearInterval(timer)
    this.typingTimers.clear()
    if (this.reviewTimer) {
      clearInterval(this.reviewTimer)
      this.reviewTimer = null
    }
    if (this.reviewKickoff) {
      clearTimeout(this.reviewKickoff)
      this.reviewKickoff = null
    }
    this.save()
    this.log('detenido')
  }

  // --- proactive review ------------------------------------------------------
  // Every few minutes the mascot looks around — the main conversation and the
  // files touched recently — and decides on her own whether writing is worth it.
  // The turn runs in a light review session, so it never blocks the chat.
  // --- proactive review ------------------------------------------------------
  // Every few minutes the mascot looks around — the main conversation and the
  // files touched recently — and decides on her own whether writing is worth it.
  // Since 2.7.0 the decision is ONE tool-less model call: no agent turn, no
  // shell, no file tools, so a review can never splice a turn into the
  // conversation the owner is having in another surface. Every tick is logged
  // to ~/.dsh/whale-maid.log so the behaviour can be audited afterwards.
  startReview() {
    if (this.config.reviewEnabled === false) return
    // Never double-schedule: a second kickoff or timer would run two ticks.
    if (this.reviewTimer || this.reviewKickoff) return
    const cfg = reviewConfig(this.config)
    this.reviewTimer = setInterval(() => { void this.reviewTick('timer') }, cfg.everyMs)
    if (typeof this.reviewTimer.unref === 'function') this.reviewTimer.unref()
    this.reviewKickoff = setTimeout(() => {
      this.reviewKickoff = null
      if (this.stopped) return
      // A tick already ran while this was pending: do not double-fire.
      if (this.lastReviewAt && Date.now() - this.lastReviewAt < 60 * 1000) {
        this.reviewLog('tick trigger=kickoff decision=skip reason=recent-review')
        return
      }
      void this.reviewTick('kickoff')
    }, 60 * 1000)
    if (typeof this.reviewKickoff.unref === 'function') this.reviewKickoff.unref()
    this.log(`revisión proactiva cada ${Math.round(cfg.everyMs / 60000)} min (sin herramientas, guarda de actividad ${Math.round(cfg.activityGuardMs / 60000)} min)`)
  }

  /** Appends one audit line to ~/.dsh/whale-maid.log (never breaks the bridge). */
  reviewLog(message, detail = '') {
    const line = `${new Date().toISOString()} [review] ${message}${detail ? ` ${detail}` : ''}`
    try {
      mkdirSync(DSH_HOME, { recursive: true })
      appendFileSync(join(DSH_HOME, 'whale-maid.log'), `${line}\n`, 'utf8')
    } catch {
      /* logging is best effort */
    }
    this.log(line)
  }

  /** Logs a tick that will not turn into a review. No turn, so no probe cooldown. */
  skipTick(trigger, reason, detail = '') {
    this.reviewLog(`tick trigger=${trigger} decision=skip reason=${reason}`, detail)
    return { run: false, reason }
  }

  /** Records the outcome of a review turn (sent or not) and starts its cooldown. */
  finishReview(trigger, outcome, reason, detail = '') {
    this.lastProbeAt = Date.now()
    this.lastOutcome = outcome
    if (outcome === 'sent') this.lastProactiveAt = this.lastProbeAt
    this.reviewLog(`tick trigger=${trigger} turn outcome=${outcome} reason=${reason}`, detail)
    return { run: true, outcome, reason }
  }

  async reviewTick(trigger = 'timer') {
    const startedAt = Date.now()
    if (this.stopped) return
    if (!this.bot) return this.skipTick(trigger, 'no-bot')
    // Set synchronously, before any await: two ticks in flight (kickoff + timer)
    // can no longer both pass this guard and prompt at the same time.
    if (this.reviewBusy) return this.skipTick(trigger, 'already-running')
    this.reviewBusy = true
    const cfg = reviewConfig(this.config)
    try {
      const target = this.allowed.size > 0 ? String([...this.allowed][0]) : null
      const sharedId = sharedSessionId(this.config, this.state)
      const reviewId = reviewSessionId(this.config, this.state)
      const shared = await sessionSnapshot(this.scope, sharedId)
      const detail = `shared=${shared.status} pending=${shared.pending} userAgoMs=${shared.lastUserAt ? startedAt - shared.lastUserAt : 'na'}`
      const base = {
        cfg,
        stopped: this.stopped,
        hasBot: Boolean(this.bot),
        busy: false,
        hasTarget: Boolean(target),
        lastProactiveAt: this.lastProactiveAt,
        lastProbeAt: this.lastProbeAt,
        lastOutcome: this.lastOutcome,
        lastFingerprint: this.lastReviewFingerprint,
        userActivityAt: shared.lastUserAt,
        sharedBusy: shared.busy || shared.locked || isSessionBusy(reviewId),
      }

      // Cheap guards first: no session writes, no model call.
      const first = decideReview({ ...base, now: startedAt, fingerprint: '' })
      if (!first.run) return this.skipTick(trigger, first.reason, detail)

      const digest = await sharedTranscript(this.scope, 10)
      const files = recentWorkspaceFiles(this.config.cwd, cfg.recentFilesMinutes)
      const fingerprint = `${digest}\n${files.join('\n')}`

      // Re-check right before spending the turn: reading the digest is async and
      // the owner may have started (or queued) a turn meanwhile.
      const late = await sessionSnapshot(this.scope, sharedId)
      const second = decideReview({
        ...base,
        now: Date.now(),
        userActivityAt: late.lastUserAt,
        sharedBusy: late.busy || late.locked || isSessionBusy(reviewId),
        fingerprint,
      })
      if (!second.run) return this.skipTick(trigger, second.reason, detail)

      this.lastReviewAt = Date.now()
      this.lastReviewFingerprint = fingerprint
      this.reviewLog(
        `tick trigger=${trigger} decision=run session=${reviewId} digestChars=${digest.length} files=${files.length}`,
        detail,
      )

      // One tool-less model call. No agent session, no prompt(): the review can
      // neither run shell/file tools nor append a turn to a live conversation.
      const llm = typeof this.scope.get === 'function' ? this.scope.get('llm') : this.scope.llm
      const turnStartedAt = Date.now()
      const reply = await reviewReply({
        llm,
        cfg,
        system: reviewSystem(this.config),
        prompt: reviewPrompt({
          personaName: this.config.personaName || 'Whale-chan',
          digest,
          files,
          now: Date.now(),
          maxSteps: cfg.maxSteps,
        }),
        sessionId: `${reviewId}-review`,
      })
      const elapsed = Date.now() - turnStartedAt
      if (reply?.timedOut) {
        return this.finishReview(trigger, 'skip', 'timeout', `elapsedMs=${elapsed} budgetMs=${cfg.timeoutMs}`)
      }
      const text = String(reply?.text ?? '').trim()
      if (isReviewSkip(text)) {
        return this.finishReview(
          trigger,
          'skip',
          text === '' ? 'empty' : 'model-skip',
          `elapsedMs=${elapsed} steps=${reply?.steps ?? 0}`,
        )
      }
      await this.sendText(target, text)
      this.finishReview(trigger, 'sent', 'ok', `elapsedMs=${elapsed} chars=${text.length} steps=${reply?.steps ?? 0}`)
      this.log('revisión: le escribí')
      return { run: true, outcome: 'sent', reason: 'ok' }
    } catch (error) {
      const message = String(error?.message ?? error)
      this.warn(`revisión: ${message}`)
      return this.finishReview(trigger, 'error', 'exception', `error=${message.slice(0, 160)} elapsedMs=${Date.now() - startedAt}`)
    } finally {
      this.reviewBusy = false
    }
  }

  writePairingHint() {
    this.writePairingFile([
      'Whale-chan pairing',
      '',
      `Código: ${this.pairing}`,
      '',
      'Enviá al bot, desde tu cuenta de Telegram:',
      `  /pair ${this.pairing}`,
      '',
      'Cuando lo hagas, tu cuenta queda autorizada y este archivo se puede borrar.',
      '',
    ].join('\n'))
  }

  writePairingFile(text) {
    try {
      const dshHome = process.env.DSH_HOME || join(process.env.USERPROFILE || process.env.HOME || '.', '.dsh')
      const file = join(dshHome, 'whale-maid.pairing.txt')
      mkdirSync(dshHome, { recursive: true })
      writeFileSync(file, text, 'utf8')
    } catch (error) {
      this.warn(`no pude escribir el archivo de pairing: ${error?.message ?? error}`)
    }
  }

  registerTools() {
    let tools
    try {
      tools = typeof this.scope.get === 'function' ? this.scope.get('tools') : undefined
    } catch {
      tools = undefined
    }
    if (!tools || typeof tools.register !== 'function') {
      this.warn('servicio tools no disponible; telegram_send y whale_remember no están registradas')
      return
    }
    const output = {
      schema: { type: 'object', additionalProperties: true },
      render: (_args, value) => [{ type: 'text', text: JSON.stringify(value) }],
    }
    try {
      this.scope.effect(() => tools.register({
        name: 'telegram_send',
        description: 'Send a Telegram message to the owner of this DeepSeek Harness installation, proactively. Use it to report a finished task or something that needs attention.',
        parameters: {
          type: 'object',
          properties: {
            text: { type: 'string', description: 'Plain-text message to deliver.' },
            chat_id: { type: 'string', description: 'Optional Telegram chat id; defaults to the owner.' },
          },
          required: ['text'],
          additionalProperties: false,
        },
        output,
        execute: async (args) => {
          const text = typeof args?.text === 'string' ? args.text : ''
          if (text.trim() === '') throw new Error('text is required')
          const explicit = args?.chat_id === undefined ? null : String(args.chat_id)
          const target = explicit ?? (this.allowed.size > 0 ? String([...this.allowed][0]) : null)
          if (!target) throw new Error('no Telegram recipient is authorized yet')
          for (const chunk of chunkText(text, this.config.maxReplyChars)) await this.bot.sendMessage(target, chunk)
          return { sent: true, chat_id: target }
        },
      }))
    } catch (error) {
      this.warn(`no pude registrar telegram_send: ${error?.message ?? error}`)
    }
    try {
      this.scope.effect(() => tools.register({
        name: 'telegram_photo',
        description: 'Send a local image file to the owner over Telegram as a real photo (renders inline on the phone). Use it when the owner cannot open file links, e.g. to show a screenshot.',
        parameters: {
          type: 'object',
          properties: {
            path: { type: 'string', description: 'Absolute path of a local .png/.jpg/.webp/.gif file.' },
            caption: { type: 'string', description: 'Optional short caption.' },
            chat_id: { type: 'string', description: 'Optional Telegram chat id; defaults to the owner.' },
          },
          required: ['path'],
          additionalProperties: false,
        },
        output,
        execute: async (args) => {
          const path = typeof args?.path === 'string' ? args.path.trim() : ''
          if (path === '') throw new Error('path is required')
          const explicit = args?.chat_id === undefined ? null : String(args.chat_id)
          const target = explicit ?? (this.allowed.size > 0 ? String([...this.allowed][0]) : null)
          if (!target) throw new Error('no Telegram recipient is authorized yet')
          const caption = typeof args?.caption === 'string' ? args.caption : ''
          const photo = await this.sendPhoto(target, path, caption)
          return {
            sent: true,
            chat_id: target,
            message_id: photo?.sent?.message_id ?? null,
            // The photo is also mirrored into the shared local thread, so the
            // in-page chat and the desktop window can render it.
            local_mirror: photo?.mirror?.ok ? photo.mirror.id : null,
          }
        },
      }))
    } catch (error) {
      this.warn(`no pude registrar telegram_photo: ${error?.message ?? error}`)
    }
    try {
      this.scope.effect(() => tools.register({
        name: 'whale_remember',
        description: 'Save one stable fact, the preferred name, a preference about the user, or one of your own deliberate evolution entries, into Whale-chan\'s long-term memory, shared with her in-page chat in DeepSeek Harness. Use it when the user shares something durable worth remembering or when you yourself choose to keep a decision about who you are.',
        parameters: {
          type: 'object',
          properties: {
            kind: { type: 'string', enum: ['name', 'fact', 'preference', 'self', 'journal'], description: 'name: how to address the user; fact: durable fact about them or their work; preference: how they like things; self: your own deliberate decision/evolution, first person, with the reason; journal: a dated self-review entry about your evolution.' },
            value: { type: 'string', description: 'Short, self-contained text (max ~200 characters).' },
          },
          required: ['kind', 'value'],
          additionalProperties: false,
        },
        output,
        execute: async (args) => {
          const known = ['name', 'fact', 'preference', 'self', 'journal']
          const kind = known.includes(args?.kind) ? args.kind : 'fact'
          const result = rememberInMascot(kind, args?.value)
          if (!result.ok) throw new Error(result.error)
          return { remembered: true, kind, value: String(args?.value ?? '').trim() }
        },
      }))
    } catch (error) {
      this.warn(`no pude registrar whale_remember: ${error?.message ?? error}`)
    }
  }

  async loop() {
    const signal = this.abort.signal
    while (!signal.aborted && !this.stopped) {
      try {
        const pollSignal = typeof AbortSignal.any === 'function'
          ? AbortSignal.any([signal, AbortSignal.timeout((this.config.pollTimeoutSeconds + 20) * 1000)])
          : signal
        const updates = await this.bot.getUpdates(this.state.offset, this.config.pollTimeoutSeconds, pollSignal)
        for (const update of Array.isArray(updates) ? updates : []) {
          const id = Number(update?.update_id)
          if (Number.isFinite(id) && id >= this.state.offset) this.state.offset = id + 1
          void this.handleUpdate(update).catch(error => this.warn(`update: ${error?.message ?? error}`))
        }
        if (Array.isArray(updates) && updates.length > 0) this.save()
      } catch (error) {
        if (signal.aborted || this.stopped) break
        const message = String(error?.message ?? error)
        if (!/abort/i.test(message)) this.warn(`poll: ${message}`)
        await new Promise(resolve => setTimeout(resolve, 3000))
      }
    }
  }

  async handleUpdate(update) {
    const message = update?.message
    if (!message) return
    const from = message.from
    if (!from || from.is_bot) return
    const userId = Number(from.id)
    const chatId = Number(message.chat?.id ?? userId)
    const text = typeof message.text === 'string' ? message.text.trim() : (typeof message.caption === 'string' ? message.caption.trim() : '')

    if (!this.allowed.has(userId)) {
      await this.handleUnauthorized(chatId, userId, text)
      return
    }
    if (text === '/memory') {
      await this.sendText(chatId, this.describeMemory())
      return
    }
    if (text.startsWith('/')) {
      if (await this.command(chatId, userId, text)) return
    }
    const content = await this.contentOf(message)
    if (!content.ok) {
      await this.sendText(chatId, content.reason)
      return
    }
    this.enqueue(chatId, () => this.runTurn(chatId, content.parts))
  }

  describeMemory() {
    const memory = readMascotMemory()
    if (!memory) return 'Todavía no tengo memoria tuya (¿abriste mi chat en la interfaz alguna vez?).'
    const lines = []
    if (memory.name) lines.push(`Te llamás ${memory.name}.`)
    if (memory.preferences.length) lines.push('Preferencias:', ...memory.preferences.map(item => `- ${item}`))
    if (memory.facts.length) lines.push('Recuerdos:', ...memory.facts.map(item => `- ${item}`))
    if (memory.selfFacts.length) lines.push('Sobre mí misma:', ...memory.selfFacts.map(item => `- ${item}`))
    if (memory.journal.length) lines.push('Bitácora:', ...memory.journal.slice(-2).map(item => `- ${item}`))
    return lines.length === 0 ? 'No tengo nada guardado todavía.' : lines.join('\n')
  }

  async handleUnauthorized(chatId, userId, text) {
    const pair = /^\/pair\s+(\S+)$/i.exec(text)
    if (pair) {
      if (!this.config.allowPairing) {
        await this.sendText(chatId, 'El emparejamiento está desactivado.')
        return
      }
      if (pair[1].toLowerCase() !== String(this.pairing).toLowerCase()) {
        await this.sendText(chatId, 'Código incorrecto.')
        return
      }
      this.allowed.add(userId)
      this.save()
      this.log(`usuario ${userId} autorizado por emparejamiento`)
      await this.sendText(chatId, 'Listo: estás autorizado. Escribime lo que necesites.')
      return
    }
    if (text.startsWith('/start') || text.startsWith('/help')) {
      await this.sendText(chatId, `Hola. Este bot no está autorizado para tu cuenta (id ${userId}).\n\nSi sos el dueño, enviá /pair <código>; el código está en ~/.dsh/whale-maid.pairing.txt.`)
    }
  }

  async command(chatId, userId, text) {
    const command = text.split(/\s+/)[0].toLowerCase()
    const persona = this.config.personaName || 'Whale-chan'
    if (command === '/start' || command === '/help') {
      await this.sendText(chatId, [
        `Soy ${persona} 🐋, la misma de la interfaz, ahora en Telegram.`,
        'Cada mensaje corre en la sesión compartida de DeepSeek Harness, con herramientas.',
        '',
        '/new — empezar una sesión nueva (compartida)',
        '/status — sesión, carpeta y permisos',
        '/memory — lo que recuerdo de vos',
        '/models — modelos disponibles',
        '/model <provider>/<model> — cambiar el modelo',
        '/stop — cortar el turno en curso',
        '/help — esta ayuda',
      ].join('\n'))
      return true
    }
    if (command === '/new') {
      this.state.sharedSession = `whale-maid-${Date.now().toString(36)}`
      this.save()
      await this.sendText(chatId, 'Sesión nueva (compartida con la mascota). Contame qué hacemos.')
      return true
    }
    if (command === '/status') {
      const sessionId = this.state.sharedSession ?? '(todavía sin sesión)'
      await this.sendText(chatId, [
        `sesión: ${sessionId}`,
        `carpeta: ${this.config.cwd}`,
        `permisos: ${this.config.permissionPreset}`,
        `autorizados: ${this.allowed.size}`,
        `modelo: ${this.config.model ? `${this.config.model.provider}/${this.config.model.model}` : 'el del perfil'}`,
      ].join('\n'))
      return true
    }
    if (command === '/models') {
      try {
        const catalog = await this.scope.sessionController.modelCatalog()
        const lines = []
        if (catalog?.default) lines.unshift(`Actual por defecto: ${catalog.default.provider}/${catalog.default.model}`)
        for (const group of Array.isArray(catalog?.groups) ? catalog.groups : []) {
          const models = Array.isArray(group?.models) ? group.models.map(item => item?.id).filter(Boolean) : []
          if (models.length > 0) lines.push(`${group.name ?? group.id}: ${models.join(', ')}`)
        }
        lines.push('Cambiar con /model <provider>/<model>')
        await this.sendText(chatId, lines.join('\n') || 'No hay modelos disponibles.')
      } catch (error) {
        await this.sendText(chatId, `No pude leer el catálogo: ${error?.message ?? error}`)
      }
      return true
    }
    if (command === '/model') {
      const sessionId = this.state.sharedSession
      const arg = text.split(/\s+/)[1] ?? ''
      const slash = arg.indexOf('/')
      if (!sessionId) {
        await this.sendText(chatId, 'Todavía no hay sesión: mandame un mensaje primero.')
        return true
      }
      if (slash <= 0 || slash === arg.length - 1) {
        await this.sendText(chatId, 'Uso: /model <provider>/<model> — mirá /models.')
        return true
      }
      try {
        const provider = arg.slice(0, slash)
        const model = arg.slice(slash + 1)
        const result = await this.scope.sessionController.selectModel({ sessionId, provider, model })
        await this.sendText(chatId, `Modelo de esta sesión: ${result?.selected?.provider ?? provider}/${result?.selected?.model ?? model}`)
      } catch (error) {
        await this.sendText(chatId, `No pude cambiar el modelo: ${error?.message ?? error}`)
      }
      return true
    }
    if (command === '/stop') {
      const sessionId = this.state.sharedSession
      if (!sessionId) {
        await this.sendText(chatId, 'No hay sesión activa.')
        return true
      }
      try {
        this.scope.sessionController.cancel({ sessionId })
        await this.sendText(chatId, 'Pedí que corte el turno en curso.')
      } catch (error) {
        await this.sendText(chatId, `No pude cortar: ${error?.message ?? error}`)
      }
      return true
    }
    if (command === '/pair') {
      await this.sendText(chatId, `Ya estás autorizado (id ${userId}).`)
      return true
    }
    return false
  }

  async contentOf(message) {
    const caption = typeof message.caption === 'string' ? message.caption.trim() : ''
    const parts = []
    const media = Array.isArray(message.photo) && message.photo.length > 0
      ? message.photo[message.photo.length - 1]
      : (message.document && typeof message.document.mime_type === 'string' && message.document.mime_type.startsWith('image/')
        ? { file_id: message.document.file_id, file_size: message.document.file_size }
        : null)

    if (media) {
      try {
        if (typeof media.file_size === 'number' && media.file_size > this.config.maxPhotoBytes) {
          return { ok: false, reason: 'La imagen es demasiado grande.' }
        }
        const file = await this.bot.getFile(media.file_id)
        const buffer = await this.bot.downloadFile(file.file_path)
        const dir = join(this.config.cwd, '.whale-inbox')
        mkdirSync(dir, { recursive: true })
        const target = join(dir, `photo-${message.message_id ?? Date.now()}.jpg`)
        writeFileSync(target, buffer)
        parts.push({ type: 'image', mediaType: 'image/jpeg', data: buffer.toString('base64'), name: `${message.message_id ?? Date.now()}.jpg` })
        parts.push({ type: 'text', text: (caption === '' ? '' : `${caption}\n`) + `[Imagen recibida por Telegram; copia local: ${target}]` })
        return { ok: true, parts }
      } catch (error) {
        return { ok: false, reason: `No pude descargar la imagen: ${error?.message ?? error}` }
      }
    }
    if (message.voice || message.audio || message.video || message.video_note) {
      return { ok: false, reason: 'Todavía no proceso audios ni videos; mandame texto o una foto.' }
    }
    if (typeof message.text === 'string' && message.text.trim() !== '') return { ok: true, parts: [{ type: 'text', text: message.text.trim() }] }
    if (caption !== '') return { ok: true, parts: [{ type: 'text', text: caption }] }
    return { ok: false, reason: 'No entendí ese mensaje.' }
  }

  enqueue(chatId, task) {
    const key = String(chatId)
    const previous = this.chains.get(key) ?? Promise.resolve()
    let next
    next = previous
      .then(task)
      .catch(error => this.warn(`turno: ${error?.message ?? error}`))
      .finally(() => {
        if (this.chains.get(key) === next) this.chains.delete(key)
      })
    this.chains.set(key, next)
  }

  startTyping(chatId) {
    const key = String(chatId)
    this.bot.sendChatAction(chatId, 'typing').catch(() => undefined)
    const timer = setInterval(() => {
      this.bot.sendChatAction(chatId, 'typing').catch(() => undefined)
    }, 4500)
    this.typingTimers.set(key, timer)
    return () => {
      clearInterval(timer)
      this.typingTimers.delete(key)
    }
  }

  async runTurn(chatId, parts) {
    // The typing indicator is lazy on purpose: a turn whose only output is the
    // silence convention ("SKIP") must leave no trace, so it starts with the
    // first real text (or right before the fallback message).
    let stopTyping = null
    const ensureTyping = () => {
      if (!stopTyping) stopTyping = this.startTyping(chatId)
      return stopTyping
    }
    try {
      const { sessionId } = await ensureSession(this.scope)
      const stream = this.startStream(chatId, sessionId, ensureTyping)
      const result = await askSession(this.scope, parts)
      const finalText = String(result?.text ?? '')
      const shown = await stream.finish(finalText)
      // Silence: nothing sent, no fallback placeholder, no typing left behind.
      if (shown.silent || isSilentReply(finalText)) return
      if (!shown.sent) {
        ensureTyping()
        await this.sendText(chatId, finalText === '' ? 'Listo, pero no hubo texto de respuesta.' : finalText)
      }
    } catch (error) {
      ensureTyping()
      await this.sendText(chatId, `Error: ${error?.message ?? error}`)
    } finally {
      if (stopTyping) stopTyping()
    }
  }

  /** Streams assistant text deltas into one Telegram message, so the reply grows live. */
  startStream(chatId, sessionId, onActivity) {
    if (!this.config.streamReplies) return { finish: async () => ({ sent: false, silent: false }) }
    let text = ''
    let messageId = null
    let lastEdit = 0
    let editing = Promise.resolve()
    let off = null

    const flush = () => {
      const body = text.trim()
      if (body === '') return Promise.resolve()
      // Hold back partial silent replies: the final text may still be "SKIP",
      // and streaming it live would send it before finish() can decide.
      if (isSilentReply(body) || couldBecomeSilentReply(body)) return Promise.resolve()
      const now = Date.now()
      if (now - lastEdit < 1100 && lastEdit !== 0) return Promise.resolve()
      lastEdit = now
      const slice = body.length > this.config.maxReplyChars ? body.slice(0, this.config.maxReplyChars) : body
      editing = editing.then(async () => {
        try {
          if (typeof onActivity === 'function') onActivity()
          if (messageId === null) {
            const sent = await this.bot.sendMessage(chatId, slice, { disable_web_page_preview: true })
            messageId = sent?.message_id ?? null
          } else {
            await this.bot.editMessageText(chatId, messageId, slice, { disable_web_page_preview: true })
          }
        } catch {
          /* cosmetic: the final send still happens */
        }
      })
      return editing
    }

    try {
      off = this.scope.on('agent/assistant-stream', ({ agent, frame }) => {
        try {
          if (String(agent?.id) !== String(sessionId)) return
          if (frame?.type !== 'chunk') return
          const chunk = frame.chunk
          if (!chunk || chunk.type !== 'text-delta' || typeof chunk.text !== 'string') return
          text += chunk.text
          void flush()
        } catch {
          /* a malformed frame must not break the chat */
        }
      })
    } catch {
      off = null
    }

    return {
      finish: async (finalText) => {
        try {
          if (typeof off === 'function') off()
        } catch {
          /* already released */
        }
        const final = String(finalText ?? '')
        if (text.trim() === '' && final !== '') text = final
        lastEdit = 0
        // The final text is authoritative: if it is exactly SKIP, do not flush
        // whatever was buffered and report the turn as silent.
        if (isSilentReply(final !== '' ? final : text)) {
          await editing
          return { sent: messageId !== null, silent: true }
        }
        await flush()
        await editing
        return { sent: messageId !== null, silent: false }
      },
    }
  }

  async sendText(chatId, text) {
    // Defense in depth: even a caller that forgets to check gets silence.
    if (isSilentReply(text)) return
    for (const chunk of chunkText(text, this.config.maxReplyChars)) {
      try {
        await this.bot.sendMessage(chatId, chunk, { disable_web_page_preview: true })
      } catch (error) {
        this.warn(`envío: ${error?.message ?? error}`)
        return
      }
    }
  }

  /** Upload a local image as an inline Telegram photo (for screenshots). */
  async sendPhoto(chatId, imagePath, caption = '') {
    if (!this.bot) return { sent: null, mirror: { ok: false, error: 'telegram offline' } }
    let sent
    try {
      sent = await this.bot.sendPhoto(chatId, imagePath, { caption })
    } catch (error) {
      this.warn(`foto: ${error?.message ?? error}`)
      // Fallback: at least tell the owner the file exists and where it is.
      await this.sendText(chatId, `No pude subir la imagen: ${error?.message ?? error}\nArchivo: ${imagePath}`)
      throw error
    }
    // Local mirror only (path + metadata, never base64): the shared history
    // route merges it so both local surfaces show the photo too. Nothing here
    // re-sends to Telegram.
    const mirror = recordOutboxImage({
      path: imagePath,
      caption,
      chatId,
      messageId: sent?.message_id ?? null,
      source: 'telegram_photo',
    })
    if (!mirror.ok) this.warn(`espejo local de la foto: ${mirror.error}`)
    return { sent, mirror }
  }
}

export function apply(ctx, config = {}) {
  try {
    ctx.inject(['sessionController'], scope => {
      let bridge
      try {
        bridge = new WhaleTelegram(scope, config)
      } catch (error) {
        ctx.logger.warn('whale-maid-telegram: no pude inicializar: %s', String(error))
        return
      }
      ctx.effect(() => {
        let stop = () => {}
        try {
          stop = bridge.start()
        } catch (error) {
          ctx.logger.warn('whale-maid-telegram: no pude arrancar: %s', String(error))
        }
        return () => {
          try {
            stop()
          } catch {
            /* teardown is best effort */
          }
        }
      })
    })
  } catch (error) {
    ctx.logger.warn('whale-maid-telegram: no pude montar el plugin: %s', String(error))
  }
}
