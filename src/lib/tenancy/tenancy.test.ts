import { describe, expect, it } from 'vitest'
import { canonicalizePath } from './canonical-path'
import { tenantHref } from './tenant-href'
import { parseTenantRefFromPath } from './tenant-ref'

describe('lib/tenancy (V-38)', () => {
  it('canonicalizePath lowercases slug segment, strips trailing slash, and collapses slashes', () => {
    expect(canonicalizePath('/ACME/pos')).toEqual({ changed: true, pathname: '/acme/pos' })
    expect(canonicalizePath('/acme/pos/')).toEqual({ changed: true, pathname: '/acme/pos' })
    expect(canonicalizePath('/acme')).toEqual({ changed: false, pathname: '/acme' })
    expect(canonicalizePath('/')).toEqual({ changed: false, pathname: '/' })
    expect(canonicalizePath('/Acme/')).toEqual({ changed: true, pathname: '/acme' })
    expect(canonicalizePath('//acme//pos')).toEqual({ changed: true, pathname: '/acme/pos' })
    expect(canonicalizePath('/acme/Bar')).toEqual({ changed: false, pathname: '/acme/Bar' })
  })

  it('tenantHref builds tenant-scoped sub-path URLs', () => {
    expect(tenantHref('acme', '')).toBe('/acme')
    expect(tenantHref('acme', '/pos')).toBe('/acme/pos')
    expect(tenantHref('ACME', '/admin/products')).toBe('/acme/admin/products')
  })

  it('parseTenantRefFromPath extracts valid non-reserved lowercase slug refs', () => {
    expect(parseTenantRefFromPath('/acme')).toEqual({ kind: 'slug', slug: 'acme' })
    expect(parseTenantRefFromPath('/toko-maju-7/pos')).toEqual({
      kind: 'slug',
      slug: 'toko-maju-7',
    })
    expect(parseTenantRefFromPath('/')).toBeNull()
    expect(parseTenantRefFromPath('/ACME/pos')).toBeNull()
    expect(parseTenantRefFromPath('/admin')).toBeNull()
    expect(parseTenantRefFromPath('/pos')).toBeNull()
  })
})
