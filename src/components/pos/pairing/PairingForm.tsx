import { useId, useState, type FormEvent } from 'react'
import { useTranslation } from 'react-i18next'
import { Info, TriangleAlert } from '~/components/ui'
import { TenantBadge } from '~/components/layout/TenantBadge'
import { Button, Card, Input } from '~/components/ui'
import { QrScanButton } from './QrScanButton'
import { PairingProgress } from './PairingProgress'

export type PairingErrorKey =
  | 'INVALID'
  | 'RATE_LIMITED'
  | 'REGISTER_BUSY'
  | 'SUSPENDED'
  | 'NETWORK'
  | 'SERVER'
  | 'WRONG_ADDRESS'

export interface PairingFormProps {
  tenantName: string
  tenantSlug: string
  initialCode?: string
  initialError?: PairingErrorKey | null
  initialDeviceName?: string
  hasOtherTenants?: boolean
  submitting?: boolean
  progress?: { step: number; total: number } | null
  error?: PairingErrorKey | null
  rateLimitedDisabled?: boolean
  onSubmit: (values: { code: string; deviceName: string }) => void
}

function formatCodeInput(raw: string): string {
  const clean = raw.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 8)
  if (clean.length > 4) {
    return `${clean.slice(0, 4)}-${clean.slice(4)}`
  }
  return clean
}

export function PairingForm({
  tenantName,
  tenantSlug,
  initialCode = '',
  initialError = null,
  initialDeviceName = '',
  hasOtherTenants = false,
  submitting = false,
  progress = null,
  error = null,
  rateLimitedDisabled = false,
  onSubmit,
}: PairingFormProps) {
  const { t } = useTranslation()
  const codeId = useId()
  const devNameId = useId()

  const [code, setCode] = useState(() => formatCodeInput(initialCode))
  const [deviceName, setDeviceName] = useState(initialDeviceName)

  const activeError = error ?? initialError
  const isDisabled = submitting || rateLimitedDisabled

  function handleSubmit(e: FormEvent) {
    e.preventDefault()
    if (isDisabled) return
    const stripped = code.replace(/[\s-]+/g, '')
    onSubmit({ code: stripped, deviceName: deviceName.trim() })
  }

  function errorText(key: PairingErrorKey): string {
    if (key === 'WRONG_ADDRESS') {
      return t('pos.pair.wrongAddress')
    }
    return t(`pos.pair.errors.${key}`)
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-canvas px-4 py-8">
      <Card className="w-full max-w-dialog-md p-6 md:p-8">
        <div className="mb-6">
          <TenantBadge variant="hero" name={tenantName} slug={tenantSlug} />
        </div>

        <h1 className="text-h2 font-semibold text-ink">
          {t('pos.pair.title', { tenant: tenantName })}
        </h1>
        <p className="mt-1.5 text-body text-ink-soft">{t('pos.pair.subtitle')}</p>

        {hasOtherTenants ? (
          <div className="mt-4 flex items-start gap-2.5 rounded-card border border-info-line bg-info-soft p-3 text-caption text-info-ink">
            <Info className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
            <span>{t('pos.pair.otherTenantNotice')}</span>
          </div>
        ) : null}

        {activeError ? (
          <div
            role="alert"
            className="mt-4 flex items-start gap-2.5 rounded-card border border-danger-line bg-danger-soft p-3 text-body text-danger-ink"
          >
            <TriangleAlert className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
            <span>{errorText(activeError)}</span>
          </div>
        ) : null}

        <form onSubmit={handleSubmit} className="mt-5 flex flex-col gap-4">
          <div className="flex flex-col gap-1.5">
            <label htmlFor={codeId} className="text-label font-medium text-ink">
              {t('pos.pair.codeLabel')}
            </label>
            <Input
              id={codeId}
              value={code}
              onChange={(e) => setCode(formatCodeInput(e.target.value))}
              placeholder={t('pos.pair.codePlaceholder')}
              autoComplete="off"
              autoCapitalize="characters"
              spellCheck={false}
              disabled={isDisabled}
              className="font-mono text-h3 tracking-widest uppercase"
            />
          </div>

          <div className="flex flex-col gap-1.5">
            <label htmlFor={devNameId} className="text-label font-medium text-ink">
              {t('pos.pair.deviceNameLabel')}
            </label>
            <Input
              id={devNameId}
              value={deviceName}
              onChange={(e) => setDeviceName(e.target.value.slice(0, 80))}
              disabled={isDisabled}
            />
          </div>

          {progress ? <PairingProgress step={progress.step} total={progress.total} /> : null}

          <div className="flex flex-col gap-3 sm:flex-row">
            <Button
              type="submit"
              variant="primary"
              size="xl"
              fullWidth
              loading={submitting}
              disabled={isDisabled}
            >
              {t('pos.pair.submit')}
            </Button>
            <QrScanButton
              disabled={isDisabled}
              onScanned={(raw) => {
                if (raw) setCode(formatCodeInput(raw))
              }}
            />
          </div>

          <p className="text-center text-caption text-ink-soft">{t('pos.pair.onlineHint')}</p>
        </form>
      </Card>
    </div>
  )
}
