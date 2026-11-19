import { Outlet, createFileRoute, redirect } from '@tanstack/react-router'
import { AdminShell } from '~/components/layout/AdminShell'
import { ToastProvider } from '~/components/ui'
import { getSessionFn, type AdminSessionView } from '~/functions/auth/session.fn'
import { changeLocale, i18next } from '~/i18n'
import { safeReturnTo } from '~/lib/safe-redirect'
import { tenantHref } from '~/lib/tenancy/tenant-href'

export interface AdminAuthedContext {
  session: AdminSessionView | null
}

export const Route = createFileRoute('/$tenant/admin/_authed')({
  ssr: true,
  beforeLoad: async ({ params, location, context }): Promise<AdminAuthedContext> => {
    if (!('tenantStatus' in context) || context.tenantStatus !== 'active') {
      return { session: null }
    }

    const session = await getSessionFn({ data: { slug: params.tenant } })
    if (!session) {
      const target = safeReturnTo(
        `${location.pathname}${location.searchStr ?? ''}`,
        params.tenant,
      )
      const loginBase = tenantHref(params.tenant, '/admin/login')
      const returnParam = encodeURIComponent(target)
      throw redirect({
        href: `${loginBase}?returnTo=${returnParam}`,
      })
    }

    if (i18next.language !== session.locale) {
      await changeLocale(session.locale)
    }

    return { session }
  },
  component: AdminAuthedLayout,
})

function AdminAuthedLayout() {
  const { session } = Route.useRouteContext()
  if (!session) {
    return null
  }
  return (
    <ToastProvider>
      <AdminShell session={session}>
        <Outlet />
      </AdminShell>
    </ToastProvider>
  )
}
