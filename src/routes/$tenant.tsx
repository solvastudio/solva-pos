import { Outlet, createFileRoute, notFound, redirect } from '@tanstack/react-router'
import { NotFoundView } from '~/components/layout/NotFoundView'
import { SuspendedView } from '~/components/layout/SuspendedView'
import { resolveTenantFn } from '~/functions/tenant/resolve.fn'
import { RESERVED_SLUGS } from '~/lib/kernel'
import { canonicalizePath } from '~/lib/tenancy/canonical-path'

const RESERVED_SET = new Set<string>(RESERVED_SLUGS)

export type TenantRouteContext =
  | {
      tenantStatus: 'active'
      tenant: { id: string; slug: string; name: string }
    }
  | {
      tenantStatus: 'suspended'
      tenant: null
    }

export const Route = createFileRoute('/$tenant')({
  beforeLoad: async ({ params, location }): Promise<TenantRouteContext> => {
    const canonical = canonicalizePath(location.pathname)
    if (canonical.changed) {
      throw redirect({
        href: `${canonical.pathname}${location.searchStr ?? ''}`,
        statusCode: 308,
      })
    }

    if (RESERVED_SET.has(params.tenant.toLowerCase())) {
      throw notFound()
    }

    const res = await resolveTenantFn({ data: { slug: params.tenant } })
    if (res.kind === 'not_found') {
      throw notFound()
    }
    if (res.kind === 'suspended') {
      return { tenantStatus: 'suspended', tenant: null }
    }

    return {
      tenantStatus: 'active',
      tenant: {
        id: res.tenantId,
        slug: res.slug,
        name: res.name,
      },
    }
  },
  notFoundComponent: NotFoundView,
  component: TenantLayoutComponent,
})

function TenantLayoutComponent() {
  const ctx = Route.useRouteContext()
  if (ctx.tenantStatus === 'suspended') {
    return <SuspendedView />
  }
  return <Outlet />
}
