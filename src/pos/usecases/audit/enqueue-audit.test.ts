import { afterEach, describe, expect, it } from 'vitest'
import { AppendAuditPayloadV1 } from '~/lib/contracts'
import { listSendable } from '../../data/outbox.repo'
import { deleteTenantDbForTests, openTenantDb } from '../../db/solva-db'
import { enqueueAudit } from './enqueue-audit'

const T1 = '0192a000-0000-7000-8000-00000000a001'
const REG = '0192a000-0000-7000-8000-00000000c001'

afterEach(async () => {
  await deleteTenantDbForTests(T1)
})

describe('pos/usecases/audit/enqueue-audit', () => {
  it('enqueues a valid AppendAudit outbox command with monotonic sequence', async () => {
    const db = await openTenantDb(T1)

    const cmd = await enqueueAudit(db, {
      action: 'OVERRIDE_DISCOUNT',
      entityType: 'sale',
      registerId: REG,
      reasonCode: 'MANAGER_APPROVED',
      occurredAtIso: '2026-11-20T03:00:00.000Z',
    })

    expect(cmd.type).toBe('AppendAudit')
    expect(cmd.device_seq).toBe(1)
    expect(cmd.status).toBe('PENDING')
    expect(() => AppendAuditPayloadV1.parse(cmd.payload)).not.toThrow()

    const queued = await listSendable(db, { nowIso: '2026-11-20T03:00:05.000Z' })
    expect(queued).toHaveLength(1)
    expect(queued[0]!.id).toBe(cmd.id)
  })
})
