import { afterAll, afterEach, beforeEach, describe, expect, it } from 'vitest'
import {
  createModifier,
  createModifierGroup,
  linkModifierGroupProduct,
  unlinkModifierGroupProduct,
} from '~/modules/catalog/public'
import { createTable, deactivateOrDeleteTable } from '~/modules/fnb/public'
import {
  createPairingCode,
  createRegister,
  enrollDevice,
} from '~/modules/identity/public'
import {
  type FeedCursor,
  type FeedRow,
  type SyncDeviceIdentity,
  fullResyncPage,
  pullPage,
  startFullResync,
  startPullCycle,
} from '~/modules/sync/public'
import { composeServer, resetCompositionForTests } from '~/server/composition'
import { closePools } from '~/server/db'
import { setupFnbTenant } from './helpers/fnb'

async function drainPull(
  tenantId: string,
  scope: { tenantId: string; outletId: string; registerId: string; deviceId: string },
  cursor: FeedCursor | null = null,
) {
  const cycle = await startPullCycle(tenantId)
  const rows: FeedRow[] = []
  let cur = cursor
  while (true) {
    const page = await pullPage({
      tenantId,
      scope,
      cursor: cur,
      cycleUpper: cycle.upper,
      pageSize: 100,
    })
    if (page.fullResyncRequired) throw new Error('Unexpected full resync required')
    rows.push(...page.rows)
    cur = page.nextCursor
    if (!page.hasMore) break
  }
  return { rows, cursor: cur }
}

describe('F&B master sync feed (fnb_table outlet scoping, modifiers, tombstones, resync)', () => {
  beforeEach(() => {
    resetCompositionForTests()
    composeServer()
  })

  afterEach(() => {
    resetCompositionForTests()
  })

  afterAll(async () => {
    await closePools()
  })

  it('scopes fnb_table by outlet while streaming tenant-wide modifier entities and tombstones', async () => {
    const f = await setupFnbTenant('fnb-feed')

    const regB = await createRegister(f.actor, {
      outletId: f.outletB,
      code: 'CASB',
      name: 'Cashier B',
      registerType: 'CASHIER',
      invoicePrefix: 'CASB',
    })
    const pairB = await createPairingCode(f.actor, regB.id)
    const enrB = await enrollDevice(
      { slug: f.slug, code: pairB.code, device_name: 'Cashier B Dev' },
      '10.10.0.3',
      { minDelayMs: 0 },
    )
    const devA = f.cashierDev
    const devB: SyncDeviceIdentity = {
      tenantId: f.tenantId,
      outletId: f.outletB,
      registerId: regB.id,
      deviceId: enrB.device_id,
      registerType: 'CASHIER',
    }
    const scopeA = {
      tenantId: devA.tenantId,
      outletId: devA.outletId,
      registerId: devA.registerId,
      deviceId: devA.deviceId,
    }
    const scopeB = {
      tenantId: devB.tenantId,
      outletId: devB.outletId,
      registerId: devB.registerId,
      deviceId: devB.deviceId,
    }

    const tblA2 = await createTable(f.fnbActor, { outletId: f.outletA, code: 'A02', capacity: 2 })
    const tblB1 = await createTable(f.fnbActor, { outletId: f.outletB, code: 'B01', capacity: 6 })
    const grp = await createModifierGroup(f.catalogActor, { name: 'Topping', selectionType: 'MULTI' })
    const mod = await createModifier(f.catalogActor, {
      modifierGroupId: grp.id,
      name: 'Keju',
      priceDelta: 4000,
    })
    const link = await linkModifierGroupProduct(f.catalogActor, {
      modifierGroupId: grp.id,
      productId: f.menuProductId,
    })

    const pullA = await drainPull(f.tenantId, scopeA)
    const tablesA = pullA.rows.filter((r) => r.entity === 'fnb_table').map((r) => r.id)
    expect(tablesA).toContain(f.tableA1Id)
    expect(tablesA).toContain(tblA2.id)
    expect(tablesA).not.toContain(tblB1.id)

    const modRowsA = pullA.rows.filter((r) => r.entity === 'modifier')
    expect(modRowsA.some((r) => r.id === mod.id && !('created_by' in (r.row ?? {})))).toBe(true)

    const pullB = await drainPull(f.tenantId, scopeB)
    const tablesB = pullB.rows.filter((r) => r.entity === 'fnb_table').map((r) => r.id)
    expect(tablesB).toEqual([tblB1.id])
    expect(pullB.rows.some((r) => r.entity === 'modifier_group' && r.id === grp.id)).toBe(true)
    expect(pullB.rows.some((r) => r.entity === 'modifier_group_product' && r.id === link.id)).toBe(
      true,
    )

    // Delete table A2 & unlink modifier_group_product -> incremental pull emits tombstones
    await deactivateOrDeleteTable(f.fnbActor, tblA2.id)
    await unlinkModifierGroupProduct(f.catalogActor, {
      modifierGroupId: grp.id,
      productId: f.menuProductId,
    })

    const deltaA = await drainPull(f.tenantId, scopeA, pullA.cursor)
    expect(
      deltaA.rows.some((r) => r.entity === 'fnb_table' && r.id === tblA2.id && r.op === 'delete'),
    ).toBe(true)
    expect(
      deltaA.rows.some(
        (r) => r.entity === 'modifier_group_product' && r.id === link.id && r.op === 'delete',
      ),
    ).toBe(true)

    // Full resync excludes tombstones and still respects outlet scoping
    const start = await startFullResync(
      devA,
      {},
      { schemaVersion: 1, appVersion: 'v0.1.0', syncProtocol: 1, requestRef: 'fnb-fs-1' },
    )
    const resyncRows: FeedRow[] = []
    for (const entity of start.entities) {
      let afterId: string | null = null
      while (true) {
        const page = await fullResyncPage(devA, {
          snapshot_token: start.snapshot_token,
          entity,
          after_id: afterId,
          page_size: 100,
        })
        resyncRows.push(...page.rows)
        afterId = page.next_after_id
        if (!page.has_more) break
      }
    }
    const resyncTableIds = resyncRows.filter((r) => r.entity === 'fnb_table').map((r) => r.id)
    expect(resyncTableIds).toEqual([f.tableA1Id])
    expect(resyncRows.some((r) => r.entity === 'modifier' && r.id === mod.id)).toBe(true)
    expect(resyncRows.some((r) => r.entity === 'modifier_group_product' && r.id === link.id)).toBe(
      false,
    )
  })
})
