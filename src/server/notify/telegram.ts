import '@tanstack/react-start/server-only'

export interface SendTelegramDeps {
  token: string
  chatId: string
  fetch?: typeof globalThis.fetch
  timeoutMs?: number
}

/**
 * Posts a plain text operational alert to Telegram Bot API with a strict timeout.
 * Never throws and never serializes or logs the bot token.
 */
export async function sendTelegram(text: string, deps: SendTelegramDeps): Promise<boolean> {
  const fetchImpl = deps.fetch ?? globalThis.fetch
  const timeoutMs = deps.timeoutMs ?? 3_000
  const url = `https://api.telegram.org/bot${deps.token}/sendMessage`

  try {
    const res = await fetchImpl(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        chat_id: deps.chatId,
        text,
      }),
      signal: AbortSignal.timeout(timeoutMs),
    })
    return res.ok
  } catch {
    return false
  }
}
