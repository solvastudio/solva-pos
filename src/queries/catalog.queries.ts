import { queryOptions } from '@tanstack/react-query'
import {
  getAvailabilityMatrixFn,
  getPriceMatrixFn,
  getProductFn,
  listCatalogOutletsFn,
  listCategoriesFn,
  listFeatureFlagsFn,
  listProductsFn,
  listUomsFn,
} from '~/functions/catalog/catalog-read.fn'
import {
  qk,
  type AvailabilityMatrixQueryFilter,
  type PriceMatrixQueryFilter,
  type ProductListQueryFilter,
} from './keys'

export function productsListQueryOptions(tenantSlug: string, filter?: ProductListQueryFilter) {
  return queryOptions({
    queryKey: qk.products(tenantSlug, filter),
    queryFn: () => listProductsFn({ data: filter ?? {} }),
  })
}

export function productDetailQueryOptions(tenantSlug: string, productId: string) {
  return queryOptions({
    queryKey: qk.productDetail(tenantSlug, productId),
    queryFn: () => getProductFn({ data: { id: productId } }),
  })
}

export function categoriesQueryOptions(tenantSlug: string) {
  return queryOptions({
    queryKey: qk.categories(tenantSlug),
    queryFn: () => listCategoriesFn(),
  })
}

export function uomsQueryOptions(tenantSlug: string) {
  return queryOptions({
    queryKey: qk.uoms(tenantSlug),
    queryFn: () => listUomsFn(),
  })
}

export function catalogOutletsQueryOptions(tenantSlug: string) {
  return queryOptions({
    queryKey: qk.catalogOutlets(tenantSlug),
    queryFn: () => listCatalogOutletsFn(),
  })
}

export function priceMatrixQueryOptions(tenantSlug: string, filter?: PriceMatrixQueryFilter) {
  return queryOptions({
    queryKey: qk.priceMatrix(tenantSlug, filter),
    queryFn: () => getPriceMatrixFn({ data: filter ?? {} }),
  })
}

export function availabilityMatrixQueryOptions(
  tenantSlug: string,
  filter?: AvailabilityMatrixQueryFilter,
) {
  return queryOptions({
    queryKey: qk.availabilityMatrix(tenantSlug, filter),
    queryFn: () => getAvailabilityMatrixFn({ data: filter ?? {} }),
  })
}

export function featureFlagsQueryOptions(tenantSlug: string) {
  return queryOptions({
    queryKey: qk.featureFlags(tenantSlug),
    queryFn: () => listFeatureFlagsFn(),
  })
}
