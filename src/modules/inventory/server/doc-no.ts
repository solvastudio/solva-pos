import '@tanstack/react-start/server-only'
import { sql } from 'drizzle-orm'
import { invoicePeriod } from '~/lib/kernel'
import { AppError } from '~/server/error-classify'
import type { TenantTx } from '~/server/db'

/**
 * Nomor dokumen inventori `{JENIS}-{KODE_OUTLET}-{MMYY}-{URUT4}` (BR-STK-020, SCHEMA §2.2 STD-D).
 * URUT dihitung `MAX+1` per (tenant, outlet, jenis, MMYY) di bawah advisory lock transaksi, sehingga dua
 * posting paralel menerima nomor berbeda. Tidak wajib tanpa celah. Di atas 9999 melebar menjadi 5 digit.
 */

export type DocKind = 'GR' | 'TRF' | 'OPN'

export function draftDocNo(): string {
  return `DRAFT-${crypto.randomUUID().slice(0, 8)}`
}

export async function nextDocNo(
  tx: TenantTx,
  input: { tenantId: string; outletId: string; kind: DocKind; businessDate: string },
): Promise<string> {
  const outlet = await tx.execute<{ code: string }>(sql`
    SELECT code FROM outlet WHERE tenant_id = ${input.tenantId}::uuid AND id = ${input.outletId}::uuid
  `)
  const code = outlet.rows[0]?.code
  if (!code) {
    throw new AppError('VALIDATION_FAILED', 'Outlet tidak ditemukan')
  }
  const mmyy = invoicePeriod(input.businessDate)
  const prefix = `${input.kind}-${code}-${mmyy}-`

  await tx.execute(sql`
    SELECT pg_advisory_xact_lock(hashtextextended(${input.tenantId} || ${input.outletId} || ${input.kind} || ${mmyy}, 0))
  `)

  const maxRes = await maxSequence(tx, input.tenantId, input.outletId, input.kind, prefix)
  const next = maxRes + 1
  return `${prefix}${String(next).padStart(4, '0')}`
}

async function maxSequence(
  tx: TenantTx,
  tenantId: string,
  outletId: string,
  kind: DocKind,
  prefix: string,
): Promise<number> {
  const pattern = `${prefix}%`
  const row =
    kind === 'GR'
      ? await tx.execute<{ m: number | string | null }>(sql`
          SELECT MAX(CAST(split_part(doc_no, '-', 4) AS int)) AS m FROM goods_receipt
          WHERE tenant_id = ${tenantId}::uuid AND outlet_id = ${outletId}::uuid AND doc_no LIKE ${pattern}`)
      : kind === 'TRF'
        ? await tx.execute<{ m: number | string | null }>(sql`
            SELECT MAX(CAST(split_part(doc_no, '-', 4) AS int)) AS m FROM transfer
            WHERE tenant_id = ${tenantId}::uuid AND outlet_id = ${outletId}::uuid AND doc_no LIKE ${pattern}`)
        : await tx.execute<{ m: number | string | null }>(sql`
            SELECT MAX(CAST(split_part(doc_no, '-', 4) AS int)) AS m FROM stocktake
            WHERE tenant_id = ${tenantId}::uuid AND outlet_id = ${outletId}::uuid AND doc_no LIKE ${pattern}`)
  return Number(row.rows[0]?.m ?? 0)
}
