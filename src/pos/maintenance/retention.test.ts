import 'fake-indexeddb/auto'
import { afterEach, describe, expect, it } from 'vitest'
import { deleteTenantDbForTests, openTenantDb, type SolvaDb } from '../db/solva-db'
import { getMeta, setMeta } from '../data/meta.repo'
import { FULL_RESYNC_RESUME_WINDOW_MS } from '../data/pull-stage.repo'
import { computeRetentionCutoffDate, runRetentionPass } from './retention'
import { checkAndPruneStorage } from './storage'

const TENANT_ID = '01950000-0000-7000-8000-000000000051'
let openedDb: SolvaDb | null = null

afterEach(async () => {
  if (openedDb) {
    openedDb.close()
    openedDb = null
  }
  await deleteTenantDbForTests(TENANT_ID)
})

describe('retention & storage pressure', () => {
  it('prunes SYNCED >3 month records with child rows while never deleting PENDING/NEEDS_ATTENTION or recent rows', async () => {
    openedDb = await openTenantDb(TENANT_ID)
    const db = openedDb

    const nowMs = Date.parse('2026-11-20T10:00:00.000Z')
    // Today = 2026-11-20 -> 3 months ago = 2026-08-20 -> start of month = 2026-08-01
    expect(computeRetentionCutoffDate(nowMs)).toBe('2026-08-01')

    await db.sale.bulkAdd([
      {
        id: 'sale-old-synced',
        tenant_id: TENANT_ID,
        outlet_id: 'o1',
        register_id: 'r1',
        device_id: 'd1',
        shift_id: 'sh-old',
        status: 'PAID',
        created_by: 'u1',
        created_at_device: '2026-07-15T10:00:00.000Z',
        clock_offset_ms: 0,
        occurred_at: '2026-07-15T10:00:00.000Z',
        business_date: '2026-07-15',
        invoice_no: 'INV-OLD-1',
        invoice_prefix: 'OUT01',
        invoice_period: '202607',
        invoice_seq: 1,
        legal_entity_id: 'le1',
        legal_entity_npwp: null,
        legal_entity_is_pkp: false,
        price_tax_mode: 'INCLUSIVE',
        tax_profile: 'NONE',
        tax_rate: '0',
        tax_rate_id: null,
        service_charge_rate: '0',
        service_charge_taxable: false,
        cash_rounding_unit: 0,
        receipt_locale: 'id-ID',
        currency: 'IDR',
        gross_total: 1000,
        line_discount_total: 0,
        bill_discount_type: null,
        bill_discount_pct: null,
        bill_discount_input: null,
        bill_discount_total: 0,
        discount_approved_by: null,
        net_subtotal: 1000,
        service_charge: 0,
        tax_base: 1000,
        tax_amount: 0,
        dpp: 1000,
        grand_total: 1000,
        rounding: 0,
        total_due: 1000,
        customer_name: null,
        customer_phone: null,
        catalog_cursor: null,
        bill_id: null,
        bill_ref: null,
        sync_status: 'SYNCED',
        synced_at: '2026-07-15T10:01:00.000Z',
        server_result: null,
        print_state: 'DONE',
      },
      {
        id: 'sale-old-pending',
        tenant_id: TENANT_ID,
        outlet_id: 'o1',
        register_id: 'r1',
        device_id: 'd1',
        shift_id: 'sh-old',
        status: 'PAID',
        created_by: 'u1',
        created_at_device: '2026-06-01T10:00:00.000Z',
        clock_offset_ms: 0,
        occurred_at: '2026-06-01T10:00:00.000Z',
        business_date: '2026-06-01',
        invoice_no: 'INV-OLD-PENDING',
        invoice_prefix: 'OUT01',
        invoice_period: '202606',
        invoice_seq: 1,
        legal_entity_id: 'le1',
        legal_entity_npwp: null,
        legal_entity_is_pkp: false,
        price_tax_mode: 'INCLUSIVE',
        tax_profile: 'NONE',
        tax_rate: '0',
        tax_rate_id: null,
        service_charge_rate: '0',
        service_charge_taxable: false,
        cash_rounding_unit: 0,
        receipt_locale: 'id-ID',
        currency: 'IDR',
        gross_total: 1000,
        line_discount_total: 0,
        bill_discount_type: null,
        bill_discount_pct: null,
        bill_discount_input: null,
        bill_discount_total: 0,
        discount_approved_by: null,
        net_subtotal: 1000,
        service_charge: 0,
        tax_base: 1000,
        tax_amount: 0,
        dpp: 1000,
        grand_total: 1000,
        rounding: 0,
        total_due: 1000,
        customer_name: null,
        customer_phone: null,
        catalog_cursor: null,
        bill_id: null,
        bill_ref: null,
        sync_status: 'PENDING',
        synced_at: null,
        server_result: null,
        print_state: 'DONE',
      },
      {
        id: 'sale-recent-synced',
        tenant_id: TENANT_ID,
        outlet_id: 'o1',
        register_id: 'r1',
        device_id: 'd1',
        shift_id: 'sh-recent',
        status: 'PAID',
        created_by: 'u1',
        created_at_device: '2026-08-05T10:00:00.000Z',
        clock_offset_ms: 0,
        occurred_at: '2026-08-05T10:00:00.000Z',
        business_date: '2026-08-05',
        invoice_no: 'INV-RECENT',
        invoice_prefix: 'OUT01',
        invoice_period: '202608',
        invoice_seq: 1,
        legal_entity_id: 'le1',
        legal_entity_npwp: null,
        legal_entity_is_pkp: false,
        price_tax_mode: 'INCLUSIVE',
        tax_profile: 'NONE',
        tax_rate: '0',
        tax_rate_id: null,
        service_charge_rate: '0',
        service_charge_taxable: false,
        cash_rounding_unit: 0,
        receipt_locale: 'id-ID',
        currency: 'IDR',
        gross_total: 1000,
        line_discount_total: 0,
        bill_discount_type: null,
        bill_discount_pct: null,
        bill_discount_input: null,
        bill_discount_total: 0,
        discount_approved_by: null,
        net_subtotal: 1000,
        service_charge: 0,
        tax_base: 1000,
        tax_amount: 0,
        dpp: 1000,
        grand_total: 1000,
        rounding: 0,
        total_due: 1000,
        customer_name: null,
        customer_phone: null,
        catalog_cursor: null,
        bill_id: null,
        bill_ref: null,
        sync_status: 'SYNCED',
        synced_at: '2026-08-05T10:01:00.000Z',
        server_result: null,
        print_state: 'DONE',
      },
    ])

    await db.sale_line.add({
      id: 'sl-old',
      sale_id: 'sale-old-synced',
      line_no: 1,
      line_kind: 'ITEM',
      product_id: 'p1',
      sku_id: 'sku1',
      uom_id: 'uom1',
      sku_code: 'SKU1',
      item_name: 'Kopi',
      uom_code: 'PCS',
      qty: '1',
      conversion_factor: '1',
      qty_base: '1',
      unit_price: 1000,
      price_source: 'OUTLET',
      is_open_price: false,
      taxable: false,
      discount_type: null,
      discount_pct: null,
      discount_input: null,
      discount_approved_by: null,
      line_gross: 1000,
      line_discount: 0,
      line_net: 1000,
      bill_discount_alloc: 0,
      service_alloc: 0,
      tax_alloc: 0,
      note: null,
      source_bill_item_id: null,
      modifiers: [],
    })

    await db.outbox_command.bulkAdd([
      {
        id: 'cmd-old-acked',
        type: 'AppendAudit',
        payload: { entry: { id: 'big-payload' } },
        schema_version: 1,
        device_seq: 1,
        register_id: 'r1',
        status: 'ACKED',
        dependency_key: null,
        depends_on: [],
        attempts: 0,
        next_retry_at: null,
        last_error_class: null,
        last_error_code: null,
        last_error_ref: null,
        result: { ok: true },
        created_at_device: '2026-11-10T00:00:00.000Z',
        acked_at: '2026-11-10T00:01:00.000Z',
        app_version: '1.0.0',
      },
      {
        id: 'cmd-pending-keep',
        type: 'AppendAudit',
        payload: { entry: { id: 'keep-me' } },
        schema_version: 1,
        device_seq: 2,
        register_id: 'r1',
        status: 'PENDING',
        dependency_key: null,
        depends_on: [],
        attempts: 0,
        next_retry_at: null,
        last_error_class: null,
        last_error_code: null,
        last_error_ref: null,
        result: null,
        created_at_device: '2026-06-01T00:00:00.000Z',
        app_version: '1.0.0',
      },
      {
        id: 'cmd-2d-acked',
        type: 'AppendAudit',
        payload: { entry: { id: 'recent-2d' } },
        schema_version: 1,
        device_seq: 3,
        register_id: 'r1',
        status: 'ACKED',
        dependency_key: null,
        depends_on: [],
        attempts: 0,
        next_retry_at: null,
        last_error_class: null,
        last_error_code: null,
        last_error_ref: null,
        result: null,
        created_at_device: '2026-11-18T00:00:00.000Z',
        acked_at: '2026-11-18T00:01:00.000Z',
        app_version: '1.0.0',
      },
    ])

    const res = await runRetentionPass(db, { trustedNowMs: nowMs })
    expect(res.salesDeleted).toBe(1)
    expect(res.outboxPayloadsStripped).toBe(1)

    expect(await db.sale.get('sale-old-synced')).toBeUndefined()
    expect(await db.sale_line.get('sl-old')).toBeUndefined()
    expect(await db.sale.get('sale-old-pending')).toBeDefined()
    expect(await db.sale.get('sale-recent-synced')).toBeDefined()

    expect((await db.outbox_command.get('cmd-old-acked'))?.payload).toBeNull()
    expect((await db.outbox_command.get('cmd-pending-keep'))?.payload).toEqual({
      entry: { id: 'keep-me' },
    })
    // 2 days old is retained under normal 7-day retention
    expect((await db.outbox_command.get('cmd-2d-acked'))?.payload).not.toBeNull()

    // > 85% storage pressure triggers aggressive 1-day payload pruning while keeping pending intact
    const pressure = await checkAndPruneStorage(db, {
      trustedNowMs: nowMs,
      storageManager: {
        estimate: async () => ({ usage: 90, quota: 100 }),
      },
    })
    expect(pressure.level).toBe('prune')
    expect(pressure.pruned?.outboxPayloadsStripped).toBe(1)
    expect((await db.outbox_command.get('cmd-2d-acked'))?.payload).toBeNull()
    expect((await db.outbox_command.get('cmd-pending-keep'))?.payload).toEqual({
      entry: { id: 'keep-me' },
    })
  })

  it('keeps staged rows of a resumable full resync and drops those of an expired one', async () => {
    openedDb = await openTenantDb(TENANT_ID)
    const db = openedDb
    const nowMs = Date.parse('2026-11-20T10:00:00.000Z')
    const stageRow = (cycleId: string) => ({
      cycle_id: cycleId,
      entity: 'outlet',
      op: 'upsert' as const,
      id: `row-${cycleId}`,
      version: 1,
      payload: {},
    })
    const baseStage = {
      cycle_id: 'cyc-live',
      snapshot_token: 'tok',
      snapshot_version: 5,
      entities: ['outlet'],
      counts: { outlet: 1 },
      entity_index: 0,
      after_id: null,
    }
    await db.pull_stage.bulkAdd([stageRow('cyc-live'), stageRow('cyc-orphan')])

    await setMeta(db, 'full_resync_stage', { ...baseStage, started_at_ms: nowMs - 60_000 })
    const first = await runRetentionPass(db, { trustedNowMs: nowMs })
    expect(first.pullStageDeleted).toBe(1)
    expect((await db.pull_stage.toArray()).map((r) => r.cycle_id)).toEqual(['cyc-live'])

    await setMeta(db, 'full_resync_stage', {
      ...baseStage,
      started_at_ms: nowMs - FULL_RESYNC_RESUME_WINDOW_MS - 1,
    })
    await runRetentionPass(db, { trustedNowMs: nowMs })
    expect(await getMeta(db, 'full_resync_stage')).toBeNull()
    expect(await db.pull_stage.count()).toBe(0)
  })
})
