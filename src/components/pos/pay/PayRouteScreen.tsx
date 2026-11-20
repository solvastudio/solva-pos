import { useEffect, useState } from 'react'
import { useNavigate } from '@tanstack/react-router'
import { useTranslation } from 'react-i18next'
import { PosWorkspaceShell } from '~/components/pos/shell/PosWorkspaceShell'
import type { BootResult } from '~/pos/boot/boot'
import { getOutlet, listActivePaymentMethods, listActiveStaff, listRegisters } from '~/pos/data/master.repo'
import { setMeta } from '~/pos/data/meta.repo'
import type { PaymentMethodRecord } from '~/pos/db/types'
import type { DetailedPaymentEntry } from '~/pos/domain/build-finalize-payload'
import { useCart } from '~/pos/hooks/use-cart'
import { useShift } from '~/pos/hooks/use-shift'
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
      if (outlet && reg) setOutletLabel(`${outlet.code} · ${reg.code}`)
    })
    return () => {
      cancelled = true
    }
  }, [db, device, sessionStaff])

  async function handleComplete(payments: readonly DetailedPaymentEntry[]) {
    if (!db || !sessionStaff) return
    setSubmitting(true)
    setErrorMessage(null)
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
