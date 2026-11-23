import { useEffect, useState } from 'react'
import { useNavigate } from '@tanstack/react-router'
import { PosWorkspaceShell } from '~/components/pos/shell/PosWorkspaceShell'
import { formatPosOutletLabel } from '~/components/pos/shell/use-pos-shell-actions'
import type { BootResult } from '~/pos/boot/boot'
import { getOutlet, listActiveStaff, listRegisters } from '~/pos/data/master.repo'
import { setMeta } from '~/pos/data/meta.repo'
import { observePrintJobForEntity } from '~/pos/data/print-job.repo'
import { getSaleWithDetails } from '~/pos/data/sale.repo'
import type { PrintJobRecord, SalePaymentRecord, SaleRecord } from '~/pos/db/types'
import { useShift } from '~/pos/hooks/use-shift'
import { kickActivePrintQueue } from '~/pos/printing/runtime'
import { clearSession, getSessionState } from '~/pos/session/session'
import { reprintSale } from '~/pos/usecases/print/reprint'
import { SaleDone } from './SaleDone'

export interface DoneRouteScreenProps {
  tenant: string
  saleId: string
  bootResult: BootResult
}

export function DoneRouteScreen({ tenant, saleId, bootResult }: DoneRouteScreenProps) {
  const navigate = useNavigate()
  const cleanSlug = tenant.toLowerCase()
  const sessionStaff = getSessionState().staff

  const db = bootResult.kind === 'READY' ? bootResult.db : null
  const device = bootResult.kind === 'READY' ? bootResult.device : null
  const tenantName =
    bootResult.kind === 'READY' && bootResult.tenant?.name ? bootResult.tenant.name : tenant

  const { openShift } = useShift(db, device?.register_id ?? null)

  const [sale, setSale] = useState<SaleRecord | null>(null)
  const [payments, setPayments] = useState<SalePaymentRecord[]>([])
  const [printJob, setPrintJob] = useState<PrintJobRecord | null>(null)
  const [staffName, setStaffName] = useState('')
  const [outletLabel, setOutletLabel] = useState<string | undefined>(undefined)

  useEffect(() => {
    if (!db || !device || !sessionStaff) return
    let cancelled = false

    void Promise.all([
      getSaleWithDetails(db, saleId),
      getOutlet(db, device.outlet_id),
      listRegisters(db, device.outlet_id),
      listActiveStaff(db),
    ]).then(([details, outlet, regs, staff]) => {
      if (cancelled) return
      if (details) {
        setSale(details.sale)
        setPayments(details.payments)
        setPrintJob(details.printJob)
      }
      const st = staff.find((s) => s.id === sessionStaff.staffId)
      setStaffName(st?.display_name ?? '')
      const reg = regs.find((r) => r.id === device.register_id)
      if (outlet && reg) setOutletLabel(formatPosOutletLabel(outlet, reg))
    })

    const sub = observePrintJobForEntity(db, saleId).subscribe({
      next(job) {
        if (!cancelled) setPrintJob(job)
      },
    })

    return () => {
      cancelled = true
      sub.unsubscribe()
    }
  }, [db, device, saleId, sessionStaff])

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
      <SaleDone
        sale={sale}
        payments={payments}
        printJob={printJob}
        onReprint={
          db && sale
            ? () => {
                void reprintSale(db, sale.id).then(() => kickActivePrintQueue())
              }
            : undefined
        }
        onNewSale={() => void navigate({ href: `/${cleanSlug}/pos/sell` })}
      />
    </PosWorkspaceShell>
  )
}
