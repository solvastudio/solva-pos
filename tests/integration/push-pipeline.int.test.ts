import { webcrypto } from 'node:crypto'
import * as fc from 'fast-check'
import { sql } from 'drizzle-orm'
import { afterAll, afterEach, beforeEach, describe, expect, it } from 'vitest'
import { createIdGenerator, parseIsoUtcMs } from '~/lib/kernel'
import { type PushCommandEnvelope } from '~/lib/contracts'
import { verifyAuditChain } from '~/modules/audit/public'
import {
  __clearDeviceAuthCacheForTests,
  __clearTenantCacheForTests,
  createLegalEntity,
  createOutlet,
  createPairingCode,
  createRegister,
  createTenant,
  enrollDevice,
  getTenantAuthMetadataBySlug,
  redeemInvite,
  type IdentityAuthActor,
} from '~/modules/identity/public'
import { PERMISSION_CODES } from '~/modules/identity/shared'
import {
  processPush,
  registerCommandHandler,
  type SyncDeviceIdentity,
} from '~/modules/sync/public'
import { composeServer, resetCompositionForTests } from '~/server/composition'
import { resetLimitersForTests } from '~/server/auth/rate-limit/limiters'
import { __resetPushLimitsForTests } from '~/server/auth/rate-limit/push-limits'
import { closePools, withTenant } from '~/server/db'
import { resetEnvForTests } from '~/server/env'
import { AppError } from '~/server/error-classify'
import { captureLogs } from '~/server/logging/logger-core'
import { __resetNotifierForTests, createNotifier } from '~/server/notify/notifier'
import { uniqueSlug } from './helpers/tenants'

const testIdGen = createIdGenerator({
  nowMs: () => Date.now(),
  nextUint32: () => {
    const buf = new Uint32Array(1)
    webcrypto.getRandomValues(buf)
    return buf[0]!
  },
})

const testOp = { platformUserId: testIdGen.newId(), email: 'op-push@example.test' }

