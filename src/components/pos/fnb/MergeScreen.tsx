import { useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { PosWorkspaceShell } from '~/components/pos/shell/PosWorkspaceShell'
import { usePosShellActions } from '~/components/pos/shell/use-pos-shell-actions'
import { Button } from '~/components/ui/Button'
import { Card } from '~/components/ui/Card'
import { EmptyState } from '~/components/ui/EmptyState'
import { ReceiptText } from '~/components/ui/icons'
import { useToast } from '~/components/ui/Toast'
import { formatMoney, toMoney } from '~/lib/kernel'
import type { BootResult } from '~/pos/boot/boot'
import {
  getLocalBillWithItems,
  listLocalBills,
  type LocalBillWithItems,
} from '~/pos/data/bill.repo'
import { mergeBillsLocal } from '~/pos/data/bill-merge.repo'
import { listActiveTables } from '~/pos/data/table.repo'
import type { BillRecord, FnbTableRecord } from '~/pos/db/types'
import { canMergeBillsTarget, filterMergeCandidates } from '~/pos/domain/merge-candidates'

export interface MergeScreenProps {
  tenant: string
  billId: string
  bootResult: BootResult
}

export function MergeScreen({ tenant, billId, bootResult }: MergeScreenProps) {
  const { t, i18n } = useTranslation()
  const locale = i18n.language === 'en-US' ? 'en-US' : 'id-ID'
  const { show: showToast } = useToast()
  const shell = usePosShellActions(tenant, bootResult)
  const db = bootResult.kind === 'READY' ? bootResult.db : null
  const device = bootResult.kind === 'READY' ? bootResult.device : null
  const staff = shell.sessionStaff

  const [targetData, setTargetData] = useState<LocalBillWithItems | null>(null)
  const [candidates, setCandidates] = useState<readonly BillRecord[]>([])
  const [candidateDetails, setCandidateDetails] = useState<Map<string, LocalBillWithItems>>(new Map())
  const [tablesById, setTablesById] = useState<Map<string, FnbTableRecord>>(new Map())
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set())
  const [submitting, setSubmitting] = useState(false)
  const [errorMsg, setErrorMsg] = useState<string | null>(null)

  useEffect(() => {
    if (!db || !device) return
    let cancelled = false
    void Promise.all([
      getLocalBillWithItems(db, billId),
      listLocalBills(db),
      listActiveTables(db, device.outlet_id),
    ]).then(async ([tgt, allBills, tables]) => {
      if (cancelled) return
      setTargetData(tgt)
      setTablesById(new Map(tables.map((tb) => [tb.id, tb])))
      const eligible = filterMergeCandidates(allBills, billId, device.device_id)
      setCandidates(eligible)
      const pairs = await Promise.all(eligible.map(async (c) => [c.id, await getLocalBillWithItems(db, c.id)] as const))
      if (!cancelled) {
        const nextMap = new Map<string, LocalBillWithItems>()
        for (const [id, d] of pairs) {
          if (d) nextMap.set(id, d)
        }
        setCandidateDetails(nextMap)
      }
    })
    return () => {
      cancelled = true
    }
  }, [billId, db, device])

  const canConfirm = useMemo(() => {
    if (!targetData || !device || selectedIds.size === 0) return false
    return canMergeBillsTarget(targetData.bill, device.device_id)
  }, [device, selectedIds.size, targetData])

  function toggleCandidate(id: string) {
    setSelectedIds((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  async function handleConfirmMerge() {
    if (!db || !staff || !canConfirm) return
    setSubmitting(true)
    setErrorMsg(null)
    try {
      await mergeBillsLocal(db, {
        targetBillId: billId,
        sourceBillIds: [...selectedIds],
        staffId: staff.staffId,
      })
      showToast({ tone: 'success', message: t('pos.merge.success') })
      await shell.navigate({ href: `/${shell.cleanSlug}/pos/bill/${billId}` })
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : t('pos.merge.failed'))
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <PosWorkspaceShell
      tenantSlug={shell.cleanSlug}
      tenantName={shell.tenantName}
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
      <div className="mx-auto flex h-full w-full max-w-3xl flex-col gap-4 overflow-y-auto p-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div>
            <h1 className="text-h2 font-bold text-ink">
              {t('pos.merge.title', { ref: targetData?.bill.bill_ref ?? '' })}
            </h1>
            <p className="text-body-sm text-ink-soft">{t('pos.merge.subtitle')}</p>
          </div>
          <Button
            type="button"
            variant="secondary"
            size="md"
            onClick={() => void shell.navigate({ href: `/${shell.cleanSlug}/pos/bill/${billId}` })}
          >
            {t('common.back')}
          </Button>
        </div>

        {candidates.length === 0 ? (
          <EmptyState
            icon={<ReceiptText className="size-10" aria-hidden="true" />}
            title={t('pos.merge.emptyTitle')}
            description={t('pos.merge.emptyDesc')}
          />
        ) : (
          <div className="flex flex-col gap-2">
            {candidates.map((cand) => {
              const detail = candidateDetails.get(cand.id)
              const activeItems = detail?.items.filter((i) => i.status === 'ACTIVE') ?? []
              const sum = activeItems.reduce(
                (acc, i) => acc + Math.round(Number(i.qty) * i.unit_price),
                0,
              )
              const tb = tablesById.get(cand.table_id)
              const checked = selectedIds.has(cand.id)
              return (
                <Card
                  key={cand.id}
                  className="flex cursor-pointer items-center justify-between gap-3 p-3"
                >
                  <label className="flex min-h-11 flex-1 cursor-pointer items-center gap-3">
                    <input
                      type="checkbox"
                      checked={checked}
                      onChange={() => toggleCandidate(cand.id)}
                      className="size-4 accent-action"
                    />
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2">
                        <span className="font-mono text-body font-bold text-ink">{cand.bill_ref}</span>
                        {tb ? (
                          <span className="rounded bg-surface-sunken px-2 py-0.5 text-caption text-ink-soft">
                            {tb.code}
                          </span>
                        ) : null}
                      </div>
                      <div className="text-caption text-ink-soft">
                        {t('pos.merge.itemCountHint', { count: activeItems.length })}
                      </div>
                    </div>
                  </label>
                  <span className="font-mono text-body font-semibold text-ink tabular-nums">
                    {formatMoney(toMoney(sum), locale)}
                  </span>
                </Card>
              )
            })}
          </div>
        )}

        {errorMsg ? (
          <p role="alert" className="text-body-sm font-medium text-danger-ink">
            {errorMsg}
          </p>
        ) : null}

        <div className="flex justify-end gap-2">
          <Button
            type="button"
            variant="primary"
            size="lg"
            disabled={!canConfirm || submitting}
            loading={submitting}
            onClick={() => void handleConfirmMerge()}
          >
            {t('pos.merge.confirmButton')}
          </Button>
        </div>
      </div>
    </PosWorkspaceShell>
  )
}
