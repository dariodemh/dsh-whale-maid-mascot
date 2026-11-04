/** Minimal Telegram Bot API client (long polling), no dependencies. */
const API = 'https://api.telegram.org'

export class TelegramError extends Error {
  constructor(method, description, status) {
    super(`${method}: ${description}`)
    this.name = 'TelegramError'
    this.method = method
    this.status = status
  }
}

export class TelegramBot {
  constructor(token, fetchImpl = globalThis.fetch) {
    if (typeof token !== 'string' || token.trim() === '') throw new Error('empty Telegram bot token')
    this.token = token.trim()
    this.fetch = fetchImpl
  }

  async call(method, body, options = {}) {
    const response = await this.fetch(`${API}/bot${this.token}/${method}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body ?? {}),
      signal: options.signal ?? AbortSignal.timeout(120_000),
    })
    let payload
    try {
      payload = await response.json()
    } catch {
      throw new TelegramError(method, `HTTP ${response.status}`, response.status)
    }
    if (!payload || payload.ok !== true) throw new TelegramError(method, payload?.description ?? `HTTP ${response.status}`, response.status)
    return payload.result
  }

  getUpdates(offset, timeoutSeconds, signal) {
    return this.call('getUpdates', { offset, timeout: timeoutSeconds, allowed_updates: ['message'] }, { signal })
  }

  sendMessage(chatId, text, extra = {}) {
    return this.call('sendMessage', { chat_id: chatId, text, ...extra })
  }

  editMessageText(chatId, messageId, text, extra = {}) {
    return this.call('editMessageText', { chat_id: chatId, message_id: messageId, text, ...extra })
  }

  sendChatAction(chatId, action = 'typing') {
    return this.call('sendChatAction', { chat_id: chatId, action }).catch(() => undefined)
  }

  getFile(fileId) {
    return this.call('getFile', { file_id: fileId })
  }

  async downloadFile(filePath, signal) {
    const response = await this.fetch(`${API}/file/bot${this.token}/${filePath}`, { signal })
    if (!response.ok) throw new Error(`telegram download failed: HTTP ${response.status}`)
    return Buffer.from(await response.arrayBuffer())
  }
}