async function setupDeviceFixture(
  slug: string,
  registerType: 'CASHIER' | 'WAITER' = 'CASHIER',
) {
  const email = `owner-${slug}@example.test`
  const created = await createTenant(testOp, {
    name: `Push ${slug}`,
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
  const le = await createLegalEntity(actor, { name: 'PT Push', isPkp: false })
  const out = await createOutlet(actor, {
    legalEntityId: le.id,
    code: 'OUT01',
    name: 'Outlet 01',
    timezone: 'Asia/Jakarta',
    dayCutoffTime: '00:00',
    priceTaxMode: 'INCLUSIVE',
  })
  const reg = await createRegister(actor, {
    outletId: out.id,
    code: registerType === 'CASHIER' ? 'POS01' : 'WTR01',
    name: registerType === 'CASHIER' ? 'Cashier 1' : 'Waiter 1',
    registerType,
    invoicePrefix: registerType === 'CASHIER' ? 'OUT01-POS01' : null,
  })
  const pairing = await createPairingCode(actor, reg.id)
  const enrolled = await enrollDevice(
    { slug, code: pairing.code, device_name: `Tablet-${registerType}` },
    '10.3.0.1',
    { minDelayMs: 0 },
  )
  const syncDevice: SyncDeviceIdentity = {
    tenantId: created.tenantId,
    deviceId: enrolled.device_id,
    registerId: reg.id,
    outletId: out.id,
    registerType,
  }
  return { tenantId: created.tenantId, actor, outlet: out, register: reg, syncDevice }
}

async function getAuditLastSeq(tenantId: string): Promise<number> {
  return withTenant(tenantId, async (tx) => {
    const res = await tx.execute(
      sql`SELECT last_seq FROM audit_chain_head WHERE tenant_id = ${tenantId}::uuid`,
    )
    return res.rows[0] ? Number(res.rows[0].last_seq) : 0
  })
}

function makeAuditCmd(
  deviceSeq: number,
  overrides?: {
    id?: string
    depends_on?: string[]
    entry?: Record<string, unknown>
  },
): PushCommandEnvelope {
  const commandId = overrides?.id ?? testIdGen.newId()
  const nowIso = new Date().toISOString()
  return {
    id: commandId,
    type: 'AppendAudit',
    schema_version: 1,
    device_seq: deviceSeq,
    depends_on: overrides?.depends_on ?? [],
    created_at_device: nowIso,
    payload: {
      entry: {
        id: testIdGen.newId(),
        action: 'cash.movement',
        entity_type: 'cash_movement',
        entity_id: testIdGen.newId(),
        before_data: null,
        after_data: { amount: 50000 },
        reason_code: 'PETTY_CASH',
        reason_text: 'Restock ice',
        actor_user_id: null,
        approver_user_id: null,
        occurred_at_device: nowIso,
        occurred_at: nowIso,
        business_date: '2026-11-20',
        related_command_id: null,
        ...overrides?.entry,
      },
    },
  }
}

describe('push pipeline integration (idempotency, attention queue, dependencies, audit handler)', () => {
  beforeEach(() => {
    resetCompositionForTests()
    composeServer()
    resetLimitersForTests()
    __resetPushLimitsForTests()
    __clearDeviceAuthCacheForTests()
    __clearTenantCacheForTests()
  })

  afterEach(() => {
    resetCompositionForTests()
  })

  afterAll(async () => {
    await closePools()
  })

  it('replays identical AppendAudit command 5x idempotently and updates device_sync_status', async () => {
    const slug = uniqueSlug('push-replay')
    const fx = await setupDeviceFixture(slug)
    const baseSeq = await getAuditLastSeq(fx.tenantId)
    const cmd = makeAuditCmd(1, { entry: { actor_user_id: fx.actor.appUserId } })

    const results = []
    for (let i = 0; i < 5; i += 1) {
      const res = await processPush(
        fx.syncDevice,
        {
          sent_at_device: new Date().toISOString(),
          clock_offset_ms: 120,
          commands: [cmd],
        },
        {
          schemaVersion: 1,
          appVersion: 'v0.1.0',
          syncProtocol: 1,
          requestRef: `req-replay-${i}`,
        },
      )
      expect(res.results).toHaveLength(1)
      expect(res.max_schema_version).toBe(1)
      results.push(res.results[0]!)
    }

    const first = results[0]!
    expect(first.outcome).toBe('ACK')
    if (first.outcome === 'ACK') {
      expect(typeof first.result.audit_id).toBe('string')
      expect(first.result.chain_seq).toBe(baseSeq + 1)
      for (const r of results) {
        expect(r).toEqual(first)
      }
    }

    await withTenant(fx.tenantId, async (tx) => {
      const idemRows = await tx.execute(
        sql`SELECT attempt_count, status FROM idempotency_command WHERE command_id = ${cmd.id}::uuid`,
      )
      expect(idemRows.rows).toHaveLength(1)
      expect(Number(idemRows.rows[0]!.attempt_count)).toBe(5)
      expect(idemRows.rows[0]!.status).toBe('ACKED')

      const auditRows = await tx.execute(
        sql`SELECT id, command_id FROM audit_log WHERE command_id = ${cmd.id}::uuid`,
      )
      expect(auditRows.rows).toHaveLength(1)

      const devStatus = await tx.execute(
        sql`SELECT last_push_at, last_success_sync_at, clock_offset_ms, app_version, schema_version
            FROM device_sync_status WHERE device_id = ${fx.syncDevice.deviceId}::uuid`,
      )
      expect(devStatus.rows).toHaveLength(1)
      expect(devStatus.rows[0]!.last_push_at).not.toBeNull()
      expect(devStatus.rows[0]!.last_success_sync_at).not.toBeNull()
      expect(Number(devStatus.rows[0]!.clock_offset_ms)).toBe(120)
      expect(devStatus.rows[0]!.app_version).toBe('v0.1.0')
      expect(Number(devStatus.rows[0]!.schema_version)).toBe(1)

      const chain = await verifyAuditChain(tx)
      expect(chain.ok).toBe(true)
    })
  })

  it('rejects hash-mismatched replay as ATTENTION without mutating original row', async () => {
    const slug = uniqueSlug('push-mismatch')
    const fx = await setupDeviceFixture(slug)
    const cmdId = testIdGen.newId()
    const orig = makeAuditCmd(1, { id: cmdId, entry: { reason_text: 'Original reason' } })

    const first = await processPush(
      fx.syncDevice,
      { sent_at_device: new Date().toISOString(), clock_offset_ms: 0, commands: [orig] },
      { schemaVersion: 1, appVersion: 'v0.1.0', syncProtocol: 1, requestRef: 'req-m-1' },
    )
    expect(first.results[0]!.outcome).toBe('ACK')

    const tampered = makeAuditCmd(1, { id: cmdId, entry: { reason_text: 'Tampered reason' } })
    const second = await processPush(
      fx.syncDevice,
      { sent_at_device: new Date().toISOString(), clock_offset_ms: 0, commands: [tampered] },
      { schemaVersion: 1, appVersion: 'v0.1.0', syncProtocol: 1, requestRef: 'req-m-2' },
    )
    expect(second.results[0]).toEqual({
      id: cmdId,
      outcome: 'ATTENTION',
      reason_class: 'STRUCTURAL',
      reason_code: 'VALIDATION_FAILED',
      ref: 'req-m-2',
    })

    await withTenant(fx.tenantId, async (tx) => {
      const idemRows = await tx.execute(
        sql`SELECT status, attempt_count FROM idempotency_command WHERE command_id = ${cmdId}::uuid`,
      )
      expect(idemRows.rows[0]!.status).toBe('ACKED')
      expect(Number(idemRows.rows[0]!.attempt_count)).toBe(1)

      const auditRows = await tx.execute(
        sql`SELECT reason_text FROM audit_log WHERE command_id = ${cmdId}::uuid`,
      )
      expect(auditRows.rows).toHaveLength(1)
      expect(auditRows.rows[0]!.reason_text).toBe('Original reason')
    })
  })

  it('sends invalid AppendAudit action to attention_item and replays identical ATTENTION', async () => {
    const slug = uniqueSlug('push-badact')
    const fx = await setupDeviceFixture(slug)
    const cmd = makeAuditCmd(1, { entry: { action: 'invalid.action.name' } })

    const first = await processPush(
      fx.syncDevice,
      { sent_at_device: new Date().toISOString(), clock_offset_ms: 0, commands: [cmd] },
      { schemaVersion: 1, appVersion: 'v0.1.0', syncProtocol: 1, requestRef: 'req-ba-1' },
    )
    expect(first.results[0]).toEqual({
      id: cmd.id,
      outcome: 'ATTENTION',
      reason_class: 'STRUCTURAL',
      reason_code: 'VALIDATION_FAILED',
      ref: 'req-ba-1',
    })

    const replay = await processPush(
      fx.syncDevice,
      { sent_at_device: new Date().toISOString(), clock_offset_ms: 0, commands: [cmd] },
      { schemaVersion: 1, appVersion: 'v0.1.0', syncProtocol: 1, requestRef: 'req-ba-2' },
    )
    expect(replay.results[0]).toEqual({
      id: cmd.id,
      outcome: 'ATTENTION',
      reason_class: 'STRUCTURAL',
      reason_code: 'VALIDATION_FAILED',
      ref: 'req-ba-1',
    })

    await withTenant(fx.tenantId, async (tx) => {
      const attRows = await tx.execute(
        sql`SELECT reason_class, reason_code, status FROM attention_item WHERE command_id = ${cmd.id}::uuid`,
      )
      expect(attRows.rows).toHaveLength(1)
      expect(attRows.rows[0]!.reason_class).toBe('STRUCTURAL')
      expect(attRows.rows[0]!.reason_code).toBe('VALIDATION_FAILED')
      expect(attRows.rows[0]!.status).toBe('OPEN')

      const idemRows = await tx.execute(
        sql`SELECT status, attempt_count FROM idempotency_command WHERE command_id = ${cmd.id}::uuid`,
      )
      expect(idemRows.rows[0]!.status).toBe('ATTENTION')
      expect(Number(idemRows.rows[0]!.attempt_count)).toBe(2)
    })
  })

  it('rejects cross-tenant actor_user_id with UNKNOWN_REFERENCE and WAITER forbidden type with AUTHORIZATION', async () => {
    const slugA = uniqueSlug('push-iso-a')
    const slugB = uniqueSlug('push-iso-b')
    const fxA = await setupDeviceFixture(slugA, 'CASHIER')
    const fxB = await setupDeviceFixture(slugB, 'WAITER')

    const crossActorCmd = makeAuditCmd(1, { entry: { actor_user_id: fxB.actor.appUserId } })
    const resA = await processPush(
      fxA.syncDevice,
      { sent_at_device: new Date().toISOString(), clock_offset_ms: 0, commands: [crossActorCmd] },
      { schemaVersion: 1, appVersion: 'v0.1.0', syncProtocol: 1, requestRef: 'req-xt-1' },
    )
    expect(resA.results[0]).toEqual({
      id: crossActorCmd.id,
      outcome: 'ATTENTION',
      reason_class: 'STRUCTURAL',
      reason_code: 'UNKNOWN_REFERENCE',
      ref: 'req-xt-1',
    })

    let openShiftCalled = false
    registerCommandHandler({
      type: 'OpenShift',
      parse: (p) => p,
      async handle() {
        openShiftCalled = true
        return { ok: true }
      },
    })

    const waiterCmd: PushCommandEnvelope = {
      id: testIdGen.newId(),
      type: 'OpenShift',
      schema_version: 1,
      device_seq: 1,
      depends_on: [],
      created_at_device: new Date().toISOString(),
      payload: { opening_cash: 100000 },
    }
    const resWaiter = await processPush(
      fxB.syncDevice,
      { sent_at_device: new Date().toISOString(), clock_offset_ms: 0, commands: [waiterCmd] },
      { schemaVersion: 1, appVersion: 'v0.1.0', syncProtocol: 1, requestRef: 'req-wtr-1' },
    )
    expect(openShiftCalled).toBe(false)
    expect(resWaiter.results[0]).toEqual({
      id: waiterCmd.id,
      outcome: 'ATTENTION',
      reason_class: 'AUTHORIZATION',
      reason_code: 'FORBIDDEN',
      ref: 'req-wtr-1',
    })

    // Cross-tenant scope guard on outlet_id
    const wrongOutletCmd = makeAuditCmd(2, {
      entry: { outlet_id: fxB.outlet.id },
    })
    const resWrongOutlet = await processPush(
      fxA.syncDevice,
      { sent_at_device: new Date().toISOString(), clock_offset_ms: 0, commands: [wrongOutletCmd] },
      { schemaVersion: 1, appVersion: 'v0.1.0', syncProtocol: 1, requestRef: 'req-xo-1' },
    )
    expect(resWrongOutlet.results[0]).toEqual({
      id: wrongOutletCmd.id,
      outcome: 'ATTENTION',
      reason_class: 'AUTHORIZATION',
      reason_code: 'FORBIDDEN',
      ref: 'req-xo-1',
    })

    // Tenant B RLS cannot see Tenant A idempotency or audit rows
    await withTenant(fxB.tenantId, async (tx) => {
      const aRows = await tx.execute(
        sql`SELECT command_id FROM idempotency_command WHERE command_id = ${crossActorCmd.id}::uuid`,
      )
      expect(aRows.rows).toHaveLength(0)
    })
  })

  it('returns RETRY with zero idempotency/audit rows under lock timeout, then ACK once unlocked', async () => {
    const slug = uniqueSlug('push-retry')
    const fx = await setupDeviceFixture(slug)
    const baseSeq = await getAuditLastSeq(fx.tenantId)

    const seed = makeAuditCmd(1)
    const seedRes = await processPush(
      fx.syncDevice,
      { sent_at_device: new Date().toISOString(), clock_offset_ms: 0, commands: [seed] },
      { schemaVersion: 1, appVersion: 'v0.1.0', syncProtocol: 1, requestRef: 'req-seed' },
    )
    expect(seedRes.results[0]!.outcome).toBe('ACK')

    const contended = makeAuditCmd(2)

    let releaseLock!: () => void
    const lockReleased = new Promise<void>((resolve) => {
      releaseLock = resolve
    })
    let lockAcquired!: () => void
    const onLockAcquired = new Promise<void>((resolve) => {
      lockAcquired = resolve
    })

    const lockHolder = withTenant(fx.tenantId, async (tx) => {
      await tx.execute(
        sql`SELECT last_seq FROM audit_chain_head WHERE tenant_id = ${fx.tenantId}::uuid FOR UPDATE`,
      )
      lockAcquired()
      await lockReleased
    })

    await onLockAcquired
    const blockedPush = await processPush(
      fx.syncDevice,
      { sent_at_device: new Date().toISOString(), clock_offset_ms: 0, commands: [contended] },
      { schemaVersion: 1, appVersion: 'v0.1.0', syncProtocol: 1, requestRef: 'req-retry-1' },
      { lockTimeoutMs: 50 },
    )
    expect(blockedPush.results[0]).toEqual({ id: contended.id, outcome: 'RETRY' })

    releaseLock()
    await lockHolder

    await withTenant(fx.tenantId, async (tx) => {
      const idem = await tx.execute(
        sql`SELECT 1 FROM idempotency_command WHERE command_id = ${contended.id}::uuid`,
      )
      expect(idem.rows).toHaveLength(0)
    })

    const retried = await processPush(
      fx.syncDevice,
      { sent_at_device: new Date().toISOString(), clock_offset_ms: 0, commands: [contended] },
      { schemaVersion: 1, appVersion: 'v0.1.0', syncProtocol: 1, requestRef: 'req-retry-2' },
    )
    expect(retried.results[0]!.outcome).toBe('ACK')

    await withTenant(fx.tenantId, async (tx) => {
      const chain = await verifyAuditChain(tx)
      expect(chain).toEqual({ ok: true, checked: baseSeq + 2 })
    })
  })

  it('returns HELD on unmet/ATTENTION parent, unblocks on ACK, and rejects on DISMISSED parent', async () => {
    const slug = uniqueSlug('push-deps')
    const fx = await setupDeviceFixture(slug)

    const missingParentId = testIdGen.newId()
    const childWaiting = makeAuditCmd(2, { depends_on: [missingParentId] })
    const heldMissing = await processPush(
      fx.syncDevice,
      { sent_at_device: new Date().toISOString(), clock_offset_ms: 0, commands: [childWaiting] },
      { schemaVersion: 1, appVersion: 'v0.1.0', syncProtocol: 1, requestRef: 'req-held-1' },
    )
    expect(heldMissing.results[0]).toEqual({ id: childWaiting.id, outcome: 'HELD' })

    // Invalid parent goes to ATTENTION; child depending on it remains HELD
    const badParent = makeAuditCmd(3, { entry: { action: 'bad.parent.action' } })
    const childOnBad = makeAuditCmd(4, { depends_on: [badParent.id] })
    const resBadDep = await processPush(
      fx.syncDevice,
      {
        sent_at_device: new Date().toISOString(),
        clock_offset_ms: 0,
        commands: [badParent, childOnBad],
      },
      { schemaVersion: 1, appVersion: 'v0.1.0', syncProtocol: 1, requestRef: 'req-held-2' },
    )
    expect(resBadDep.results[0]!.outcome).toBe('ATTENTION')
    expect(resBadDep.results[1]).toEqual({ id: childOnBad.id, outcome: 'HELD' })

    // Push parent and childWaiting now -> both ACK in seq order
    const validParent = makeAuditCmd(1, { id: missingParentId })
    const resUnblocked = await processPush(
      fx.syncDevice,
      {
        sent_at_device: new Date().toISOString(),
        clock_offset_ms: 0,
        commands: [childWaiting, validParent],
      },
      { schemaVersion: 1, appVersion: 'v0.1.0', syncProtocol: 1, requestRef: 'req-unblock' },
    )
    expect(resUnblocked.results.map((r) => r.outcome)).toEqual(['ACK', 'ACK'])

    // Dismiss badParent manually in DB under tenant RLS -> childOnBad gets UNKNOWN_REFERENCE
    await withTenant(fx.tenantId, async (tx) => {
      await tx.execute(
        sql`UPDATE idempotency_command SET status = 'DISMISSED' WHERE command_id = ${badParent.id}::uuid`,
      )
    })
    const resDismissedDep = await processPush(
      fx.syncDevice,
      { sent_at_device: new Date().toISOString(), clock_offset_ms: 0, commands: [childOnBad] },
      { schemaVersion: 1, appVersion: 'v0.1.0', syncProtocol: 1, requestRef: 'req-dismissed' },
    )
    expect(resDismissedDep.results[0]).toEqual({
      id: childOnBad.id,
      outcome: 'ATTENTION',
      reason_class: 'STRUCTURAL',
      reason_code: 'UNKNOWN_REFERENCE',
      ref: 'req-dismissed',
    })
  })

  it('orders commands in ascending device_seq regardless of arrival order', async () => {
    const slug = uniqueSlug('push-seq')
    const fx = await setupDeviceFixture(slug)
    const baseSeq = await getAuditLastSeq(fx.tenantId)

    const cmdSeq20 = makeAuditCmd(20)
    const cmdSeq10 = makeAuditCmd(10)

    const res = await processPush(
      fx.syncDevice,
      {
        sent_at_device: new Date().toISOString(),
        clock_offset_ms: 0,
        commands: [cmdSeq20, cmdSeq10],
      },
      { schemaVersion: 1, appVersion: 'v0.1.0', syncProtocol: 1, requestRef: 'req-order' },
    )

    expect(res.results).toHaveLength(2)
    expect(res.results[0]!.id).toBe(cmdSeq10.id)
    expect(res.results[1]!.id).toBe(cmdSeq20.id)
    if (res.results[0]!.outcome === 'ACK' && res.results[1]!.outcome === 'ACK') {
      expect(Number(res.results[0]!.result.chain_seq)).toBe(baseSeq + 1)
      expect(Number(res.results[1]!.result.chain_seq)).toBe(baseSeq + 2)
    }
  })

  it('throws AppError(UPDATE_REQUIRED) for unsupported schema version', async () => {
    const slug = uniqueSlug('push-schema')
    const fx = await setupDeviceFixture(slug)

    await expect(
      processPush(
        fx.syncDevice,
        { sent_at_device: new Date().toISOString(), clock_offset_ms: 0, commands: [] },
        { schemaVersion: 99, appVersion: 'v9.9.9', syncProtocol: 1, requestRef: 'req-upd' },
      ),
    ).rejects.toMatchObject({
      code: 'UPDATE_REQUIRED',
    } satisfies Partial<AppError>)
  })

  it('converges across random orderings, duplicates, and transient faults (fast-check)', async () => {
    const slug = uniqueSlug('push-fc')
    const fx = await setupDeviceFixture(slug)
    let nextSeq = 1

    await fc.assert(
      fc.asyncProperty(
        fc.integer({ min: 2, max: 5 }),
        fc.integer({ min: 0, max: 100 }),
        async (count, seed) => {
          const cmds: PushCommandEnvelope[] = []
          for (let i = 0; i < count; i += 1) {
            cmds.push(makeAuditCmd(nextSeq++))
          }

          // Duplicate every even item and shuffle deterministically via seed
          const withDupes = [...cmds, ...cmds.filter((_, idx) => idx % 2 === 0)]
          const shuffled = [...withDupes].sort(
            (a, b) =>
              ((a.device_seq * 31 + seed) % 97) - ((b.device_seq * 31 + seed) % 97),
          )

          // First pass with simulated transient lock contention on one chunk if lockTimeoutMs triggers
          await processPush(
            fx.syncDevice,
            { sent_at_device: new Date().toISOString(), clock_offset_ms: 0, commands: shuffled },
            { schemaVersion: 1, appVersion: 'v0.1.0', syncProtocol: 1, requestRef: `fc-${seed}-a` },
          )

          // Second pass replaying all unique commands guarantees all ACK
          const finalRes = await processPush(
            fx.syncDevice,
            { sent_at_device: new Date().toISOString(), clock_offset_ms: 0, commands: cmds },
            { schemaVersion: 1, appVersion: 'v0.1.0', syncProtocol: 1, requestRef: `fc-${seed}-b` },
          )
          for (const item of finalRes.results) {
            expect(item.outcome).toBe('ACK')
          }

          await withTenant(fx.tenantId, async (tx) => {
            const chain = await verifyAuditChain(tx)
            expect(chain.ok).toBe(true)
          })
        },
      ),
      { numRuns: 4 },
    )
  })

  it('logs 1 structured summary per command without leaking raw payload content', async () => {
    const slug = uniqueSlug('push-log')
    const fx = await setupDeviceFixture(slug)
    const secretSentinel = 'SENTINEL_PAYLOAD_NO_LEAK_8821'
    const cmd = makeAuditCmd(1, {
      entry: {
        reason_text: secretSentinel,
        after_data: { note: secretSentinel },
      },
    })

    const logs = captureLogs('info')
    try {
      const res = await processPush(
        fx.syncDevice,
        { sent_at_device: new Date().toISOString(), clock_offset_ms: 0, commands: [cmd] },
        { schemaVersion: 1, appVersion: 'v0.1.0', syncProtocol: 1, requestRef: 'req-log-1' },
      )
      expect(res.results[0]!.outcome).toBe('ACK')

      const entries = logs.entries().filter((e) => e.scope === 'sync.push')
      expect(entries).toHaveLength(1)
      expect(entries[0]).toMatchObject({
        commandId: cmd.id,
        commandType: 'AppendAudit',
        schemaVersion: 1,
        outcome: 'ACK',
        msg: 'command processed',
      })
      expect(typeof entries[0]!.durationMs).toBe('number')

      const rawOutput = logs.lines().join('\n')
      expect(rawOutput).not.toContain(secretSentinel)
      expect(parseIsoUtcMs(res.server_time)).toBeGreaterThan(0)
    } finally {
      logs.stop()
    }
  })

  it('escalates repeated handler TypeError after N attempts to ATTENTION (INTERNAL_ERROR) with rate-limited Telegram alert and idempotency', async () => {
    const slug = uniqueSlug('push-escalate')
    const fx = await setupDeviceFixture(slug)

    const sentAlerts: string[] = []
    let mockNowMs = Date.UTC(2026, 10, 20, 12, 0, 0)
    const mockNotifier = createNotifier({
      enabled: true,
      now: () => mockNowMs,
      send: async (text) => {
        sentAlerts.push(text)
        return true
      },
    })
    __resetNotifierForTests(mockNotifier)

    let handleCalls = 0
    registerCommandHandler({
      type: 'OpenShift',
      parse: (raw) => raw,
      handle: async () => {
        handleCalls += 1
        throw new TypeError('cannot read property xyz')
      },
    })

    const cmdId = testIdGen.newId()
    const nowIso = new Date().toISOString()
    const cmd: PushCommandEnvelope = {
      id: cmdId,
      type: 'OpenShift',
      schema_version: 1,
      device_seq: 1,
      depends_on: [],
      created_at_device: nowIso,
      payload: { outlet_id: fx.outlet.id },
    }

    try {
      // Attempts 1..9 must stay RETRY with persistent attempt_count incrementing across rolled-back txs.
      for (let attempt = 1; attempt <= 9; attempt += 1) {
        const res = await processPush(
          fx.syncDevice,
          { sent_at_device: nowIso, clock_offset_ms: 0, commands: [cmd] },
          { schemaVersion: 1, appVersion: 'v0.1.0', syncProtocol: 1, requestRef: `req-te-${attempt}` },
        )
        expect(res.results[0]).toEqual({ id: cmdId, outcome: 'RETRY' })

        await withTenant(fx.tenantId, async (tx) => {
          const tracker = await tx.execute(
            sql`SELECT attempt_count, last_error_code FROM command_failure_attempt WHERE command_id = ${cmdId}::uuid`,
          )
          expect(tracker.rows).toHaveLength(1)
          expect(Number(tracker.rows[0]!.attempt_count)).toBe(attempt)
          const idem = await tx.execute(
            sql`SELECT 1 FROM idempotency_command WHERE command_id = ${cmdId}::uuid`,
          )
          expect(idem.rows).toHaveLength(0)
        })
      }

      // 10th attempt (default N=10) escalates to ATTENTION STRUCTURAL INTERNAL_ERROR.
      const escalated = await processPush(
        fx.syncDevice,
        { sent_at_device: nowIso, clock_offset_ms: 0, commands: [cmd] },
        { schemaVersion: 1, appVersion: 'v0.1.0', syncProtocol: 1, requestRef: 'req-te-10' },
      )
      expect(escalated.results[0]).toEqual({
        id: cmdId,
        outcome: 'ATTENTION',
        reason_class: 'STRUCTURAL',
        reason_code: 'INTERNAL_ERROR',
        ref: 'req-te-10',
      })
      expect(handleCalls).toBe(10)

      await mockNotifier.flushForTests()
      expect(sentAlerts).toHaveLength(1)
      expect(sentAlerts[0]).toContain('code=INTERNAL_ERROR')

      await withTenant(fx.tenantId, async (tx) => {
        const idem = await tx.execute(
          sql`SELECT status, attempt_count FROM idempotency_command WHERE command_id = ${cmdId}::uuid`,
        )
        expect(idem.rows).toHaveLength(1)
        expect(idem.rows[0]!.status).toBe('ATTENTION')
        expect(Number(idem.rows[0]!.attempt_count)).toBe(10)

        const att = await tx.execute(
          sql`SELECT reason_class, reason_code, status FROM attention_item WHERE command_id = ${cmdId}::uuid`,
        )
        expect(att.rows).toHaveLength(1)
        expect(att.rows[0]!.reason_class).toBe('STRUCTURAL')
        expect(att.rows[0]!.reason_code).toBe('INTERNAL_ERROR')
        expect(att.rows[0]!.status).toBe('OPEN')

        const tracker = await tx.execute(
          sql`SELECT 1 FROM command_failure_attempt WHERE command_id = ${cmdId}::uuid`,
        )
        expect(tracker.rows).toHaveLength(0)
      })

      // Replay after escalation is idempotent and does NOT re-invoke the buggy handler.
      const replay = await processPush(
        fx.syncDevice,
        { sent_at_device: nowIso, clock_offset_ms: 0, commands: [cmd] },
        { schemaVersion: 1, appVersion: 'v0.1.0', syncProtocol: 1, requestRef: 'req-te-11' },
      )
      expect(replay.results[0]).toEqual({
        id: cmdId,
        outcome: 'ATTENTION',
        reason_class: 'STRUCTURAL',
        reason_code: 'INTERNAL_ERROR',
        ref: 'req-te-10',
      })
      expect(handleCalls).toBe(10)

      // Env override (SYNC_PUSH_MAX_FAILURE_ATTEMPTS=2) triggers earlier escalation and respects Telegram cooldown.
      const prevLimit = process.env.SYNC_PUSH_MAX_FAILURE_ATTEMPTS
      process.env.SYNC_PUSH_MAX_FAILURE_ATTEMPTS = '2'
      resetEnvForTests()
      mockNowMs += 5_000 // still within 10-min Telegram cooldown
      try {
        const cmd2: PushCommandEnvelope = {
          ...cmd,
          id: testIdGen.newId(),
          device_seq: 2,
        }
        const r1 = await processPush(
          fx.syncDevice,
          { sent_at_device: nowIso, clock_offset_ms: 0, commands: [cmd2] },
          { schemaVersion: 1, appVersion: 'v0.1.0', syncProtocol: 1, requestRef: 'req-env-1' },
        )
        expect(r1.results[0]!.outcome).toBe('RETRY')
        const r2 = await processPush(
          fx.syncDevice,
          { sent_at_device: nowIso, clock_offset_ms: 0, commands: [cmd2] },
          { schemaVersion: 1, appVersion: 'v0.1.0', syncProtocol: 1, requestRef: 'req-env-2' },
        )
        expect(r2.results[0]!.outcome).toBe('ATTENTION')
        await mockNotifier.flushForTests()
        expect(sentAlerts).toHaveLength(1)
      } finally {
        if (prevLimit === undefined) delete process.env.SYNC_PUSH_MAX_FAILURE_ATTEMPTS
        else process.env.SYNC_PUSH_MAX_FAILURE_ATTEMPTS = prevLimit
        resetEnvForTests()
      }
    } finally {
      __resetNotifierForTests()
    }
  })

  it('keeps genuine transient lock timeout as RETRY without premature escalation and cleans tracker on ACK', async () => {
    const slug = uniqueSlug('push-lock-nonesc')
    const fx = await setupDeviceFixture(slug)
    await processPush(
      fx.syncDevice,
      { sent_at_device: new Date().toISOString(), clock_offset_ms: 0, commands: [makeAuditCmd(1)] },
      { schemaVersion: 1, appVersion: 'v0.1.0', syncProtocol: 1, requestRef: 'req-lock-prime' },
    )

    const contended = makeAuditCmd(2)
    let releaseLock!: () => void
    const lockReleased = new Promise<void>((resolve) => {
      releaseLock = resolve
    })
    let lockAcquired!: () => void
    const onLockAcquired = new Promise<void>((resolve) => {
      lockAcquired = resolve
    })

    const lockHolder = withTenant(fx.tenantId, async (tx) => {
      await tx.execute(
        sql`SELECT last_seq FROM audit_chain_head WHERE tenant_id = ${fx.tenantId}::uuid FOR UPDATE`,
      )
      lockAcquired()
      await lockReleased
    })

    await onLockAcquired
    try {
      for (let i = 1; i <= 3; i += 1) {
        const res = await processPush(
          fx.syncDevice,
          { sent_at_device: new Date().toISOString(), clock_offset_ms: 0, commands: [contended] },
          { schemaVersion: 1, appVersion: 'v0.1.0', syncProtocol: 1, requestRef: `req-lck-${i}` },
          { lockTimeoutMs: 40 },
        )
        expect(res.results[0]).toEqual({ id: contended.id, outcome: 'RETRY' })
      }
    } finally {
      releaseLock()
      await lockHolder
    }

    await withTenant(fx.tenantId, async (tx) => {
      const att = await tx.execute(
        sql`SELECT 1 FROM attention_item WHERE command_id = ${contended.id}::uuid`,
      )
      expect(att.rows).toHaveLength(0)
      const tracker = await tx.execute(
        sql`SELECT attempt_count FROM command_failure_attempt WHERE command_id = ${contended.id}::uuid`,
      )
      expect(Number(tracker.rows[0]!.attempt_count)).toBe(3)
    })

    const acked = await processPush(
      fx.syncDevice,
      { sent_at_device: new Date().toISOString(), clock_offset_ms: 0, commands: [contended] },
      { schemaVersion: 1, appVersion: 'v0.1.0', syncProtocol: 1, requestRef: 'req-lck-ack' },
    )
    expect(acked.results[0]!.outcome).toBe('ACK')

    await withTenant(fx.tenantId, async (tx) => {
      const tracker = await tx.execute(
        sql`SELECT 1 FROM command_failure_attempt WHERE command_id = ${contended.id}::uuid`,
      )
      expect(tracker.rows).toHaveLength(0)
    })
  })

  it('uses a much higher bound for transient failures than for deterministic ones and stores a redacted detail', async () => {
    const slug = uniqueSlug('push-lock-bound')
    const fx = await setupDeviceFixture(slug)
    await processPush(
      fx.syncDevice,
      { sent_at_device: new Date().toISOString(), clock_offset_ms: 0, commands: [makeAuditCmd(1)] },
      { schemaVersion: 1, appVersion: 'v0.1.0', syncProtocol: 1, requestRef: 'req-bound-prime' },
    )

    const contended = makeAuditCmd(2)
    let releaseLock!: () => void
    const lockReleased = new Promise<void>((resolve) => {
      releaseLock = resolve
    })
    let lockAcquired!: () => void
    const onLockAcquired = new Promise<void>((resolve) => {
      lockAcquired = resolve
    })
    const lockHolder = withTenant(fx.tenantId, async (tx) => {
      await tx.execute(
        sql`SELECT last_seq FROM audit_chain_head WHERE tenant_id = ${fx.tenantId}::uuid FOR UPDATE`,
      )
      lockAcquired()
      await lockReleased
    })

    await onLockAcquired
    const outcomes: string[] = []
    try {
      // Deterministic bound is 2, transient bound is 5: attempts 2..4 must still be RETRY.
      for (let i = 1; i <= 5; i += 1) {
        const res = await processPush(
          fx.syncDevice,
          { sent_at_device: new Date().toISOString(), clock_offset_ms: 0, commands: [contended] },
          { schemaVersion: 1, appVersion: 'v0.1.0', syncProtocol: 1, requestRef: `req-bnd-${i}` },
          { lockTimeoutMs: 40, maxFailureAttempts: 2, maxTransientAttempts: 5 },
        )
        outcomes.push(res.results[0]!.outcome)
      }
    } finally {
      releaseLock()
      await lockHolder
    }

    expect(outcomes).toEqual(['RETRY', 'RETRY', 'RETRY', 'RETRY', 'ATTENTION'])

    await withTenant(fx.tenantId, async (tx) => {
      const att = await tx.execute(
        sql`SELECT reason_class, reason_code, detail FROM attention_item WHERE command_id = ${contended.id}::uuid`,
      )
      expect(att.rows).toHaveLength(1)
      expect(att.rows[0]!.reason_code).toBe('INTERNAL_ERROR')
      const detail = String(att.rows[0]!.detail)
      expect(detail).toContain('55P03')
      // Drizzle query errors embed SQL text and bound parameters in their message; they must never be stored.
      expect(detail).not.toMatch(/params:|insert into|select |audit_chain_head|Failed query:/i)
    })
  })
})
