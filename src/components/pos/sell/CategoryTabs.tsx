import { useTranslation } from 'react-i18next'
import { cn } from '~/lib/cn'
import type { CategoryRecord } from '~/pos/db/types'

export interface CategoryTabsProps {
  categories: readonly CategoryRecord[]
  selectedCategoryId: string | null
  onSelect: (categoryId: string | null) => void
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
        className={cn(
          'min-h-touch shrink-0 rounded-pill border px-4 text-label font-medium transition-colors',
          selectedCategoryId === null
            ? 'border-action bg-action text-on-action'
            : 'border-line bg-surface text-ink hover:bg-surface-sunken',
        )}
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
            className={cn(
              'min-h-touch shrink-0 rounded-pill border px-4 text-label font-medium transition-colors',
              active
                ? 'border-action bg-action text-on-action'
                : 'border-line bg-surface text-ink hover:bg-surface-sunken',
            )}
          >
            {cat.name}
          </button>
        )
      })}
    </div>
  )
}
