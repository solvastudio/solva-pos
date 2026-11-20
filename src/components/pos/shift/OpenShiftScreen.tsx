import { useEffect, useState } from 'react'
import { useNavigate } from '@tanstack/react-router'
import { useTranslation } from 'react-i18next'
import { PosWorkspaceShell } from '~/components/pos/shell/PosWorkspaceShell'
import { OpenShiftForm } from '~/components/pos/shift/OpenShiftForm'
import type { BootResult } from '~/pos/boot/boot'
import { getOutlet, listRegisters } from '~/pos/data/master.repo'
import { setMeta } from '~/pos/data/meta.repo'
import { clearSession, getSessionState } from '~/pos/session/session'
import { openShift } from '~/pos/usecases/shift/open-shift'

export interface OpenShiftScreenProps {
  tenant: string
  bootResult: BootResult
}

export function OpenShiftScreen({ tenant, bootResult }: OpenShiftScreenProps) {
  const { t } = useTranslation()
  const navigate = useNavigate()
  const cleanSlug = tenant.toLowerCase()

  const sessionStaff = getSessionState().staff
  const [outletName, setOutletName] = useState('')
  const [registerName, setRegisterName] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [errorMessage, setErrorMessage] = useState<string | null>(null)

  const tenantName =
    bootResult.kind === 'READY' && bootResult.tenant?.name ? bootResult.tenant.name : tenant
  const mandatoryUpdateBlocked =
    bootResult.kind === 'READY' && bootResult.state.kind === 'UPDATE_REQUIRED'

  useEffect(() => {
    if (bootResult.kind !== 'READY') return
    const { db, device } = bootResult
    void Promise.all([
      getOutlet(db, device.outlet_id),
      listRegisters(db, device.outlet_id),
    ]).then(([outlet, regs]) => {
      if (outlet) setOutletName(outlet.name)
      const reg = regs.find((r) => r.id === device.register_id)
      if (reg) setRegisterName(reg.name || reg.code)
    })
  }, [bootResult])

  async function handleLockScreen() {
    if (bootResult.kind === 'READY' && sessionStaff) {
      await setMeta(bootResult.db, 'idle_lock', {
        locked: true,
        locked_staff_id: sessionStaff.staffId,
        locked_at: new Date().toISOString(),
      })
    }
    clearSession()
    void navigate({ href: `/${cleanSlug}/pos/login` })
  }

  function handleSwitchStaff() {
    clearSession()
    void navigate({ href: `/${cleanSlug}/pos/login` })
  }

  async function handleOpenShift(openingCash: number) {
    if (bootResult.kind !== 'READY' || !sessionStaff) return
    setSubmitting(true)
    setErrorMessage(null)
    try {
      const res = await openShift(bootResult.db, {
        openingCash,
        staffId: sessionStaff.staffId,
      })
      if (res.ok || res.reason === 'SHIFT_ALREADY_OPEN') {
        void navigate({ href: `/${cleanSlug}/pos/sell` })
        return
      }
      if (res.reason === 'INVALID_AMOUNT') {
        setErrorMessage(t('pos.shift.invalidAmount'))
      } else {
        setErrorMessage(t('pos.shift.genericError'))
      }
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <PosWorkspaceShell
      tenantName={tenantName}
      tenantSlug={cleanSlug}
      outletLabel={outletName && registerName ? `${outletName} · ${registerName}` : undefined}
      staffName={sessionStaff?.staffId}
      shiftOpen={false}
      activeNav="shift"
      onLocaleChange={(next) => {
        if (bootResult.kind === 'READY') {
          void setMeta(bootResult.db, 'locale', next)
        }
      }}
      onLockScreen={() => void handleLockScreen()}
      onSwitchStaff={handleSwitchStaff}
    >
      <OpenShiftForm
        staffName={sessionStaff?.staffId ?? ''}
        outletName={outletName || tenantName}
        registerName={registerName || t('pos.shell.registerFallback')}
        mandatoryUpdateBlocked={mandatoryUpdateBlocked}
        submitting={submitting}
        errorMessage={errorMessage}
        onSubmit={handleOpenShift}
      />
    </PosWorkspaceShell>
  )
}
