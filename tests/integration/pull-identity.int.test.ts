import { webcrypto } from 'node:crypto'
import { sql } from 'drizzle-orm'
import { afterAll, afterEach, beforeEach, describe, expect, it } from 'vitest'
import { createIdGenerator } from '~/lib/kernel'
import {
  __clearDeviceAuthCacheForTests,
  __clearTenantCacheForTests,
  changeMemberRoleAndOutlets,
  createInvite,
  createLegalEntity,
  createOutlet,
  createPairingCode,
  createRegister,
  createTenant,
  enrollDevice,
  getTenantAuthMetadataBySlug,
  listRolesWithPermissions,
  redeemInvite,
  setPin,
  type IdentityAuthActor,
} from '~/modules/identity/public'
import { PERMISSION_CODES } from '~/modules/identity/shared'
import {
  handlePull,
  processPush,
  type FeedRow,
  type SyncDeviceIdentity,
  writeMaster,
} from '~/modules/sync/public'
import { resetLimitersForTests } from '~/server/auth/rate-limit/limiters'
import { composeServer, resetCompositionForTests } from '~/server/composition'
import { closePools, withTenant } from '~/server/db'
import { AppError } from '~/server/error-classify'
import { uniqueSlug } from './helpers/tenants'

const testIdGen = createIdGenerator({
  nowMs: () => Date.now(),
  nextUint32: () => {
    const buf = new Uint32Array(1)
    webcrypto.getRandomValues(buf)
    return buf[0]!
  },
})

const testOp = { platformUserId: testIdGen.newId(), email: 'op-pull-id@example.test' }

async function setupMultiOutletTenant(slug: string) {
  const email = `owner-${slug}@example.test`
  const created = await createTenant(testOp, {
    name: `Pull ${slug}`,
    slug,
    ownerEmail: email,
    ownerDisplayName: 'Owner',
  })
  const meta = await getTenantAuthMetadataBySlug(slug)
  await redeemInvite({
    tenantId: created.tenantId,
    tenantSlug: slug,
    authOrgId: meta!.authOrgId,
    email,
    code: created.ownerInvite.code,
    password: 'OwnerPassword123!',
  })
  const actor: IdentityAuthActor = {
    tenantId: created.tenantId,
    tenantSlug: slug,
    authOrgId: meta!.authOrgId,
    appUserId: created.ownerInvite.appUserId,
    permissions: new Set(PERMISSION_CODES),
    outletIds: null,
    roleCodes: ['OWNER'],
  }

  const le = await createLegalEntity(actor, { name: 'PT Pull', isPkp: false })
  const out1 = await createOutlet(actor, {
    legalEntityId: le.id,
    code: 'OUT01',
    name: 'Outlet 01',
    timezone: 'Asia/Jakarta',
    dayCutoffTime: '00:00',
    priceTaxMode: 'INCLUSIVE',
  })
  const out2 = await createOutlet(actor, {
    legalEntityId: le.id,
    code: 'OUT02',
    name: 'Outlet 02',
    timezone: 'Asia/Jakarta',
    dayCutoffTime: '00:00',
    priceTaxMode: 'EXCLUSIVE',
  })

  const reg1 = await createRegister(actor, {
    outletId: out1.id,
    code: 'POS01',
    name: 'Cashier 1',
    registerType: 'CASHIER',
    invoicePrefix: 'OUT01-POS01',
  })
  const reg2 = await createRegister(actor, {
    outletId: out1.id,
    code: 'POS02',
    name: 'Cashier 2',
    registerType: 'CASHIER',
    invoicePrefix: 'OUT01-POS02',
  })
  const regOut2 = await createRegister(actor, {
    outletId: out2.id,
    code: 'POS03',
    name: 'Out2 Cashier',
    registerType: 'CASHIER',
    invoicePrefix: 'OUT02-POS03',
  })

  const pair1 = await createPairingCode(actor, reg1.id)
  const dev1Enr = await enrollDevice(
    { slug, code: pair1.code, device_name: 'Dev-OUT01-POS01' },
    '10.5.0.1',
    { minDelayMs: 0 },
  )
  const pair2 = await createPairingCode(actor, reg2.id)
  const dev2Enr = await enrollDevice(
    { slug, code: pair2.code, device_name: 'Dev-OUT01-POS02' },
    '10.5.0.2',
    { minDelayMs: 0 },
  )
  const pairOut2 = await createPairingCode(actor, regOut2.id)
  const devOut2Enr = await enrollDevice(
    { slug, code: pairOut2.code, device_name: 'Dev-OUT02-POS03' },
    '10.5.0.3',
    { minDelayMs: 0 },
  )

  const syncDev1: SyncDeviceIdentity = {
    tenantId: created.tenantId,
    deviceId: dev1Enr.device_id,
    registerId: reg1.id,
    outletId: out1.id,
    registerType: 'CASHIER',
  }
  const syncDev2: SyncDeviceIdentity = {
    tenantId: created.tenantId,
    deviceId: dev2Enr.device_id,
    registerId: reg2.id,
    outletId: out1.id,
    registerType: 'CASHIER',
  }
  const syncDevOut2: SyncDeviceIdentity = {
    tenantId: created.tenantId,
    deviceId: devOut2Enr.device_id,
    registerId: regOut2.id,
    outletId: out2.id,
    registerType: 'CASHIER',
  }

  return {
    tenantId: created.tenantId,
    slug,
    actor,
    out1,
    out2,
    reg1,
    reg2,
    regOut2,
    syncDev1,
    syncDev2,
    syncDevOut2,
  }
}

