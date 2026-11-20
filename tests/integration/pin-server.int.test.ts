import { webcrypto } from 'node:crypto'
import { afterAll, beforeEach, describe, expect, it } from 'vitest'
import { createIdGenerator } from '~/lib/kernel'
import { verifyAuditChain } from '~/modules/audit/public'
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
  listMembers,
  listRolesWithPermissions,
  redeemInvite,
  resetPin,
  revokeDevice,
  setPin,
  type IdentityAuthActor,
} from '~/modules/identity/public'
import { PERMISSION_CODES } from '~/modules/identity/shared'
import {
  processPush,
  pullPage,
  startPullCycle,
  type FeedRow,
  type SyncDeviceIdentity,
} from '~/modules/sync/public'
import { computePinHashDirect, bytesToBase64Url } from '~/pos/session/pin-kdf'
import { resetLimitersForTests } from '~/server/auth/rate-limit/limiters'
import { __resetPushLimitsForTests } from '~/server/auth/rate-limit/push-limits'
import { composeServer, resetCompositionForTests } from '~/server/composition'
import { closePools, withTenant } from '~/server/db'
import { resetEnvForTests } from '~/server/env'
import { uniqueSlug } from './helpers/tenants'

const idGen = createIdGenerator({
  nowMs: () => Date.now(),
  nextUint32: () => {
    const buf = new Uint32Array(1)
    webcrypto.getRandomValues(buf)
    return buf[0]!
  },
})

const testOp = { platformUserId: idGen.newId(), email: 'op-pin@example.test' }

