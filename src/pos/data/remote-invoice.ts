import {
  InvoiceLookupResponseSchema,
  type InvoiceLookupResponse,
} from '~/lib/contracts/invoice-lookup'
import type { SolvaDb } from '../db/solva-db'
import { deviceFetch } from '../sync/device-http'

export type RemoteInvoiceResult =
  | { readonly kind: 'ok'; readonly data: InvoiceLookupResponse }
  | { readonly kind: 'offline' }
  | { readonly kind: 'not_found' }
  | { readonly kind: 'error' }

/**
 * Queries `GET /api/pos/v1/invoice?no=...` online-only (`networkMode: 'online'`),
 * never caching remote invoice responses into persistent Dexie storage.
 */
export async function fetchRemoteInvoice(
  db: SolvaDb,
  invoiceNo: string,
  opts?: { fetch?: typeof fetch },
): Promise<RemoteInvoiceResult> {
  const cleanNo = invoiceNo.trim()
  if (!cleanNo) return { kind: 'not_found' }

  const res = await deviceFetch<unknown>(
    `/api/pos/v1/invoice?no=${encodeURIComponent(cleanNo)}`,
    {
      method: 'GET',
      db,
      fetch: opts?.fetch,
      timeoutMs: 8_000,
    },
  )

  if (res.kind === 'network' || res.kind === 'timeout') {
    return { kind: 'offline' }
  }
  if (res.kind === 'ok') {
    const parsed = InvoiceLookupResponseSchema.safeParse(res.data)
    return parsed.success ? { kind: 'ok', data: parsed.data } : { kind: 'error' }
  }
  if (res.kind === 'server_error' && res.status === 404) {
    return { kind: 'not_found' }
  }
  if (res.kind === 'invalid') {
    return { kind: 'not_found' }
  }
  return { kind: 'error' }
}
