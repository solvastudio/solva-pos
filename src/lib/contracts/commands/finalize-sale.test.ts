import { ZodError } from 'zod'
import { describe, expect, it } from 'vitest'
import v04Fixture from '../../../../tests/fixtures/contracts/v1/FinalizeSale.json'
import v11Fixture from '../../../../tests/fixtures/contracts/v1/FinalizeSale.v11.json'
import { FinalizeSalePayloadV1 } from './finalize-sale'

describe('contracts/commands/finalize-sale (v1)', () => {
  it('accepts V-04 (3 lines, single cash) and V-11 (QRIS + rounding settler cash) fixtures', () => {
    const parsed04 = FinalizeSalePayloadV1.parse(v04Fixture)
    expect(parsed04.sale.grand_total).toBe(112476)
    expect(parsed04.sale.rounding).toBe(24)
    expect(parsed04.lines[0]!.modifiers).toEqual([])

    const parsed11 = FinalizeSalePayloadV1.parse(v11Fixture)
    expect(parsed11.payments).toHaveLength(2)
    expect(parsed11.payments[1]!.is_rounding_settler).toBe(true)
  })

  it('rejects structural violations with path-specific Zod issues', () => {
    const base = v04Fixture as Record<string, unknown>

    // Unknown extra field (.strict)
    const extraSale = structuredClone(base) as { sale: Record<string, unknown> }
    extraSale.sale.register_id = '01950000-0000-7000-8000-000000009999'
    expect(() => FinalizeSalePayloadV1.parse(extraSale)).toThrow(ZodError)

    // Non-integer money
    const floatMoney = structuredClone(base) as { sale: Record<string, unknown> }
    floatMoney.sale.grand_total = 112476.5
    expect(() => FinalizeSalePayloadV1.parse(floatMoney)).toThrow(ZodError)

    // Invalid scale qty
    const badQty = structuredClone(base) as { lines: Array<Record<string, unknown>> }
    badQty.lines[0]!.qty = '1.23456'
    expect(() => FinalizeSalePayloadV1.parse(badQty)).toThrow(ZodError)

    // Percent > 100
    const badPct = structuredClone(base) as { lines: Array<Record<string, unknown>> }
    badPct.lines[2]!.discount_pct = '101'
    expect(() => FinalizeSalePayloadV1.parse(badPct)).toThrow(ZodError)

    // Uppercase UUID
    const upperUuid = structuredClone(base) as { sale: Record<string, unknown> }
    upperUuid.sale.id = '01950000-0000-7000-8000-0000000001AB'
    expect(() => FinalizeSalePayloadV1.parse(upperUuid)).toThrow(ZodError)

    // CASH payment without cash_tendered
    const missingTender = structuredClone(base) as { payments: Array<Record<string, unknown>> }
    missingTender.payments[0]!.cash_tendered = null
    expect(() => FinalizeSalePayloadV1.parse(missingTender)).toThrow(ZodError)

    // OPEN_PRICE without is_open_price = true
    const badOpenPrice = structuredClone(base) as { lines: Array<Record<string, unknown>> }
    badOpenPrice.lines[0]!.price_source = 'OPEN_PRICE'
    badOpenPrice.lines[0]!.is_open_price = false
    expect(() => FinalizeSalePayloadV1.parse(badOpenPrice)).toThrow(ZodError)

    // STOCK_BASIS line with non-zero money
    const badStockBasis = structuredClone(base) as { lines: Array<Record<string, unknown>> }
    badStockBasis.lines[0]!.line_kind = 'STOCK_BASIS'
    expect(() => FinalizeSalePayloadV1.parse(badStockBasis)).toThrow(ZodError)

    // Duplicate line_no
    const dupLine = structuredClone(base) as { lines: Array<Record<string, unknown>> }
    dupLine.lines[1]!.line_no = 1
    expect(() => FinalizeSalePayloadV1.parse(dupLine)).toThrow(ZodError)
  })
})
