import { useTranslation } from 'react-i18next'
import { useLang } from '~/hooks/use-lang'
import { cn } from '~/lib/cn'

export function LangToggle() {
  const { t } = useTranslation()
  const { locale, setLocale } = useLang()

  return (
    <div
      role="group"
      aria-label={t('sys.lang.label')}
      className="inline-flex items-center gap-1 rounded-control bg-surface px-2 py-1 text-caption shadow-pill border border-line"
    >
      <button
        type="button"
        onClick={() => void setLocale('id-ID')}
        aria-pressed={locale === 'id-ID'}
        className={cn(
          'rounded-xs px-1.5 py-0.5 font-semibold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus-ring',
          locale === 'id-ID'
            ? 'bg-action text-on-action'
            : 'text-ink-soft hover:bg-surface-hover',
        )}
      >
        {t('sys.lang.id')}
      </button>
      <span aria-hidden="true" className="h-3 w-px bg-line" />
      <button
        type="button"
        onClick={() => void setLocale('en-US')}
        aria-pressed={locale === 'en-US'}
        className={cn(
          'rounded-xs px-1.5 py-0.5 font-semibold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus-ring',
          locale === 'en-US'
            ? 'bg-action text-on-action'
            : 'text-ink-soft hover:bg-surface-hover',
        )}
      >
        {t('sys.lang.en')}
      </button>
    </div>
  )
}
