import '@tanstack/react-start/server-only'
import { z } from 'zod'

const ENV_MODES = ['development', 'staging', 'production'] as const
const LOG_LEVELS = ['trace', 'debug', 'info', 'warn', 'error', 'fatal', 'silent'] as const

const optionalUrlSchema = z.preprocess(
  (v) => (v === '' ? undefined : v),
  z
    .string()
    .regex(/^postgres(?:ql)?:\/\/.+/)
    .optional(),
)

const optionalNonEmpty = z.preprocess(
  (v) => (v === '' ? undefined : v),
  z.string().min(1).optional(),
)

function positiveIntEnv(defaultValue: number) {
  return z.preprocess(
    (v) => (v === '' || v === undefined ? undefined : v),
    z.coerce.number().int().min(1).default(defaultValue),
  )
}

const scheduleCsvSchema = z.preprocess(
  (v) => (v === '' || v === undefined ? undefined : v),
  z
    .string()
    .regex(/^\d+(?:,\d+)*$/)
    .default('0,0,0,30,60,120,300,900'),
)

export const envSchema = z.object({
  APP_ENV: z.enum(ENV_MODES),
  LOG_LEVEL: z.preprocess((v) => (v === '' ? undefined : v), z.enum(LOG_LEVELS).default('info')),
  LOG_DIR: z.preprocess((v) => (v === '' ? undefined : v), z.string().min(1).default('./logs')),
  LOG_RETENTION_DAYS: z.preprocess(
    (v) => (v === '' || v === undefined ? undefined : v),
    z.coerce.number().int().min(1).max(3650).default(30),
  ),
  DATABASE_URL: optionalUrlSchema,
  DATABASE_OWNER_URL: optionalUrlSchema,
  BETTER_AUTH_SECRET: optionalNonEmpty,
  SYNC_TOKEN_SECRET: optionalNonEmpty,
  AUTH_COOKIE_SECURE: z.preprocess(
    (v) =>
      v === '' || v === undefined
        ? undefined
        : v === 'true' || v === true
          ? true
          : v === 'false' || v === false
            ? false
            : v,
    z.boolean().optional(),
  ),
  TRUSTED_PROXY_CIDR: optionalNonEmpty,
  PUBLIC_BASE_URL: z.preprocess(
    (v) => (v === '' ? undefined : v),
    z.string().url().optional(),
  ),
  SOURCEMAP_DIR: z.preprocess(
    (v) => (v === '' || v === undefined ? undefined : v),
    z.string().min(1).default('./sourcemaps'),
  ),
  TELEGRAM_BOT_TOKEN: optionalNonEmpty,
  TELEGRAM_CHAT_ID: optionalNonEmpty,

  RL_LOGIN_SCHEDULE_SEC: scheduleCsvSchema,
  RL_LOGIN_RESET_AFTER_SEC: positiveIntEnv(900),
  RL_LOGIN_SLUG_ALERT_THRESHOLD: positiveIntEnv(100),
  RL_LOGIN_SLUG_ALERT_WINDOW_SEC: positiveIntEnv(900),
  RL_LOGIN_SLUG_TARPIT_MS: positiveIntEnv(2000),
  RL_LOGIN_IPSLUG_POINTS: positiveIntEnv(100),
  RL_LOGIN_IPSLUG_WINDOW_SEC: positiveIntEnv(900),
  RL_LOGIN_IPSLUG_BLOCK_SEC: positiveIntEnv(900),
  RL_LOGIN_KEY_MAX: positiveIntEnv(10000),
  RL_ENROLL_IP_POINTS: positiveIntEnv(10),
  RL_ENROLL_IP_WINDOW_SEC: positiveIntEnv(300),
  RL_ENROLL_SLUG_POINTS: positiveIntEnv(30),
  RL_ENROLL_SLUG_WINDOW_SEC: positiveIntEnv(300),
  RL_REDEEM_EMAIL_POINTS: positiveIntEnv(5),
  RL_REDEEM_EMAIL_WINDOW_SEC: positiveIntEnv(900),
  RL_REDEEM_SLUG_POINTS: positiveIntEnv(30),
  RL_REDEEM_SLUG_WINDOW_SEC: positiveIntEnv(300),
  RL_REDEEM_IPSLUG_POINTS: positiveIntEnv(10),
  RL_REDEEM_IPSLUG_WINDOW_SEC: positiveIntEnv(300),
  RL_ISSUE_TENANT_PER_HOUR: positiveIntEnv(20),
  RL_ISSUE_EMAIL_PER_HOUR: positiveIntEnv(5),
  RL_SLUG_PROBE_POINTS: positiveIntEnv(60),
  RL_SLUG_PROBE_WINDOW_SEC: positiveIntEnv(300),
  RL_BAD_CREDENTIAL_IP_POINTS: positiveIntEnv(30),
  RL_BAD_CREDENTIAL_IP_WINDOW_SEC: positiveIntEnv(300),
  RL_DEVICE_PUSH_PER_MIN: positiveIntEnv(60),
  RL_DEVICE_PULL_PER_MIN: positiveIntEnv(30),
  RL_DEVICE_PING_PER_MIN: positiveIntEnv(30),
  RL_DEVICE_HANDOVER_PER_MIN: positiveIntEnv(30),
  RL_DEVICE_LOG_PER_10MIN: positiveIntEnv(20),
  RL_FULL_RESYNC_PER_HOUR: positiveIntEnv(1),
  RL_PUSH_CONCURRENCY: positiveIntEnv(8),
  RL_REPORT_CONCURRENCY_PER_TENANT: positiveIntEnv(2),
  SYNC_PUSH_MAX_FAILURE_ATTEMPTS: positiveIntEnv(10),
})

