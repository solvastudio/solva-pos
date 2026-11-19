import { useRouteContext } from '@tanstack/react-router'

export interface CurrentTenantContext {
  tenantId: string
  slug: string
  name: string
  basePath: string
}

export function useCurrentTenant(): CurrentTenantContext {
  const ctx = useRouteContext({ from: '/$tenant' })
  if (ctx.tenantStatus !== 'active' || !ctx.tenant) {
    throw new Error('Tenant context is not active')
  }
  return {
    tenantId: ctx.tenant.id,
    slug: ctx.tenant.slug,
    name: ctx.tenant.name,
    basePath: `/${ctx.tenant.slug}`,
  }
}
