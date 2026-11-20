import { lazy, Suspense, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Button } from '~/components/ui/Button'
import { QrCode } from '~/components/ui/icons'
import { isCameraScanSupported } from '~/pos/scanner/camera'

const LazyCameraScanModal = lazy(() =>
  import('../scanner/CameraScanModal').then((m) => ({
    default: m.CameraScanModal,
  })),
)

export interface QrScanButtonProps {
  disabled?: boolean
  available?: boolean
  onScanned?: (rawValue: string) => void
}

/**
 * Progressive QR scan trigger (SCR-P01): rendered when camera scanning is supported
 * and lazy-loads `barcode-detector` only after opening the modal.
 */
export function QrScanButton({ disabled = false, available, onScanned }: QrScanButtonProps) {
  const { t } = useTranslation()
  const [open, setOpen] = useState(false)

  const isSupported = available ?? (isCameraScanSupported() && typeof onScanned === 'function')

  if (!isSupported) {
    return null
  }

  return (
    <>
      <Button
        type="button"
        variant="secondary"
        size="xl"
        disabled={disabled}
        onClick={() => setOpen(true)}
      >
        <QrCode className="size-4" aria-hidden="true" />
        <span>{t('pos.pair.qrScan')}</span>
      </Button>

      {open ? (
        <Suspense fallback={null}>
          <LazyCameraScanModal
            open={open}
            onOpenChange={setOpen}
            formats={['qr_code']}
            onDetected={(raw) => {
              onScanned?.(raw)
            }}
          />
        </Suspense>
      ) : null}
    </>
  )
}
