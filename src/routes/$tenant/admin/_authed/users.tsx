import { createFileRoute, redirect } from '@tanstack/react-router'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { DevicesTab } from '~/components/admin/devices/DevicesTab'
import { RegistersTab } from '~/components/admin/users/RegistersTab'
import { RolesTab } from '~/components/admin/users/RolesTab'
import { UsersTab } from '~/components/admin/users/UsersTab'
import { Tabs, type TabItem } from '~/components/ui'
import { useCurrentTenant } from '~/hooks/use-current-tenant'
import { tenantHref } from '~/lib/tenancy/tenant-href'
import {
  devicesQueryOptions,
  membersQueryOptions,
  outletsQueryOptions,
  pendingInvitesQueryOptions,
  registersQueryOptions,
  rolesQueryOptions,
} from '~/queries/identity.queries'

export const Route = createFileRoute('/$tenant/admin/_authed/users')({
  beforeLoad: ({ params, context }) => {
    if (!context.session?.permissions.includes('user.manage')) {
      throw redirect({ href: tenantHref(params.tenant, '/admin') })
    }
  },
  loader: async ({ params, context }) => {
    const tasks: Promise<unknown>[] = [
      context.queryClient.ensureQueryData(membersQueryOptions(params.tenant)),
      context.queryClient.ensureQueryData(rolesQueryOptions(params.tenant)),
      context.queryClient.ensureQueryData(outletsQueryOptions(params.tenant)),
      context.queryClient.ensureQueryData(registersQueryOptions(params.tenant)),
      context.queryClient.ensureQueryData(devicesQueryOptions(params.tenant)),
    ]
    if (context.session?.permissions.includes('user.invite')) {
      tasks.push(context.queryClient.ensureQueryData(pendingInvitesQueryOptions(params.tenant)))
    }
    await Promise.all(tasks)
  },
  component: AdminUsersPage,
})

function AdminUsersPage() {
  const { t } = useTranslation()
  const { slug, name } = useCurrentTenant()
  const { session } = Route.useRouteContext()
  const [activeTab, setActiveTab] = useState('users')
  const canEditRoles = session?.outletIds === null

  const tabItems: readonly TabItem[] = [
    {
      value: 'users',
      label: t('admin.users.tabUsers'),
      content: (
        <div className="mt-6">
          <UsersTab
            tenantSlug={slug}
            tenantName={name}
            permissions={session?.permissions ?? []}
            actorOutletIds={session?.outletIds ?? []}
          />
        </div>
      ),
    },
    {
      value: 'roles',
      label: t('admin.users.tabRoles'),
      content: (
        <div className="mt-6">
          <RolesTab tenantSlug={slug} canEditRoles={canEditRoles} />
        </div>
      ),
    },
    {
      value: 'registers',
      label: t('admin.users.tabRegisters'),
      content: (
        <div className="mt-6">
          <RegistersTab tenantSlug={slug} />
        </div>
      ),
    },
    {
      value: 'devices',
      label: t('admin.users.tabDevices'),
      content: (
        <div className="mt-6">
          <DevicesTab tenantSlug={slug} />
        </div>
      ),
    },
  ]

  return (
    <div className="flex flex-col gap-6">
      <h1 className="text-h1 font-semibold text-ink">{t('admin.users.title')}</h1>
      <Tabs
        items={tabItems}
        value={activeTab}
        onValueChange={setActiveTab}
        size="md"
        ariaLabel={t('admin.users.tabsLabel')}
      />
    </div>
  )
}
