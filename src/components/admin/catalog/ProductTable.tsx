import { Link } from '@tanstack/react-router'
import { useTranslation } from 'react-i18next'
import { Button, Chip, DataTable, Package, PencilLine, type DataTableColumn } from '~/components/ui'
import { formatMoney, toMoney, type LocaleId } from '~/lib/kernel'
import { tenantHref } from '~/lib/tenancy/tenant-href'
import type { AdminProductListItem } from '~/modules/catalog/shared'

export interface ProductTableProps {
  tenantSlug: string
  rows: readonly AdminProductListItem[]
  loading?: boolean
  onCreateAction?: () => void
}

function formatPriceRange(
  range: AdminProductListItem['priceRange'],
  locale: LocaleId,
): string | null {
  if (!range) return null
  if (range.min === range.max) return formatMoney(toMoney(range.min), locale)
  return `${formatMoney(toMoney(range.min), locale)} – ${formatMoney(toMoney(range.max), locale)}`
}

export function ProductTable({
  tenantSlug,
  rows,
  loading = false,
  onCreateAction,
}: ProductTableProps) {
  const { t, i18n } = useTranslation()
  const locale: LocaleId = i18n.language === 'en' ? 'en-US' : 'id-ID'

  const columns: DataTableColumn<AdminProductListItem>[] = [
    {
      id: 'name',
      header: t('admin.catalog.colName'),
      stickyFirst: true,
      sortValue: (r) => r.name,
      cell: (r) => (
        <div className="flex flex-col">
          <Link
            to={tenantHref(tenantSlug, `/admin/catalog/${r.id}`)}
            className="font-medium text-ink hover:text-action hover:underline"
          >
            {r.name}
          </Link>
          <span className="font-mono text-caption text-ink-soft">{r.code}</span>
        </div>
      ),
    },
    {
      id: 'category',
      header: t('admin.catalog.colCategory'),
      sortValue: (r) => r.categoryPath,
      cell: (r) => <span className="text-body text-ink-soft">{r.categoryPath}</span>,
    },
    {
      id: 'type',
      header: t('admin.catalog.colType'),
      cell: (r) => (
        <Chip
          status={r.productType === 'MENU_FNB' ? 'open_price' : 'void'}
          label={t(`admin.catalog.type${r.productType}`)}
        />
      ),
    },
    {
      id: 'skus',
      header: t('admin.catalog.colSkus'),
      align: 'right',
      numeric: true,
      sortValue: (r) => r.skuCount,
      cell: (r) => <span className="font-mono tabular-nums">{r.skuCount}</span>,
    },
    {
      id: 'price',
      header: t('admin.catalog.colPrice'),
      align: 'right',
      numeric: true,
      cell: (r) => {
        const text = formatPriceRange(r.priceRange, locale)
        return text ? (
          <span className="font-mono tabular-nums">{text}</span>
        ) : (
          <Chip status="stock_estimate_low" label={t('admin.catalog.priceNotSet')} />
        )
      },
    },
    {
      id: 'availability',
      header: t('admin.catalog.colAvailability'),
      cell: (r) => (
        <span className="text-body text-ink">
          {t('admin.catalog.availabilitySummary', {
            available: r.availability.available,
            total: r.availability.total,
          })}
        </span>
      ),
    },
    {
      id: 'status',
      header: t('admin.catalog.colStatus'),
      cell: (r) => (
        <Chip
          status={r.isActive ? 'synced' : 'item_unavailable'}
          label={r.isActive ? t('common.active') : t('common.inactive')}
        />
      ),
    },
    {
      id: 'actions',
      header: t('admin.catalog.colActions'),
      align: 'right',
      hideOnMobileCard: true,
      cell: (r) => (
        <Link
          to={tenantHref(tenantSlug, `/admin/catalog/${r.id}`)}
          className="inline-flex min-h-control-md items-center gap-1 rounded-sm px-2 text-body font-medium text-action hover:bg-surface-sunken"
        >
          <PencilLine className="size-4" />
          {t('common.edit')}
        </Link>
      ),
    },
  ]

  return (
    <DataTable
      caption={t('admin.catalog.title')}
      columns={columns}
      rows={rows}
      getRowKey={(r) => r.id}
      loading={loading}
      pageSize={50}
      emptyIcon={<Package className="size-10" />}
      emptyTitle={t('admin.catalog.emptyTitle')}
      emptyDescription={t('admin.catalog.emptyDesc')}
      emptyAction={
        onCreateAction ? (
          <Button type="button" onClick={onCreateAction}>
            {t('admin.catalog.addButton')}
          </Button>
        ) : undefined
      }
      mobileTitle={(r) => r.name}
      mobileActions={(r) => (
        <Link
          to={tenantHref(tenantSlug, `/admin/catalog/${r.id}`)}
          className="inline-flex min-h-control-md items-center gap-1 rounded-sm border border-line px-3 text-body font-medium text-ink"
        >
          <PencilLine className="size-4" />
          {t('common.edit')}
        </Link>
      )}
    />
  )
}
