import { useEffect, useState } from 'react'
import { useNavigate } from '@tanstack/react-router'
import { useTranslation } from 'react-i18next'
import { PosWorkspaceShell } from '~/components/pos/shell/PosWorkspaceShell'
import { formatPosOutletLabel } from '~/components/pos/shell/use-pos-shell-actions'
import { Button } from '~/components/ui/Button'
import { ErrorCodeBlock } from '~/components/ui/ErrorCodeBlock'
import type { BootResult } from '~/pos/boot/boot'
import { getOutlet, listActivePaymentMethods, listActiveStaff, listRegisters } from '~/pos/data/master.repo'
import { setMeta } from '~/pos/data/meta.repo'
import type { PaymentMethodRecord } from '~/pos/db/types'
import type { DetailedPaymentEntry } from '~/pos/domain/build-finalize-payload'
import { useCart } from '~/pos/hooks/use-cart'
import { useShift } from '~/pos/hooks/use-shift'
import { exportPending, triggerBlobDownload } from '~/pos/maintenance/export-pending'
import { clearSession, getSessionState } from '~/pos/session/session'
import { posCartStore } from '~/pos/state/cart-store'
import { finalizeSale, FinalizeSaleError } from '~/pos/usecases/sales/finalize-sale'
import { PaymentScreen } from './PaymentScreen'

export interface PayRouteScreenProps {
  tenant: string
  bootResult: BootResult
}

export function PayRouteScreen({ tenant, bootResult }: PayRouteScreenProps) {
  const { t } = useTranslation()
  const navigate = useNavigate()
  const cleanSlug = tenant.toLowerCase()
  const sessionStaff = getSessionState().staff

  const db = bootResult.kind === 'READY' ? bootResult.db : null
  const device = bootResult.kind === 'READY' ? bootResult.device : null
  const tenantName =
    bootResult.kind === 'READY' && bootResult.tenant?.name ? bootResult.tenant.name : tenant

  const cart = useCart((s) => s.cart)
  const { openShift } = useShift(db, device?.register_id ?? null)

  const [paymentMethods, setPaymentMethods] = useState<PaymentMethodRecord[]>([])
  const [staffName, setStaffName] = useState('')
  const [outletLabel, setOutletLabel] = useState<string | undefined>(undefined)
  const [submitting, setSubmitting] = useState(false)
  const [errorMessage, setErrorMessage] = useState<string | null>(null)
  const [storageFull, setStorageFull] = useState(false)

  useEffect(() => {
    if (cart.lines.length === 0) {
      void navigate({ href: `/${cleanSlug}/pos/sell` })
    }
  }, [cart.lines.length, cleanSlug, navigate])

  useEffect(() => {
    if (!db || !device || !sessionStaff) return
    let cancelled = false
    void Promise.all([
      listActivePaymentMethods(db),
      getOutlet(db, device.outlet_id),
      listRegisters(db, device.outlet_id),
      listActiveStaff(db),
    ]).then(([methods, outlet, regs, staff]) => {
      if (cancelled) return
      setPaymentMethods(methods)
      const st = staff.find((s) => s.id === sessionStaff.staffId)
      setStaffName(st?.display_name ?? '')
      const reg = regs.find((r) => r.id === device.register_id)
      if (outlet && reg) setOutletLabel(formatPosOutletLabel(outlet, reg))
    })
    return () => {
      cancelled = true
    }
  }, [db, device, sessionStaff])

  async function handleComplete(payments: readonly DetailedPaymentEntry[]) {
    if (!db || !sessionStaff) return
    setSubmitting(true)
    setErrorMessage(null)
    setStorageFull(false)
    try {
      const res = await finalizeSale(db, {
        cart,
        payments,
        staffId: sessionStaff.staffId,
      })
      await posCartStore.getState().clearCart()
      void navigate({ href: `/${cleanSlug}/pos/done/${res.saleId}` })
    } catch (err) {
      if (err instanceof FinalizeSaleError) {
        if (err.code === 'SHIFT_REQUIRED') {
          setErrorMessage(t('pos.pay.errorShiftRequired'))
        } else if (err.code === 'PREFIX_NOT_CONFIGURED') {
          setErrorMessage(t('pos.pay.errorPrefixMissing'))
        } else if (err.code === 'STORAGE_FULL') {
          setStorageFull(true)
          setErrorMessage(t('pos.pay.errorStorageFull'))
        } else {
          setErrorMessage(t('pos.pay.errorGeneric'))
        }
      } else {
        setErrorMessage(t('pos.pay.errorGeneric'))
      }
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <PosWorkspaceShell
      tenantName={tenantName}
      tenantSlug={cleanSlug}
      outletLabel={outletLabel}
      staffName={staffName || sessionStaff?.staffId}
      shiftOpen={Boolean(openShift)}
      activeNav="sell"
      onLocaleChange={(next) => {
        if (db) void setMeta(db, 'locale', next)
      }}
      onSwitchStaff={() => {
        clearSession()
        void navigate({ href: `/${cleanSlug}/pos/login` })
      }}
    >
      {storageFull ? (
        <div className="mx-auto mt-4 flex w-full max-w-2xl flex-col gap-3 px-4">
          <ErrorCodeBlock code="STORAGE_FULL" refId="storage_full" local />
          <div className="flex flex-wrap gap-2">
            <Button
              type="button"
              variant="secondary"
              size="sm"
              onClick={() => {
                if (!db) return
                void exportPending(db, {
                  logAudit: false,
                  staffId: sessionStaff?.staffId ?? null,
                }).then((exp) => {
                  triggerBlobDownload(exp.blob, exp.filename)
                })
              }}
            >
              {t('pos.queue.exportButton')}
            </Button>
            <Button
              type="button"
              variant="secondary"
              size="sm"
              onClick={() => void navigate({ href: `/${cleanSlug}/pos/settings` })}
            >
              {t('pos.more.settingsTitle')}
            </Button>
          </div>
        </div>
      ) : null}
      <PaymentScreen
        cart={cart}
        paymentMethods={paymentMethods}
        submitting={submitting}
        errorMessage={errorMessage}
        onBack={() => void navigate({ href: `/${cleanSlug}/pos/sell` })}
        onComplete={handleComplete}
      />
    </PosWorkspaceShell>
  )
}
