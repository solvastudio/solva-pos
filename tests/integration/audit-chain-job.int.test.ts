import { afterAll, describe, expect, it } from 'vitest'
import { closePools } from '~/server/db'
import { verifyAuditChainsForActiveTenants } from '~/server/jobs/audit-chain-job'
import { createTestTenant, uniqueSlug } from './helpers/tenants'

describe('audit chain verification job', () => {
  afterAll(async () => {
    await closePools()
  })

  it('reports an intact chain for a tenant without audit rows', async () => {
    const tenant = await createTestTenant(uniqueSlug('audit-job-ok'))

    const res = await verifyAuditChainsForActiveTenants({ tenantIds: [tenant.id] })

    expect(res).toEqual({ tenantsChecked: 1, tenantsBroken: 0 })
  })

  it('counts every tenant whose chain fails verification', async () => {
    const a = await createTestTenant(uniqueSlug('audit-job-a'))
    const b = await createTestTenant(uniqueSlug('audit-job-b'))
    let call = 0

    const res = await verifyAuditChainsForActiveTenants({
      tenantIds: [a.id, b.id],
      verify: async () => {
        call += 1
        return call === 1
          ? { ok: true, checked: 0 }
          : { ok: false, brokenAtSeq: 3, reason: 'PREV_HASH' }
      },
    })

    expect(res).toEqual({ tenantsChecked: 2, tenantsBroken: 1 })
  })
})
