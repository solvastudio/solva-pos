import { useTranslation } from 'react-i18next'
import { Button } from '~/components/ui/Button'
import { QrCode } from '~/components/ui/icons'

export interface QrScanButtonProps {
  disabled?: boolean
  available?: boolean
  onScanned?: (rawValue: string) => void
}

/**
 * Progressive QR scan trigger (SCR-P01): rendered only when BarcodeDetector and
 * camera scanning support are present (full camera UI arrives in Fase 44).
 */
export function QrScanButton({ disabled = false, available, onScanned }: QrScanButtonProps) {
  const { t } = useTranslation()
  const isSupported =
    available ??
    (typeof window !== 'undefined' &&
      'BarcodeDetector' in window &&
      typeof onScanned === 'function')

  if (!isSupported) {
    return null
  }

  return (
    <Button
      type="button"
      variant="secondary"
      size="xl"
      disabled={disabled}
      onClick={() => onScanned?.('')}
    >
      <QrCode className="size-4" aria-hidden="true" />
      <span>{t('pos.pair.qrScan')}</span>
    </Button>
  )
}
