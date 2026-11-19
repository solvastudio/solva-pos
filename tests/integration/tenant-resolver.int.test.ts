import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { __clearTenantCacheForTests, resolveTenantBySlug } from '~/modules/identity/public'
import * as resolverRepo from '~/modules/identity/server/tenant-resolver.repo'
import { closePools } from '~/server/db'
import { createTestTenant, uniqueSlug } from './helpers/tenants'

describe('tenant resolver service and memory cache', () => {
  beforeEach(() => {
    __clearTenantCacheForTests()
    vi.restoreAllMocks()
  })

  afterAll(async () => {
    await closePools()
  })

  it('resolves ACTIVE and SUSPENDED tenants by lowercase slug from DB', async () => {
    const activeSlug = uniqueSlug('resact')
    const suspSlug = uniqueSlug('ressusp')
    const active = await createTestTenant(activeSlug, 'Acme Coffee', 'ACTIVE')
    const suspended = await createTestTenant(suspSlug, 'Suspended Store', 'SUSPENDED')

    const foundActive = await resolveTenantBySlug(activeSlug)
    expect(foundActive).toEqual({
      tenantId: active.id,
      slug: activeSlug,
      status: 'ACTIVE',
      name: 'Acme Coffee',
    })

    const foundSuspended = await resolveTenantBySlug(suspSlug)
    expect(foundSuspended).toEqual({
      tenantId: suspended.id,
      slug: suspSlug,
      status: 'SUSPENDED',
      name: 'Suspended Store',
    })
  })

  it('normalizes uppercase slugs and returns null for unknown slugs', async () => {
    const slug = uniqueSlug('upper')
    const created = await createTestTenant(slug, 'Upper Case Store')

    const found = await resolveTenantBySlug(slug.toUpperCase())
    expect(found?.tenantId).toBe(created.id)
    expect(found?.slug).toBe(slug)

    expect(await resolveTenantBySlug(uniqueSlug('missing'))).toBeNull()
  })

  it('rejects invalid slugs without querying the database', async () => {
    const spy = vi.spyOn(resolverRepo, 'callResolveTenantBySlug')
    expect(await resolveTenantBySlug('a')).toBeNull()
    expect(await resolveTenantBySlug('-bad')).toBeNull()
    expect(await resolveTenantBySlug('admin')).toBeNull()
    expect(spy).not.toHaveBeenCalled()
  })

  it('caches found results for 60s and expires entries using injected clock', async () => {
    const slug = uniqueSlug('cache')
    await createTestTenant(slug, 'Cached Store')

    const spy = vi.spyOn(resolverRepo, 'callResolveTenantBySlug')
    let nowMs = 1_760_000_000_000

    const first = await resolveTenantBySlug(slug, { now: () => nowMs })
    const second = await resolveTenantBySlug(slug, { now: () => nowMs + 30_000 })
    expect(first?.name).toBe('Cached Store')
    expect(second?.name).toBe('Cached Store')
    expect(spy).toHaveBeenCalledTimes(1)

    nowMs += 60_001
    const third = await resolveTenantBySlug(slug, { now: () => nowMs })
    expect(third?.name).toBe('Cached Store')
    expect(spy).toHaveBeenCalledTimes(2)
  })
})
