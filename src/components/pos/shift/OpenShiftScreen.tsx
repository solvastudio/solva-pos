import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { PosWorkspaceShell } from '~/components/pos/shell/PosWorkspaceShell'
import { usePosShellActions } from '~/components/pos/shell/use-pos-shell-actions'
import { OpenShiftForm } from '~/components/pos/shift/OpenShiftForm'
import type { BootResult } from '~/pos/boot/boot'
import { getOutlet, listRegisters } from '~/pos/data/master.repo'
import { openShift } from '~/pos/usecases/shift/open-shift'

export interface OpenShiftScreenProps {
  tenant: string
  bootResult: BootResult
}

export function OpenShiftScreen({ tenant, bootResult }: OpenShiftScreenProps) {
  const { t } = useTranslation()
  const shell = usePosShellActions(tenant, bootResult)

  const [outletName, setOutletName] = useState('')
  const [registerName, setRegisterName] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [errorMessage, setErrorMessage] = useState<string | null>(null)

  const mandatoryUpdateBlocked =
    bootResult.kind === 'READY' && bootResult.state.kind === 'UPDATE_REQUIRED'

  useEffect(() => {
    if (bootResult.kind !== 'READY') return
    const { db, device } = bootResult
    let cancelled = false
    void Promise.all([
      getOutlet(db, device.outlet_id),
      listRegisters(db, device.outlet_id),
    ]).then(([outlet, regs]) => {
      if (cancelled) return
      if (outlet) setOutletName(outlet.name)
      const reg = regs.find((r) => r.id === device.register_id)
      if (reg) setRegisterName(reg.name || reg.code)
    })
    return () => {
      cancelled = true
    }
  }, [bootResult])

  async function handleOpenShift(openingCash: number) {
    if (!shell.db || !shell.sessionStaff) return
    setSubmitting(true)
    setErrorMessage(null)
    try {
      const res = await openShift(shell.db, {
        openingCash,
        staffId: shell.sessionStaff.staffId,
      })
      if (res.ok || res.reason === 'SHIFT_ALREADY_OPEN') {
        void shell.navigate({ href: `/${shell.cleanSlug}/pos/sell` })
        return
      }
      if (res.reason === 'UPDATE_REQUIRED') {
        setErrorMessage(t('banner.updateRequired'))
      } else if (res.reason === 'INVALID_AMOUNT') {
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
      tenantName={shell.tenantName}
      tenantSlug={shell.cleanSlug}
      outletLabel={shell.outletLabel}
      staffName={shell.staffName}
      shiftOpen={Boolean(shell.openShift)}
      activeNav="shift"
      onSyncNow={shell.handleSyncNow}
      onLocaleChange={shell.handleLocaleChange}
      onLockScreen={() => void shell.handleLockScreen()}
      onSwitchStaff={shell.handleSwitchStaff}
    >
      <OpenShiftForm
        staffName={shell.staffName}
        outletName={outletName || shell.tenantName}
        registerName={registerName || t('pos.shell.registerFallback')}
        mandatoryUpdateBlocked={mandatoryUpdateBlocked}
        submitting={submitting}
        errorMessage={errorMessage}
        onSubmit={handleOpenShift}
      />
    </PosWorkspaceShell>
  )
}
