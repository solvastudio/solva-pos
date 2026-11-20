import 'fake-indexeddb/auto'
import { afterEach, describe, expect, it } from 'vitest'
import { deleteTenantDbForTests, openTenantDb, type SolvaDb } from '../db/solva-db'
import {
  applyOutboxResults,
  holdCommandsAboveServerSchema,
  listSendable,
  releaseEligibleSchemaHolds,
} from '../data/outbox.repo'
import { applyCommandUpdates } from './command-updates'

const TENANT_ID = '01950000-0000-7000-8000-000000000049'

let openedDb: SolvaDb | null = null

afterEach(async () => {
  if (openedDb) {
    openedDb.close()
    openedDb = null
  }
  await deleteTenantDbForTests(TENANT_ID)
})

async function setupDb(): Promise<SolvaDb> {
  openedDb = await openTenantDb(TENANT_ID)
  return openedDb
}

describe('command-updates & full outbox projection', () => {
  it('applies ACCEPTED_MANUAL, DISMISSED, and UNKNOWN_REFERENCE for dependent commands atomically', async () => {
    const db = await setupDb()
    const saleId = '01950000-0000-7000-8000-000000000201'
    const cmdParentId = '01950000-0000-7000-8000-000000000301'
    const cmdChildId = '01950000-0000-7000-8000-000000000302'
    const cmdDismissId = '01950000-0000-7000-8000-000000000303'

    await db.sale.put({
      id: saleId,
      tenant_id: TENANT_ID,
      outlet_id: 'out-1',
      register_id: 'reg-1',
      device_id: 'dev-1',
      shift_id: 'sh-1',
      status: 'PAID',
      created_by: 'u-1',
      created_at_device: '2026-11-20T01:00:00.000Z',
      clock_offset_ms: 0,
      occurred_at: '2026-11-20T01:00:00.000Z',
      business_date: '2026-11-20',
      invoice_no: 'OUT01-01-202611-0001',
      invoice_prefix: 'OUT01-01',
      invoice_period: '202611',
      invoice_seq: 1,
      legal_entity_id: 'le-1',
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
      gross_total: 10_000,
      line_discount_total: 0,
      bill_discount_type: null,
      bill_discount_pct: null,
      bill_discount_input: null,
      bill_discount_total: 0,
      discount_approved_by: null,
      net_subtotal: 10_000,
      service_charge: 0,
      tax_base: 10_000,
      tax_amount: 0,
      dpp: 10_000,
      grand_total: 10_000,
      rounding: 0,
      total_due: 10_000,
      customer_name: null,
      customer_phone: null,
      catalog_cursor: null,
      bill_id: null,
      bill_ref: null,
      sync_status: 'PENDING',
      synced_at: null,
      server_result: null,
      print_state: 'DONE',
    })

    await db.outbox_command.bulkAdd([
      {
        id: cmdParentId,
        type: 'FinalizeSale',
        payload: { sale: { id: saleId } },
        schema_version: 1,
        device_seq: 1,
        register_id: 'reg-1',
        status: 'NEEDS_ATTENTION',
        dependency_key: `sale:${saleId}`,
        depends_on: [],
        attempts: 1,
        next_retry_at: null,
        last_error_class: 'STRUCTURAL',
        last_error_code: 'VALIDATION_FAILED',
        last_error_ref: 'ref-1',
        result: null,
        created_at_device: '2026-11-20T01:00:00.000Z',
        app_version: '1.0.0',
      },
      {
        id: cmdDismissId,
        type: 'OpenShift',
        payload: { shift: { id: 'sh-1' } },
        schema_version: 1,
        device_seq: 2,
        register_id: 'reg-1',
        status: 'NEEDS_ATTENTION',
        dependency_key: 'shift:sh-1',
        depends_on: [],
        attempts: 1,
        next_retry_at: null,
        last_error_class: 'STRUCTURAL',
        last_error_code: 'VALIDATION_FAILED',
        last_error_ref: 'ref-2',
        result: null,
        created_at_device: '2026-11-20T01:01:00.000Z',
        app_version: '1.0.0',
      },
      {
        id: cmdChildId,
        type: 'VoidSale',
        payload: { void: { sale_id: saleId } },
        schema_version: 1,
        device_seq: 3,
        register_id: 'reg-1',
        status: 'PENDING',
        dependency_key: null,
        depends_on: [cmdDismissId],
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

    const count = await applyCommandUpdates(
      db,
      [
        { id: cmdParentId, status: 'ACCEPTED_MANUAL' },
        { id: cmdDismissId, status: 'DISMISSED' },
        {
          id: cmdChildId,
          status: 'NEEDS_ATTENTION',
          reason_class: 'STRUCTURAL',
          reason_code: 'UNKNOWN_REFERENCE',
          ref: 'dep-ref-1',
        },
      ],
      { ackedAtIso: '2026-11-20T02:00:00.000Z' },
    )

    expect(count).toBe(3)

    const updatedParent = await db.outbox_command.get(cmdParentId)
    expect(updatedParent?.status).toBe('ACKED')
    expect(updatedParent?.manager_decision).toBe('ACCEPTED_MANUAL')
    expect(updatedParent?.acked_at).toBe('2026-11-20T02:00:00.000Z')

    const updatedSale = await db.sale.get(saleId)
    expect(updatedSale?.sync_status).toBe('SYNCED')
    expect(updatedSale?.synced_at).toBe('2026-11-20T02:00:00.000Z')

    const dismissed = await db.outbox_command.get(cmdDismissId)
    expect(dismissed?.status).toBe('DISMISSED')
    expect(dismissed?.manager_decision).toBe('DISMISSED')

    const child = await db.outbox_command.get(cmdChildId)
    expect(child?.status).toBe('NEEDS_ATTENTION')
    expect(child?.last_error_code).toBe('UNKNOWN_REFERENCE')
    expect(child?.last_error_ref).toBe('dep-ref-1')
  })

  it('mirrors reassigned -Dn invoice numbers on ACK and holds/releases SERVER_BEHIND commands automatically', async () => {
    const db = await setupDb()
    const saleId = '01950000-0000-7000-8000-000000000202'
    const cmd1Id = '01950000-0000-7000-8000-000000000311'
    const cmd2Id = '01950000-0000-7000-8000-000000000312'

    await db.sale.put({
      id: saleId,
      tenant_id: TENANT_ID,
      outlet_id: 'out-1',
      register_id: 'reg-1',
      device_id: 'dev-1',
      shift_id: 'sh-1',
      status: 'PAID',
      created_by: 'u-1',
      created_at_device: '2026-11-20T01:00:00.000Z',
      clock_offset_ms: 0,
      occurred_at: '2026-11-20T01:00:00.000Z',
      business_date: '2026-11-20',
      invoice_no: 'OUT01-01-202611-0002',
      invoice_prefix: 'OUT01-01',
      invoice_period: '202611',
      invoice_seq: 2,
      legal_entity_id: 'le-1',
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
      gross_total: 10_000,
      line_discount_total: 0,
      bill_discount_type: null,
      bill_discount_pct: null,
      bill_discount_input: null,
      bill_discount_total: 0,
      discount_approved_by: null,
      net_subtotal: 10_000,
      service_charge: 0,
      tax_base: 10_000,
      tax_amount: 0,
      dpp: 10_000,
      grand_total: 10_000,
      rounding: 0,
      total_due: 10_000,
      customer_name: null,
      customer_phone: null,
      catalog_cursor: null,
      bill_id: null,
      bill_ref: null,
      sync_status: 'PENDING',
      synced_at: null,
      server_result: null,
      print_state: 'DONE',
    })

    await db.outbox_command.bulkAdd([
      {
        id: cmd1Id,
        type: 'FinalizeSale',
        payload: { sale: { id: saleId } },
        schema_version: 1,
        device_seq: 1,
        register_id: 'reg-1',
        status: 'SENDING',
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
        id: cmd2Id,
        type: 'AppendAudit',
        payload: { entry: { id: 'a-v2' } },
        schema_version: 2,
        device_seq: 2,
        register_id: 'reg-1',
        status: 'PENDING',
        dependency_key: null,
        depends_on: [],
        attempts: 0,
        next_retry_at: null,
        last_error_class: null,
        last_error_code: null,
        last_error_ref: null,
        result: null,
        created_at_device: '2026-11-20T01:01:00.000Z',
        app_version: '1.0.0',
      },
    ])

    await applyOutboxResults(
      db,
      [
        {
          id: cmd1Id,
          outcome: 'ACK',
          result: {
            sale_id: saleId,
            invoice_no: 'OUT01-01-202611-0002-D2',
            invoice_conflict_idx: 2,
            received_at: '2026-11-20T01:05:00.000Z',
            flags: [],
          },
        },
      ],
      {
        nowIso: '2026-11-20T01:05:00.000Z',
        nextRetryAtIso: () => '2026-11-20T01:05:05.000Z',
      },
    )

    const sale = await db.sale.get(saleId)
    expect(sale?.invoice_no).toBe('OUT01-01-202611-0002-D2')
    expect(sale?.sync_status).toBe('SYNCED')
    expect(sale?.server_result?.invoice_conflict_idx).toBe(2)

    // Hold v2 command when server_max_schema = 1
    await holdCommandsAboveServerSchema(db, 1)
    expect(await listSendable(db)).toHaveLength(0)
    const heldRow = await db.outbox_command.get(cmd2Id)
    expect(heldRow?.last_error_class).toBe('SCHEMA')
    expect(heldRow?.last_error_code).toBe('SERVER_BEHIND')

    // Release automatically once server upgrades to max_schema_version = 2
    await releaseEligibleSchemaHolds(db, { serverMaxSchema: 2, updateRequired: false })
    const sendableAfter = await listSendable(db)
    expect(sendableAfter.map((r) => r.id)).toEqual([cmd2Id])
  })
})
