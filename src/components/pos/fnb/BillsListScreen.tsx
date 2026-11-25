import { useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { IncomingBillsList } from '~/components/pos/fnb/IncomingBillsList'
import { formatTimeHhMm } from '~/components/pos/fnb/TableCard'
import { PosWorkspaceShell } from '~/components/pos/shell/PosWorkspaceShell'
import { usePosShellActions } from '~/components/pos/shell/use-pos-shell-actions'
import { Button } from '~/components/ui/Button'
import { useToast } from '~/components/ui/Toast'
import { cn } from '~/lib/cn'
import type { BootResult } from '~/pos/boot/boot'
import { listLocalBills, observeLocalBills } from '~/pos/data/bill.repo'
import { listBillSnapshots, observeBillSnapshots } from '~/pos/data/bill-snapshot.repo'
import { listActiveTables } from '~/pos/data/table.repo'
import type { BillRecord, BillSnapshotRecord, FnbTableRecord } from '~/pos/db/types'
import { canAccept } from '~/pos/domain/bill-guards'
import { useSyncState } from '~/pos/hooks/use-sync-state'
import { acceptBillClient } from '~/pos/sync/handover-client'

export interface BillsListScreenProps {
  tenant: string
  bootResult: BootResult
}

export function BillsListScreen({ tenant, bootResult }: BillsListScreenProps) {
  const { t } = useTranslation()
  const { show: showToast } = useToast()
  const shell = usePosShellActions(tenant, bootResult)
  const { syncState } = useSyncState()

  const [tables, setTables] = useState<FnbTableRecord[]>([])
  const [localBills, setLocalBills] = useState<BillRecord[]>([])
  const [snapshots, setSnapshots] = useState<BillSnapshotRecord[]>([])
  const [filter, setFilter] = useState<'MINE' | 'OTHER'>('MINE')
  const [acceptingBillId, setAcceptingBillId] = useState<string | null>(null)
  const [acceptError, setAcceptError] = useState<string | null>(null)

  const isOnline = syncState.conn !== 'OFFLINE'
  const regId = shell.device?.register_id ?? ''
  const regType = shell.device?.register_type === 'WAITER' ? 'WAITER' : 'CASHIER'

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

  const tableCodeById = useMemo(
    () => new Map(tables.map((tbl) => [tbl.id, tbl.code])),
    [tables],
  )

  const incomingBills = useMemo(
    () =>
      snapshots.filter(
        (s) =>
          s.status === 'OPEN' &&
          s.handover_status === 'PENDING' &&
          s.handover_target_register_id === regId,
      ),
    [regId, snapshots],
  )

  const myOpenBills = useMemo(() => {
    const devId = shell.device?.device_id ?? ''
    return localBills.filter((b) => b.status === 'OPEN' && b.lease_device_id === devId)
  }, [localBills, shell.device?.device_id])

  async function handleAccept(billId: string) {
    if (!shell.db || !shell.sessionStaff) return
    setAcceptError(null)
    setAcceptingBillId(billId)
    try {
      const res = await acceptBillClient(
        shell.db,
        { billId, staffId: shell.sessionStaff.staffId },
        { isOnline: () => isOnline },
      )
      if (!res.ok) {
        setAcceptError(
          res.code === 'HANDOVER_NOT_PENDING'
            ? t('pos.handover.errorNotPending')
            : t('pos.handover.errorGeneric'),
        )
        shell.handleSyncNow()
        return
      }
      showToast({ tone: 'success', message: t('pos.handover.acceptedToast') })
      shell.handleSyncNow()
      void shell.navigate({ href: `/${shell.cleanSlug}/pos/bill/${billId}` })
    } finally {
      setAcceptingBillId(null)
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
      activeNav="bills"
      onSyncNow={shell.handleSyncNow}
      onLocaleChange={shell.handleLocaleChange}
      onLockScreen={() => void shell.handleLockScreen()}
      onSwitchStaff={shell.handleSwitchStaff}
    >
      <div className="mx-auto flex w-full max-w-5xl flex-col gap-6 p-4">
        <h1 className="text-h2 font-semibold text-ink">{t('pos.bill.title')}</h1>

        {regType === 'CASHIER' ? (
          <IncomingBillsList
            bills={incomingBills}
            tableCodeById={tableCodeById}
            canAcceptFn={(b) => canAccept(b, { registerId: regId, registerType: regType, isOnline })}
            acceptingBillId={acceptingBillId}
            errorMessage={acceptError}
            onAccept={(id) => void handleAccept(id)}
            onView={(id) => void shell.navigate({ href: `/${shell.cleanSlug}/pos/bill/${id}` })}
          />
        ) : null}

        <div className="flex flex-col gap-3">
          <div className="flex gap-2">
            <button
              type="button"
              onClick={() => setFilter('MINE')}
              className={cn(
                'min-h-11 rounded-pill px-4 text-label font-medium transition-colors',
                filter === 'MINE'
                  ? 'bg-action text-on-action'
                  : 'bg-surface-sunken text-ink-soft hover:text-ink',
              )}
            >
              {t('pos.bill.filterMine')} ({myOpenBills.length})
            </button>
            <button
              type="button"
              onClick={() => setFilter('OTHER')}
              className={cn(
                'min-h-11 rounded-pill px-4 text-label font-medium transition-colors',
                filter === 'OTHER'
                  ? 'bg-action text-on-action'
                  : 'bg-surface-sunken text-ink-soft hover:text-ink',
              )}
            >
              {t('pos.bill.filterOther')} ({snapshots.length})
            </button>
          </div>

          {filter === 'MINE' ? (
            myOpenBills.length === 0 ? (
              <p className="rounded-card border border-dashed border-line bg-surface-sunken p-4 text-body-sm text-ink-soft">
                {t('pos.bill.noBills')}
              </p>
            ) : (
              <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-2">
                {myOpenBills.map((b) => (
                  <div
                    key={b.id}
                    className="flex items-center justify-between gap-3 rounded-card border border-line bg-surface p-3"
                  >
                    <div className="min-w-0">
                      <div className="flex items-center gap-2">
                        <span className="font-mono text-label font-bold text-ink">{b.bill_ref}</span>
                        <span className="rounded bg-surface-sunken px-1.5 py-0.5 text-caption text-ink-soft">
                          {tableCodeById.get(b.table_id) ?? b.table_id}
                        </span>
                      </div>
                      <div className="mt-1 text-caption text-ink-soft">
                        {b.customer_name ?? '-'}
                        {b.is_awaiting_payment ? ` · ${t('pos.table.statusAwaitingPayment')}` : ''}
                      </div>
                    </div>
                    <Button
                      type="button"
                      variant="secondary"
                      size="md"
                      onClick={() => void shell.navigate({ href: `/${shell.cleanSlug}/pos/bill/${b.id}` })}
                    >
                      {t('pos.bill.openBillAction')}
                    </Button>
                  </div>
                ))}
              </div>
            )
          ) : snapshots.length === 0 ? (
            <p className="rounded-card border border-dashed border-line bg-surface-sunken p-4 text-body-sm text-ink-soft">
              {t('pos.bill.noBills')}
            </p>
          ) : (
            <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-2">
              {snapshots.map((b) => (
                <div
                  key={b.bill_id}
                  className="flex items-center justify-between gap-3 rounded-card border-2 border-dashed border-violet-line bg-violet-soft p-3"
                >
                  <div className="min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="font-mono text-label font-bold text-ink">{b.bill_ref}</span>
                      <span className="rounded bg-surface px-1.5 py-0.5 text-caption text-ink">
                        {tableCodeById.get(b.table_id) ?? b.table_id}
                      </span>
                    </div>
                    <div className="mt-1 text-caption text-violet-ink">
                      {b.last_event_at
                        ? t('pos.table.updatedAt', { time: formatTimeHhMm(b.last_event_at) })
                        : t('pos.table.statusLockedOther')}
                    </div>
                  </div>
                  <Button
                    type="button"
                    variant="secondary"
                    size="md"
                    onClick={() =>
                      void shell.navigate({ href: `/${shell.cleanSlug}/pos/bill/${b.bill_id}` })
                    }
                  >
                    {t('pos.bill.openBillAction')}
                  </Button>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </PosWorkspaceShell>
  )
}
