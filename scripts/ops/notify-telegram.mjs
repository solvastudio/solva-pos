import { parseArgs } from 'node:util'

async function main() {
  const { values } = parseArgs({
    options: {
      kind: { type: 'string', default: 'health_failed' },
      version: { type: 'string', default: process.env.APP_VERSION || 'unknown' },
      env: { type: 'string', default: process.env.APP_ENV || 'unknown' },
      code: { type: 'string' },
      ref: { type: 'string' },
    },
    allowPositionals: true,
  })

  const token = process.env.TELEGRAM_BOT_TOKEN
  const chatId = process.env.TELEGRAM_CHAT_ID
  if (!token || !chatId) {
    process.stdout.write('Telegram notifications disabled (missing bot token or chat id)\n')
    return
  }

  const parts = [
    `[Solva POS Alert] ${values.kind}`,
    `env=${values.env}`,
    `version=${values.version}`,
    `time=${new Date().toISOString()}`,
  ]
  if (values.code) parts.push(`code=${values.code}`)
  if (values.ref) parts.push(`ref=${values.ref}`)

  await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      chat_id: chatId,
      text: parts.join(' | '),
    }),
    signal: AbortSignal.timeout(3_000),
  })
}

main()
  .catch(() => undefined)
  .finally(() => {
    process.exitCode = 0
  })
