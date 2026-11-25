import { useEffect, useMemo, useState, type FormEvent } from 'react'
import { useTranslation } from 'react-i18next'
import { TableGrid } from '~/components/pos/fnb/TableGrid'
import { PosWorkspaceShell } from '~/components/pos/shell/PosWorkspaceShell'
import { usePosShellActions } from '~/components/pos/shell/use-pos-shell-actions'
import { Button } from '~/components/ui/Button'
import { Dialog } from '~/components/ui/Dialog'
import { Field } from '~/components/ui/Field'
import { Input } from '~/components/ui/Input'
import type { BootResult } from '~/pos/boot/boot'
import { listLocalBills, observeLocalBills, openBill } from '~/pos/data/bill.repo'
import { listBillSnapshots, observeBillSnapshots } from '~/pos/data/bill-snapshot.repo'
import { listActiveTables } from '~/pos/data/table.repo'
import type { BillRecord, BillSnapshotRecord, FnbTableRecord } from '~/pos/db/types'
import { groupBillsByTable, type DerivedTableStatus } from '~/pos/domain/table-status'

export interface TablesScreenProps {
  tenant: string
  bootResult: BootResult
}

export function TablesScreen({ tenant, bootResult }: TablesScreenProps) {
  const { t } = useTranslation()
  const shell = usePosShellActions(tenant, bootResult)

  const [tables, setTables] = useState<FnbTableRecord[]>([])
  const [localBills, setLocalBills] = useState<BillRecord[]>([])
  const [snapshots, setSnapshots] = useState<BillSnapshotRecord[]>([])
  const [selectedArea, setSelectedArea] = useState<string | null>(null)
  const [openOnly, setOpenOnly] = useState(false)
  const [searchQuery, setSearchQuery] = useState('')

  const [openModalTable, setOpenModalTable] = useState<FnbTableRecord | null>(null)
  const [customerName, setCustomerName] = useState('')
  const [customerPhone, setCustomerPhone] = useState('')
  const [creatingBill, setCreatingBill] = useState(false)

  const [pickModal, setPickModal] = useState<{
    table: FnbTableRecord
    derived: DerivedTableStatus
  } | null>(null)

  useEffect(() => {
    const db = shell.db
    const dev = shell.device
    if (!db || !dev) return
    let cancelled = false

    void Promise.all([
      listActiveTables(db, dev.outlet_id),
      listLocalBills(db),
      listBillSnapshots(db),
    ]).then(([tbls, locals, snaps]) => {
      if (cancelled) return
      setTables(tbls)
      setLocalBills(locals)
      setSnapshots(snaps)
    })

    const subLocal = observeLocalBills(db).subscribe({
      next: (rows) => {
        if (!cancelled) setLocalBills(rows)
      },
    })
    const subSnap = observeBillSnapshots(db).subscribe({
      next: (rows) => {
        if (!cancelled) setSnapshots(rows)
      },
    })

    return () => {
      cancelled = true
      subLocal.unsubscribe()
      subSnap.unsubscribe()
    }
  }, [shell.db, shell.device])

  const statusByTable = useMemo(() => {
    const devId = shell.device?.device_id ?? ''
    return groupBillsByTable(
      tables.map((tbl) => tbl.id),
      localBills,
      snapshots,
      devId,
    )
  }, [localBills, shell.device?.device_id, snapshots, tables])

  const totalsByTable = useMemo(() => {
    const map = new Map<string, number>()
    const snapById = new Map(snapshots.map((s) => [s.bill_id, s]))
    for (const [tableId, summary] of statusByTable.entries()) {
      const first = summary.bills[0]
      if (!first) continue
      const snap = snapById.get(first.billId)
      if (snap) {
        const gross = snap.items
          .filter((i) => i.status === 'ACTIVE')
          .reduce((acc, i) => acc + Math.round(Number(i.qty) * i.unit_price), 0)
        map.set(tableId, gross)
      }
    }
    return map
  }, [snapshots, statusByTable])

  function handleSelectTable(table: FnbTableRecord, derived: DerivedTableStatus) {
    if (derived.billCount === 0) {
      setCustomerName('')
      setCustomerPhone('')
      setOpenModalTable(table)
      return
    }
    if (derived.billCount === 1) {
      void shell.navigate({ href: `/${shell.cleanSlug}/pos/bill/${derived.bills[0]!.billId}` })
      return
    }
    setPickModal({ table, derived })
  }

  async function handleConfirmOpenBill(e: FormEvent) {
    e.preventDefault()
    if (!shell.db || !shell.sessionStaff || !openModalTable) return
    setCreatingBill(true)
    try {
      const res = await openBill(shell.db, {
        tableId: openModalTable.id,
        staffId: shell.sessionStaff.staffId,
        customer:
          customerName.trim() || customerPhone.trim()
            ? {
                ...(customerName.trim() ? { name: customerName.trim() } : {}),
                ...(customerPhone.trim() ? { phone: customerPhone.trim() } : {}),
              }
            : undefined,
      })
      setOpenModalTable(null)
      void shell.navigate({ href: `/${shell.cleanSlug}/pos/bill/${res.bill.id}` })
    } finally {
      setCreatingBill(false)
    }
  }

  return (
    <PosWorkspaceShell
      tenantName={shell.tenantName}
      tenantSlug={shell.cleanSlug}
      outletLabel={shell.outletLabel}
      staffName={shell.staffName}
      shiftOpen={Boolean(shell.openShift)}
      registerType={shell.device?.register_type}
      activeNav="tables"
      onSyncNow={shell.handleSyncNow}
      onLocaleChange={shell.handleLocaleChange}
      onLockScreen={() => void shell.handleLockScreen()}
      onSwitchStaff={shell.handleSwitchStaff}
    >
      <TableGrid
        tables={tables}
        statusByTable={statusByTable}
        totalsByTable={totalsByTable}
        selectedArea={selectedArea}
        openOnly={openOnly}
        searchQuery={searchQuery}
        onAreaChange={setSelectedArea}
        onOpenOnlyChange={setOpenOnly}
        onSearchChange={setSearchQuery}
        onSelectTable={handleSelectTable}
      />

      <Dialog
        open={openModalTable !== null}
        onOpenChange={(open) => {
          if (!open) setOpenModalTable(null)
        }}
        title={`${t('pos.bill.openBillTitle')} — ${openModalTable?.code ?? ''}`}
        size="sm"
      >
        <form onSubmit={(e) => void handleConfirmOpenBill(e)} className="flex flex-col gap-4">
          <Field htmlFor="open-bill-cust-name" label={t('pos.cart.customerNameLabel')}>
            <Input
              id="open-bill-cust-name"
              value={customerName}
              maxLength={80}
              onChange={(e) => setCustomerName(e.target.value)}
            />
          </Field>
          <Field htmlFor="open-bill-cust-phone" label={t('pos.cart.customerPhoneLabel')}>
            <Input
              id="open-bill-cust-phone"
              type="tel"
              value={customerPhone}
              maxLength={20}
              onChange={(e) => setCustomerPhone(e.target.value)}
            />
          </Field>
          <div className="flex justify-end gap-2">
            <Button type="button" variant="secondary" size="md" onClick={() => setOpenModalTable(null)}>
              {t('common.cancel')}
            </Button>
            <Button type="submit" variant="primary" size="md" loading={creatingBill}>
              {t('pos.table.openNewBillOnTable')}
            </Button>
          </div>
        </form>
      </Dialog>

      <Dialog
        open={pickModal !== null}
        onOpenChange={(open) => {
          if (!open) setPickModal(null)
        }}
        title={t('pos.table.pickBillTitle', { table: pickModal?.table.code ?? '' })}
        size="sm"
      >
        {pickModal ? (
          <div className="flex flex-col gap-2.5">
            {pickModal.derived.bills.map((b) => (
              <Button
                key={b.billId}
                type="button"
                variant="secondary"
                size="md"
                onClick={() => {
                  setPickModal(null)
                  void shell.navigate({ href: `/${shell.cleanSlug}/pos/bill/${b.billId}` })
                }}
                className="justify-between"
              >
                <span className="font-mono font-semibold">{b.billRef}</span>
                <span className="text-caption text-ink-soft">
                  {b.isAwaitingPayment
                    ? t('pos.table.statusAwaitingPayment')
                    : b.leaseDeviceId === shell.device?.device_id
                      ? t('pos.bill.filterMine')
                      : t('pos.table.statusLockedOther')}
                </span>
              </Button>
            ))}

            <Button
              type="button"
              variant="primary"
              size="md"
              onClick={() => {
                const tbl = pickModal.table
                setPickModal(null)
                setCustomerName('')
                setCustomerPhone('')
                setOpenModalTable(tbl)
              }}
            >
              {t('pos.table.openNewBillOnTable')}
            </Button>
          </div>
        ) : null}
      </Dialog>
    </PosWorkspaceShell>
  )
}
