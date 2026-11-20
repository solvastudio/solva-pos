import { useTranslation } from 'react-i18next'
import { Ban, CirclePause, ClockAlert, Download, KeyRound, Layers, Lock, RefreshCw, ShieldAlert } from '~/components/ui/icons'
import { Button } from '~/components/ui/Button'
import { ErrorCodeBlock } from '~/components/ui/ErrorCodeBlock'
import type { SystemVariant } from '~/pos/boot/route-decision'

export interface SystemScreenProps {
  variant: SystemVariant
  refId?: string | null
  onRetrySync?: () => void
  onExportPending?: () => void
  onRepair?: () => void
  onReload?: () => void
  retrying?: boolean
}

const VARIANT_CODE: Record<SystemVariant, string | null> = {
  lease_expired: 'LEASE_EXPIRED',
  clock_back: null,
  update_required: 'UPDATE_REQUIRED',
  duplicate_instance: null,
  revoked: 'DEVICE_REVOKED',
  credential_expired: 'CREDENTIAL_EXPIRED',
  tenant_suspended: 'TENANT_SUSPENDED',
  local_db_failed: 'LOCAL_DB_FAILED',
}

function VariantIcon({ variant }: { variant: SystemVariant }) {
  const cls = 'size-8'
  switch (variant) {
    case 'lease_expired':
      return <Lock className={cls} aria-hidden="true" />
    case 'clock_back':
      return <ClockAlert className={cls} aria-hidden="true" />
    case 'update_required':
      return <Download className={cls} aria-hidden="true" />
    case 'duplicate_instance':
      return <Layers className={cls} aria-hidden="true" />
    case 'revoked':
      return <Ban className={cls} aria-hidden="true" />
    case 'credential_expired':
      return <KeyRound className={cls} aria-hidden="true" />
    case 'tenant_suspended':
      return <CirclePause className={cls} aria-hidden="true" />
    case 'local_db_failed':
      return <ShieldAlert className={cls} aria-hidden="true" />
  }
}

/**
 * Centered blocking system screen (SCR-P15) across all 8 lock/sync/duplicate states.
 * Never offers "Use this tab" on `duplicate_instance` or destructive reset on `local_db_failed`.
 */
export function SystemScreen({
  variant,
  refId = null,
  onRetrySync,
  onExportPending,
  onRepair,
  onReload,
  retrying = false,
}: SystemScreenProps) {
  const { t } = useTranslation()
  const code = VARIANT_CODE[variant]

  const toneCls =
    variant === 'duplicate_instance' || variant === 'clock_back' || variant === 'update_required'
      ? 'bg-warning-soft text-warning-ink'
      : 'bg-danger-soft text-danger-ink'

  const showSyncRetry =
    variant === 'lease_expired' ||
    variant === 'clock_back' ||
    variant === 'tenant_suspended' ||
    variant === 'local_db_failed'

  const showRepair = variant === 'revoked' || variant === 'credential_expired'
  const showReload = variant === 'update_required'

  return (
    <div
      style={{ zIndex: 'var(--z-system)' }}
      className="fixed inset-0 flex items-center justify-center bg-canvas px-4 py-8"
    >
      <main className="w-full max-w-dialog-md rounded-modal border border-line bg-surface p-6 shadow-card md:p-8">
        <div role="alert" aria-live="assertive" className="flex flex-col items-start gap-4">
          <div
            className={`inline-flex size-12 items-center justify-center rounded-full ${toneCls}`}
          >
            <VariantIcon variant={variant} />
          </div>

          <div>
            <h1 className="text-h2 font-semibold text-ink">
              {t(`pos.system.variants.${variant}.title`)}
            </h1>
            <p className="mt-2 text-body text-ink-soft">
              {t(`pos.system.variants.${variant}.body`)}
            </p>
          </div>

          {code ? (
            <ErrorCodeBlock
              code={code}
              refId={refId ?? code.toLowerCase()}
              local={Boolean(refId?.toUpperCase().startsWith('D-'))}
              className="w-full"
            />
          ) : null}

          <div className="flex w-full flex-col gap-3">
            {showSyncRetry && onRetrySync ? (
              <Button
                type="button"
                variant="primary"
                size="xl"
                fullWidth
                loading={retrying}
                onClick={onRetrySync}
              >
                <RefreshCw className="size-4" aria-hidden="true" />
                <span>
                  {variant === 'clock_back'
                    ? t('pos.system.actions.retryCheck')
                    : t('pos.system.actions.retrySync')}
                </span>
              </Button>
            ) : null}

            {showReload && onReload ? (
              <Button type="button" variant="primary" size="xl" fullWidth onClick={onReload}>
                <RefreshCw className="size-4" aria-hidden="true" />
                <span>{t('pos.system.actions.reload')}</span>
              </Button>
            ) : null}

            {showRepair && onRepair ? (
              <Button type="button" variant="primary" size="xl" fullWidth onClick={onRepair}>
                {t('pos.system.actions.repair')}
              </Button>
            ) : null}

            {onExportPending && variant !== 'duplicate_instance' ? (
              <Button
                type="button"
                variant="secondary"
                size="xl"
                fullWidth
                onClick={onExportPending}
              >
                {t('pos.system.actions.exportPending')}
              </Button>
            ) : null}
          </div>
        </div>
      </main>
    </div>
  )
}
