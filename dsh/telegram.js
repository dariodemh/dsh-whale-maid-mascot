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
import { mkdirSync, readdirSync, statSync, writeFileSync } from 'node:fs'
import { join, relative, sep } from 'node:path'
import { randomBytes } from 'node:crypto'
import {
  chunkText,
  loadConfig,
  loadState,
  reviewSessionId,
  readMascotMemory,
  rememberInMascot,
  resolveToken,
  saveState,
} from './config.js'
import { askSession, ensureSession, sharedTranscript } from './session.js'
import { TelegramBot } from './telegram-api.js'

const SKIP_DIRS = new Set(['node_modules', '.git', '.pnpm-store', 'dist', 'build', 'coverage'])

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

class WhaleTelegram {
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
  startReview() {
    if (this.config.reviewEnabled === false) return
    const every = Math.max(60000, Number(this.config.reviewEveryMs) || 0)
    this.reviewTimer = setInterval(() => { void this.reviewTick() }, every)
    if (typeof this.reviewTimer.unref === 'function') this.reviewTimer.unref()
    this.reviewKickoff = setTimeout(() => { void this.reviewTick() }, 60 * 1000)
    if (typeof this.reviewKickoff.unref === 'function') this.reviewKickoff.unref()
    this.log(`revisión proactiva cada ${Math.round(every / 60000)} min`)
  }

  reviewPrompt(digest, files) {
    const now = new Date().toLocaleString(undefined, {
      weekday: 'long',
      hour: '2-digit',
      minute: '2-digit',
    })
    const lines = [
      `Sos ${this.config.personaName || 'Whale-chan'} en tu turno de revisión. Nadie te escribió: mirás alrededor y decidís si vale la pena escribirle un mensaje por Telegram, o quedarte callada.`,
      `Ahora es: ${now}.`,
    ]
    if (digest) lines.push('', 'Último tramo de la conversación principal:', digest)
    if (files.length > 0) lines.push('', 'Archivos tocados hace poco:', ...files.map(file => `- ${file}`))
    lines.push(
      '',
      'Podés usar tus herramientas (shell, archivos, búsqueda) si querés confirmar algo antes de escribir.',
      '',
      'Reglas:',
      '- Si no hay nada que realmente valga la pena, respondé exactamente: SKIP',
      '- Si sí, escribí solo el mensaje: 1 a 3 frases, cálido y concreto, sin explicar el mecanismo ni mencionar que revisaste nada.',
      '- No inventes datos ni recuerdos. Si no estás segura, mejor SKIP.',
      '- Nada de recordatorios genéricos del tipo "¿cómo va todo?": solo cosas que viste y que merecen su atención.',
    )
    return lines.join('\n')
  }

  async reviewTick() {
    if (this.stopped || this.reviewBusy || !this.bot) return
    const target = this.allowed.size > 0 ? String([...this.allowed][0]) : null
    if (!target) return
    const cooldown = Math.max(60000, Number(this.config.reviewCooldownMs) || 0)
    if (this.lastProactiveAt && Date.now() - this.lastProactiveAt < cooldown) return

    const digest = await sharedTranscript(this.scope, 10)
    const files = recentWorkspaceFiles(this.config.cwd, Number(this.config.reviewRecentFilesMinutes) || 30)
    const fingerprint = `${digest}\n${files.join('\n')}`
    const sinceLastReview = Date.now() - (this.lastReviewAt || 0)
    // Nothing changed and we reviewed recently: stay quiet instead of burning a turn.
    if (fingerprint === this.lastReviewFingerprint && sinceLastReview < 30 * 60 * 1000) return

    this.reviewBusy = true
    this.lastReviewAt = Date.now()
    this.lastReviewFingerprint = fingerprint
    try {
      const sessionId = reviewSessionId(this.config, this.state)
      const result = await askSession(
        this.scope,
        [{ type: 'text', text: this.reviewPrompt(digest, files) }],
        { sessionId },
      )
      const text = String(result?.text ?? '').trim()
      if (!text || /^skip\b/i.test(text)) return
      await this.sendText(target, text)
      this.lastProactiveAt = Date.now()
      this.log('revisión: le escribí')
    } catch (error) {
      this.warn(`revisión: ${error?.message ?? error}`)
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
    const stopTyping = this.startTyping(chatId)
    try {
      const { sessionId } = await ensureSession(this.scope)
      const stream = this.startStream(chatId, sessionId)
      const result = await askSession(this.scope, parts)
      const shown = await stream.finish(result.text)
      if (!shown.sent) await this.sendText(chatId, result.text === '' ? 'Listo, pero no hubo texto de respuesta.' : result.text)
    } catch (error) {
      await this.sendText(chatId, `Error: ${error?.message ?? error}`)
    } finally {
      stopTyping()
    }
  }

  /** Streams assistant text deltas into one Telegram message, so the reply grows live. */
  startStream(chatId, sessionId) {
    if (!this.config.streamReplies) return { finish: async () => ({ sent: false }) }
    let text = ''
    let messageId = null
    let lastEdit = 0
    let editing = Promise.resolve()
    let off = null

    const flush = () => {
      const body = text.trim()
      if (body === '') return Promise.resolve()
      const now = Date.now()
      if (now - lastEdit < 1100 && lastEdit !== 0) return Promise.resolve()
      lastEdit = now
      const slice = body.length > this.config.maxReplyChars ? body.slice(0, this.config.maxReplyChars) : body
      editing = editing.then(async () => {
        try {
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
        if (text.trim() === '' && typeof finalText === 'string') text = finalText
        lastEdit = 0
        await flush()
        await editing
        return { sent: messageId !== null }
      },
    }
  }

  async sendText(chatId, text) {
    for (const chunk of chunkText(text, this.config.maxReplyChars)) {
      try {
        await this.bot.sendMessage(chatId, chunk, { disable_web_page_preview: true })
      } catch (error) {
        this.warn(`envío: ${error?.message ?? error}`)
        return
      }
    }
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
