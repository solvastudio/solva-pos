import { describe, expect, it } from 'vitest'
import { ipInCidr, normalizeIp, resolveClientIp } from './ip'

describe('ratelimit/ip', () => {
  it('normalizes IPv4 and IPv4-mapped IPv6 addresses', () => {
    expect(normalizeIp('192.168.1.5')).toBe('192.168.1.5')
    expect(normalizeIp('::ffff:172.18.0.2')).toBe('172.18.0.2')
    expect(normalizeIp('::1')).toBe('::1')
    expect(normalizeIp('not-an-ip')).toBeNull()
  })

  it('matches IPv4 and IPv6 CIDRs accurately', () => {
    expect(ipInCidr('172.18.0.2', '172.16.0.0/12')).toBe(true)
    expect(ipInCidr('::ffff:172.18.0.2', '172.16.0.0/12')).toBe(true)
    expect(ipInCidr('192.168.1.1', '172.16.0.0/12')).toBe(false)
    expect(ipInCidr('2001:db8::42', '2001:db8::/32')).toBe(true)
    expect(ipInCidr('2001:db9::42', '2001:db8::/32')).toBe(false)
  })

  it('trusts X-Real-IP only when remoteAddress is inside trustedCidrs', () => {
    expect(
      resolveClientIp({
        remoteAddress: '::ffff:172.18.0.2',
        xRealIp: '203.0.113.9',
        trustedCidrs: ['172.16.0.0/12'],
      }),
    ).toBe('203.0.113.9')

    // Spoofed X-Real-IP from untrusted client is ignored.
    expect(
      resolveClientIp({
        remoteAddress: '198.51.100.7',
        xRealIp: '1.2.3.4',
        trustedCidrs: ['172.16.0.0/12'],
      }),
    ).toBe('198.51.100.7')

    // Invalid X-Real-IP falls back safely to remoteAddress.
    expect(
      resolveClientIp({
        remoteAddress: '172.18.0.2',
        xRealIp: '1.2.3.4, 5.6.7.8',
        trustedCidrs: ['172.16.0.0/12'],
      }),
    ).toBe('172.18.0.2')
  })
})
