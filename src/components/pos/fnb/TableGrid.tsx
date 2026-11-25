import { useMemo } from 'react'
import { useTranslation } from 'react-i18next'
import { EmptyState } from '~/components/ui/EmptyState'
import { Input } from '~/components/ui/Input'
import { LayoutGrid, Search } from '~/components/ui/icons'
import { cn } from '~/lib/cn'
import type { FnbTableRecord } from '~/pos/db/types'
import type { DerivedTableStatus } from '~/pos/domain/table-status'
import { TableCard } from './TableCard'

export interface TableGridProps {
  tables: readonly FnbTableRecord[]
  statusByTable: ReadonlyMap<string, DerivedTableStatus>
  totalsByTable?: ReadonlyMap<string, number>
  selectedArea: string | null
  openOnly: boolean
  searchQuery: string
  onAreaChange: (area: string | null) => void
  onOpenOnlyChange: (openOnly: boolean) => void
  onSearchChange: (q: string) => void
  onSelectTable: (table: FnbTableRecord, derived: DerivedTableStatus) => void
}

export function TableGrid({
  tables,
  statusByTable,
  totalsByTable,
  selectedArea,
  openOnly,
  searchQuery,
  onAreaChange,
  onOpenOnlyChange,
  onSearchChange,
  onSelectTable,
}: TableGridProps) {
  const { t } = useTranslation()

  const areas = useMemo(() => {
    const unique = new Set<string>()
    for (const tbl of tables) {
      if (tbl.area && tbl.area.trim()) unique.add(tbl.area.trim())
    }
    return [...unique]
  }, [tables])

  const filtered = useMemo(() => {
    const q = searchQuery.trim().toLowerCase()
    return tables.filter((tbl) => {
      if (selectedArea && (tbl.area ?? '').trim() !== selectedArea) return false
      const derived = statusByTable.get(tbl.id) ?? {
        status: 'EMPTY' as const,
        billCount: 0,
        updatedAt: null,
        bills: [],
      }
      if (openOnly && derived.status === 'EMPTY') return false
      if (q) {
        const hay = `${tbl.code} ${tbl.area ?? ''}`.toLowerCase()
        if (!hay.includes(q)) return false
      }
      return true
    })
  }, [openOnly, searchQuery, selectedArea, statusByTable, tables])

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-3 p-3 sm:p-4">
      <div className="flex flex-wrap items-center gap-2">
        <div className="relative min-w-48 flex-1">
          <Search
            className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-ink-soft"
            aria-hidden="true"
          />
          <Input
            type="search"
            value={searchQuery}
            onChange={(e) => onSearchChange(e.target.value)}
            placeholder={t('pos.table.searchPlaceholder')}
            aria-label={t('pos.table.searchPlaceholder')}
            className="pl-9"
          />
        </div>

        <button
          type="button"
          aria-pressed={openOnly}
          onClick={() => onOpenOnlyChange(!openOnly)}
          className={cn(
            'min-h-control-md rounded-card border px-3 text-label font-medium transition-colors focus-visible:ring-2 focus-visible:ring-focus-ring focus-visible:outline-none',
            openOnly
              ? 'border-action bg-action text-on-action'
              : 'border-line bg-surface text-ink hover:bg-surface-sunken',
          )}
        >
          {t('pos.table.openOnlyFilter')}
        </button>
      </div>

      {areas.length > 0 ? (
        <div className="flex gap-1.5 overflow-x-auto pb-1" role="tablist" aria-label={t('pos.table.title')}>
          <button
            type="button"
            role="tab"
            aria-selected={selectedArea === null}
            onClick={() => onAreaChange(null)}
            className={cn(
              'min-h-11 shrink-0 rounded-pill px-3.5 text-label font-medium transition-colors',
              selectedArea === null
                ? 'bg-action text-on-action'
                : 'bg-surface-sunken text-ink-soft hover:text-ink',
            )}
          >
            {t('pos.table.allAreas')}
          </button>
          {areas.map((area) => (
            <button
              key={area}
              type="button"
              role="tab"
              aria-selected={selectedArea === area}
              onClick={() => onAreaChange(area)}
              className={cn(
                'min-h-11 shrink-0 rounded-pill px-3.5 text-label font-medium transition-colors',
                selectedArea === area
                  ? 'bg-action text-on-action'
                  : 'bg-surface-sunken text-ink-soft hover:text-ink',
              )}
            >
              {area}
            </button>
          ))}
        </div>
      ) : null}

      {filtered.length === 0 ? (
        <EmptyState icon={<LayoutGrid className="size-8" />} title={t('pos.table.emptyGrid')} />
      ) : (
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5">
          {filtered.map((tbl) => {
            const derived = statusByTable.get(tbl.id) ?? {
              status: 'EMPTY' as const,
              billCount: 0,
              updatedAt: null,
              bills: [],
            }
            return (
              <TableCard
                key={tbl.id}
                table={tbl}
                derived={derived}
                summaryTotal={totalsByTable?.get(tbl.id) ?? null}
                onSelect={onSelectTable}
              />
            )
          })}
        </div>
      )}
    </div>
  )
}
