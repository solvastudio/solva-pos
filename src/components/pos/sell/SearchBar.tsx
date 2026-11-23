import { forwardRef, lazy, Suspense, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Button } from '~/components/ui/Button'
import { ScanBarcode, Search, X } from '~/components/ui/icons'
import { isCameraScanSupported } from '~/pos/scanner/camera'

const LazyCameraScanModal = lazy(() =>
  import('../scanner/CameraScanModal').then((m) => ({
    default: m.CameraScanModal,
  })),
)

export interface SearchBarProps {
  value: string
  onChange: (value: string) => void
  onSubmitSearch?: () => void
  onCameraScanned?: (code: string) => void
  cameraAvailable?: boolean
}

export const SearchBar = forwardRef<HTMLInputElement, SearchBarProps>(function SearchBar(
  { value, onChange, onSubmitSearch, onCameraScanned, cameraAvailable },
  ref,
) {
  const { t } = useTranslation()
  const [cameraOpen, setCameraOpen] = useState(false)
  const canCamera = cameraAvailable ?? (isCameraScanSupported() && typeof onCameraScanned === 'function')

  return (
    <div className="flex items-center gap-2">
      <div className="relative flex-1">
        <Search
          className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-ink-soft"
          aria-hidden="true"
        />
        <input
          ref={ref}
          type="search"
          value={value}
          data-scanner-search="true"
          aria-label={t('pos.sell.searchAria')}
          placeholder={t('pos.sell.searchPlaceholder')}
          onChange={(e) => onChange(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && onSubmitSearch) {
              e.preventDefault()
              onSubmitSearch()
            }
          }}
          className="h-11 w-full rounded-control border border-line bg-surface pr-10 pl-9 text-body text-ink placeholder:text-ink-soft focus:border-action focus:ring-2 focus:ring-focus-ring focus:outline-none"
        />
        {value ? (
          <button
            type="button"
            aria-label={t('pos.sell.clearSearch')}
            onClick={() => onChange('')}
            className="absolute top-1/2 right-2 flex size-8 -translate-y-1/2 items-center justify-center rounded-control text-ink-soft hover:bg-surface-sunken hover:text-ink"
          >
            <X className="size-4" aria-hidden="true" />
          </button>
        ) : null}
      </div>

      {canCamera ? (
        <Button
          type="button"
          variant="secondary"
          size="md"
          aria-label={t('pos.sell.cameraScanAria')}
          onClick={() => setCameraOpen(true)}
          className="h-11 shrink-0 px-3"
        >
          <ScanBarcode className="size-5" aria-hidden="true" />
        </Button>
      ) : null}

      {cameraOpen ? (
        <Suspense fallback={null}>
          <LazyCameraScanModal
            open={cameraOpen}
            onOpenChange={setCameraOpen}
            onDetected={(code) => {
              onCameraScanned?.(code)
            }}
          />
        </Suspense>
      ) : null}
    </div>
  )
})
