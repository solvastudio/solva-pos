import { z } from 'zod'

/**
 * Input contracts for inventory documents. Quantities are sent as decimal strings (BR-UOM-005);
 * money as integer rupiah (BR-MNY-*). Business dates are `YYYY-MM-DD`.
 */

const uuid = z.string().uuid()
const businessDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Tanggal tidak valid')
const qtyString = z.string().trim().regex(/^\d+(\.\d{1,4})?$/, 'Jumlah tidak valid (maks 4 desimal)')
const moneyInt = z.number().int().min(0).max(999_999_999_999)

export const grLineSchema = z.object({
  skuId: uuid,
  uomId: uuid,
  qty: qtyString,
  unitCost: moneyInt.nullable().optional(),
  lineValue: moneyInt.nullable().optional(),
})

export const grDraftSchema = z.object({
  id: uuid.optional(),
  outletId: uuid,
  supplierId: uuid.nullable().optional(),
  supplierRef: z.string().trim().max(60).nullable().optional(),
  businessDate,
  note: z.string().trim().max(500).nullable().optional(),
  lines: z.array(grLineSchema).min(1).max(200),
})

export const idSchema = z.object({ id: uuid })

export const grReverseSchema = z.object({
  id: uuid,
  reasonText: z.string().trim().min(1).max(500),
})

export const transferDraftSchema = z.object({
  id: uuid.optional(),
  fromOutletId: uuid,
  toOutletId: uuid,
  businessDate,
  note: z.string().trim().max(500).nullable().optional(),
  lines: z
    .array(z.object({ skuId: uuid, uomId: uuid, qtyInput: qtyString }))
    .min(1)
    .max(200),
})

export const transferReceiveSchema = z.object({
  id: uuid,
  lines: z.array(z.object({ lineId: uuid, qtyReceivedBase: qtyString })).min(1).max(200),
  closeReasonCode: z.string().trim().min(1).max(40).nullable().optional(),
  closeReasonText: z.string().trim().max(200).nullable().optional(),
})

export const stocktakeCreateSchema = z
  .object({
    outletId: uuid,
    businessDate,
    scope: z.enum(['ALL', 'SELECTED']),
    skuIds: z.array(uuid).max(2000).optional(),
  })
  .refine((v) => v.scope === 'ALL' || (v.skuIds?.length ?? 0) > 0, {
    message: 'Pilih minimal satu SKU untuk opname parsial',
    path: ['skuIds'],
  })

export const stocktakeCountsSchema = z.object({
  id: uuid,
  counts: z.array(z.object({ lineId: uuid, countedQty: qtyString })).min(1).max(2000),
})

export const supplierSchema = z.object({
  id: uuid.optional(),
  name: z.string().trim().min(1).max(120),
  contact: z.string().trim().max(200).nullable().optional(),
})

export const outletIdSchema = z.object({ outletId: uuid })

export const r02FilterSchema = z.object({
  outletId: uuid.optional(),
  categoryId: uuid.optional(),
  onlyNegative: z.boolean().optional(),
  onlyInTransit: z.boolean().optional(),
  availability: z.enum(['ALL', 'AVAILABLE', 'UNAVAILABLE']).optional(),
})
