import 'fake-indexeddb/auto'
import { describe, expect, it } from 'vitest'
import { z } from 'zod'
import { SolvaDb } from '../solva-db'
import { STORES_V1 } from '../schema-v1'
import { invoiceCounterKey, nextSeq } from '../../data/counter.repo'
import { migrateOutbox } from './outbox-migrate'

const TENANT_ID = '01950000-0000-7000-8000-000000000048'

const FakeAuditV1 = z.object({
  entry: z.object({
    id: z.string(),
    action: z.string(),
  }),
})

const FakeAuditV2 = z.object({
  entry: z.object({
    id: z.string(),
    action: z.string(),
    v2_source: z.string(),
  }),
})

const FakeAuditV3 = z.object({
  entry: z.object({
    id: z.string(),
    action: z.string(),
    v2_source: z.string(),
    v3_checksum: z.string(),
  }),
})

describe('outbox-migrate (Dexie N-1 -> N payload migration)', () => {
  it('upgrades three synthetic versions (v1 -> v2 -> v3) preserving all rows, invoice seq, and marking unmigratable items without deletion', async () => {
    // 1. Seed a v1 "old world" database with pending v1 commands, an ACKED command, a broken v1 command, and an invoice counter.
    class LegacyDbV1 extends SolvaDb {
      constructor() {
        super(TENANT_ID)
      }
    }
    const db1 = new LegacyDbV1()
    await db1.open()

    await db1.local_counter.put({
      key: invoiceCounterKey('reg-01', '202611'),
      register_id: 'reg-01',
      doc_type: 'INVOICE',
      period: '202611',
      last_seq: 42,
      updated_at: '2026-11-20T01:00:00.000Z',
    })

    await db1.outbox_command.bulkAdd([
      {
        id: '01950000-0000-7000-8000-000000000101',
        type: 'AppendAudit',
        payload: { entry: { id: 'a1', action: 'legacy.action' } },
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
        id: '01950000-0000-7000-8000-000000000102',
        type: 'AppendAudit',
        payload: { entry: { id: 'a2', action: 'already.acked' } },
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
        app_version: '1.0.0',
      },
      {
        id: '01950000-0000-7000-8000-000000000103',
        type: 'FinalizeSale', // Missing migrator for FinalizeSale v1 -> v2
        payload: { corrupted: true },
        schema_version: 1,
        device_seq: 3,
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
        created_at_device: '2026-11-20T01:02:00.000Z',
        app_version: '1.0.0',
      },
    ])
    db1.close()

    const migrateOptsV2 = {
      targetSchemaVersion: 2,
      migrateOptions: {
        migrators: {
          AppendAudit: {
            1: (p: unknown) => {
              const parsed = FakeAuditV1.parse(p)
              return { entry: { ...parsed.entry, v2_source: 'upgraded-v2' } }
            },
          },
        },
        schemas: {
          AppendAudit: { 2: FakeAuditV2 },
        },
      },
    }

    // 2. Open synthetic v2 that runs migrateOutbox(tx, 1, 2) inside Dexie upgrade().
    class TestDbV2 extends SolvaDb {
      constructor() {
        super(TENANT_ID)
      }
      protected override registerUpgradeHooks(): void {
        this.version(2)
          .stores(STORES_V1)
          .upgrade(async (tx) => {
            await migrateOutbox(tx, 1, 2, migrateOptsV2)
            await tx.table('meta').put({ key: 'dexie_version', value: 2 })
          })
      }
    }

    const db2 = new TestDbV2()
    await db2.open()
    const rowsAfterV2 = (await db2.outbox_command.toArray()).sort(
      (a, b) => a.device_seq - b.device_seq,
    )
    expect(rowsAfterV2).toHaveLength(3)

    // Pending valid row migrated to v2
    expect(rowsAfterV2[0]!.schema_version).toBe(2)
    expect(FakeAuditV2.parse(rowsAfterV2[0]!.payload).entry.v2_source).toBe('upgraded-v2')

    // ACKED row untouched
    expect(rowsAfterV2[1]!.schema_version).toBe(1)

    // Unmigratable row kept safely with SCHEMA_NOT_MIGRATABLE
    expect(rowsAfterV2[2]!.status).toBe('PENDING')
    expect(rowsAfterV2[2]!.last_error_class).toBe('SCHEMA')
    expect(rowsAfterV2[2]!.last_error_code).toBe('SCHEMA_NOT_MIGRATABLE')

    // Next invoice counter picks up right at 43
    const nextInvoice = await db2.transaction('rw', db2.local_counter, (tx) =>
      nextSeq(tx, invoiceCounterKey('reg-01', '202611'), {
        registerId: 'reg-01',
        docType: 'INVOICE',
        period: '202611',
        updatedAt: '2026-11-20T02:00:00.000Z',
      }),
    )
    expect(nextInvoice).toBe(43)
    db2.close()

    // 3. Upgrade again to synthetic v3
    class TestDbV3 extends SolvaDb {
      constructor() {
        super(TENANT_ID)
      }
      protected override registerUpgradeHooks(): void {
        this.version(2)
          .stores(STORES_V1)
          .upgrade(async (tx) => {
            await migrateOutbox(tx, 1, 2, migrateOptsV2)
          })
        this.version(3)
          .stores(STORES_V1)
          .upgrade(async (tx) => {
            await migrateOutbox(tx, 2, 3, {
              targetSchemaVersion: 3,
              migrateOptions: {
                migrators: {
                  AppendAudit: {
                    2: (p: unknown) => {
                      const parsed = FakeAuditV2.parse(p)
                      return { entry: { ...parsed.entry, v3_checksum: 'sha-ok' } }
                    },
                  },
                },
                schemas: {
                  AppendAudit: { 3: FakeAuditV3 },
                },
              },
            })
            await tx.table('meta').put({ key: 'dexie_version', value: 3 })
          })
      }
    }

    const db3 = new TestDbV3()
    await db3.open()
    const rowsAfterV3 = (await db3.outbox_command.toArray()).sort(
      (a, b) => a.device_seq - b.device_seq,
    )
    expect(rowsAfterV3).toHaveLength(3)
    expect(rowsAfterV3[0]!.schema_version).toBe(3)
    expect(FakeAuditV3.parse(rowsAfterV3[0]!.payload).entry.v3_checksum).toBe('sha-ok')
    expect(rowsAfterV3[2]!.last_error_code).toBe('SCHEMA_NOT_MIGRATABLE')
    expect((await db3.meta.get('dexie_version'))?.value).toBe(3)
    db3.close()
  })
})
