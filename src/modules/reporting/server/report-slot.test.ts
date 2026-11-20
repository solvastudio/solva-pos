import { beforeEach, describe, expect, it } from 'vitest'
import {
  __resetReportSlotsForTests,
  acquireReportSlot,
  getActiveReportCount,
  isReportBusyError,
  withReportSlot,
} from './report-slot'

beforeEach(() => {
  __resetReportSlotsForTests()
})

describe('report-slot per-tenant concurrency semaphore (max 2 per tenant)', () => {
  it('allows up to 2 concurrent reports per tenant, rejects the 3rd with REPORT_BUSY, and isolates tenants', async () => {
    const tenantA = '11111111-1111-4111-8111-111111111111'
    const tenantB = '22222222-2222-4222-8222-222222222222'

    const rel1 = acquireReportSlot(tenantA)
    const rel2 = acquireReportSlot(tenantA)
    const rel3 = acquireReportSlot(tenantA)

    expect(rel1).not.toBeNull()
    expect(rel2).not.toBeNull()
    expect(rel3).toBeNull()
    expect(getActiveReportCount(tenantA)).toBe(2)

    // Tenant B is unaffected
    const relB = acquireReportSlot(tenantB)
    expect(relB).not.toBeNull()
    relB?.()

    // 3rd concurrent withReportSlot on tenantA throws REPORT_BUSY
    let caught: unknown = null
    try {
      await withReportSlot(tenantA, async () => 'unreachable')
    } catch (err) {
      caught = err
    }
    expect(isReportBusyError(caught)).toBe(true)

    // Releasing one slot allows the next report to run
    rel1?.()
    rel1?.() // idempotent double release
    expect(getActiveReportCount(tenantA)).toBe(1)

    const res = await withReportSlot(tenantA, async () => 'ok')
    expect(res).toBe('ok')

    rel2?.()
    expect(getActiveReportCount(tenantA)).toBe(0)
  })
})
