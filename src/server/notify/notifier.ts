import '@tanstack/react-start/server-only'
import { APP_VERSION } from '~/lib/app-version'
import { getEnv } from '../env'
import { createLogger } from '../log'
import { sendTelegram } from './telegram'

const log = createLogger('notify')

export type NotifyKind = 'fatal' | 'error_spike' | 'health_failed'

export interface NotifyInfo {
  code?: string
  ref?: string
  count?: number
}

export interface NotifierOptions {
  now?: () => number
  send?: (text: string) => Promise<boolean>
  enabled?: boolean
  appVersion?: string
  env?: string
  warnOnce?: (msg: string) => void
}

export interface Notifier {
  readonly enabled: boolean
  notify(kind: NotifyKind, info?: NotifyInfo): void
  notifyImmediate(kind: NotifyKind, info?: NotifyInfo): Promise<boolean>
  flushForTests(): Promise<void>
}

const TEN_MINUTES_MS = 10 * 60_000
const ONE_HOUR_MS = 60 * 60_000
const CIRCUIT_OPEN_MS = 5 * 60_000
const CIRCUIT_FAILURE_THRESHOLD = 5
const MAX_MESSAGES_PER_HOUR = 20

export function formatTelegramAlert(
  kind: NotifyKind,
  info: NotifyInfo,
  meta: { appVersion: string; env: string; timeIso: string; suppressedEvents: number },
): string {
  const parts = [
    `[Solva POS Alert] ${kind}`,
    `env=${meta.env}`,
    `version=${meta.appVersion}`,
    `time=${meta.timeIso}`,
  ]
  if (info.code) parts.push(`code=${info.code}`)
  if (info.ref) parts.push(`ref=${info.ref}`)
  if (info.count !== undefined) parts.push(`count=${info.count}`)
  if (meta.suppressedEvents > 0) parts.push(`+${meta.suppressedEvents} suppressed events`)
  return parts.join(' | ')
}

export function createNotifier(opts: NotifierOptions = {}): Notifier {
  const now = opts.now ?? (() => Date.now())
  const appVersion = opts.appVersion ?? APP_VERSION
  const env = opts.env ?? process.env.APP_ENV ?? 'development'
  const enabled = opts.enabled ?? Boolean(opts.send)
  const warnOnce = opts.warnOnce ?? ((msg: string) => log.warn({ scope: 'notify' }, msg))

  let warnedDisabled = false
  let consecutiveFailures = 0
  let circuitOpenUntil = 0
  let hourlyTimestamps: number[] = []
  const lastKindSentAt = new Map<NotifyKind, number>()
  const lastFingerprintAt = new Map<string, number>()
  const suppressedCounts = new Map<NotifyKind, number>()
  const pendingPromises = new Set<Promise<unknown>>()

  async function dispatchNow(kind: NotifyKind, info: NotifyInfo): Promise<boolean> {
    if (!enabled || !opts.send) {
      if (!warnedDisabled) {
        warnedDisabled = true
        warnOnce('Telegram notifications disabled (missing bot token or chat id)')
      }
      return false
    }

    const t = now()
    if (t < circuitOpenUntil) {
      suppressedCounts.set(kind, (suppressedCounts.get(kind) ?? 0) + 1)
      return false
    }

    hourlyTimestamps = hourlyTimestamps.filter((ts) => t - ts < ONE_HOUR_MS)
    if (hourlyTimestamps.length >= MAX_MESSAGES_PER_HOUR) {
      suppressedCounts.set(kind, (suppressedCounts.get(kind) ?? 0) + 1)
      return false
    }

    const fingerprint = `${kind}:${info.code ?? ''}`
    const lastFp = lastFingerprintAt.get(fingerprint)
    if (lastFp !== undefined && t - lastFp < TEN_MINUTES_MS) {
      suppressedCounts.set(kind, (suppressedCounts.get(kind) ?? 0) + 1)
      return false
    }

    const lastKind = lastKindSentAt.get(kind)
    if (lastKind !== undefined && t - lastKind < TEN_MINUTES_MS) {
      suppressedCounts.set(kind, (suppressedCounts.get(kind) ?? 0) + 1)
      return false
    }

    const suppressed = suppressedCounts.get(kind) ?? 0
    const text = formatTelegramAlert(kind, info, {
      appVersion,
      env,
      timeIso: new Date(t).toISOString(),
      suppressedEvents: suppressed,
    })

    let delivered: boolean
    try {
      delivered = await opts.send(text)
    } catch {
      delivered = false
    }

    if (delivered) {
      consecutiveFailures = 0
      circuitOpenUntil = 0
      hourlyTimestamps.push(t)
      lastKindSentAt.set(kind, t)
      lastFingerprintAt.set(fingerprint, t)
      suppressedCounts.set(kind, 0)
      return true
    }

    consecutiveFailures += 1
    if (consecutiveFailures >= CIRCUIT_FAILURE_THRESHOLD) {
      circuitOpenUntil = t + CIRCUIT_OPEN_MS
    }
    return false
  }

  return {
    enabled: Boolean(enabled && opts.send),
    notify(kind: NotifyKind, info: NotifyInfo = {}): void {
      queueMicrotask(() => {
        const p = dispatchNow(kind, info).finally(() => {
          pendingPromises.delete(p)
        })
        pendingPromises.add(p)
      })
    },
    async notifyImmediate(kind: NotifyKind, info: NotifyInfo = {}): Promise<boolean> {
      return dispatchNow(kind, info)
    },
    async flushForTests(): Promise<void> {
      await new Promise<void>((resolve) => queueMicrotask(resolve))
      await Promise.all([...pendingPromises])
    },
  }
}

let cachedNotifier: Notifier | null = null

export function getNotifier(): Notifier {
  if (cachedNotifier) return cachedNotifier
  let token: string | undefined
  let chatId: string | undefined
  let appEnv = process.env.APP_ENV ?? 'development'
  try {
    const env = getEnv()
    token = env.TELEGRAM_BOT_TOKEN
    chatId = env.TELEGRAM_CHAT_ID
    appEnv = env.APP_ENV
  } catch {
    token = process.env.TELEGRAM_BOT_TOKEN || undefined
    chatId = process.env.TELEGRAM_CHAT_ID || undefined
  }

  const enabled = Boolean(token && chatId)
  cachedNotifier = createNotifier({
    enabled,
    env: appEnv,
    send: enabled
      ? (text) => sendTelegram(text, { token: token!, chatId: chatId! })
      : undefined,
  })
  return cachedNotifier
}

export function __resetNotifierForTests(override?: Notifier): void {
  cachedNotifier = override ?? null
}