export type AppEnv = z.infer<typeof envSchema>

export function parseEnv(rawEnv: Record<string, string | undefined>): AppEnv {
  const parsed = envSchema.safeParse(rawEnv)
  if (!parsed.success) {
    // Report only the KEY NAMES that failed validation; secret values are never included.
    const keys = Array.from(
      new Set(parsed.error.issues.map((issue) => issue.path.join('.') || 'ENV')),
    )
    throw new Error(`Invalid environment configuration for keys: ${keys.join(', ')}`)
  }

  if (
    parsed.data.APP_ENV === 'production' &&
    (parsed.data.LOG_LEVEL === 'debug' || parsed.data.LOG_LEVEL === 'trace')
  ) {
    throw new Error(
      'Invalid environment configuration: LOG_LEVEL debug/trace is forbidden when APP_ENV=production',
    )
  }

  if (
    (parsed.data.APP_ENV === 'staging' || parsed.data.APP_ENV === 'production') &&
    !parsed.data.TRUSTED_PROXY_CIDR
  ) {
    throw new Error(
      'Invalid environment configuration: TRUSTED_PROXY_CIDR is required in staging and production',
    )
  }

  return parsed.data
}

let cachedEnv: AppEnv | null = null

export function getEnv(): AppEnv {
  if (!cachedEnv) {
    cachedEnv = parseEnv(process.env)
  }
  return cachedEnv
}

export function requireDbEnv(): { DATABASE_URL: string; DATABASE_OWNER_URL?: string } {
  const env = getEnv()
  if (!env.DATABASE_URL) {
    throw new Error('Missing required environment variable: DATABASE_URL')
  }
  return {
    DATABASE_URL: env.DATABASE_URL,
    ...(env.DATABASE_OWNER_URL ? { DATABASE_OWNER_URL: env.DATABASE_OWNER_URL } : {}),
  }
}

export function requireAuthEnv(): {
  BETTER_AUTH_SECRET: string
  AUTH_COOKIE_SECURE: boolean
} {
  const env = getEnv()
  if (!env.BETTER_AUTH_SECRET || env.BETTER_AUTH_SECRET.length < 32) {
    throw new Error('Missing or weak BETTER_AUTH_SECRET: must be set to at least 32 characters')
  }
  const secure =
    env.AUTH_COOKIE_SECURE !== undefined
      ? env.AUTH_COOKIE_SECURE
      : env.APP_ENV === 'production' || env.APP_ENV === 'staging'
  return {
    BETTER_AUTH_SECRET: env.BETTER_AUTH_SECRET,
    AUTH_COOKIE_SECURE: secure,
  }
}

export function getPublicBaseUrl(): string {
  const configured = getEnv().PUBLIC_BASE_URL
  return (configured ?? 'http://localhost:3000').replace(/\/+$/, '')
}

export function getSyncPushMaxFailureAttempts(): number {
  return getEnv().SYNC_PUSH_MAX_FAILURE_ATTEMPTS
}

export function getSyncTokenSecret(): string {
  const env = getEnv()
  if (env.SYNC_TOKEN_SECRET) {
    return env.SYNC_TOKEN_SECRET
  }
  if (env.BETTER_AUTH_SECRET && env.BETTER_AUTH_SECRET.length >= 32) {
    return env.BETTER_AUTH_SECRET
  }
  throw new Error('Missing SYNC_TOKEN_SECRET or BETTER_AUTH_SECRET for snapshot signing')
}

export function resetEnvForTests(): void {
  cachedEnv = null
}
