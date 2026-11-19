import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { envSchema, parseEnv } from './env'
import { RATE_LIMIT_ENV_KEYS, getRateLimitConfig } from './rate-limit-config'

describe('rate-limit-config and RL_* schema parity', () => {
  it('matches the exact RL_* key set in envSchema and .env.example', () => {
    const schemaRlKeys = Object.keys(envSchema.shape)
      .filter((k) => k.startsWith('RL_'))
      .sort()
    const configRlKeys = [...RATE_LIMIT_ENV_KEYS].sort()

    const envExamplePath = resolve(import.meta.dirname, '../../.env.example')
    const envExampleLines = readFileSync(envExamplePath, 'utf8')
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter((line) => line.length > 0 && !line.startsWith('#'))
      .map((line) => line.split('=')[0]!.trim())
      .filter((k) => k.startsWith('RL_'))
      .sort()

    expect(configRlKeys).toEqual(schemaRlKeys)
    expect(envExampleLines).toEqual(schemaRlKeys)
  })

  it('rejects non-positive RL_* values', () => {
    expect(() => parseEnv({ APP_ENV: 'development', RL_LOGIN_KEY_MAX: '0' })).toThrowError(
      /RL_LOGIN_KEY_MAX/,
    )
    expect(() =>
      parseEnv({ APP_ENV: 'development', RL_LOGIN_SCHEDULE_SEC: 'invalid' }),
    ).toThrowError(/RL_LOGIN_SCHEDULE_SEC/)
  })

  it('parses default schedule and proxy CIDR list from env', () => {
    const prevAppEnv = process.env.APP_ENV
    const prevCidr = process.env.TRUSTED_PROXY_CIDR
    process.env.APP_ENV = 'development'
    process.env.TRUSTED_PROXY_CIDR = '172.16.0.0/12, 10.0.0.0/8'
    try {
      const cfg = getRateLimitConfig()
      expect(cfg.loginScheduleMs).toEqual([0, 0, 0, 30_000, 60_000, 120_000, 300_000, 900_000])
      expect(cfg.trustedProxyCidrs).toEqual(['172.16.0.0/12', '10.0.0.0/8'])
      expect(cfg.pushConcurrency).toBe(8)
    } finally {
      process.env.APP_ENV = prevAppEnv
      if (prevCidr === undefined) {
        delete process.env.TRUSTED_PROXY_CIDR
      } else {
        process.env.TRUSTED_PROXY_CIDR = prevCidr
      }
    }
  })
})
