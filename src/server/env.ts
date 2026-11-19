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
  TRUSTED_PROXY_CIDR: optionalNonEmpty,
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
    throw new Error('Invalid environment configuration: LOG_LEVEL debug/trace is forbidden when APP_ENV=production')
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

export function resetEnvForTests(): void {
  cachedEnv = null
}
