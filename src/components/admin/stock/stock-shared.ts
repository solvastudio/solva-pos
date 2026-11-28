import { useQuery, useQueryClient } from '@tanstack/react-query'
import { listOutletOptionsFn } from '~/functions/identity/org.fn'
import { listSkuOptionsFn, listTransferDestinationsFn } from '~/functions/inventory/stock-read.fn'
import { useCurrentTenant } from '~/hooks/use-current-tenant'

export function formatOutletName(outlets: readonly { id: string; code: string; name: string }[], id: string): string {
  const outlet = outlets.find((o) => o.id === id)
  return outlet ? outlet.name || outlet.code : id
}

export function todayIso(): string {
  return new Date().toLocaleDateString('en-CA')
}

/** Money input: digits only, converted to an integer rupiah amount. */
export function parseMoneyInput(raw: string): number | null {
  const digits = raw.replace(/[^\d]/g, '')
  if (digits.length === 0) return null
  return Number(digits)
}

export function useStockInvalidate() {
  const queryClient = useQueryClient()
  const { slug } = useCurrentTenant()
  return () => queryClient.invalidateQueries({ queryKey: ['admin', slug, 'stock'] })
}

export function useOutletOptions() {
  const { slug } = useCurrentTenant()
  const query = useQuery({ queryKey: ['admin', slug, 'outlet-options'], queryFn: () => listOutletOptionsFn() })
  return query.data ?? []
}

/** Active outlets a transfer may be sent to; not limited to the actor's own outlets. */
export function useTransferDestinations() {
  const { slug } = useCurrentTenant()
  const query = useQuery({
    queryKey: ['admin', slug, 'stock', 'transfer-destinations'],
    queryFn: () => listTransferDestinationsFn(),
  })
  return query.data ?? []
}

export function useSkuOptions() {
  const { slug } = useCurrentTenant()
  const query = useQuery({ queryKey: ['admin', slug, 'stock', 'skus'], queryFn: () => listSkuOptionsFn() })
  return query.data ?? []
}

export interface GrDraftLine {
  skuId: string
  qty: string
  lineValue: string
}
