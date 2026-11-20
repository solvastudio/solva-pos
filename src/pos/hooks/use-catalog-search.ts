import { useLiveQuery } from 'dexie-react-hooks'
import {
  listVisibleProducts,
  searchProducts,
  type CatalogProductEntry,
} from '../data/catalog.repo'
import type { SolvaDb } from '../db/solva-db'

export interface UseCatalogSearchOptions {
  query: string
  outletId: string | null
  categoryId?: string
  limit?: number
  page?: number
  pageSize?: number
}

/**
 * Live offline catalog query reacting cleanly to Dexie pull-applier commits.
 */
export function useCatalogSearch(
  db: SolvaDb | null,
  opts: UseCatalogSearchOptions,
): {
  items: readonly CatalogProductEntry[]
  total: number
  isLoading: boolean
} {
  const res = useLiveQuery(async () => {
    if (!db || !opts.outletId) {
      return { items: [] as CatalogProductEntry[], total: 0 }
    }
    if (opts.query.trim().length > 0) {
      const items = await searchProducts(db, opts.query, {
        outletId: opts.outletId,
        categoryId: opts.categoryId,
        limit: opts.limit,
      })
      return { items, total: items.length }
    }
    const page = await listVisibleProducts(db, {
      outletId: opts.outletId,
      categoryId: opts.categoryId,
      page: opts.page,
      pageSize: opts.pageSize,
    })
    return { items: page.items, total: page.total }
  }, [db, opts.query, opts.outletId, opts.categoryId, opts.limit, opts.page, opts.pageSize])

  return {
    items: res?.items ?? [],
    total: res?.total ?? 0,
    isLoading: res === undefined,
  }
}
