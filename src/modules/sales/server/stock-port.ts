import '@tanstack/react-start/server-only'
import type { Money, Qty } from '~/lib/kernel'
import type { TenantTx } from '~/server/db'

/**
 * Port stok untuk alur penjualan (Fase 53). `sales` tidak mengimpor `inventory`; adaptornya
 * didaftarkan di composition root (`src/server/composition.ts`) dengan struktur yang sama.
 * Tanpa adaptor terdaftar (mis. tes sales murni), port bawaan tidak menulis apa pun.
 */

export interface SaleStockLinePort {
  readonly lineId: string
  readonly lineNo: number
  readonly lineKind: 'ITEM' | 'SHARE' | 'STOCK_BASIS'
  readonly skuId: string | null
  readonly qtyBase: Qty
}

export interface SaleStockInputPort {
  readonly tenantId: string
  readonly outletId: string
  readonly saleId: string
  readonly occurredAt: string
  readonly businessDate: string
  readonly processedAt: string
  readonly commandId: string | null
  readonly actorId: string | null
  readonly lines: readonly SaleStockLinePort[]
}

export interface SaleStockResultPort {
  readonly costTotal: Money | null
  readonly lines: readonly { readonly lineId: string; readonly costSnapshot: Money | null }[]
  readonly negativeResults: readonly { readonly outletId: string; readonly skuId: string; readonly qtyAfter: Qty }[]
}

export interface VoidStockLinePort {
  readonly lineId: string
  readonly lineNo: number
  readonly skuId: string | null
  readonly qtyBase: Qty
  readonly costSnapshot: Money | null
  readonly returnedQtyBase: Qty
  readonly returnedCost: Money
}

export interface VoidStockInputPort {
  readonly tenantId: string
  readonly outletId: string
  readonly occurredAt: string
  readonly businessDate: string
  readonly processedAt: string
  readonly commandId: string | null
  readonly actorId: string | null
  readonly lines: readonly VoidStockLinePort[]
}

export interface ReturnStockLinePort {
  readonly creditNoteLineId: string
  readonly lineNo: number
  readonly saleLineId: string
  readonly skuId: string | null
  readonly disposition: string | null
  readonly qtyReturnedBase: Qty
  readonly saleQtyBase: Qty
  readonly costSnapshot: Money | null
  readonly returnedQtyBefore: Qty
  readonly costReturnedBefore: Money
}

export interface ReturnStockInputPort {
  readonly tenantId: string
  readonly outletId: string
  readonly occurredAt: string
  readonly businessDate: string
  readonly processedAt: string
  readonly commandId: string | null
  readonly actorId: string | null
  readonly lines: readonly ReturnStockLinePort[]
}

export interface SaleStockPort {
  applySale(tx: TenantTx, input: SaleStockInputPort): Promise<SaleStockResultPort>
  applyVoid(tx: TenantTx, input: VoidStockInputPort): Promise<void>
  applyReturn(
    tx: TenantTx,
    input: ReturnStockInputPort,
  ): Promise<{ readonly lines: readonly { readonly creditNoteLineId: string; readonly costReturned: Money | null }[] }>
}

const defaultPort: SaleStockPort = {
  async applySale(_tx, input) {
    return {
      costTotal: null,
      lines: input.lines.map((l) => ({ lineId: l.lineId, costSnapshot: null })),
      negativeResults: [],
    }
  },
  async applyVoid() {
    return undefined
  },
  async applyReturn(_tx, input) {
    return { lines: input.lines.map((l) => ({ creditNoteLineId: l.creditNoteLineId, costReturned: null })) }
  },
}

let activePort: SaleStockPort = defaultPort

export function registerSaleStockPort(port: SaleStockPort): void {
  activePort = port
}

export function getSaleStockPort(): SaleStockPort {
  return activePort
}

export function __clearSaleStockPortForTests(): void {
  activePort = defaultPort
}
