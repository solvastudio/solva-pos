import { queryOptions } from '@tanstack/react-query'
import { listTablesFn } from '~/functions/fnb/tables.fn'
import { qk } from './keys'

export function fnbTablesQueryOptions(tenantSlug: string, outletId?: string) {
  return queryOptions({
    queryKey: qk.fnbTables(tenantSlug, outletId),
    queryFn: () => listTablesFn({ data: outletId ? { outletId } : {} }),
  })
}
