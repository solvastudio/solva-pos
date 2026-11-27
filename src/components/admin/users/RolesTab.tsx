import { useQuery } from '@tanstack/react-query'
import { useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Button, Plus, Skeleton, useToast } from '~/components/ui'
import { cn } from '~/lib/cn'
import type { PermissionCode, RoleMatrixView } from '~/modules/identity/shared'
import { rolesQueryOptions } from '~/queries/identity.queries'
import { RoleDetailPanel } from './RoleDetailPanel'
import { RoleFormDialog } from './RoleFormDialog'
import { RoleActorProvider, useRoleActor, type RoleActor } from './role-actor-context'

export interface RolesTabProps {
  tenantSlug: string
  canEditRoles: boolean
  actorPermissions: readonly PermissionCode[]
  actorDiscountLimitPct: number
}

interface FormDialogState {
  mode: 'create' | 'duplicate'
  source: RoleMatrixView | null
}

/** Provides the signed-in member's role-management capabilities to the whole tab. */
export function RolesTab({
  tenantSlug,
  canEditRoles,
  actorPermissions,
  actorDiscountLimitPct,
}: RolesTabProps) {
  const actor = useMemo<RoleActor>(() => {
    const permissions = new Set(actorPermissions)
    return {
      permissions,
      discountLimitPct: actorDiscountLimitPct,
      canEditRoles,
      canViewMembers: permissions.has('user.manage'),
    }
  }, [actorPermissions, actorDiscountLimitPct, canEditRoles])

  return (
    <RoleActorProvider value={actor}>
      <RolesTabContent tenantSlug={tenantSlug} />
    </RoleActorProvider>
  )
}

function RolesTabContent({ tenantSlug }: { tenantSlug: string }) {
  const { t } = useTranslation()
  const toast = useToast()
  const { canEditRoles } = useRoleActor()
  const { data: roles = [], isLoading } = useQuery(rolesQueryOptions(tenantSlug))

  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [dialog, setDialog] = useState<FormDialogState | null>(null)
  const [dialogSession, setDialogSession] = useState(0)

  const selected = roles.find((r) => r.id === selectedId) ?? roles[0] ?? null

  function openDialog(next: FormDialogState) {
    setDialogSession((n) => n + 1)
    setDialog(next)
  }

  if (isLoading) {
    return (
      <div className="flex flex-col gap-2" aria-busy="true">
        {Array.from({ length: 6 }).map((_, idx) => (
          <Skeleton key={idx} className="h-11 w-full rounded-control" />
        ))}
      </div>
    )
  }

  return (
    <div className="flex flex-col gap-5 md:flex-row md:items-start">
      <aside className="flex flex-col gap-3 md:sticky md:top-4 md:w-72 md:shrink-0">
        {canEditRoles ? (
          <Button
            variant="primary"
            size="md"
            leadingIcon={<Plus className="size-4" aria-hidden="true" />}
            onClick={() => openDialog({ mode: 'create', source: null })}
          >
            {t('admin.users.role.newButton')}
          </Button>
        ) : null}
        <ul
          role="list"
          aria-label={t('admin.users.role.listLabel')}
          className="flex flex-wrap gap-1.5 md:flex-col"
        >
          {roles.map((r) => {
            const isSelected = r.id === selected?.id
            return (
              <li key={r.id} className="min-w-0 md:w-full">
                <button
                  type="button"
                  aria-current={isSelected ? 'true' : undefined}
                  onClick={() => setSelectedId(r.id)}
                  className={cn(
                    'flex min-h-11 items-center justify-between gap-2 rounded-control border px-3 py-1.5 text-left transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus-ring md:min-h-12 md:w-full md:py-2',
                    isSelected
                      ? 'border-action bg-action-soft text-on-action-soft ring-1 ring-action'
                      : 'border-line bg-surface text-ink hover:bg-surface-hover',
                  )}
                >
                  <span className="min-w-0">
                    <span className="block truncate text-body font-medium">{r.name}</span>
                    <span className="block text-caption text-ink-soft">
                      {t('admin.users.role.memberCount', { count: r.memberCount })}
                    </span>
                  </span>
                  {r.isSystem ? (
                    <span
                      className={cn(
                        'shrink-0 rounded-md border px-2 py-0.5 text-label-sm font-medium',
                        isSelected
                          ? 'border-action/30 bg-surface text-on-action-soft'
                          : 'border-line bg-surface-subtle text-ink-soft',
                      )}
                    >
                      {t('admin.users.role.systemBadge')}
                    </span>
                  ) : null}
                </button>
              </li>
            )
          })}
        </ul>
      </aside>

      <section className="min-w-0 flex-1">
        {selected ? (
          <RoleDetailPanel
            key={`${selected.id}:${selected.version}`}
            tenantSlug={tenantSlug}
            role={selected}
            onDuplicate={(source) => openDialog({ mode: 'duplicate', source })}
            onDeleted={() => setSelectedId(null)}
          />
        ) : null}
      </section>

      {dialog ? (
        <RoleFormDialog
          key={dialogSession}
          open
          onOpenChange={(next) => {
            if (!next) setDialog(null)
          }}
          tenantSlug={tenantSlug}
          mode={dialog.mode}
          source={dialog.source}
          onCreated={(role) => {
            toast.show({
              tone: 'success',
              message: t(
                dialog.mode === 'create'
                  ? 'admin.users.role.created'
                  : 'admin.users.role.duplicated',
              ),
            })
            setDialog(null)
            setSelectedId(role.id)
          }}
        />
      ) : null}
    </div>
  )
}
