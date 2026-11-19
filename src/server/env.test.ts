import { describe, expect, it } from 'vitest'
import { parseEnv } from './env'

describe('server/env', () => {
  it('menolak saat APP_ENV tidak diisi dan menyebut nama kunci saja', () => {
    expect(() => parseEnv({})).toThrowError(/APP_ENV/)
  })

  it('menolak LOG_LEVEL debug/trace ketika APP_ENV=production', () => {
    expect(() => parseEnv({ APP_ENV: 'production', LOG_LEVEL: 'debug' })).toThrowError(/LOG_LEVEL/)
    expect(() => parseEnv({ APP_ENV: 'production', LOG_LEVEL: 'trace' })).toThrowError(/LOG_LEVEL/)
  })

  it('menerima konfigurasi sah dengan bawaan yang diharapkan', () => {
    const dev = parseEnv({ APP_ENV: 'development' })
    expect(dev).toEqual({
      APP_ENV: 'development',
      LOG_LEVEL: 'info',
      LOG_DIR: './logs',
      LOG_RETENTION_DAYS: 30,
      DATABASE_URL: undefined,
      DATABASE_OWNER_URL: undefined,
      BETTER_AUTH_SECRET: undefined,
      TRUSTED_PROXY_CIDR: undefined,
    })

    const prod = parseEnv({
      APP_ENV: 'production',
      LOG_LEVEL: 'warn',
      LOG_DIR: '/var/log/solva',
      LOG_RETENTION_DAYS: '90',
      DATABASE_URL: 'postgres://app:pw@db:5432/solva',
    })
    expect(prod.LOG_RETENTION_DAYS).toBe(90)
    expect(prod.LOG_LEVEL).toBe('warn')
  })

  it('tidak pernah membocorkan nilai rahasia pada pesan galat validasi', () => {
    let errMsg = ''
    try {
      parseEnv({
        APP_ENV: 'development',
        DATABASE_URL: 'http://u:SECRET_RAHASIA_99@h/d',
        LOG_RETENTION_DAYS: 'SECRET_BukanAngka',
      })
    } catch (err) {
      errMsg = err instanceof Error ? err.message : String(err)
    }
    expect(errMsg).toContain('DATABASE_URL')
    expect(errMsg).toContain('LOG_RETENTION_DAYS')
    expect(errMsg).not.toContain('SECRET')
  })
})
