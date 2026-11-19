import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Button, CircleAlert, Copy, Dialog, QrCode, useToast } from '~/components/ui'
import type { CreatePairingCodeResult } from '~/modules/identity/shared'

export interface PairingDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  pairing: CreatePairingCodeResult | null
}

export function PairingDialog({ open, onOpenChange, pairing }: PairingDialogProps) {
  const { t } = useTranslation()
  const toast = useToast()
  const [qrDataUrl, setQrDataUrl] = useState<string | null>(null)
  const [showQr, setShowQr] = useState(true)
  const [remainingSec, setRemainingSec] = useState(15 * 60)

  useEffect(() => {
    if (!open || !pairing) return
    let cancelled = false
    setShowQr(true)
    setQrDataUrl(null)

    // Lazy-load QR encoder solely inside admin modal so POS bundles stay lean.
    void import('qrcode').then((QR) =>
      QR.toDataURL(pairing.enrollUrl, {
        width: 200,
        margin: 4,
        errorCorrectionLevel: 'M',
      }).then((url) => {
        if (!cancelled) {
          setQrDataUrl(url)
        }
      }),
    )

    return () => {
      cancelled = true
    }
  }, [open, pairing])

  useEffect(() => {
    if (!open || !pairing) return
    const expiresMs = Date.parse(pairing.expiresAt)

    function tick() {
      const diffSec = Math.max(0, Math.floor((expiresMs - Date.now()) / 1000))
      setRemainingSec(diffSec)
    }

    tick()
    const timer = window.setInterval(tick, 1000)
    return () => window.clearInterval(timer)
  }, [open, pairing])

  async function copyValue(text: string) {
    try {
      await navigator.clipboard.writeText(text)
      toast.show({ tone: 'success', message: t('common.copied') })
    } catch {
      // Ignore clipboard failures on non-HTTPS dev origins.
    }
  }

  if (!pairing) return null

  const expired = remainingSec <= 0
  const mins = Math.floor(remainingSec / 60)
  const secs = remainingSec % 60

  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      title={t('admin.devices.pairing.title')}
      size="md"
      footer={
        <Button variant="primary" size="md" onClick={() => onOpenChange(false)}>
          {t('common.close')}
        </Button>
      }
    >
      <div className="flex flex-col gap-4">
        {expired ? (
          <div
            role="alert"
            className="flex items-start gap-2 rounded-control border border-danger-solid bg-danger-soft p-4 text-body font-medium text-danger-ink"
          >
            <CircleAlert className="mt-0.5 size-5 shrink-0" aria-hidden="true" />
            <span>{t('admin.devices.pairing.expiredMessage')}</span>
          </div>
        ) : (
          <>
            <div className="rounded-card border border-line bg-surface-subtle p-4 flex flex-col gap-3">
              <p className="text-label-sm font-medium text-ink-soft">
                {t('admin.devices.pairing.codeLabel')}
              </p>
              <p className="font-mono text-code-id font-bold tracking-wider text-ink select-all">
                {pairing.code}
              </p>
              <Button
                variant="secondary"
                size="xl"
                leadingIcon={<Copy className="size-4" aria-hidden="true" />}
                onClick={() => void copyValue(pairing.code)}
              >
                {t('admin.devices.pairing.copyCode')}
              </Button>
            </div>

            <div className="flex flex-col items-center gap-3 rounded-card border border-line bg-surface p-4">
              <div className="flex w-full items-center justify-between gap-2">
                <span className="inline-flex items-center gap-1.5 text-label font-medium text-ink">
                  <QrCode className="size-4" aria-hidden="true" />
                  <span>{pairing.code}</span>
                </span>
                <Button variant="ghost" size="md" onClick={() => setShowQr((prev) => !prev)}>
                  {showQr ? t('admin.devices.pairing.hideQr') : t('admin.devices.pairing.showQr')}
                </Button>
              </div>

              {showQr && qrDataUrl ? (
                <div className="rounded-control border border-line bg-surface p-2">
                  <img
                    src={qrDataUrl}
                    alt={t('admin.devices.pairing.qrAlt')}
                    className="size-48"
                  />
                </div>
              ) : null}

              <p className="text-center text-body-sm text-ink-soft">
                {t('admin.devices.pairing.manualFallback', { url: pairing.baseUrl })}
              </p>

              <Button
                variant="ghost"
                size="md"
                leadingIcon={<Copy className="size-4" aria-hidden="true" />}
                onClick={() => void copyValue(pairing.baseUrl)}
              >
                {t('admin.devices.pairing.copyUrl')}
              </Button>
            </div>

            <p aria-live="polite" className="text-center text-body-sm font-medium tabular-nums text-ink">
              {t('admin.devices.pairing.countdownRemaining', {
                minutes: String(mins),
                seconds: String(secs).padStart(2, '0'),
              })}
            </p>
          </>
        )}
      </div>
    </Dialog>
  )
}
