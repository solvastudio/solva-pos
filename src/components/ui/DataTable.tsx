import { useMemo, useState, type ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import { cn } from '~/lib/cn'
import { Button } from './Button'
import { EmptyState } from './EmptyState'
import { Skeleton } from './Skeleton'
import { ChevronDown, ChevronUp } from './icons'

export interface DataTableColumn<T> {
  readonly id: string
  readonly header: string
  readonly align?: 'left' | 'right'
  readonly numeric?: boolean
  readonly stickyFirst?: boolean
  readonly hideOnMobileCard?: boolean
  readonly mobileLabel?: string
  readonly sortValue?: (row: T) => string | number
  readonly cell: (row: T) => ReactNode
}

export interface DataTableProps<T> {
  caption: string
  columns: readonly DataTableColumn<T>[]
  rows: readonly T[]
  getRowKey: (row: T) => string
  loading?: boolean
  emptyTitle: string
  emptyDescription?: string
  emptyIcon?: ReactNode
  emptyAction?: ReactNode
  pageSize?: number
  className?: string
  mobileActions?: (row: T) => ReactNode
  mobileTitle?: (row: T) => ReactNode
}

type SortDirection = 'asc' | 'desc'

export function DataTable<T>({
  caption,
  columns,
  rows,
  getRowKey,
  loading = false,
  emptyTitle,
  emptyDescription,
  emptyIcon,
  emptyAction,
  pageSize = 50,
  className,
  mobileActions,
  mobileTitle,
}: DataTableProps<T>) {
  const { t } = useTranslation()
  const [sortState, setSortState] = useState<{ columnId: string; dir: SortDirection } | null>(null)
  const [page, setPage] = useState(0)

  const sortedRows = useMemo(() => {
    if (!sortState) return rows
    const col = columns.find((c) => c.id === sortState.columnId)
    if (!col?.sortValue) return rows
    const getter = col.sortValue
    const factor = sortState.dir === 'asc' ? 1 : -1
    return [...rows].sort((a, b) => {
      const av = getter(a)
      const bv = getter(b)
      if (typeof av === 'number' && typeof bv === 'number') {
        return (av - bv) * factor
      }
      return String(av).localeCompare(String(bv)) * factor
    })
  }, [columns, rows, sortState])

  const totalPages = Math.max(1, Math.ceil(sortedRows.length / pageSize))
  const safePage = Math.min(page, totalPages - 1)
  const pageStart = safePage * pageSize
  const pagedRows = useMemo(
    () => sortedRows.slice(pageStart, pageStart + pageSize),
    [pageStart, pageSize, sortedRows],
  )

  function toggleSort(columnId: string) {
    setPage(0)
    setSortState((prev) => {
      if (!prev || prev.columnId !== columnId) {
        return { columnId, dir: 'asc' }
      }
      if (prev.dir === 'asc') {
        return { columnId, dir: 'desc' }
      }
      return null
    })
  }

  if (loading) {
    return (
      <div className={cn('flex flex-col gap-2', className)} aria-busy="true">
        {Array.from({ length: 8 }).map((_, idx) => (
          <Skeleton key={idx} className="h-11 w-full rounded-control" />
        ))}
      </div>
    )
  }

  if (rows.length === 0) {
    return (
      <EmptyState
        icon={emptyIcon}
        title={emptyTitle}
        description={emptyDescription}
        action={emptyAction}
      />
    )
  }

  const showPagination = sortedRows.length > pageSize
  const fromRow = pageStart + 1
  const toRow = Math.min(pageStart + pageSize, sortedRows.length)

  return (
    <div className={cn('flex flex-col gap-3', className)}>
      <div className="hidden overflow-x-auto rounded-card border border-line bg-surface md:block">
        <table className="w-full border-collapse text-left">
          <caption className="sr-only">{caption}</caption>
          <thead>
            <tr className="border-b border-line bg-surface-subtle text-label-sm font-semibold text-ink-soft">
              {columns.map((col, idx) => {
                const isNumeric = Boolean(col.numeric || col.align === 'right')
                const isSorted = sortState?.columnId === col.id
                const ariaSort: 'ascending' | 'descending' | 'none' | undefined = col.sortValue
                  ? isSorted
                    ? sortState.dir === 'asc'
                      ? 'ascending'
                      : 'descending'
                    : 'none'
                  : undefined

                return (
                  <th
                    key={col.id}
                    scope="col"
                    aria-sort={ariaSort}
                    className={cn(
                      'sticky top-0 z-sticky bg-surface-subtle px-4 py-3 whitespace-nowrap',
                      isNumeric && 'text-right',
                      col.stickyFirst && idx === 0 && 'left-0 z-sticky',
                    )}
                  >
                    {col.sortValue ? (
                      <button
                        type="button"
                        onClick={() => toggleSort(col.id)}
                        className={cn(
                          'inline-flex items-center gap-1 font-semibold text-ink-soft hover:text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus-ring rounded-xs',
                          isNumeric && 'flex-row-reverse',
                        )}
                      >
                        <span>{col.header}</span>
                        {isSorted && sortState.dir === 'asc' ? (
                          <ChevronUp className="size-3.5 text-ink" aria-hidden="true" />
                        ) : (
                          <ChevronDown
                            className={cn(
                              'size-3.5',
                              isSorted ? 'text-ink' : 'text-ink-muted',
                            )}
                            aria-hidden="true"
                          />
                        )}
                      </button>
                    ) : (
                      col.header
                    )}
                  </th>
                )
              })}
            </tr>
          </thead>
          <tbody className="divide-y divide-line-subtle">
            {pagedRows.map((row) => (
              <tr key={getRowKey(row)} className="hover:bg-surface-hover transition-colors">
                {columns.map((col, idx) => {
                  const isNumeric = Boolean(col.numeric || col.align === 'right')
                  return (
                    <td
                      key={col.id}
                      className={cn(
                        'min-h-control-md px-4 py-2.5 text-body text-ink align-middle',
                        isNumeric && 'text-right tabular-nums whitespace-nowrap',
                        col.stickyFirst && idx === 0 && 'sticky left-0 bg-surface font-medium',
                      )}
                    >
                      {col.cell(row)}
                    </td>
                  )
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <ul className="flex flex-col gap-3 md:hidden" aria-label={caption}>
        {pagedRows.map((row) => {
          const cardCols = columns.filter((col) => !col.hideOnMobileCard)
          const firstCol = cardCols[0]
          const bodyCols = cardCols.slice(1)
          return (
            <li
              key={getRowKey(row)}
              className="rounded-card border border-line bg-surface p-4 flex flex-col gap-2"
            >
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0 flex-1 text-body font-semibold text-ink">
                  {mobileTitle ? mobileTitle(row) : firstCol?.cell(row)}
                </div>
                {mobileActions ? (
                  <div className="shrink-0 flex items-center gap-1">{mobileActions(row)}</div>
                ) : null}
              </div>
              {bodyCols.length > 0 ? (
                <dl className="grid grid-cols-2 gap-x-3 gap-y-1.5 border-t border-line-subtle pt-2">
                  {bodyCols.map((col) => (
                    <div key={col.id} className="min-w-0">
                      <dt className="text-caption text-ink-soft truncate">
                        {col.mobileLabel ?? col.header}
                      </dt>
                      <dd
                        className={cn(
                          'text-body-sm text-ink break-words',
                          col.numeric && 'tabular-nums',
                        )}
                      >
                        {col.cell(row)}
                      </dd>
                    </div>
                  ))}
                </dl>
              ) : null}
            </li>
          )
        })}
      </ul>

      {showPagination ? (
        <div className="flex flex-wrap items-center justify-between gap-3 text-body-sm text-ink-soft">
          <span className="tabular-nums">
            {t('common.showingRows', { from: fromRow, to: toRow, total: sortedRows.length })}
          </span>
          <div className="flex items-center gap-2">
            <Button
              variant="secondary"
              size="md"
              disabled={safePage <= 0}
              onClick={() => setPage((p) => Math.max(0, p - 1))}
            >
              {t('common.previous')}
            </Button>
            <span className="px-2 tabular-nums">
              {t('common.pageOf', { page: safePage + 1, totalPages })}
            </span>
            <Button
              variant="secondary"
              size="md"
              disabled={safePage >= totalPages - 1}
              onClick={() => setPage((p) => Math.min(totalPages - 1, p + 1))}
            >
              {t('common.next')}
            </Button>
          </div>
        </div>
      ) : null}
    </div>
  )
}
