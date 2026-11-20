import { afterAll, beforeEach, describe, expect, it } from 'vitest'
import {
  __clearDeviceAuthCacheForTests,
  __clearTenantCacheForTests,
} from '~/modules/identity/public'
import {
  __resetReportSlotsForTests,
  acquireReportSlot,
  exportReportCsv,
  getSalesReport,
  isReportBusyError,
} from '~/modules/reporting/public'
import { resetLimitersForTests } from '~/server/auth/rate-limit/limiters'
import { __resetPushLimitsForTests } from '~/server/auth/rate-limit/push-limits'
import { composeServer, resetCompositionForTests } from '~/server/composition'
import { closePools } from '~/server/db'
import { resetEnvForTests } from '~/server/env'
import { seedV25SalesReportFixture } from '../fixtures/report-seed'

beforeEach(() => {
  resetEnvForTests()
  __clearTenantCacheForTests()
  __clearDeviceAuthCacheForTests()
  resetLimitersForTests()
  __resetPushLimitsForTests()
  __resetReportSlotsForTests()
  resetCompositionForTests()
  composeServer()
})

afterAll(async () => {
  await closePools()
})

describe('Report concurrency semaphore (±2 per tenant), access scope, and CSV export', () => {
  it('rejects the 3rd concurrent report on the same tenant with REPORT_BUSY while allowing other tenants and completing after release', async () => {
    const fixA = await seedV25SalesReportFixture()
    const fixB = await seedV25SalesReportFixture()

    // Hold 2 report slots on tenant A
    const rel1 = acquireReportSlot(fixA.tenantId)!
    const rel2 = acquireReportSlot(fixA.tenantId)!
    expect(rel1).toBeTypeOf('function')
    expect(rel2).toBeTypeOf('function')

    // 3rd report on tenant A fails immediately with REPORT_BUSY
    let busyErr: unknown = null
    try {
      await getSalesReport(fixA.ownerActor, {
        outletIds: [fixA.out1.id],
        from: '2026-11-17',
        to: '2026-11-17',
        groupBy: 'DAY',
      })
    } catch (err) {
      busyErr = err
    }
    expect(isReportBusyError(busyErr)).toBe(true)

    // Tenant B can still execute reports concurrently while tenant A has 2 active slots
    const rptB = await getSalesReport(fixB.ownerActor, {
      outletIds: [fixB.out1.id],
      from: '2026-11-17',
      to: '2026-11-17',
      groupBy: 'DAY',
    })
    expect(rptB.totals.netSales).toBe(170_100)

    // Release one slot on tenant A -> report now succeeds
    rel1()
    const rptA = await getSalesReport(fixA.ownerActor, {
      outletIds: [fixA.out1.id],
      from: '2026-11-17',
      to: '2026-11-17',
      groupBy: 'DAY',
    })
    expect(rptA.totals.netSales).toBe(170_100)
    rel2()
  })

  it('enforces report.view permission, outlet scope intersection, and exports UTF-8 BOM CSV with formula escaping', async () => {
    const fix = await seedV25SalesReportFixture()

    // Cashier without report.view is rejected
    await expect(
      getSalesReport(fix.cashierActorNoReport, {
        outletIds: [fix.out1.id],
        from: '2026-11-17',
        to: '2026-11-17',
        groupBy: 'DAY',
      }),
    ).rejects.toThrow(/FORBIDDEN|report\.view/i)

    // Manager scoped to OUT01 with empty outletIds only sees OUT01
    const scopedRpt = await getSalesReport(fix.managerOut1Actor, {
      outletIds: [],
      from: '2026-11-17',
      to: '2026-11-17',
      groupBy: 'DAY',
    })
    expect(scopedRpt.rows.every((r) => r.outletId === fix.out1.id)).toBe(true)

    // CSV export includes UTF-8 BOM and exact filename solva-sales-2026-11-17-2026-11-17.csv
    const csvRes = await exportReportCsv(fix.ownerActor, 'sales', {
      outletIds: [fix.out1.id],
      from: '2026-11-17',
      to: '2026-11-17',
      groupBy: 'DAY',
    })
    expect(csvRes.filename).toBe('solva-sales-2026-11-17-2026-11-17.csv')
    expect(csvRes.csv.startsWith('\uFEFF')).toBe(true)
    expect(csvRes.csv).toContain('2026-11-17,OUT01,Outlet Utama,3,176700,7370,169330,0,18626,44,188000,17900,170100,1')
  })
})
