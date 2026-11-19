import { describe, expect, it } from 'vitest'
import { checkSameOrigin } from './origin-check'

describe('checkSameOrigin', () => {
  it('allows safe methods without origin checks', () => {
    const req = new Request('http://localhost:3000/acme/admin/api/auth/get-session', {
      method: 'GET',
      headers: { Origin: 'https://evil.example' },
    })
    expect(checkSameOrigin(req)).toEqual({ ok: true })
  })

  it('allows matching Origin on POST', () => {
    const req = new Request('http://localhost:3000/acme/admin/api/auth/sign-in/email', {
      method: 'POST',
      headers: {
        Host: 'localhost:3000',
        Origin: 'http://localhost:3000',
      },
    })
    expect(checkSameOrigin(req)).toEqual({ ok: true })
  })

  it('rejects cross-origin POST when Origin mismatches', () => {
    const req = new Request('http://localhost:3000/acme/admin/api/auth/sign-in/email', {
      method: 'POST',
      headers: {
        Host: 'localhost:3000',
        Origin: 'https://evil.example',
      },
    })
    const res = checkSameOrigin(req)
    expect(res.ok).toBe(false)
  })

  it('rejects null Origin and cross-site Sec-Fetch-Site headers', () => {
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

  it('respects X-Forwarded-Host and X-Forwarded-Proto behind reverse proxy', () => {
    const proxied = new Request('http://127.0.0.1:3000/acme/admin/api/auth/sign-in/email', {
      method: 'POST',
      headers: {
        'X-Forwarded-Host': 'pos.example.id',
        'X-Forwarded-Proto': 'https',
        Origin: 'https://pos.example.id',
      },
    })
    expect(checkSameOrigin(proxied)).toEqual({ ok: true })
  })
})
