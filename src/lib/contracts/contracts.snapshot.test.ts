import { describe, expect, it } from 'vitest'
import { z } from 'zod'
import { COMMAND_PAYLOAD_SCHEMAS } from './commands'
import { SCHEMA_VERSION } from './versions'

/**
 * Hand-maintained baseline of required top-level / nested fields per v1 command.
 * Adding a new REQUIRED field or changing an existing field's JSON Schema type
 * WITHOUT bumping `SCHEMA_VERSION` and adding a migrator/upcaster breaks this guard.
 * Optional fields (e.g. Phase 56 `modifiers`) remain backwards-compatible without a bump.
 */
const REQUIRED_FIELDS_BY_VERSION: Record<number, Record<string, Record<string, string>>> = {
  1: {
    'FinalizeSale.sale': {
      id: 'string',
      shift_id: 'string',
      created_by: 'string',
      created_at_device: 'string',
      clock_offset_ms: 'integer',
      occurred_at: 'string',
      business_date: 'string',
      invoice_no: 'string',
      invoice_prefix: 'string',
      invoice_period: 'string',
      invoice_seq: 'integer',
      legal_entity_id: 'string',
      legal_entity_npwp: 'string|null',
      legal_entity_is_pkp: 'boolean',
      price_tax_mode: 'string',
      tax_profile: 'string',
      tax_rate: 'string',
      tax_rate_id: 'string|null',
      service_charge_rate: 'string',
      service_charge_taxable: 'boolean',
      cash_rounding_unit: 'integer',
      receipt_locale: 'string',
      currency: 'string',
      gross_total: 'integer',
      line_discount_total: 'integer',
      bill_discount_type: 'string|null',
      bill_discount_pct: 'string|null',
      bill_discount_input: 'integer|null',
      bill_discount_total: 'integer',
      discount_approved_by: 'string|null',
      net_subtotal: 'integer',
      service_charge: 'integer',
      tax_base: 'integer',
      tax_amount: 'integer',
      dpp: 'integer',
      grand_total: 'integer',
      rounding: 'integer',
      customer_name: 'string|null',
      customer_phone: 'string|null',
      catalog_cursor: 'integer|null',
      bill_id: 'string|null',
      bill_ref: 'string|null',
    },
    'FinalizeSale.lines.item': {
      id: 'string',
      line_no: 'integer',
      line_kind: 'string',
      product_id: 'string|null',
      sku_id: 'string|null',
      uom_id: 'string|null',
      sku_code: 'string',
      item_name: 'string',
      uom_code: 'string',
      qty: 'string',
      conversion_factor: 'string',
      qty_base: 'string',
      unit_price: 'integer',
      price_source: 'string',
      is_open_price: 'boolean',
      taxable: 'boolean',
      discount_type: 'string|null',
      discount_pct: 'string|null',
      discount_input: 'integer|null',
      discount_approved_by: 'string|null',
      line_gross: 'integer',
      line_discount: 'integer',
      line_net: 'integer',
      bill_discount_alloc: 'integer',
      service_alloc: 'integer',
      tax_alloc: 'integer',
      note: 'string|null',
      source_bill_item_id: 'string|null',
    },
    'FinalizeSale.payments.item': {
      id: 'string',
      seq: 'integer',
      method_id: 'string',
      method_code: 'string',
      method_name: 'string',
      method_kind: 'string',
      amount_applied: 'integer',
      cash_tendered: 'integer|null',
      change_given: 'integer|null',
      reference: 'string|null',
      is_rounding_settler: 'boolean',
    },
    VoidSale: {
      sale_id: 'string',
      voided_at: 'string',
      voided_by: 'string',
      void_approved_by: 'string',
      reason_code: 'string',
      reason_text: 'string',
    },
    'FinalizeCreditNote.credit_note': {
      id: 'string',
      shift_id: 'string',
      created_by: 'string',
      approved_by: 'string',
      created_at_device: 'string',
      clock_offset_ms: 'integer',
      occurred_at: 'string',
      business_date: 'string',
      cn_no: 'string',
      cn_prefix: 'string',
      cn_period: 'string',
      cn_seq: 'integer',
      original_sale_id: 'string',
      original_invoice_no: 'string',
      reason_code: 'string',
      reason_text: 'string|null',
      price_tax_mode: 'string',
      cash_rounding_unit: 'integer',
      receipt_locale: 'string',
      net_total: 'integer',
      service_total: 'integer',
      tax_total: 'integer',
      refund_gross: 'integer',
      rounding: 'integer',
    },
    'FinalizeCreditNote.lines.item': {
      id: 'string',
      line_no: 'integer',
      sale_line_id: 'string',
      qty_returned: 'string',
      qty_returned_base: 'string',
      refund_net: 'integer',
      refund_service: 'integer',
      refund_tax: 'integer',
      is_final_return: 'boolean',
      disposition: 'string|null',
    },
    'FinalizeCreditNote.refunds.item': {
      id: 'string',
      seq: 'integer',
      method_id: 'string',
      method_code: 'string',
      method_name: 'string',
      method_kind: 'string',
      amount_applied: 'integer',
      reference: 'string|null',
    },
    'OpenShift.shift': {
      id: 'string',
      created_by: 'string',
      created_at_device: 'string',
      clock_offset_ms: 'integer',
      occurred_at: 'string',
      business_date: 'string',
      opening_cash: 'integer',
    },
    'RecordCashMovement.movement': {
      id: 'string',
      shift_id: 'string',
      created_by: 'string',
      created_at_device: 'string',
      clock_offset_ms: 'integer',
      occurred_at: 'string',
      business_date: 'string',
      direction: 'string',
      amount: 'integer',
      reason_code: 'string',
      reason_text: 'string',
    },
    CloseShift: {
      shift_id: 'string',
      counted_cash: 'integer',
      count_submitted_at: 'string',
      closed_at: 'string',
      closed_at_device: 'string',
      expected_cash_device: 'integer',
      variance_device: 'integer',
      close_note: 'string|null',
    },
  },
}

