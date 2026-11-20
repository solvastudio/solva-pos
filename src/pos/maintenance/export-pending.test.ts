import 'fake-indexeddb/auto'
import { afterEach, describe, expect, it } from 'vitest'
import { deleteTenantDbForTests, openTenantDb, type SolvaDb } from '../db/solva-db'
import { tenantDbName } from '../locks/names'
import { exportPending, exportPendingDynamic } from './export-pending'

const TENANT_ID = '01950000-0000-7000-8000-000000000052'
let openedDb: SolvaDb | null = null

afterEach(async () => {
  if (openedDb) {
    openedDb.close()
    openedDb = null
  }
  await deleteTenantDbForTests(TENANT_ID)
})

describe('export-pending (.jsonl + SHA-256 + dynamic mode + audit)', () => {
  it('exports all non-ACKED commands in JSON Lines with valid header hash and records audit', async () => {
    openedDb = await openTenantDb(TENANT_ID)
    const db = openedDb

    await db.meta.bulkPut([
      {
        key: 'device',
        value: {
          device_id: 'dev-export-01',
          credential: 'tok',
          credential_expires_at: '2027-01-01T00:00:00.000Z',
          tenant_id: TENANT_ID,
          slug: 'kopi-ku',
          register_id: 'reg-01',
          outlet_id: 'out-01',
          register_type: 'CASHIER',
        },
      },
      {
        key: 'clock',
        value: {
          offset_ms: 5_000,
          offset_at: '2026-11-20T00:00:00.000Z',
          max_seen_time: '2026-11-20T00:00:00.000Z',
        },
      },
    ])

    await db.outbox_command.bulkAdd([
      {
        id: '01950000-0000-7000-8000-000000000401',
        type: 'FinalizeSale',
        payload: { sale: { id: 's1', invoice_no: 'OUT01-01-202611-0001' } },
        schema_version: 1,
        device_seq: 1,
        register_id: 'reg-01',
        status: 'PENDING',
        dependency_key: null,
        depends_on: [],
        attempts: 0,
        next_retry_at: null,
        last_error_class: null,
        last_error_code: null,
        last_error_ref: null,
        result: null,
        created_at_device: '2026-11-20T01:00:00.000Z',
        app_version: '1.0.0',
      },
      {
        id: '01950000-0000-7000-8000-000000000402',
        type: 'FinalizeSale',
        payload: { sale: { id: 's2', invoice_no: 'OUT01-01-202611-0002' } },
        schema_version: 1,
        device_seq: 2,
        register_id: 'reg-01',
        status: 'ACKED',
        dependency_key: null,
        depends_on: [],
        attempts: 0,
        next_retry_at: null,
        last_error_class: null,
        last_error_code: null,
        last_error_ref: null,
        result: { ok: true },
        created_at_device: '2026-11-20T01:01:00.000Z',
        acked_at: '2026-11-20T01:02:00.000Z',
        app_version: '1.0.0',
      },
      {
        id: '01950000-0000-7000-8000-000000000403',
        type: 'FinalizeSale',
        payload: { sale: { id: 's3', invoice_no: 'OUT01-01-202611-0003' } },
        schema_version: 1,
        device_seq: 3,
        register_id: 'reg-01',
        status: 'NEEDS_ATTENTION',
        dependency_key: null,
        depends_on: [],
        attempts: 1,
        next_retry_at: null,
        last_error_class: 'STRUCTURAL',
        last_error_code: 'VALIDATION_FAILED',
        last_error_ref: 'ref-403',
        result: null,
        created_at_device: '2026-11-20T01:03:00.000Z',
        app_version: '1.0.0',
      },
    ])

    const fixedMs = Date.parse('2026-11-20T02:00:00.000Z')
    const exported = await exportPending(db, {
      trustedNowMs: fixedMs,
      staffId: '01950000-0000-7000-8000-000000000999',
    })

    expect(exported.count).toBe(2)
    expect(exported.filename).toBe('solva-pending_dev-export-01_20261120T020005Z.jsonl')
    expect(exported.sha256).toMatch(/^[a-f0-9]{64}$/)

    const lines = exported.text.trimEnd().split('\n')
    expect(lines).toHaveLength(3)
    const parsedHeader = JSON.parse(lines[0]!)
    expect(parsedHeader).toMatchObject({
      device_id: 'dev-export-01',
      register_id: 'reg-01',
      count: 2,
      sha256: exported.sha256,
    })

    const allCmds = await db.outbox_command.toArray()
    expect(allCmds.some((c) => c.type === 'AppendAudit')).toBe(true)

    // Dynamic recovery export without schema definitions reads all pending rows
    db.close()
    openedDb = null
    const dynamic = await exportPendingDynamic(tenantDbName(TENANT_ID), { trustedNowMs: fixedMs })
    expect(dynamic).not.toBeNull()
    expect(dynamic!.count).toBe(3)
  })
})
