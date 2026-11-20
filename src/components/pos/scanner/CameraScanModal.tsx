import { useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Button } from '~/components/ui/Button'
import { Dialog } from '~/components/ui/Dialog'
import { CircleAlert } from '~/components/ui/icons'
import { startCameraScan } from '~/pos/scanner/camera'

export interface CameraScanModalProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  onDetected: (rawValue: string) => void
  formats?: string[]
}

export function CameraScanModal({
  open,
  onOpenChange,
  onDetected,
  formats,
}: CameraScanModalProps) {
  const { t } = useTranslation()
  const videoRef = useRef<HTMLVideoElement | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!open) {
      setError(null)
      return
    }
    const video = videoRef.current
    if (!video) return

    let active = true
    let handle: { stop: () => void } | null = null

    void startCameraScan({
      video,
      formats,
      onDetected: (code) => {
        if (!active) return
        active = false
        handle?.stop()
        onDetected(code)
        onOpenChange(false)
      },
      onError: () => {
        if (active) setError(t('pos.sell.cameraPermissionDenied'))
      },
    })
      .then((h) => {
        if (!active) {
          h.stop()
          return
        }
        handle = h
      })
      .catch(() => {
        if (active) setError(t('pos.sell.cameraPermissionDenied'))
      })

    return () => {
      active = false
      handle?.stop()
    }
  }, [formats, onDetected, onOpenChange, open, t])

  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      title={t('pos.sell.cameraModalTitle')}
      description={t('pos.sell.cameraModalHint')}
      size="md"
      footer={
        <Button type="button" variant="secondary" onClick={() => onOpenChange(false)}>
          {t('pos.sell.cameraClose')}
        </Button>
      }
    >
      <div className="flex flex-col gap-3">
        {error ? (
          <div
            role="alert"
            className="flex items-start gap-2 rounded-card border border-danger-line bg-danger-soft p-3 text-body text-danger-ink"
          >
            <CircleAlert className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
            <span>{error}</span>
          </div>
        ) : (
          <div className="relative aspect-video w-full overflow-hidden rounded-card bg-surface-sunken">
            <video
              ref={videoRef}
              muted
              playsInline
              className="h-full w-full object-cover"
            />
          </div>
        )}
      </div>
    </Dialog>
  )
}
