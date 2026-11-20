import type { ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import { DataTable, type DataTableColumn } from '~/components/ui'

export interface DataTableCmp10Props<T> {
  readonly caption: string
  readonly columns: readonly DataTableColumn<T>[]
  readonly rows: readonly T[]
  readonly getRowKey: (row: T) => string
  readonly emptyTitle: string
  readonly loading?: boolean
  readonly truncated?: boolean
  readonly footer?: ReactNode
}

export function DataTableCmp10<T>({
  caption,
  columns,
  rows,
  getRowKey,
  emptyTitle,
  loading = false,
  truncated = false,
  footer = null,
}: DataTableCmp10Props<T>) {
  const { t } = useTranslation()

  return (
    <div className="flex flex-col gap-3">
      {truncated ? (
        <div
          role="status"
          className="rounded-control border border-warning-border bg-warning-soft p-3 text-body-sm text-warning-ink"
        >
          {t('admin.report.truncatedWarning')}
        </div>
      ) : null}

      <DataTable
        caption={caption}
        columns={columns}
        rows={rows}
        loading={loading}
        getRowKey={getRowKey}
        emptyTitle={emptyTitle}
      />

      {footer}
    </div>
  )
}