async function setupPinTenant(prefix: string) {
  const slug = uniqueSlug(prefix)
  const email = `owner-${slug}@example.test`
  const created = await createTenant(testOp, {
    name: `Pin ${slug}`,
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

  const ownerActor: IdentityAuthActor = {
    tenantId: created.tenantId,
    tenantSlug: slug,
    authOrgId: meta!.authOrgId,
    appUserId: created.ownerInvite.appUserId,
    permissions: new Set(PERMISSION_CODES),
    outletIds: null,
    roleCodes: ['OWNER'],
  }

  const le = await createLegalEntity(ownerActor, { name: 'PT Pin', isPkp: false })
  const out1 = await createOutlet(ownerActor, {
    legalEntityId: le.id,
    code: 'OUT01',
    name: 'Outlet 1',
    timezone: 'Asia/Jakarta',
    dayCutoffTime: '00:00',
    priceTaxMode: 'EXCLUSIVE',
  })
  const out2 = await createOutlet(ownerActor, {
    legalEntityId: le.id,
    code: 'OUT02',
    name: 'Outlet 2',
    timezone: 'Asia/Jakarta',
    dayCutoffTime: '00:00',
    priceTaxMode: 'EXCLUSIVE',
  })

  const reg1 = await createRegister(ownerActor, {
    outletId: out1.id,
    code: 'POS01',
    name: 'POS 1',
    registerType: 'CASHIER',
    invoicePrefix: 'OUT01-POS01',
  })
  const reg2 = await createRegister(ownerActor, {
    outletId: out1.id,
    code: 'POS02',
    name: 'POS 2',
    registerType: 'CASHIER',
    invoicePrefix: 'OUT01-POS02',
  })
  const reg3 = await createRegister(ownerActor, {
    outletId: out2.id,
    code: 'POS01',
    name: 'POS Out2',
    registerType: 'CASHIER',
    invoicePrefix: 'OUT02-POS01',
  })

  const roles = await listRolesWithPermissions(ownerActor)
  const cashierRole = roles.find((r) => r.code === 'CASHIER')!
  const managerRole = roles.find((r) => r.code === 'MANAGER')!

  // Staff 1: OUT01 Cashier
  const staff1Email = `cashier1-${slug}@example.test`
  const inv1 = await createInvite(ownerActor, {
    email: staff1Email,
    displayName: 'Kasir Out1',
    roleId: cashierRole.id,
    outletIds: [out1.id],
  })
  await redeemInvite({
    tenantId: created.tenantId,
    tenantSlug: slug,
    authOrgId: meta!.authOrgId,
    email: staff1Email,
    code: inv1.code,
    password: 'StaffPassword123!',
  })

  // Manager bound ONLY to OUT02 (to test scope enforcement)
  const mgr2Email = `mgr2-${slug}@example.test`
  const invMgr2 = await createInvite(ownerActor, {
    email: mgr2Email,
    displayName: 'Mgr Out2',
    roleId: managerRole.id,
    outletIds: [out2.id],
  })
  await redeemInvite({
    tenantId: created.tenantId,
    tenantSlug: slug,
    authOrgId: meta!.authOrgId,
    email: mgr2Email,
    code: invMgr2.code,
    password: 'MgrPassword123!',
  })
  const mgr2Actor: IdentityAuthActor = {
    tenantId: created.tenantId,
    tenantSlug: slug,
    authOrgId: meta!.authOrgId,
    appUserId: invMgr2.appUserId,
    permissions: new Set(managerRole.permissions),
    outletIds: [out2.id],
    roleCodes: ['MANAGER'],
  }

  return {
    tenantId: created.tenantId,
    slug,
    ownerActor,
    mgr2Actor,
    out1,
    out2,
    reg1,
    reg2,
    reg3,
    staff1Id: inv1.appUserId,
    cashierRoleId: cashierRole.id,
  }
}

async function pullAllStaffPins(args: {
  tenantId: string
  outletId: string
  registerId: string
  deviceId: string
}): Promise<FeedRow[]> {
  const { upper } = await startPullCycle(args.tenantId)
  const res = await pullPage({
    tenantId: args.tenantId,
    scope: args,
    cursor: null,
    cycleUpper: upper,
    pageSize: 500,
  })
  if (res.fullResyncRequired) throw new Error('Unexpected full resync required')
  return res.rows.filter((r) => r.entity === 'staff_pin')
}

describe('PIN server lifecycle, device-scoped derivation, feed isolation, ReportPinState & RLS', () => {
  beforeEach(() => {
    resetEnvForTests()
    __clearTenantCacheForTests()
    __clearDeviceAuthCacheForTests()
    resetLimitersForTests()
    __resetPushLimitsForTests()
    resetCompositionForTests()
    composeServer()
  })

  afterAll(async () => {
    await closePools()
  })

  it('derives distinct per-device hashes, syncs strictly per device, updates on enroll/revoke/outlet move, and enforces policy/scope', async () => {
    const env = await setupPinTenant('pin-main')

    // Enroll dev1 (OUT01 POS01) & dev3 (OUT02 POS01) BEFORE setting PIN
    const p1 = await createPairingCode(env.ownerActor, env.reg1.id)
    const dev1 = await enrollDevice({ slug: env.slug, code: p1.code, device_name: 'Dev1' }, '10.1.1.1', { minDelayMs: 0 })
    const p3 = await createPairingCode(env.ownerActor, env.reg3.id)
    const dev3 = await enrollDevice({ slug: env.slug, code: p3.code, device_name: 'Dev3' }, '10.1.1.3', { minDelayMs: 0 })

    // Weak PIN and wrong length rejected
    await expect(setPin(env.ownerActor, { userId: env.staff1Id, pin: '1234' })).rejects.toMatchObject({
      code: 'VALIDATION_FAILED',
    })
    await expect(setPin(env.ownerActor, { userId: env.staff1Id, pin: '123' })).rejects.toMatchObject({
      code: 'VALIDATION_FAILED',
    })

    // OUT02 Manager cannot set PIN for OUT01 Cashier
    await expect(setPin(env.mgr2Actor, { userId: env.staff1Id, pin: '4827' })).rejects.toMatchObject({
      code: 'FORBIDDEN',
    })

    // Owner sets PIN '4827' for OUT01 Cashier -> epoch 1
    const res1 = await setPin(env.ownerActor, { userId: env.staff1Id, pin: '4827' })
    expect(res1.pinEpoch).toBe(1)

    // Verifier is stored as non-plaintext Argon2id bytes; sentinel '4827' nowhere in DB or audit
    await withTenant(env.tenantId, async (tx) => {
      const cred = await tx.execute<{ verifier: Buffer; pin_epoch: number }>(
        `SELECT verifier, pin_epoch FROM user_pin_credential WHERE user_id = '${env.staff1Id}'`,
      )
      expect(cred.rows).toHaveLength(1)
      expect(cred.rows[0]!.pin_epoch).toBe(1)
      expect(cred.rows[0]!.verifier.length).toBe(32)
      expect(cred.rows[0]!.verifier.toString('utf8')).not.toContain('4827')

      const audits = await tx.execute<{ after_data: unknown }>(
        `SELECT after_data FROM audit_log WHERE action = 'pin.reset'`,
      )
      expect(JSON.stringify(audits.rows)).not.toContain('4827')

      const pinRows = await tx.execute<{ device_id: string }>(
        `SELECT device_id FROM staff_pin WHERE user_id = '${env.staff1Id}' AND deleted_at IS NULL`,
      )
      expect(pinRows.rows.map((r) => r.device_id)).toEqual([dev1.device_id])
    })

    // Enroll dev2 in OUT01 AFTER setPin -> auto-derives distinct staff_pin hash for dev2 inside enroll tx
    const p2 = await createPairingCode(env.ownerActor, env.reg2.id)
    const dev2 = await enrollDevice({ slug: env.slug, code: p2.code, device_name: 'Dev2' }, '10.1.1.2', { minDelayMs: 0 })

    // Feed isolation: dev1 gets ONLY dev1 row; dev2 gets ONLY dev2 row with DIFFERENT hash; dev3 (OUT02) gets 0
    const feed1 = await pullAllStaffPins({
      tenantId: env.tenantId,
      outletId: env.out1.id,
      registerId: env.reg1.id,
      deviceId: dev1.device_id,
    })
    const feed2 = await pullAllStaffPins({
      tenantId: env.tenantId,
      outletId: env.out1.id,
      registerId: env.reg2.id,
      deviceId: dev2.device_id,
    })
    const feed3 = await pullAllStaffPins({
      tenantId: env.tenantId,
      outletId: env.out2.id,
      registerId: env.reg3.id,
      deviceId: dev3.device_id,
    })

    const staff1Feed1 = feed1.find((r) => r.op === 'upsert' && r.row?.user_id === env.staff1Id)
    const staff1Feed2 = feed2.find((r) => r.op === 'upsert' && r.row?.user_id === env.staff1Id)
    expect(staff1Feed1).toBeDefined()
    expect(staff1Feed2).toBeDefined()
    expect(staff1Feed1!.row!.pin_hash).not.toBe(staff1Feed2!.row!.pin_hash)
    expect(staff1Feed1!.row!.device_salt).not.toBe(staff1Feed2!.row!.device_salt)
    expect(feed3.filter((r) => r.op === 'upsert' && r.row?.user_id === env.staff1Id)).toHaveLength(0)

    // Client WebCrypto verification reproduces exact wire pin_hash for dev1 & dev2!
    for (const entry of [staff1Feed1!, staff1Feed2!]) {
      const row = entry.row!
      const clientHash = await computePinHashDirect('4827', {
        device_salt: String(row.device_salt),
        kdf_algo: row.kdf_algo as 'ARGON2ID',
        kdf_params: row.kdf_params as {
          memorySize: number
          iterations: number
          parallelism: number
          hashLength: number
        },
        kdf_salt: String(row.kdf_salt),
      })
      expect(bytesToBase64Url(clientHash)).toBe(row.pin_hash)
    }

    // Move staff1 from OUT01 to OUT02 -> OUT01 dev1/dev2 tombstoned, OUT02 dev3 created!
    await changeMemberRoleAndOutlets(env.ownerActor, {
      appUserId: env.staff1Id,
      assignments: [{ outletId: env.out2.id, roleId: env.cashierRoleId }],
    })
    await withTenant(env.tenantId, async (tx) => {
      const activePins = await tx.execute<{ device_id: string }>(
        `SELECT device_id FROM staff_pin WHERE user_id = '${env.staff1Id}' AND deleted_at IS NULL`,
      )
      expect(activePins.rows.map((r) => r.device_id)).toEqual([dev3.device_id])
    })

    // Revoke dev3 -> staff_pin for dev3 tombstoned
    await revokeDevice(env.ownerActor, { deviceId: dev3.device_id, reasonCode: 'REPLACED' })
    await withTenant(env.tenantId, async (tx) => {
      const activePins = await tx.execute<{ device_id: string }>(
        `SELECT device_id FROM staff_pin WHERE device_id = '${dev3.device_id}' AND deleted_at IS NULL`,
      )
      expect(activePins.rows).toHaveLength(0)
    })
  })

  it('processes ReportPinState monotonically, audits lock_tier 3, clears status on resetPin, and isolates RLS across tenants', async () => {
    const env = await setupPinTenant('pin-rpt')
    const envB = await setupPinTenant('pin-rlsb')

    const p1 = await createPairingCode(env.ownerActor, env.reg1.id)
    const dev1 = await enrollDevice({ slug: env.slug, code: p1.code, device_name: 'Dev1' }, '10.1.2.1', { minDelayMs: 0 })
    const syncDev: SyncDeviceIdentity = {
      tenantId: env.tenantId,
      deviceId: dev1.device_id,
      registerId: env.reg1.id,
      outletId: env.out1.id,
      registerType: 'CASHIER',
    }

    await setPin(env.ownerActor, { userId: env.staff1Id, pin: '4827' })

    // Report lock_tier = 3 at device_seq = 5 -> persisted + pin.locked audit
    const rLocked = await processPush(
      syncDev,
      {
        sent_at_device: '2026-11-20T10:00:00.000Z',
        clock_offset_ms: 0,
        commands: [
          {
            id: idGen.newId(),
            type: 'ReportPinState',
            schema_version: 1,
            device_seq: 5,
            depends_on: [],
            created_at_device: '2026-11-20T10:00:00.000Z',
            payload: {
              user_id: env.staff1Id,
              failed_count: 15,
              lock_tier: 3,
              locked_until: null,
              last_failed_at: '2026-11-20T10:00:00.000Z',
              pin_epoch_seen: 1,
            },
          },
        ],
      },
      { schemaVersion: 1, appVersion: 'v0.1.0', syncProtocol: 1, requestRef: 'pin-lock-5' },
    )
    expect(rLocked.results[0]!.outcome).toBe('ACK')

    // Stale ReportPinState with device_seq = 2 (< 5) is ACKed idempotently without overwriting failed_count 15!
    const rStale = await processPush(
      syncDev,
      {
        sent_at_device: '2026-11-20T10:01:00.000Z',
        clock_offset_ms: 0,
        commands: [
          {
            id: idGen.newId(),
            type: 'ReportPinState',
            schema_version: 1,
            device_seq: 2,
            depends_on: [],
            created_at_device: '2026-11-20T09:50:00.000Z',
            payload: {
              user_id: env.staff1Id,
              failed_count: 5,
              lock_tier: 1,
              locked_until: '2026-11-20T09:55:00.000Z',
              last_failed_at: '2026-11-20T09:50:00.000Z',
              pin_epoch_seen: 1,
            },
          },
        ],
      },
      { schemaVersion: 1, appVersion: 'v0.1.0', syncProtocol: 1, requestRef: 'pin-stale-2' },
    )
    expect(rStale.results[0]).toMatchObject({ outcome: 'ACK', result: { applied: false } })

    // listMembers reports real 'locked' status
    const membersLocked = await listMembers(env.ownerActor)
    expect(membersLocked.find((m) => m.appUserId === env.staff1Id)?.pinStatus).toBe('locked')

    // Manager resets PIN -> epoch bumps to 2, listMembers immediately reports 'active' again
    const rReset = await resetPin(env.ownerActor, { userId: env.staff1Id, pin: '7391' })
    expect(rReset.pinEpoch).toBe(2)
    const membersAfterReset = await listMembers(env.ownerActor)
    expect(membersAfterReset.find((m) => m.appUserId === env.staff1Id)?.pinStatus).toBe('active')

    // Tenant B sees 0 rows in all 3 PIN tables & cannot see Tenant A's PIN status; audit chain holds
    await withTenant(envB.tenantId, async (tx) => {
      for (const tbl of ['user_pin_credential', 'staff_pin', 'staff_pin_state'] as const) {
        const res = await tx.execute<{ cnt: number }>(`SELECT count(*)::int AS cnt FROM "${tbl}"`)
        expect(res.rows[0]!.cnt).toBe(0)
      }
    })
    await withTenant(env.tenantId, async (tx) => {
      const chain = await verifyAuditChain(tx)
      expect(chain.ok).toBe(true)
      const lockedAudit = await tx.execute<{ cnt: number }>(
        `SELECT count(*)::int AS cnt FROM audit_log WHERE action = 'pin.locked' AND entity_id = '${env.staff1Id}'`,
      )
      expect(lockedAudit.rows[0]!.cnt).toBe(1)
    })
  })
})
