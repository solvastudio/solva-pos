import { useMutation, useQueryClient } from '@tanstack/react-query'
import { useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import {
  Button,
  Chip,
  DataTable,
  Dialog,
  PencilLine,
  Plus,
  Select,
  Trash2,
  useToast,
  type DataTableColumn,
} from '~/components/ui'
import { deleteOrDeactivateTableFn } from '~/functions/fnb/tables.fn'
import type { OutletSummaryView } from '~/modules/catalog/shared'
import type { FnbTableView } from '~/modules/fnb/shared'
import { TableDialog } from './TableDialog'

export interface TablesTableProps {
  tenantSlug: string
  outlets: readonly OutletSummaryView[]
  tables: readonly FnbTableView[]
  loading?: boolean
}

export function TablesTable({ tenantSlug, outlets, tables, loading = false }: TablesTableProps) {
  const { t } = useTranslation()
  const toast = useToast()
  const queryClient = useQueryClient()

  const [selectedOutletId, setSelectedOutletId] = useState<string>('')
  const [dialogOpen, setDialogOpen] = useState(false)
  const [editing, setEditing] = useState<FnbTableView | null>(null)
  const [confirmTarget, setConfirmTarget] = useState<FnbTableView | null>(null)
  const [errorMsg, setErrorMsg] = useState<string | null>(null)

  const outletMap = useMemo(() => {
    const map = new Map<string, OutletSummaryView>()
    for (const o of outlets) map.set(o.id, o)
    return map
  }, [outlets])

  const filteredTables = useMemo(() => {
    if (!selectedOutletId) return tables
    return tables.filter((row) => row.outletId === selectedOutletId)
  }, [tables, selectedOutletId])

  const removeMut = useMutation({
    retry: 0,
    mutationFn: (id: string) => deleteOrDeactivateTableFn({ data: { id } }),
    onSuccess: (res) => {
      if (!res.ok) {
        setErrorMsg(t(res.errorKey as never))
        return
      }
      setErrorMsg(null)
      setConfirmTarget(null)
      queryClient.invalidateQueries({ queryKey: ['fnb', tenantSlug, 'tables'] })
      toast.show({
        tone: 'success',
        message:
          res.data.mode === 'deactivated'
            ? t('admin.tables.deactivated')
            : t('admin.tables.deleted'),
      })
    },
    onError: (err) => setErrorMsg(err.message),
  })

  const columns: DataTableColumn<FnbTableView>[] = [
    {
      id: 'code',
      header: t('admin.tables.codeLabel'),
      stickyFirst: true,
      sortValue: (row) => row.code,
      cell: (row) => <span className="font-mono font-semibold text-ink">{row.code}</span>,
    },
    {
      id: 'outlet',
      header: t('admin.tables.outletLabel'),
      sortValue: (row) => outletMap.get(row.outletId)?.name ?? row.outletId,
      cell: (row) => {
        const o = outletMap.get(row.outletId)
        return <span className="text-body text-ink">{o ? `${o.code} — ${o.name}` : row.outletId}</span>
      },
    },
    {
      id: 'area',
      header: t('admin.tables.areaLabel'),
      sortValue: (row) => row.area ?? '',
      cell: (row) => <span className="text-body text-ink-soft">{row.area ?? '—'}</span>,
    },
    {
      id: 'capacity',
      header: t('admin.tables.capacityLabel'),
      align: 'right',
      numeric: true,
      sortValue: (row) => row.capacity ?? 0,
      cell: (row) => (
        <span className="tabular-nums text-body text-ink">
          {row.capacity === null ? '—' : row.capacity}
        </span>
      ),
    },
    {
      id: 'sortOrder',
      header: t('admin.tables.sortOrderLabel'),
      align: 'right',
      numeric: true,
      sortValue: (row) => row.sortOrder,
      cell: (row) => <span className="tabular-nums text-body text-ink-soft">{row.sortOrder}</span>,
    },
    {
      id: 'status',
      header: t('admin.tables.statusLabel'),
      cell: (row) => (
        <div className="flex flex-wrap items-center gap-1.5">
          <Chip
            status={row.isActive ? 'active' : 'inactive'}
            label={row.isActive ? t('admin.tables.statusActive') : t('admin.tables.statusInactive')}
          />
          {row.hasOpenBill ? (
            <Chip status="lease_other" label={t('admin.tables.inUseChip')} />
          ) : null}
        </div>
      ),
    },
    {
      id: 'actions',
      header: t('admin.tables.actionsLabel'),
      align: 'right',
      hideOnMobileCard: true,
      cell: (row) => (
        <div className="inline-flex items-center gap-1">
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={() => {
              setEditing(row)
              setDialogOpen(true)
            }}
          >
            <PencilLine className="size-4" aria-hidden="true" />
            <span>{t('admin.tables.editAction')}</span>
          </Button>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            disabled={row.hasOpenBill}
            title={row.hasOpenBill ? t('admin.tables.hasOpenBill') : undefined}
            onClick={() => setConfirmTarget(row)}
          >
            <Trash2 className="size-4" aria-hidden="true" />
            <span>
              {row.hasAnyBill ? t('admin.tables.deactivateAction') : t('admin.tables.deleteAction')}
            </span>
          </Button>
        </div>
      ),
    },
  ]

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="w-full max-w-xs">
          <Select
            ariaLabel={t('admin.tables.outletLabel')}
            value={selectedOutletId}
            onValueChange={setSelectedOutletId}
            size="md"
            options={[
              { value: '', label: t('admin.tables.allOutlets') },
              ...outlets.map((o) => ({ value: o.id, label: `${o.code} — ${o.name}` })),
            ]}
          />
        </div>
        <Button
          type="button"
          onClick={() => {
            setEditing(null)
            setDialogOpen(true)
          }}
          disabled={outlets.length === 0}
        >
          <Plus className="size-4" aria-hidden="true" />
          <span>{t('admin.tables.addButton')}</span>
        </Button>
      </div>

      {errorMsg ? (
        <p role="alert" className="text-body text-danger-ink">
          {errorMsg}
        </p>
      ) : null}

      <DataTable
        caption={t('admin.tables.title')}
        columns={columns}
        rows={filteredTables}
        getRowKey={(row) => row.id}
        loading={loading}
        emptyTitle={t('admin.tables.emptyTitle')}
        emptyDescription={t('admin.tables.emptyDesc')}
      />

      <TableDialog
        open={dialogOpen}
        onOpenChange={setDialogOpen}
        tenantSlug={tenantSlug}
        outlets={outlets}
        defaultOutletId={selectedOutletId || outlets[0]?.id}
        editing={editing}
      />

      <Dialog
        open={confirmTarget !== null}
        onOpenChange={(next) => {
          if (!next) setConfirmTarget(null)
        }}
        title={
          confirmTarget?.hasAnyBill
            ? t('admin.tables.deactivateAction')
            : t('admin.tables.deleteAction')
        }
        size="sm"
      >
        <p className="text-body text-ink-soft">
          {confirmTarget?.hasAnyBill
            ? t('admin.tables.deactivateConfirm', { code: confirmTarget.code })
            : t('admin.tables.deleteConfirm', { code: confirmTarget?.code ?? '' })}
        </p>
        <div className="mt-4 flex justify-end gap-2">
          <Button type="button" variant="secondary" onClick={() => setConfirmTarget(null)}>
            {t('common.cancel')}
          </Button>
          <Button
            type="button"
            variant="danger"
            loading={removeMut.isPending}
            onClick={() => confirmTarget && removeMut.mutate(confirmTarget.id)}
          >
            {confirmTarget?.hasAnyBill
              ? t('admin.tables.deactivateAction')
              : t('admin.tables.deleteAction')}
          </Button>
        </div>
      </Dialog>
    </div>
  )
}
