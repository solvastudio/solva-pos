import { afterEach, describe, expect, it } from 'vitest'
import { resetEnvForTests } from '~/server/env'
import { checkSameOrigin, getTrustedOrigins } from './origin-check'

const SAVED_APP_ENV = process.env.APP_ENV
const SAVED_PUBLIC_BASE_URL = process.env.PUBLIC_BASE_URL
const SAVED_TRUSTED_PROXY_CIDR = process.env.TRUSTED_PROXY_CIDR

function restoreEnv(): void {
  if (SAVED_APP_ENV === undefined) delete process.env.APP_ENV
  else process.env.APP_ENV = SAVED_APP_ENV
  if (SAVED_PUBLIC_BASE_URL === undefined) delete process.env.PUBLIC_BASE_URL
  else process.env.PUBLIC_BASE_URL = SAVED_PUBLIC_BASE_URL
  if (SAVED_TRUSTED_PROXY_CIDR === undefined) delete process.env.TRUSTED_PROXY_CIDR
  else process.env.TRUSTED_PROXY_CIDR = SAVED_TRUSTED_PROXY_CIDR
  resetEnvForTests()
}

describe('checkSameOrigin & getTrustedOrigins', () => {
  afterEach(() => {
    restoreEnv()
  })

  it('allows safe methods without origin checks', () => {
    process.env.APP_ENV = 'development'
    resetEnvForTests()

    const req = new Request('http://localhost:3000/acme/admin/api/auth/get-session', {
      method: 'GET',
      headers: { Origin: 'https://evil.example' },
    })
    expect(checkSameOrigin(req)).toEqual({ ok: true })
  })

  it('allows matching PUBLIC_BASE_URL / Host in development and ignores spoofed X-Forwarded-Host', () => {
    process.env.APP_ENV = 'development'
    process.env.PUBLIC_BASE_URL = 'http://localhost:3000'
    resetEnvForTests()

    const valid = new Request('http://127.0.0.1:3000/acme/admin/api/auth/sign-in/email', {
      method: 'POST',
      headers: {
        Host: 'localhost:4000',
        Origin: 'http://localhost:4000',
      },
    })
    expect(checkSameOrigin(valid)).toEqual({ ok: true })

    // Spoofed X-Forwarded-Host must NEVER be trusted even in development.
    const spoofedXfh = new Request('http://127.0.0.1:3000/acme/admin/api/auth/sign-in/email', {
      method: 'POST',
      headers: {
        Host: 'localhost:3000',
        'X-Forwarded-Host': 'evil.example',
        'X-Forwarded-Proto': 'https',
        Origin: 'https://evil.example',
      },
    })
    expect(checkSameOrigin(spoofedXfh).ok).toBe(false)
  })

  it('rejects null Origin and cross-site Sec-Fetch-Site headers', () => {
    process.env.APP_ENV = 'development'
    resetEnvForTests()

    const nullOrigin = new Request('http://localhost:3000/acme/admin/api/auth/sign-out', {
      method: 'POST',
      headers: { Origin: 'null' },
    })
    expect(checkSameOrigin(nullOrigin).ok).toBe(false)

    const crossSite = new Request('http://localhost:3000/acme/admin/api/auth/sign-out', {
      method: 'POST',
      headers: { 'Sec-Fetch-Site': 'cross-site' },
    })
    expect(checkSameOrigin(crossSite).ok).toBe(false)
  })

  it('strictly trusts ONLY PUBLIC_BASE_URL in production and staging (ignores Host and X-Forwarded-Host)', () => {
    process.env.APP_ENV = 'production'
    process.env.TRUSTED_PROXY_CIDR = '172.16.0.0/12'
    process.env.PUBLIC_BASE_URL = 'https://pos.example.id/subpath-ignored'
    resetEnvForTests()

    const allowed = new Request('http://127.0.0.1:3000/acme/admin/api/auth/sign-in/email', {
      method: 'POST',
      headers: {
        Host: 'evil.example',
        'X-Forwarded-Host': 'evil.example',
        'X-Forwarded-Proto': 'http',
        Origin: 'https://pos.example.id',
      },
    })
    expect(getTrustedOrigins(allowed)).toEqual(['https://pos.example.id'])
    expect(checkSameOrigin(allowed)).toEqual({ ok: true })

    // Spoofed Host or X-Forwarded-Host with matching Origin must be REJECTED in staging/production.
    const spoofedHost = new Request('http://127.0.0.1:3000/acme/admin/api/auth/sign-in/email', {
      method: 'POST',
      headers: {
        Host: 'attacker.example',
        'X-Forwarded-Host': 'attacker.example',
        'X-Forwarded-Proto': 'https',
        Origin: 'https://attacker.example',
      },
    })
    expect(checkSameOrigin(spoofedHost).ok).toBe(false)
  })

  it('fails closed in production/staging if PUBLIC_BASE_URL is missing', () => {
    process.env.APP_ENV = 'staging'
    process.env.TRUSTED_PROXY_CIDR = '127.0.0.0/8'
    delete process.env.PUBLIC_BASE_URL
    resetEnvForTests()

    const req = new Request('http://127.0.0.1:3000/platform/api/auth/login', {
      method: 'POST',
      headers: { Origin: 'http://localhost:3000' },
    })
    expect(() => getTrustedOrigins(req)).toThrowError(/PUBLIC_BASE_URL/)
    expect(() => checkSameOrigin(req)).toThrowError(/PUBLIC_BASE_URL/)
  })
})
