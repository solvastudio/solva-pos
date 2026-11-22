import { useQuery } from '@tanstack/react-query'
import { createFileRoute, redirect, useNavigate } from '@tanstack/react-router'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { CategoryManager } from '~/components/admin/catalog/CategoryManager'
import { ProductTable } from '~/components/admin/catalog/ProductTable'
import { UomManager } from '~/components/admin/catalog/UomManager'
import {
  Button,
  Dialog,
  Download,
  Input,
  Plus,
  Search,
  Select,
  Upload,
  useToast,
} from '~/components/ui'
import { exportCatalogCsvFn } from '~/functions/catalog/catalog-import.fn'
import { useCurrentTenant } from '~/hooks/use-current-tenant'
import { productListSearchSchema } from '~/lib/filters/catalog'
import { tenantHref } from '~/lib/tenancy/tenant-href'
import {
  categoriesQueryOptions,
  productsListQueryOptions,
  uomsQueryOptions,
} from '~/queries/catalog.queries'

export const Route = createFileRoute('/$tenant/admin/_authed/catalog/')({
  validateSearch: (search) => productListSearchSchema.parse(search),
  beforeLoad: ({ params, context }) => {
    if (!context.session?.permissions.includes('catalog.manage')) {
      throw redirect({ href: tenantHref(params.tenant, '/admin') })
    }
  },
  loaderDeps: ({ search }) => search,
  loader: async ({ params, context, deps }) => {
    await Promise.all([
      context.queryClient.ensureQueryData(
        productsListQueryOptions(params.tenant, {
          search: deps.q,
          categoryId: deps.categoryId,
          type: deps.type === 'ALL' ? undefined : deps.type,
          page: deps.page,
          pageSize: 50,
        }),
      ),
      context.queryClient.ensureQueryData(categoriesQueryOptions(params.tenant)),
      context.queryClient.ensureQueryData(uomsQueryOptions(params.tenant)),
    ])
  },
  component: CatalogListPage,
})

