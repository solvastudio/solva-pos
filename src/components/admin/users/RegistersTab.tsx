import { useQuery } from '@tanstack/react-query'
import { useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import {
  Button,
  Chip,
  DataTable,
  PencilLine,
  Plus,
  Printer,
  type DataTableColumn,
} from '~/components/ui'
import {
  formatPeriodMmYy,
  nextMonthFirstDay,
  type RegisterView,
} from '~/modules/identity/shared'
import { outletsQueryOptions, registersQueryOptions } from '~/queries/identity.queries'
import { ChangePrefixDialog } from './ChangePrefixDialog'
import { CreateRegisterDialog } from './CreateRegisterDialog'
import { EditRegisterDialog } from './EditRegisterDialog'

export interface RegistersTabProps {
  tenantSlug: string
}

const LOCALE_FOLLOW_OUTLET = '__FOLLOW__'

export function RegistersTab({ tenantSlug }: RegistersTabProps) {
  const { t } = useTranslation()

  const { data: registers = [], isLoading } = useQuery(registersQueryOptions(tenantSlug))
  const { data: outlets = [] } = useQuery(outletsQueryOptions(tenantSlug))

  const todayYmd = useMemo(() => new Date().toISOString().slice(0, 10), [])
  const nextMonthMmYy = useMemo(() => formatPeriodMmYy(nextMonthFirstDay(todayYmd)), [todayYmd])

  const [createOpen, setCreateOpen] = useState(false)
  const [createSession, setCreateSession] = useState(0)
  const [editing, setEditing] = useState<RegisterView | null>(null)
  const [prefixTarget, setPrefixTarget] = useState<RegisterView | null>(null)

  function openCreateDialog() {
    setCreateSession((n) => n + 1)
    setCreateOpen(true)
  }

  const localeOptions = [
    { value: LOCALE_FOLLOW_OUTLET, label: t('admin.users.register.localeDefault') },
    { value: 'id-ID', label: t('sys.lang.id') },
    { value: 'en-US', label: t('sys.lang.en') },
  ]

  const columns: readonly DataTableColumn<RegisterView>[] = [
    {
      id: 'code',
      header: t('admin.users.register.colCode'),
      stickyFirst: true,
      sortValue: (r) => r.code,
      cell: (r) => <span className="font-mono font-semibold">{r.code}</span>,
    },
    {
      id: 'name',
      header: t('admin.users.register.colName'),
      sortValue: (r) => r.name,
      cell: (r) => r.name,
    },
    {
      id: 'outlet',
      header: t('admin.users.register.colOutlet'),
      cell: (r) => `${r.outletCode} · ${r.outletName}`,
    },
    {
      id: 'type',
      header: t('admin.users.register.colType'),
      cell: (r) => (
        <span className="inline-flex items-center rounded-md border border-line bg-surface-subtle px-2 py-0.5 text-label-sm font-medium text-ink">
          {t(`admin.users.register.type${r.registerType}`)}
        </span>
      ),
    },
    {
      id: 'prefix',
      header: t('admin.users.register.colPrefix'),
      cell: (r) =>
        r.currentPrefix ? (
          <div className="flex flex-col gap-0.5">
            <span className="font-mono">{r.currentPrefix}</span>
            {r.pendingNextPrefix ? (
              <span className="font-mono text-caption text-ink-soft">
                {t('admin.users.register.nextPrefixScheduled', {
                  month: formatPeriodMmYy(r.pendingNextPrefix.effectiveMonth),
                  prefix: r.pendingNextPrefix.invoicePrefix,
                })}
              </span>
            ) : null}
          </div>
        ) : (
          t('common.dash')
        ),
    },
    {
      id: 'paper',
      header: t('admin.users.register.colPaper'),
      numeric: true,
      cell: (r) => t(`admin.users.register.paper${r.paperWidthMm}`),
    },
    {
      id: 'status',
      header: t('admin.users.register.colStatus'),
      cell: (r) => (
        <Chip
          status={r.status === 'ACTIVE' ? 'active' : 'inactive'}
          label={r.status === 'ACTIVE' ? t('common.active') : t('common.inactive')}
          size="sm"
        />
      ),
    },
    {
      id: 'action',
      header: t('admin.users.register.colAction'),
      align: 'right',
      hideOnMobileCard: true,
      cell: (r) => (
        <div className="flex items-center justify-end gap-1">
          <Button
            variant="ghost"
            size="md"
            leadingIcon={<PencilLine className="size-4" aria-hidden="true" />}
            onClick={() => setEditing(r)}
          >
            {t('common.edit')}
          </Button>
          {r.registerType === 'CASHIER' ? (
            <Button variant="secondary" size="md" onClick={() => setPrefixTarget(r)}>
              {t('admin.users.register.changePrefix')}
            </Button>
          ) : null}
        </div>
      ),
    },
  ]

  return (
    <section className="flex flex-col gap-4">
      <div className="flex justify-end">
        <Button
          variant="primary"
          size="md"
          disabled={outlets.length === 0}
          leadingIcon={<Plus className="size-4" aria-hidden="true" />}
          onClick={openCreateDialog}
        >
          {t('admin.users.register.addButton')}
        </Button>
      </div>

      <DataTable
        caption={t('admin.users.tabRegisters')}
        columns={columns}
        rows={registers}
        loading={isLoading}
        getRowKey={(r) => r.id}
        emptyIcon={<Printer className="size-8" aria-hidden="true" />}
        emptyTitle={t('admin.users.register.emptyTitle')}
        emptyDescription={t('admin.users.register.emptyDesc')}
        mobileActions={(r) => (
          <div className="flex flex-wrap gap-1">
            <Button variant="ghost" size="md" onClick={() => setEditing(r)}>
              {t('common.edit')}
            </Button>
            {r.registerType === 'CASHIER' ? (
              <Button variant="secondary" size="md" onClick={() => setPrefixTarget(r)}>
                {t('admin.users.register.changePrefix')}
              </Button>
            ) : null}
          </div>
        )}
      />

      <CreateRegisterDialog
        key={createSession}
        open={createOpen}
        onOpenChange={setCreateOpen}
        tenantSlug={tenantSlug}
        outlets={outlets}
        todayYmd={todayYmd}
        localeOptions={localeOptions}
      />

      {editing ? (
        <EditRegisterDialog
          key={editing.id}
          row={editing}
          tenantSlug={tenantSlug}
          localeOptions={localeOptions}
          onClose={() => setEditing(null)}
        />
      ) : null}

      {prefixTarget ? (
        <ChangePrefixDialog
          key={prefixTarget.id}
          row={prefixTarget}
          tenantSlug={tenantSlug}
          todayYmd={todayYmd}
          nextMonthMmYy={nextMonthMmYy}
          onClose={() => setPrefixTarget(null)}
        />
      ) : null}
    </section>
  )
}
