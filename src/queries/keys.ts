import type { ProductType } from '~/modules/catalog/shared'

export interface MembersQueryFilter {
  search?: string
  roleId?: string
  outletId?: string
}

export interface ProductListQueryFilter {
  search?: string
  categoryId?: string
  type?: ProductType
  page?: number
  pageSize?: number
}

export interface PriceMatrixQueryFilter {
  search?: string
  categoryId?: string
  onlyMissing?: boolean
  page?: number
  pageSize?: number
}

export interface AvailabilityMatrixQueryFilter {
  search?: string
  categoryId?: string
  onlyExceptions?: boolean
  page?: number
  pageSize?: number
}

export const qk = {
  legalEntities: (tenantSlug: string) => ['identity', tenantSlug, 'legal-entities'] as const,
  outlets: (tenantSlug: string) => ['identity', tenantSlug, 'outlets'] as const,
  registers: (tenantSlug: string) => ['identity', tenantSlug, 'registers'] as const,
  members: (tenantSlug: string, filter?: MembersQueryFilter) =>
    ['identity', tenantSlug, 'members', filter ?? {}] as const,
  pendingInvites: (tenantSlug: string) => ['identity', tenantSlug, 'pending-invites'] as const,
  roles: (tenantSlug: string) => ['identity', tenantSlug, 'roles'] as const,
  devices: (tenantSlug: string) => ['identity', tenantSlug, 'devices'] as const,
  products: (tenantSlug: string, filter?: ProductListQueryFilter) =>
    ['catalog', tenantSlug, 'products', filter ?? {}] as const,
  productDetail: (tenantSlug: string, productId: string) =>
    ['catalog', tenantSlug, 'product', productId] as const,
  categories: (tenantSlug: string) => ['catalog', tenantSlug, 'categories'] as const,
  uoms: (tenantSlug: string) => ['catalog', tenantSlug, 'uoms'] as const,
  catalogOutlets: (tenantSlug: string) => ['catalog', tenantSlug, 'outlets'] as const,
  priceMatrix: (tenantSlug: string, filter?: PriceMatrixQueryFilter) =>
    ['catalog', tenantSlug, 'price-matrix', filter ?? {}] as const,
  availabilityMatrix: (tenantSlug: string, filter?: AvailabilityMatrixQueryFilter) =>
    ['catalog', tenantSlug, 'availability-matrix', filter ?? {}] as const,
  featureFlags: (tenantSlug: string) => ['catalog', tenantSlug, 'feature-flags'] as const,
}
