import { createHash, webcrypto } from 'node:crypto'
import { afterAll, beforeEach, describe, expect, it } from 'vitest'
import { createIdGenerator } from '~/lib/kernel'
import {
  __clearDeviceAuthCacheForTests,
  __clearTenantCacheForTests,
  createLegalEntity,
  createOutlet,
  createPairingCode,
  createRegister,
  createTenant,
  enrollDevice,
  revokeDevice,
  type IdentityAuthActor,
} from '~/modules/identity/public'
import { PERMISSION_CODES } from '~/modules/identity/shared'
import { importPendingFile, type SyncAdminActor } from '~/modules/sync/public'
import { resetLimitersForTests } from '~/server/auth/rate-limit/limiters'
import { __resetPushLimitsForTests } from '~/server/auth/rate-limit/push-limits'
import { composeServer, resetCompositionForTests } from '~/server/composition'
import { closePools } from '~/server/db'
import { resetEnvForTests } from '~/server/env'
import { masterTx } from './helpers/master'
import { uniqueSlug } from './helpers/tenants'

const idGen = createIdGenerator({
  nowMs: () => Date.now(),
  nextUint32: () => {
    const buf = new Uint32Array(1)
    webcrypto.getRandomValues(buf)
    return buf[0]!
  },
})

const testOp = { platformUserId: idGen.newId(), email: 'op-imp@example.test' }

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

function buildJsonl(opts: {
  deviceId: string
  registerId: string
  commands: unknown[]
}): string {
  const cmdLines = opts.commands.map((c) => JSON.stringify(c))
  const sha256 = createHash('sha256').update(cmdLines.join('\n'), 'utf8').digest('hex')
  const header = JSON.stringify({
    device_id: opts.deviceId,
    register_id: opts.registerId,
    app_version: 'v1.0.0',
    schema_version: 1,
    exported_at: '2026-11-20T10:00:00.000Z',
    count: cmdLines.length,
    sha256,
  })
  return [header, ...cmdLines].join('\n') + '\n'
}

describe('importPendingFile (FLOW-16 offline recovery importer)', () => {
  it('imports valid exported JSONL even after device revocation, skips ReportPinState, rejects tampering/cross-tenant, and is idempotent', async () => {
    const slugA = uniqueSlug('imp-a')
    const createdA = await createTenant(testOp, {
      name: `ImportA ${slugA}`,
      slug: slugA,
      ownerEmail: `owner-${slugA}@example.test`,
      ownerDisplayName: 'Owner A',
    })
    const actorA: IdentityAuthActor = {
      tenantId: createdA.tenantId,
      tenantSlug: slugA,
      authOrgId: 'org-impa',
      appUserId: createdA.ownerInvite.appUserId,
      outletIds: null,
      permissions: new Set(PERMISSION_CODES),
    }
    const syncActorA: SyncAdminActor = actorA

    const le = await createLegalEntity(actorA, { name: 'PT Import A', npwp: null, isPkp: false })
    const outletA = await createOutlet(actorA, {
      legalEntityId: le.id,
      code: 'OUT1',
      name: 'Outlet 1',
      timezone: 'Asia/Jakarta',
      dayCutoffTime: '00:00',
      priceTaxMode: 'INCLUSIVE',
      taxProfile: 'NONE',
    })
    const regA = await createRegister(actorA, {
      outletId: outletA.id,
      code: 'POS01',
      name: 'Register 1',
      registerType: 'CASHIER',
      invoicePrefix: 'OUT01-POS01',
    })
    const pair = await createPairingCode(actorA, regA.id)
    const enrolled = await enrollDevice(
      { slug: slugA, code: pair.code, device_name: 'Lost Tablet' },
      '10.8.0.1',
      { minDelayMs: 0 },
    )

    // Tenant B for cross-tenant isolation test
    const slugB = uniqueSlug('imp-b')
    const createdB = await createTenant(testOp, {
      name: `ImportB ${slugB}`,
      slug: slugB,
      ownerEmail: `owner-${slugB}@example.test`,
      ownerDisplayName: 'Owner B',
    })
    const syncActorB: SyncAdminActor = {
      tenantId: createdB.tenantId,
      appUserId: createdB.ownerInvite.appUserId,
      outletIds: null,
      permissions: new Set(PERMISSION_CODES),
    }

    // Revoke device (lost tablet scenario!)
    await revokeDevice(actorA, { deviceId: enrolled.device_id, reasonCode: 'LOST' })

    const shiftId = idGen.newId()
    const shiftCmdId = idGen.newId()
    const auditCmdId = idGen.newId()
    const pinCmdId = idGen.newId()
    const nowIso = '2026-11-20T09:00:00.000Z'

    const fileText = buildJsonl({
      deviceId: enrolled.device_id,
      registerId: regA.id,
      commands: [
        {
          id: shiftCmdId,
          type: 'OpenShift',
          schema_version: 1,
          device_seq: 1,
          depends_on: [],
          created_at_device: nowIso,
          payload: {
            shift: {
              id: shiftId,
              created_by: actorA.appUserId,
              created_at_device: nowIso,
              clock_offset_ms: 0,
              occurred_at: nowIso,
              business_date: '2026-11-20',
              opening_cash: 250_000,
            },
          },
        },
        {
          id: auditCmdId,
          type: 'AppendAudit',
          schema_version: 1,
          device_seq: 2,
          depends_on: [],
          created_at_device: nowIso,
          payload: {
            entry: {
              id: idGen.newId(),
              action: 'pending.exported',
              entity_type: 'outbox',
              occurred_at: nowIso,
            },
          },
        },
        {
          id: pinCmdId,
          type: 'ReportPinState',
          schema_version: 1,
          device_seq: 3,
          depends_on: [],
          created_at_device: nowIso,
          payload: {
            user_id: actorA.appUserId,
            failed_count: 4,
            lock_tier: 0,
            locked_until: null,
            last_failed_at: nowIso,
            pin_epoch_seen: 1,
          },
        },
      ],
    })

    // 1. Tampered file fails SHA-256 check
    const tampered = fileText.replace('250000', '250001')
    await expect(importPendingFile(syncActorA, { fileText: tampered })).rejects.toThrow(/SHA-256/)

    // 2. Cross-tenant import fails ownership check
    await expect(importPendingFile(syncActorB, { fileText })).rejects.toThrow(/tenant/)

    // 2b. An actor without any outlet scope is rejected before anything is processed
    await expect(
      importPendingFile({ ...syncActorA, outletIds: undefined }, { fileText }),
    ).rejects.toThrow(/outside manager scope/)

    // 3. Valid import processes OpenShift & AppendAudit (ACK) and skips stale ReportPinState
    const res1 = await importPendingFile(syncActorA, { fileText })
    expect(res1.acked).toBe(2)
    expect(res1.replayed).toBe(0)
    expect(res1.skipped).toBe(1)

    // Verify staff_pin_state was NOT created/mutated by skipped ReportPinState
    await masterTx(createdA.tenantId, async (c) => {
      const pinRows = await c.query<{ cnt: number }>(
        `SELECT count(*)::int AS cnt FROM staff_pin_state WHERE tenant_id = $1`,
        [createdA.tenantId],
      )
      expect(pinRows.rows[0]!.cnt).toBe(0)
    })

    // 4. Re-importing same file is completely idempotent (all replayed)
    const res2 = await importPendingFile(syncActorA, { fileText })
    expect(res2.acked).toBe(0)
    expect(res2.replayed).toBe(2)
    expect(res2.skipped).toBe(1)
  })
})