async function pullAllPages(
  device: SyncDeviceIdentity,
  opts?: { pageSize?: number; attentionIds?: string[] },
) {
  const allRows: FeedRow[] = []
  let cursor: { version: number; id: string } | null = null
  let cycle: { id: string; upper: number } | null = null
  let lastPage: Extract<Awaited<ReturnType<typeof handlePull>>, { rows: unknown }> | null = null

  for (let i = 0; i < 100; i += 1) {
    const page = await handlePull(
      device,
      {
        cursor,
        cycle,
        page_size: opts?.pageSize ?? 500,
        attention_ids: opts?.attentionIds ?? [],
      },
      {
        schemaVersion: 1,
        appVersion: 'v0.1.0',
        syncProtocol: 1,
        requestRef: `pull-${i}`,
      },
    )
    if ('full_resync_required' in page) {
      throw new Error(`Unexpected full_resync_required: ${page.reason}`)
    }
    allRows.push(...page.rows)
    cursor = page.next_cursor
    cycle = { id: 'cycle-test', upper: page.upper }
    if (!page.has_more) {
      lastPage = page
      break
    }
  }

  if (!lastPage) {
    throw new Error('Did not finish pull cycle within 100 pages')
  }
  return { allRows, lastPage }
}

describe('pull identity master feeds integration', () => {
  beforeEach(() => {
    resetCompositionForTests()
    composeServer()
    resetLimitersForTests()
    __clearDeviceAuthCacheForTests()
    __clearTenantCacheForTests()
  })

  afterEach(() => {
    resetCompositionForTests()
  })

  afterAll(async () => {
    await closePools()
  })

  it('enforces outlet/register/tenant scope, strips forbidden fields, and excludes inactive/pending users', async () => {
    const slugA = uniqueSlug('pull-id-a')
    const slugB = uniqueSlug('pull-id-b')
    const fxA = await setupMultiOutletTenant(slugA)
    await setupMultiOutletTenant(slugB)

    // Add outlet-specific & tenant-wide tax rates, receipt logo key, active staff, pending staff, inactive staff
    const roles = await listRolesWithPermissions(fxA.actor)
    const cashierRole = roles.find((r) => r.code === 'CASHIER')!

    const staffEmail = `staff-${slugA}@example.test`
    const staffInv = await createInvite(fxA.actor, {
      email: staffEmail,
      displayName: 'Active Staff Out1',
      roleId: cashierRole.id,
      outletIds: [fxA.out1.id],
    })
    const metaA = await getTenantAuthMetadataBySlug(slugA)
    await redeemInvite({
      tenantId: fxA.tenantId,
      tenantSlug: slugA,
      authOrgId: metaA!.authOrgId,
      email: staffEmail,
      code: staffInv.code,
      password: 'StaffPassword123!',
    })

    const pendingInv = await createInvite(fxA.actor, {
      email: `pending-${slugA}@example.test`,
      displayName: 'Pending Staff Out1',
      roleId: cashierRole.id,
      outletIds: [fxA.out1.id],
    })

    const inactiveInv = await createInvite(fxA.actor, {
      email: `inactive-${slugA}@example.test`,
      displayName: 'Inactive Staff Out1',
      roleId: cashierRole.id,
      outletIds: [fxA.out1.id],
    })
    await redeemInvite({
      tenantId: fxA.tenantId,
      tenantSlug: slugA,
      authOrgId: metaA!.authOrgId,
      email: `inactive-${slugA}@example.test`,
      code: inactiveInv.code,
      password: 'StaffPassword123!',
    })

    const taxDefaultId = testIdGen.newId()
    const taxOut1Id = testIdGen.newId()
    const taxOut2Id = testIdGen.newId()

    await withTenant(fxA.tenantId, async (tx) => {
      await writeMaster(tx, { actorUserId: fxA.actor.appUserId }, async (w) => {
        await tx.execute(
          sql`UPDATE app_user SET is_active = false, version = ${w.version} WHERE id = ${inactiveInv.appUserId}::uuid`,
        )
        await tx.execute(
          sql`UPDATE outlet_receipt_setting SET logo_object_key = 'secret/logo.png', version = ${w.version} WHERE outlet_id = ${fxA.out1.id}::uuid`,
        )
        await tx.execute(
          sql`INSERT INTO tax_rate_history (id, tenant_id, version, tax_code, outlet_id, effective_from, rate)
              VALUES
                (${taxDefaultId}::uuid, ${w.tenantId}::uuid, ${w.version}, 'PPN', NULL, '2026-01-01', 11),
                (${taxOut1Id}::uuid, ${w.tenantId}::uuid, ${w.version}, 'PB1', ${fxA.out1.id}::uuid, '2026-01-01', 10),
                (${taxOut2Id}::uuid, ${w.tenantId}::uuid, ${w.version}, 'PB1', ${fxA.out2.id}::uuid, '2026-01-01', 12)`,
        )
      })
    })

    const { allRows, lastPage } = await pullAllPages(fxA.syncDev1, { pageSize: 3 })
    const upserts = allRows.filter((r) => r.op === 'upsert')

    const entitiesOf = (entity: string) => upserts.filter((r) => r.entity === entity)

    // Tenant, legal entity, outlet (OUT01 only), receipt setting (OUT01 only)
    expect(entitiesOf('tenant').map((r) => r.id)).toEqual([fxA.tenantId])
    expect(entitiesOf('legal_entity').length).toBeGreaterThanOrEqual(1)
    expect(entitiesOf('outlet').map((r) => r.id)).toEqual([fxA.out1.id])
    expect(entitiesOf('outlet_receipt_setting').map((r) => r.row?.outlet_id)).toEqual([fxA.out1.id])

    // All registers of OUT01 downloaded, OUT02 excluded
    const registerIds = new Set(entitiesOf('cash_master').map((r) => r.id))
    expect(registerIds).toEqual(new Set([fxA.reg1.id, fxA.reg2.id]))
    expect(registerIds.has(fxA.regOut2.id)).toBe(false)

    // Invoice prefix ONLY for reg1 (own register)
    const prefixRegIds = new Set(entitiesOf('register_invoice_prefix').map((r) => r.row?.register_id))
    expect(prefixRegIds).toEqual(new Set([fxA.reg1.id]))

    // Tax rates: tenant default + OUT01, never OUT02
    const taxIds = new Set(entitiesOf('tax_rate_history').map((r) => r.id))
    expect(taxIds.has(taxDefaultId)).toBe(true)
    expect(taxIds.has(taxOut1Id)).toBe(true)
    expect(taxIds.has(taxOut2Id)).toBe(false)

    // Payment methods, roles, permissions present
    expect(entitiesOf('payment_method').length).toBeGreaterThanOrEqual(1)
    expect(entitiesOf('role').length).toBeGreaterThanOrEqual(1)
    expect(entitiesOf('role_permission').length).toBeGreaterThanOrEqual(1)

    // app_user: owner + active staff ONLY (no pending, no inactive)
    const userIds = new Set(entitiesOf('app_user').map((r) => r.id))
    expect(userIds.has(fxA.actor.appUserId)).toBe(true)
    expect(userIds.has(staffInv.appUserId)).toBe(true)
    expect(userIds.has(pendingInv.appUserId)).toBe(false)
    expect(userIds.has(inactiveInv.appUserId)).toBe(false)

    // Forbidden columns never appear anywhere on any downloaded row
    const FORBIDDEN_FIELDS = [
      'auth_user_id',
      'membership_status',
      'auth_org_id',
      'logo_object_key',
      'created_by',
      'updated_by',
    ]
    for (const r of upserts) {
      expect(r.row?.tenant_id ?? r.id).toBeTruthy()
      if (r.row && 'tenant_id' in r.row) {
        expect(r.row.tenant_id).toBe(fxA.tenantId)
      }
      for (const badField of FORBIDDEN_FIELDS) {
        expect(r.row).not.toHaveProperty(badField)
      }
    }

    // manifest.counts matches live upsert count per entity
    expect(lastPage.manifest).toBeDefined()
    for (const [entity, count] of Object.entries(lastPage.manifest!.counts)) {
      expect(entitiesOf(entity)).toHaveLength(count)
    }
  })

  it('emits op:delete on scope departure (OUT01 -> OUT02) and master tombstone deletion', async () => {
    const slug = uniqueSlug('pull-scope')
    const fx = await setupMultiOutletTenant(slug)

    const roles = await listRolesWithPermissions(fx.actor)
    const cashierRole = roles.find((r) => r.code === 'CASHIER')!
    const staffEmail = `move-${slug}@example.test`
    const inv = await createInvite(fx.actor, {
      email: staffEmail,
      displayName: 'Movable Staff',
      roleId: cashierRole.id,
      outletIds: [fx.out1.id],
    })
    const meta = await getTenantAuthMetadataBySlug(slug)
    await redeemInvite({
      tenantId: fx.tenantId,
      tenantSlug: slug,
      authOrgId: meta!.authOrgId,
      email: staffEmail,
      code: inv.code,
      password: 'StaffPassword123!',
    })

    const initialOut1 = await pullAllPages(fx.syncDev1)
    expect(
      initialOut1.allRows.some(
        (r) => r.entity === 'app_user' && r.op === 'upsert' && r.id === inv.appUserId,
      ),
    ).toBe(true)
    const initialOut2 = await pullAllPages(fx.syncDevOut2)

    // Reassign staff from OUT01 -> OUT02
    await changeMemberRoleAndOutlets(fx.actor, {
      appUserId: inv.appUserId,
      assignments: [{ outletId: fx.out2.id, roleId: cashierRole.id }],
    })

    const deltaOut1 = await handlePull(
      fx.syncDev1,
      { cursor: initialOut1.lastPage.next_cursor, cycle: null, page_size: 500, attention_ids: [] },
      { schemaVersion: 1, appVersion: 'v0.1.0', syncProtocol: 1, requestRef: 'mv-1' },
    )
    expect('full_resync_required' in deltaOut1).toBe(false)
    if (!('full_resync_required' in deltaOut1)) {
      const delUser = deltaOut1.rows.find(
        (r) => r.entity === 'app_user' && r.id === inv.appUserId && r.op === 'delete',
      )
      const delAssignment = deltaOut1.rows.find(
        (r) => r.entity === 'user_outlet' && r.op === 'delete',
      )
      expect(delUser).toBeDefined()
      expect(delUser!.row).toBeUndefined()
      expect(delAssignment).toBeDefined()
    }

    const deltaOut2 = await handlePull(
      fx.syncDevOut2,
      { cursor: initialOut2.lastPage.next_cursor, cycle: null, page_size: 500, attention_ids: [] },
      { schemaVersion: 1, appVersion: 'v0.1.0', syncProtocol: 1, requestRef: 'mv-2' },
    )
    if (!('full_resync_required' in deltaOut2)) {
      expect(
        deltaOut2.rows.some(
          (r) => r.entity === 'app_user' && r.op === 'upsert' && r.id === inv.appUserId,
        ),
      ).toBe(true)
    }

    // Soft-delete payment_method tombstone appears incrementally
    const pmId = testIdGen.newId()
    await withTenant(fx.tenantId, async (tx) => {
      await writeMaster(tx, { actorUserId: fx.actor.appUserId }, async (w) => {
        await tx.execute(
          sql`INSERT INTO payment_method (id, tenant_id, version, code, name, kind)
              VALUES (${pmId}::uuid, ${w.tenantId}::uuid, ${w.version}, 'QRIS', 'QRIS', 'NON_CASH')`,
        )
      })
    })
    await withTenant(fx.tenantId, async (tx) => {
      await writeMaster(tx, { actorUserId: fx.actor.appUserId }, async (w) => {
        await tx.execute(
          sql`UPDATE payment_method SET deleted_at = now(), version = ${w.version} WHERE id = ${pmId}::uuid`,
        )
      })
    })

    const curAfterMove =
      !('full_resync_required' in deltaOut1) ? deltaOut1.next_cursor : initialOut1.lastPage.next_cursor
    const deltaTombstone = await handlePull(
      fx.syncDev1,
      { cursor: curAfterMove, cycle: null, page_size: 500, attention_ids: [] },
      { schemaVersion: 1, appVersion: 'v0.1.0', syncProtocol: 1, requestRef: 'tomb-1' },
    )
    if (!('full_resync_required' in deltaTombstone)) {
      expect(deltaTombstone.rows).toContainEqual(
        expect.objectContaining({
          entity: 'payment_method',
          op: 'delete',
          id: pmId,
        }),
      )
    }
  })

  it('keeps cycle upper stable mid-cycle, rejects page_size > 500, and filters command_updates by device', async () => {
    const slug = uniqueSlug('pull-stable')
    const fx = await setupMultiOutletTenant(slug)

    const initial = await pullAllPages(fx.syncDev1)
    const startCursor = initial.lastPage.next_cursor!

    // Write 3 payment methods so page_size = 2 splits across 2 pages
    const pmIds = [testIdGen.newId(), testIdGen.newId(), testIdGen.newId()]
    for (let i = 0; i < pmIds.length; i += 1) {
      await withTenant(fx.tenantId, async (tx) => {
        await writeMaster(tx, { actorUserId: fx.actor.appUserId }, async (w) => {
          await tx.execute(
            sql`INSERT INTO payment_method (id, tenant_id, version, code, name, kind)
                VALUES (${pmIds[i]!}::uuid, ${w.tenantId}::uuid, ${w.version}, ${`M${i}`}, ${`Method ${i}`}, 'NON_CASH')`,
          )
        })
      })
    }

    const p1 = await handlePull(
      fx.syncDev1,
      { cursor: startCursor, cycle: null, page_size: 2, attention_ids: [] },
      { schemaVersion: 1, appVersion: 'v0.1.0', syncProtocol: 1, requestRef: 'cyc-1' },
    )
    expect('full_resync_required' in p1).toBe(false)
    if ('full_resync_required' in p1) return
    expect(p1.has_more).toBe(true)
    expect(p1.command_updates).toBeUndefined()
    expect(p1.manifest).toBeUndefined()

    // Write late payment_method AFTER page 1 started (above p1.upper)
    const latePmId = testIdGen.newId()
    await withTenant(fx.tenantId, async (tx) => {
      await writeMaster(tx, { actorUserId: fx.actor.appUserId }, async (w) => {
        await tx.execute(
          sql`INSERT INTO payment_method (id, tenant_id, version, code, name, kind)
              VALUES (${latePmId}::uuid, ${w.tenantId}::uuid, ${w.version}, 'LATE', 'Late Method', 'NON_CASH')`,
        )
      })
    })

    // Page 2 with same upper does NOT return latePmId
    const ownCmdId = testIdGen.newId()
    const foreignCmdId = testIdGen.newId()
    const nowIso = new Date().toISOString()
    await processPush(
      fx.syncDev1,
      {
        sent_at_device: nowIso,
        clock_offset_ms: 0,
        commands: [
          {
            id: ownCmdId,
            type: 'AppendAudit',
            schema_version: 1,
            device_seq: 1,
            depends_on: [],
            created_at_device: nowIso,
            payload: {
              entry: {
                id: testIdGen.newId(),
                action: 'drawer.opened',
                entity_type: 'cash_drawer',
                occurred_at: nowIso,
              },
            },
          },
        ],
      },
      { schemaVersion: 1, appVersion: 'v0.1.0', syncProtocol: 1, requestRef: 'cmd-1' },
    )
    await processPush(
      fx.syncDev2,
      {
        sent_at_device: nowIso,
        clock_offset_ms: 0,
        commands: [
          {
            id: foreignCmdId,
            type: 'AppendAudit',
            schema_version: 1,
            device_seq: 1,
            depends_on: [],
            created_at_device: nowIso,
            payload: {
              entry: {
                id: testIdGen.newId(),
                action: 'drawer.opened',
                entity_type: 'cash_drawer',
                occurred_at: nowIso,
              },
            },
          },
        ],
      },
      { schemaVersion: 1, appVersion: 'v0.1.0', syncProtocol: 1, requestRef: 'cmd-2' },
    )

    const p2 = await handlePull(
      fx.syncDev1,
      {
        cursor: p1.next_cursor,
        cycle: { id: 'c1', upper: p1.upper },
        page_size: 2,
        attention_ids: [ownCmdId, foreignCmdId],
      },
      { schemaVersion: 1, appVersion: 'v0.1.0', syncProtocol: 1, requestRef: 'cyc-2' },
    )
    if ('full_resync_required' in p2) throw new Error('unexpected resync')
    expect(p2.has_more).toBe(false)
    expect(p2.upper).toBe(p1.upper)
    expect(p2.rows.some((r) => r.id === latePmId)).toBe(false)
    expect(p2.command_updates).toEqual([{ id: ownCmdId, status: 'ACKED' }])
    expect(p2.manifest).toBeDefined()

    // Next cycle picks up latePmId
    const nextCyc = await handlePull(
      fx.syncDev1,
      { cursor: p2.next_cursor, cycle: null, page_size: 500, attention_ids: [] },
      { schemaVersion: 1, appVersion: 'v0.1.0', syncProtocol: 1, requestRef: 'cyc-3' },
    )
    if ('full_resync_required' in nextCyc) throw new Error('unexpected resync')
    expect(nextCyc.rows.some((r) => r.id === latePmId)).toBe(true)

    await expect(
      handlePull(
        fx.syncDev1,
        { cursor: null, cycle: null, page_size: 501, attention_ids: [] },
        { schemaVersion: 1, appVersion: 'v0.1.0', syncProtocol: 1, requestRef: 'bad-sz' },
      ),
    ).rejects.toMatchObject({ code: 'VALIDATION_FAILED' } satisfies Partial<AppError>)
  })

  it('delivers app_user, user_outlet, and staff_pin when a device polls while invite is still PENDING before redeem + setPin', async () => {
    const slug = uniqueSlug('pull-pending')
    const fx = await setupMultiOutletTenant(slug)
    const roles = await listRolesWithPermissions(fx.actor)
    const cashierRole = roles.find((r) => r.code === 'CASHIER')!

    const p0 = await handlePull(
      fx.syncDev1,
      { cursor: null, cycle: null, page_size: 500, attention_ids: [] },
      { schemaVersion: 1, appVersion: 'v0.1.0', syncProtocol: 1, requestRef: 'pend-0' },
    )
    if ('full_resync_required' in p0) throw new Error('unexpected resync')

    const inv = await createInvite(fx.actor, {
      email: `yaya-${slug}@example.test`,
      displayName: 'Yaya',
      roleId: cashierRole.id,
      outletIds: [fx.out1.id],
    })

    // Device syncs while invite is still PENDING (cursor advances past initial user_outlet row)
    const pPending = await handlePull(
      fx.syncDev1,
      { cursor: p0.next_cursor, cycle: null, page_size: 500, attention_ids: [] },
      { schemaVersion: 1, appVersion: 'v0.1.0', syncProtocol: 1, requestRef: 'pend-1' },
    )
    if ('full_resync_required' in pPending) throw new Error('unexpected resync')

    await redeemInvite({
      tenantId: fx.tenantId,
      tenantSlug: slug,
      authOrgId: fx.actor.authOrgId,
      email: `yaya-${slug}@example.test`,
      code: inv.code,
      password: 'YayaPassword123!',
    })
    await setPin(fx.actor, { userId: inv.appUserId, pin: '4829' })

    const pAfter = await handlePull(
      fx.syncDev1,
      { cursor: pPending.next_cursor, cycle: null, page_size: 500, attention_ids: [] },
      { schemaVersion: 1, appVersion: 'v0.1.0', syncProtocol: 1, requestRef: 'pend-2' },
    )
    if ('full_resync_required' in pAfter) throw new Error('unexpected resync')

    expect(
      pAfter.rows.some(
        (r) => r.entity === 'app_user' && r.op === 'upsert' && r.id === inv.appUserId,
      ),
    ).toBe(true)
    expect(
      pAfter.rows.some(
        (r) =>
          r.entity === 'user_outlet' &&
          r.op === 'upsert' &&
          r.row?.user_id === inv.appUserId &&
          r.row?.outlet_id === fx.out1.id,
      ),
    ).toBe(true)
    expect(
      pAfter.rows.some(
        (r) => r.entity === 'staff_pin' && r.op === 'upsert' && r.row?.user_id === inv.appUserId,
      ),
    ).toBe(true)
  })
})
