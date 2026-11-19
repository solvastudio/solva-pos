import { describe, expect, it } from 'vitest'
import { safeReturnTo } from './safe-redirect'

describe('safeReturnTo', () => {
  it('defaults to /<slug>/admin when empty or missing', () => {
    expect(safeReturnTo(undefined, 'acme')).toBe('/acme/admin')
    expect(safeReturnTo(null, 'acme')).toBe('/acme/admin')
    expect(safeReturnTo('', 'acme')).toBe('/acme/admin')
    expect(safeReturnTo('   ', 'acme')).toBe('/acme/admin')
  })

  it('allows valid admin subpaths within the same tenant', () => {
    expect(safeReturnTo('/acme/admin', 'acme')).toBe('/acme/admin')
    expect(safeReturnTo('/acme/admin/account', 'acme')).toBe('/acme/admin/account')
    expect(safeReturnTo('/acme/admin/orders?page=2#top', 'acme')).toBe('/acme/admin/orders?page=2#top')
    expect(safeReturnTo('/ACME/admin/account', 'acme')).toBe('/acme/admin/account')
  })

  it('rejects external URLs, protocol-relative URLs, backslashes, and schemes', () => {
    expect(safeReturnTo('https://evil.example/acme/admin', 'acme')).toBe('/acme/admin')
    expect(safeReturnTo('http://evil.example', 'acme')).toBe('/acme/admin')
    expect(safeReturnTo('//evil.example/acme/admin', 'acme')).toBe('/acme/admin')
    expect(safeReturnTo('/\\evil.example', 'acme')).toBe('/acme/admin')
    expect(safeReturnTo('javascript:alert(1)', 'acme')).toBe('/acme/admin')
    expect(safeReturnTo('/%2f%2fevil.example', 'acme')).toBe('/acme/admin')
    expect(safeReturnTo('/acme/admin\nSet-Cookie: a=1', 'acme')).toBe('/acme/admin')
  })

  it('rejects other tenants and non-admin paths', () => {
    expect(safeReturnTo('/beta/admin', 'acme')).toBe('/acme/admin')
    expect(safeReturnTo('/acme/admin-fake', 'acme')).toBe('/acme/admin')
    expect(safeReturnTo('/acme/pos', 'acme')).toBe('/acme/admin')
    expect(safeReturnTo('/platform', 'acme')).toBe('/acme/admin')
  })
})