interface JsonSchemaNode {
  type?: string | string[]
  const?: unknown
  enum?: unknown[]
  anyOf?: JsonSchemaNode[]
  properties?: Record<string, JsonSchemaNode>
  required?: string[]
  items?: JsonSchemaNode
}

function summarizeType(node: JsonSchemaNode): string {
  if (typeof node.type === 'string') return node.type
  if (node.const !== undefined) return typeof node.const
  if (Array.isArray(node.enum) && node.enum.length > 0) return typeof node.enum[0]
  if (Array.isArray(node.anyOf)) {
    const parts = node.anyOf.map((branch) => {
      if (branch.type === 'null') return 'null'
      return summarizeType(branch)
    })
    return [...new Set(parts)].join('|')
  }
  return 'unknown'
}

function assertMatchesVersionContract(
  label: string,
  node: JsonSchemaNode,
  expected: Record<string, string>,
): void {
  const actualRequired = new Set(node.required ?? [])
  const expectedKeys = Object.keys(expected)

  // Every required key in the schema must match baseline & cannot silently gain new required fields.
  for (const key of actualRequired) {
    if (!(key in expected)) {
      throw new Error(
        `[${label}] field wajib baru "${key}" ditambahkan pada SCHEMA_VERSION=${SCHEMA_VERSION}: ` +
          `naikkan SCHEMA_VERSION dan tambahkan migrator/upcaster`,
      )
    }
  }

  for (const key of expectedKeys) {
    if (!actualRequired.has(key)) {
      throw new Error(
        `[${label}] field wajib "${key}" hilang pada SCHEMA_VERSION=${SCHEMA_VERSION}: ` +
          `naikkan SCHEMA_VERSION dan tambahkan migrator/upcaster`,
      )
    }
    const prop = node.properties?.[key]
    if (!prop) {
      throw new Error(`[${label}] missing property schema for "${key}"`)
    }
    const actualType = summarizeType(prop)
    const allowed = expected[key]!.split('|').sort().join('|')
    const actualNorm = actualType.split('|').sort().join('|')
    if (actualNorm !== allowed) {
      throw new Error(
        `[${label}.${key}] tipe berubah (${actualNorm} != ${allowed}) tanpa menaikkan SCHEMA_VERSION: ` +
          `naikkan SCHEMA_VERSION dan tambahkan migrator/upcaster`,
      )
    }
  }
}

