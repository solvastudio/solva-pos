import { useTranslation } from 'react-i18next'
import { cn } from '~/lib/cn'
import type { CategoryRecord } from '~/pos/db/types'

export interface CategoryTabsProps {
  categories: readonly CategoryRecord[]
  selectedCategoryId: string | null
  onSelect: (categoryId: string | null) => void
}

function categoryTabClass(active: boolean) {
  return cn(
    'inline-flex h-control-sm shrink-0 items-center justify-center rounded-control border px-3.5 text-label font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus-ring focus-visible:ring-offset-1',
    active
      ? 'border-action bg-action text-on-action'
      : 'border-line bg-surface text-ink hover:bg-surface-sunken',
  )
}

export function CategoryTabs({
  categories,
  selectedCategoryId,
  onSelect,
}: CategoryTabsProps) {
  const { t } = useTranslation()

  return (
    <div
      role="tablist"
      aria-label={t('pos.sell.categoryTabsAria')}
      className="flex items-center gap-2 overflow-x-auto pb-1"
    >
      <button
        type="button"
        role="tab"
        aria-selected={selectedCategoryId === null}
        onClick={() => onSelect(null)}
        className={categoryTabClass(selectedCategoryId === null)}
      >
        {t('pos.sell.allCategories')}
      </button>

      {categories.map((cat) => {
        const active = selectedCategoryId === cat.id
        return (
          <button
            key={cat.id}
            type="button"
            role="tab"
            aria-selected={active}
            onClick={() => onSelect(cat.id)}
            className={categoryTabClass(active)}
          >
            {cat.name}
          </button>
        )
      })}
    </div>
  )
}