function CatalogListPage() {
  const { t } = useTranslation()
  const toast = useToast()
  const { slug } = useCurrentTenant()
  const { session } = Route.useRouteContext()
  const search = Route.useSearch()
  const navigate = useNavigate()

  const canManageTenantWide = session?.outletIds === null
  const [searchDraft, setSearchDraft] = useState(search.q ?? '')
  const [catUomOpen, setCatUomOpen] = useState(false)
  const [exporting, setExporting] = useState(false)

  const filter = {
    search: search.q,
    categoryId: search.categoryId,
    type: search.type === 'ALL' ? undefined : search.type,
    page: search.page,
    pageSize: 50,
  }
  const { data: listData, isLoading } = useQuery(productsListQueryOptions(slug, filter))
  const { data: categories = [] } = useQuery(categoriesQueryOptions(slug))
  const { data: uoms = [] } = useQuery(uomsQueryOptions(slug))

  const catMap = new Map(categories.map((c) => [c.id, c]))
  const categoryOptions = [
    { value: '', label: t('admin.catalog.allCategories') },
    ...categories.map((c) => {
      const parent = c.parentId ? catMap.get(c.parentId) : null
      return { value: c.id, label: parent ? `${parent.name} > ${c.name}` : c.name }
    }),
  ]

  function updateFilters(patch: Partial<typeof search>) {
    navigate({
      to: tenantHref(slug, '/admin/catalog'),
      search: { ...search, ...patch, page: patch.page ?? 1 },
    })
  }

  async function handleExport() {
    setExporting(true)
    try {
      const res = await exportCatalogCsvFn({ data: {} })
      const blob = new Blob([res.csvText], { type: 'text/csv;charset=utf-8' })
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = `catalog-${slug}.csv`
      a.click()
      URL.revokeObjectURL(url)
      toast.show({ tone: 'success', message: t('admin.catalog.exportSucceeded') })
    } finally {
      setExporting(false)
    }
  }

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-h1 font-semibold text-ink">{t('admin.catalog.title')}</h1>
        <div className="flex flex-wrap items-center gap-2">
          <Button type="button" variant="secondary" onClick={() => setCatUomOpen(true)}>
            {t('admin.catalog.categoriesUomsButton')}
          </Button>
          {canManageTenantWide ? (
            <>
              <Button
                type="button"
                variant="secondary"
                loading={exporting}
                onClick={handleExport}
              >
                <Download className="size-4" />
                {t('admin.catalog.exportButton')}
              </Button>
              <Button
                type="button"
                variant="secondary"
                onClick={() => navigate({ to: tenantHref(slug, '/admin/catalog/import') })}
              >
                <Upload className="size-4" />
                {t('admin.catalog.importButton')}
              </Button>
              <Button
                type="button"
                onClick={() => navigate({ to: tenantHref(slug, '/admin/catalog/new') })}
              >
                <Plus className="size-4" />
                {t('admin.catalog.addButton')}
              </Button>
            </>
          ) : null}
        </div>
      </div>

      <div className="grid grid-cols-1 gap-3 md:grid-cols-4">
        <form
          onSubmit={(e) => {
            e.preventDefault()
            updateFilters({ q: searchDraft.trim() || undefined })
          }}
          className="flex items-center gap-2 md:col-span-2"
        >
          <Input
            value={searchDraft}
            aria-label={t('admin.catalog.searchPlaceholder')}
            placeholder={t('admin.catalog.searchPlaceholder')}
            onChange={(e) => setSearchDraft(e.target.value)}
            className="min-w-0 flex-1"
          />
          <Button type="submit" variant="secondary" aria-label={t('common.search')}>
            <Search className="size-4" />
          </Button>
        </form>
        <Select
          value={search.categoryId ?? ''}
          onValueChange={(v) => updateFilters({ categoryId: v || undefined })}
          aria-label={t('admin.catalog.categoryFilterLabel')}
          options={categoryOptions}
        />
        <Select
          value={search.type}
          onValueChange={(v) => updateFilters({ type: v as 'ALL' | 'RETAIL' | 'MENU_FNB' })}
          aria-label={t('admin.catalog.typeFilterLabel')}
          options={[
            { value: 'ALL', label: t('admin.catalog.typeAll') },
            { value: 'RETAIL', label: t('admin.catalog.typeRETAIL') },
            { value: 'MENU_FNB', label: t('admin.catalog.typeMENU_FNB') },
          ]}
        />
      </div>

      <ProductTable
        tenantSlug={slug}
        rows={listData?.items ?? []}
        loading={isLoading}
        onCreateAction={
          canManageTenantWide
            ? () => navigate({ to: tenantHref(slug, '/admin/catalog/new') })
            : undefined
        }
      />

      {listData && listData.total > listData.pageSize ? (
        <div className="flex items-center justify-end gap-3">
          <Button
            type="button"
            size="sm"
            variant="secondary"
            disabled={search.page <= 1}
            onClick={() => updateFilters({ page: search.page - 1 })}
          >
            {t('common.previous')}
          </Button>
          <span className="text-caption text-ink-soft">
            {t('common.pageOf', {
              page: search.page,
              totalPages: Math.max(1, Math.ceil(listData.total / listData.pageSize)),
            })}
          </span>
          <Button
            type="button"
            size="sm"
            variant="secondary"
            disabled={search.page * listData.pageSize >= listData.total}
            onClick={() => updateFilters({ page: search.page + 1 })}
          >
            {t('common.next')}
          </Button>
        </div>
      ) : null}

      <Dialog
        open={catUomOpen}
        onOpenChange={setCatUomOpen}
        title={t('admin.catalog.categoriesUomsTitle')}
        size="lg"
      >
        <div className="flex flex-col gap-8">
          <CategoryManager
            tenantSlug={slug}
            categories={categories}
            canManage={canManageTenantWide}
          />
          <UomManager tenantSlug={slug} uoms={uoms} canManage={canManageTenantWide} />
        </div>
      </Dialog>
    </div>
  )
}
