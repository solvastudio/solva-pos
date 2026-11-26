import { useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { PosWorkspaceShell } from '~/components/pos/shell/PosWorkspaceShell'
import { usePosShellActions } from '~/components/pos/shell/use-pos-shell-actions'
import { Button } from '~/components/ui/Button'
import { Card } from '~/components/ui/Card'
import { Segmented } from '~/components/ui/Segmented'
import { useToast } from '~/components/ui/Toast'
import { Minus, Plus } from '~/components/ui/icons'
import {
  addQty,
  businessDate,
  cmpQty,
  formatMoney,
  parseQty,
  subQty,
  toMoney,
  type CashRoundingUnit,
  type OutletTimezone,
} from '~/lib/kernel'
import type { SaleConfigSnapshot } from '~/lib/sales-calc'
import type { BootResult } from '~/pos/boot/boot'
import { getLocalBillWithItems, type LocalBillWithItems } from '~/pos/data/bill.repo'
import { splitBillLocal, type LocalSplitChildRequest } from '~/pos/data/bill-split.repo'
import { getOutlet } from '~/pos/data/master.repo'
import { buildConfigSnapshot } from '~/pos/domain/config-snapshot'
import {
  canSplitBill,
  previewEqualSplit,
  previewGroupSplit,
  validateItemPartition,
  validateQtyPartition,
} from '~/pos/domain/split-ui'

export interface SplitScreenProps {
  tenant: string
  billId: string
  bootResult: BootResult
}

type SplitModeUi = 'ITEM' | 'QTY' | 'EQUAL'

export function SplitScreen({ tenant, billId, bootResult }: SplitScreenProps) {
  const { t, i18n } = useTranslation()
  const locale = i18n.language === 'en-US' ? 'en-US' : 'id-ID'
  const { show: showToast } = useToast()
  const shell = usePosShellActions(tenant, bootResult)
  const db = bootResult.kind === 'READY' ? bootResult.db : null
  const device = bootResult.kind === 'READY' ? bootResult.device : null
  const staff = shell.sessionStaff

  const [billData, setBillData] = useState<LocalBillWithItems | null>(null)
  const [config, setConfig] = useState<{ config: SaleConfigSnapshot; rounding: CashRoundingUnit }>({
    config: {
      priceTaxMode: 'EXCLUSIVE',
      taxProfile: 'NONE',
      taxRate: '0',
      serviceChargeEnabled: false,
      serviceChargeRate: '0',
      serviceChargeTaxable: true,
    },
    rounding: 100,
  })
  const [mode, setMode] = useState<SplitModeUi>('EQUAL')
  const [groupCount, setGroupCount] = useState(2)
  const [itemAssign, setItemAssign] = useState<Map<string, number>>(new Map())
  const [qtyMatrix, setQtyMatrix] = useState<Map<string, string[]>>(new Map())
  const [submitting, setSubmitting] = useState(false)
  const [errorMsg, setErrorMsg] = useState<string | null>(null)

  useEffect(() => {
    if (!db || !device) return
    let cancelled = false
    void Promise.all([getLocalBillWithItems(db, billId), getOutlet(db, device.outlet_id)]).then(
      async ([loaded, outlet]) => {
        if (cancelled) return
        setBillData(loaded)
        if (loaded) {
          const active = loaded.items.filter((i) => i.status === 'ACTIVE')
          const initAssign = new Map<string, number>()
          const initQty = new Map<string, string[]>()
          active.forEach((it, idx) => {
            initAssign.set(it.id, idx % 2)
            initQty.set(it.id, [it.qty, '0'])
          })
          setItemAssign(initAssign)
          setQtyMatrix(initQty)
        }
        if (outlet) {
          const bDate = businessDate(
            new Date().toISOString(),
            outlet.timezone as OutletTimezone,
            outlet.day_cutoff_time.slice(0, 5),
          )
          const cfg = await buildConfigSnapshot(db, { outletId: outlet.id, businessDate: bDate })
          if (!cancelled && cfg.ok) {
            setConfig({ config: cfg.config, rounding: cfg.cashRoundingUnit })
          }
        }
      },
    )
    return () => {
      cancelled = true
    }
  }, [billId, db, device])

  const activeItems = useMemo(
    () => billData?.items.filter((it) => it.status === 'ACTIVE') ?? [],
    [billData],
  )

  function handleChangeGroupCount(nextCount: number) {
    const clamped = Math.max(2, Math.min(6, nextCount))
    setGroupCount(clamped)
    setItemAssign((prev) => {
      const next = new Map(prev)
      for (const [k, v] of next.entries()) {
        if (v >= clamped) next.set(k, clamped - 1)
      }
      return next
    })
    setQtyMatrix((prev) => {
      const next = new Map<string, string[]>()
      for (const it of activeItems) {
        const cur = prev.get(it.id) ?? []
        const arr = Array.from({ length: clamped }, (_, i) => cur[i] ?? '0')
        next.set(it.id, arr)
      }
      return next
    })
  }

  function stepQtySplit(itemId: string, maxQtyStr: string, groupIdx: number, delta: number) {
    setQtyMatrix((prev) => {
      const next = new Map(prev)
      const row = [...(next.get(itemId) ?? Array.from({ length: groupCount }, () => '0'))]
      const cur = parseQty((row[groupIdx] ?? '0').trim() || '0')
      if (delta > 0) {
        let totalOthers = parseQty('0')
        for (let i = 0; i < row.length; i += 1) {
          if (i !== groupIdx) {
            totalOthers = parseQty(addQty(totalOthers, parseQty(row[i] || '0')))
          }
        }
        const used = parseQty(addQty(totalOthers, cur))
        if (cmpQty(parseQty(addQty(used, parseQty('1'))), parseQty(maxQtyStr)) > 0) return prev
        row[groupIdx] = addQty(cur, parseQty('1'))
      } else {
        if (cmpQty(cur, parseQty('1')) < 0) return prev
        row[groupIdx] = subQty(cur, parseQty('1'))
      }
      next.set(itemId, row)
      return next
    })
  }

  const isValidSplit = useMemo(() => {
    if (!billData || !device) return false
    if (!canSplitBill(billData.bill, activeItems, device.device_id)) return false
    if (mode === 'EQUAL') return activeItems.length >= 1 && groupCount >= 2
    if (mode === 'ITEM') return validateItemPartition(activeItems, itemAssign, groupCount)
    return validateQtyPartition(activeItems, qtyMatrix, groupCount)
  }, [activeItems, billData, device, groupCount, itemAssign, mode, qtyMatrix])

  const previews = useMemo(() => {
    if (!billData || activeItems.length === 0) return []
    if (mode === 'EQUAL') {
      return previewEqualSplit({
        bill: billData.bill,
        activeItems,
        shareCount: groupCount,
        config: config.config,
        cashRoundingUnit: config.rounding,
      })
    }
    if (mode === 'ITEM') {
      const groups = Array.from({ length: groupCount }, (_, gIdx) =>
        activeItems.filter((it) => itemAssign.get(it.id) === gIdx),
      )
      return previewGroupSplit({
        bill: billData.bill,
        groups,
        config: config.config,
        cashRoundingUnit: config.rounding,
      })
    }
    const groups = Array.from({ length: groupCount }, (_, gIdx) =>
      activeItems.flatMap((it) => {
        const raw = qtyMatrix.get(it.id)?.[gIdx] ?? '0'
        try {
          if (cmpQty(parseQty(raw || '0'), parseQty('0')) > 0) {
            return [{ ...it, qty: parseQty(raw) }]
          }
        } catch {
          return []
        }
        return []
      }),
    )
    return previewGroupSplit({
      bill: billData.bill,
      groups,
      config: config.config,
      cashRoundingUnit: config.rounding,
    })
  }, [activeItems, billData, config, groupCount, itemAssign, mode, qtyMatrix])

  async function handleConfirmSplit() {
    if (!db || !billData || !staff || !isValidSplit) return
    setSubmitting(true)
    setErrorMsg(null)
    try {
      let childrenReq: LocalSplitChildRequest[]
      if (mode === 'EQUAL') {
        childrenReq = Array.from({ length: groupCount }, (_, i) => ({
          shareIndex: i + 1,
          shareCount: groupCount,
          items: [],
        }))
      } else if (mode === 'ITEM') {
        childrenReq = Array.from({ length: groupCount }, (_, gIdx) => ({
          items: activeItems
            .filter((it) => itemAssign.get(it.id) === gIdx)
            .map((it, lIdx) => ({
              sourceBillItemId: it.id,
              lineNo: lIdx + 1,
              qty: it.qty,
            })),
        }))
      } else {
        childrenReq = Array.from({ length: groupCount }, (_, gIdx) => ({
          items: activeItems
            .map((it) => {
              const qStr = qtyMatrix.get(it.id)?.[gIdx] ?? '0'
              const q = parseQty(qStr || '0')
              return { it, q }
            })
            .filter(({ q }) => cmpQty(q, parseQty('0')) > 0)
            .map(({ it, q }, lIdx) => ({
              sourceBillItemId: it.id,
              lineNo: lIdx + 1,
              qty: q,
            })),
        }))
      }

      const res = await splitBillLocal(db, {
        parentBillId: billData.bill.id,
        splitMode: mode,
        children: childrenReq,
        staffId: staff.staffId,
      })

      showToast({ tone: 'success', message: t('pos.split.success') })
      const firstChildId = res.children[0]!.id
      await shell.navigate({ href: `/${shell.cleanSlug}/pos/bill/${firstChildId}` })
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : t('pos.split.failed'))
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
      <div className="mx-auto flex h-full w-full max-w-4xl flex-col gap-4 overflow-y-auto p-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div>
            <h1 className="text-h2 font-bold text-ink">
              {t('pos.split.title', { ref: billData?.bill.bill_ref ?? '' })}
            </h1>
            <p className="text-body-sm text-ink-soft">{t('pos.split.subtitle')}</p>
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

        <div className="flex flex-wrap items-center justify-between gap-3">
          <Segmented
            ariaLabel={t('pos.split.modeLabel')}
            value={mode}
            onChange={(v) => setMode(v as SplitModeUi)}
            options={[
              { value: 'EQUAL', label: t('pos.split.modeEqual') },
              { value: 'ITEM', label: t('pos.split.modeItem') },
              { value: 'QTY', label: t('pos.split.modeQty') },
            ]}
          />

          <div className="flex items-center gap-2">
            <span className="text-label font-medium text-ink-soft">
              {t('pos.split.partsLabel')}
            </span>
            <Button
              type="button"
              variant="secondary"
              size="sm"
              disabled={groupCount <= 2}
              onClick={() => handleChangeGroupCount(groupCount - 1)}
              aria-label={t('pos.split.fewerParts')}
            >
              <Minus className="size-4" aria-hidden="true" />
            </Button>
            <span className="min-w-8 text-center font-mono text-h3 font-bold tabular-nums">
              {groupCount}
            </span>
            <Button
              type="button"
              variant="secondary"
              size="sm"
              disabled={groupCount >= 6}
              onClick={() => handleChangeGroupCount(groupCount + 1)}
              aria-label={t('pos.split.moreParts')}
            >
              <Plus className="size-4" aria-hidden="true" />
            </Button>
          </div>
        </div>

        {mode === 'ITEM' ? (
          <div className="flex flex-col gap-2">
            {activeItems.map((it) => (
              <Card key={it.id} className="flex flex-wrap items-center justify-between gap-2 p-3">
                <div>
                  <div className="text-body font-semibold text-ink">{it.item_name}</div>
                  <div className="text-caption text-ink-soft">
                    {`${it.qty} ${it.uom_code} × ${formatMoney(toMoney(it.unit_price), locale)}`}
                  </div>
                </div>
                <div className="flex flex-wrap gap-1.5">
                  {Array.from({ length: groupCount }, (_, gIdx) => (
                    <Button
                      key={gIdx}
                      type="button"
                      size="sm"
                      variant={itemAssign.get(it.id) === gIdx ? 'primary' : 'secondary'}
                      onClick={() =>
                        setItemAssign((prev) => {
                          const next = new Map(prev)
                          next.set(it.id, gIdx)
                          return next
                        })
                      }
                    >
                      {t('pos.split.billChip', { index: gIdx + 1 })}
                    </Button>
                  ))}
                </div>
              </Card>
            ))}
          </div>
        ) : null}

        {mode === 'QTY' ? (
          <div className="flex flex-col gap-2">
            {activeItems.map((it) => {
              const row = qtyMatrix.get(it.id) ?? Array.from({ length: groupCount }, () => '0')
              return (
                <Card key={it.id} className="flex flex-col gap-2 p-3">
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-body font-semibold text-ink">{it.item_name}</span>
                    <span className="font-mono text-caption text-ink-soft">
                      {t('pos.split.totalQtyHint', { qty: it.qty })}
                    </span>
                  </div>
                  <div className="flex flex-wrap gap-3">
                    {row.map((val, gIdx) => (
                      <div key={gIdx} className="flex items-center gap-1.5 rounded-card border border-line px-2 py-1">
                        <span className="text-caption font-semibold text-ink-soft">
                          {t('pos.split.billChip', { index: gIdx + 1 })}
                        </span>
                        <Button
                          type="button"
                          size="sm"
                          variant="ghost"
                          onClick={() => stepQtySplit(it.id, it.qty, gIdx, -1)}
                          aria-label={`${it.item_name} -`}
                        >
                          <Minus className="size-3.5" aria-hidden="true" />
                        </Button>
                        <span className="min-w-6 text-center font-mono text-body font-semibold tabular-nums">
                          {val}
                        </span>
                        <Button
                          type="button"
                          size="sm"
                          variant="ghost"
                          onClick={() => stepQtySplit(it.id, it.qty, gIdx, 1)}
                          aria-label={`${it.item_name} +`}
                        >
                          <Plus className="size-3.5" aria-hidden="true" />
                        </Button>
                      </div>
                    ))}
                  </div>
                </Card>
              )
            })}
          </div>
        ) : null}

        {previews.length > 0 ? (
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {previews.map((p) => (
              <Card key={p.label} className="flex flex-col gap-1 p-3">
                <span className="font-mono text-caption font-semibold text-ink-soft">{p.label}</span>
                <span className="font-mono text-h3 font-bold text-ink tabular-nums">
                  {formatMoney(p.grandTotal, locale)}
                </span>
                <span className="text-caption text-ink-soft">
                  {t('pos.split.cashRoundedHint', { amount: formatMoney(p.cashTotal, locale) })}
                </span>
              </Card>
            ))}
          </div>
        ) : null}

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
            disabled={!isValidSplit || submitting}
            loading={submitting}
            onClick={() => void handleConfirmSplit()}
          >
            {t('pos.split.confirmButton')}
          </Button>
        </div>
      </div>
    </PosWorkspaceShell>
  )
}