describe('contracts JSON Schema snapshots & version-bump enforcement', () => {
  it('matches committed JSON Schema snapshots for every registered command version', () => {
    expect(SCHEMA_VERSION).toBe(1)

    const allSchemas: Record<string, unknown> = {}
    for (const [cmdType, versionMap] of Object.entries(COMMAND_PAYLOAD_SCHEMAS)) {
      for (const [ver, schema] of Object.entries(versionMap)) {
        allSchemas[`${cmdType}.v${ver}`] = z.toJSONSchema(schema, {
          io: 'input',
          unrepresentable: 'any',
        })
      }
    }

    expect(allSchemas).toMatchSnapshot()
  })

  it('rejects unversioned additions of required fields or type changes relative to v1 baseline', () => {
    const baseline = REQUIRED_FIELDS_BY_VERSION[SCHEMA_VERSION]!

    const finalizeSale = z.toJSONSchema(COMMAND_PAYLOAD_SCHEMAS.FinalizeSale[1]!, {
      io: 'input',
      unrepresentable: 'any',
    }) as JsonSchemaNode
    assertMatchesVersionContract('FinalizeSale.sale', finalizeSale.properties!.sale!, baseline['FinalizeSale.sale']!)
    assertMatchesVersionContract(
      'FinalizeSale.lines.item',
      finalizeSale.properties!.lines!.items!,
      baseline['FinalizeSale.lines.item']!,
    )
    assertMatchesVersionContract(
      'FinalizeSale.payments.item',
      finalizeSale.properties!.payments!.items!,
      baseline['FinalizeSale.payments.item']!,
    )

    const voidSale = z.toJSONSchema(COMMAND_PAYLOAD_SCHEMAS.VoidSale[1]!, {
      io: 'input',
      unrepresentable: 'any',
    }) as JsonSchemaNode
    assertMatchesVersionContract('VoidSale', voidSale, baseline['VoidSale']!)

    const cn = z.toJSONSchema(COMMAND_PAYLOAD_SCHEMAS.FinalizeCreditNote[1]!, {
      io: 'input',
      unrepresentable: 'any',
    }) as JsonSchemaNode
    assertMatchesVersionContract(
      'FinalizeCreditNote.credit_note',
      cn.properties!.credit_note!,
      baseline['FinalizeCreditNote.credit_note']!,
    )
    assertMatchesVersionContract(
      'FinalizeCreditNote.lines.item',
      cn.properties!.lines!.items!,
      baseline['FinalizeCreditNote.lines.item']!,
    )
    assertMatchesVersionContract(
      'FinalizeCreditNote.refunds.item',
      cn.properties!.refunds!.items!,
      baseline['FinalizeCreditNote.refunds.item']!,
    )

    const openShift = z.toJSONSchema(COMMAND_PAYLOAD_SCHEMAS.OpenShift[1]!, {
      io: 'input',
      unrepresentable: 'any',
    }) as JsonSchemaNode
    assertMatchesVersionContract('OpenShift.shift', openShift.properties!.shift!, baseline['OpenShift.shift']!)

    const movement = z.toJSONSchema(COMMAND_PAYLOAD_SCHEMAS.RecordCashMovement[1]!, {
      io: 'input',
      unrepresentable: 'any',
    }) as JsonSchemaNode
    assertMatchesVersionContract(
      'RecordCashMovement.movement',
      movement.properties!.movement!,
      baseline['RecordCashMovement.movement']!,
    )

    const closeShift = z.toJSONSchema(COMMAND_PAYLOAD_SCHEMAS.CloseShift[1]!, {
      io: 'input',
      unrepresentable: 'any',
    }) as JsonSchemaNode
    assertMatchesVersionContract('CloseShift', closeShift, baseline['CloseShift']!)
  })
})
