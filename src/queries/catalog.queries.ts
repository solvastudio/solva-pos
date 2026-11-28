import { queryOptions } from '@tanstack/react-query'
import {
  getAvailabilityMatrixFn,
  getPriceMatrixFn,
  getProductFn,
  listCategoriesFn,
  listFeatureFlagsFn,
  listProductsFn,
  listUomsFn,
} from '~/functions/catalog/catalog-read.fn'
import {
  listModifierGroupsFn,
  listProductModifierGroupsFn,
} from '~/functions/catalog/modifier.fn'
import {
  getRecipeForMenuSkuFn,
  listIngredientOptionsFn,
} from '~/functions/catalog/recipe.fn'
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

export function modifierGroupsQueryOptions(tenantSlug: string) {
  return queryOptions({
    queryKey: qk.modifierGroups(tenantSlug),
    queryFn: () => listModifierGroupsFn(),
  })
}

export function productModifierGroupsQueryOptions(tenantSlug: string, productId: string) {
  return queryOptions({
    queryKey: qk.productModifierGroups(tenantSlug, productId),
    queryFn: () => listProductModifierGroupsFn({ data: { productId } }),
  })
}

export function recipeForSkuQueryOptions(tenantSlug: string, menuSkuId: string) {
  return queryOptions({
    queryKey: qk.recipeForSku(tenantSlug, menuSkuId),
    queryFn: () => getRecipeForMenuSkuFn({ data: { menuSkuId } }),
  })
}

export function ingredientOptionsQueryOptions(tenantSlug: string, excludeMenuSkuId?: string) {
  return queryOptions({
    queryKey: qk.ingredientOptions(tenantSlug, excludeMenuSkuId),
    queryFn: () => listIngredientOptionsFn({ data: { excludeMenuSkuId } }),
  })
}
