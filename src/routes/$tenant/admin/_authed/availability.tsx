import { useQuery } from '@tanstack/react-query'
import { createFileRoute, redirect, useNavigate } from '@tanstack/react-router'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { AvailabilityMatrix } from '~/components/admin/availability/AvailabilityMatrix'
import { Button, Input, Search, Select, Switch } from '~/components/ui'
import { useCurrentTenant } from '~/hooks/use-current-tenant'
import { availabilityMatrixSearchSchema } from '~/lib/filters/catalog'
import { tenantHref } from '~/lib/tenancy/tenant-href'
import { availabilityMatrixQueryOptions, categoriesQueryOptions } from '~/queries/catalog.queries'

export const Route = createFileRoute('/$tenant/admin/_authed/availability')({
  validateSearch: (search) => availabilityMatrixSearchSchema.parse(search),
  beforeLoad: ({ params, context }) => {
    if (!context.session?.permissions.includes('catalog.manage')) {
      throw redirect({ href: tenantHref(params.tenant, '/admin') })
    }
  },
  loaderDeps: ({ search }) => search,
  loader: async ({ params, context, deps }) => {
    await Promise.all([
      context.queryClient.ensureQueryData(
        availabilityMatrixQueryOptions(params.tenant, {
          search: deps.q,
          categoryId: deps.categoryId,
          onlyExceptions: deps.onlyExceptions,
          page: deps.page,
          pageSize: 50,
        }),
      ),
      context.queryClient.ensureQueryData(categoriesQueryOptions(params.tenant)),
    ])
  },
  component: AvailabilityMatrixPage,
})

function AvailabilityMatrixPage() {
  const { t } = useTranslation()
  const { slug } = useCurrentTenant()
  const search = Route.useSearch()
  const navigate = useNavigate()
  const [searchDraft, setSearchDraft] = useState(search.q ?? '')

  const filter = {
    search: search.q,
    categoryId: search.categoryId,
    onlyExceptions: search.onlyExceptions,
    page: search.page,
    pageSize: 50,
  }
  const { data } = useQuery(availabilityMatrixQueryOptions(slug, filter))
  const { data: categories = [] } = useQuery(categoriesQueryOptions(slug))

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
      to: tenantHref(slug, '/admin/availability'),
      search: { ...search, ...patch, page: patch.page ?? 1 },
    })
  }

  return (
    <div className="flex flex-col gap-6">
      <h1 className="text-h1 font-semibold text-ink">{t('admin.availability.title')}</h1>

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
            aria-label={t('admin.availability.searchPlaceholder')}
            placeholder={t('admin.availability.searchPlaceholder')}
            onChange={(e) => setSearchDraft(e.target.value)}
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
        <Switch
          label={t('admin.availability.onlyExceptionsLabel')}
          checked={search.onlyExceptions}
          onCheckedChange={(checked) => updateFilters({ onlyExceptions: checked })}
        />
      </div>

      {data ? <AvailabilityMatrix tenantSlug={slug} data={data} /> : null}

      {data && data.total > data.pageSize ? (
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
              totalPages: Math.max(1, Math.ceil(data.total / data.pageSize)),
            })}
          </span>
          <Button
            type="button"
            size="sm"
            variant="secondary"
            disabled={search.page * data.pageSize >= data.total}
            onClick={() => updateFilters({ page: search.page + 1 })}
          >
            {t('common.next')}
          </Button>
        </div>
      ) : null}
    </div>
  )
}
