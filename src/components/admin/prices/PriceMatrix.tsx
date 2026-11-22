import { useMutation, useQueryClient } from '@tanstack/react-query'
import { useId, useState } from 'react'
import { useTranslation } from 'react-i18next'
import {
  Button,
  Chip,
  Copy,
  Dialog,
  EmptyState,
  Field,
  Input,
  MoneyInput,
  Percent,
  Select,
  StickyFooter,
  Tag,
  useToast,
} from '~/components/ui'
import { savePricesFn } from '~/functions/catalog/catalog-write.fn'
import { increasePricePercent, type PriceMatrixResult } from '~/modules/catalog/shared'
import { qk } from '~/queries/keys'

export interface PriceMatrixProps {
  tenantSlug: string
  data: PriceMatrixResult
}

export function PriceMatrix({ tenantSlug, data }: PriceMatrixProps) {
  const { t } = useTranslation()
  const idPrefix = useId()
  const toast = useToast()
  const queryClient = useQueryClient()

  const [drafts, setDrafts] = useState<Record<string, number>>({})
  const [copyOpen, setCopyOpen] = useState(false)
  const [copyFrom, setCopyFrom] = useState<string>('DEFAULT')
  const [copyTo, setCopyTo] = useState<string>(data.outlets[0]?.id ?? '')
  const [incOpen, setIncOpen] = useState(false)
  const [incTarget, setIncTarget] = useState<string>(
    data.canEditDefault ? 'DEFAULT' : (data.outlets[0]?.id ?? ''),
  )
  const [incPercent, setIncPercent] = useState('5')
  const [mobileOutletId, setMobileOutletId] = useState<string>(
    data.canEditDefault ? 'DEFAULT' : (data.outlets[0]?.id ?? ''),
  )
  const [errorMsg, setErrorMsg] = useState<string | null>(null)

  const cellVal = (skuId: string, uomId: string, colKey: string, initial: number | null) => {
    const k = `${skuId}:${uomId}:${colKey}`
    return Object.hasOwn(drafts, k) ? drafts[k]! : initial
  }

  const setCell = (skuId: string, uomId: string, colKey: string, value: number | null) => {
    if (value === null) return
    setDrafts((prev) => ({ ...prev, [`${skuId}:${uomId}:${colKey}`]: value }))
  }

  const saveMut = useMutation({
    retry: 0,
    mutationFn: async () => {
      const entries = Object.entries(drafts).map(([k, price]) => {
        const [skuId, uomId, colKey] = k.split(':')
        return {
          skuId: skuId!,
          uomId: uomId!,
          outletId: colKey === 'DEFAULT' ? null : colKey!,
          price,
        }
      })
      return savePricesFn({ data: { entries } })
    },
    onSuccess: (res) => {
      if (!res.ok) {
        setErrorMsg(t(res.errorKey as never))
        return
      }
      setErrorMsg(null)
      setDrafts({})
      queryClient.invalidateQueries({ queryKey: qk.priceMatrix(tenantSlug) })
      toast.show({ tone: 'success', message: t('admin.prices.saved') })
    },
    onError: (err) => setErrorMsg(err.message),
  })

  function applyCopy() {
    if (!copyTo || copyTo === copyFrom) {
      setCopyOpen(false)
      return
    }
    const next = { ...drafts }
    for (const row of data.rows) {
      const srcVal =
        copyFrom === 'DEFAULT'
          ? cellVal(row.skuId, row.uomId, 'DEFAULT', row.defaultPrice)
          : cellVal(row.skuId, row.uomId, copyFrom, row.outletPrices[copyFrom] ?? null)
      if (srcVal !== null) {
        next[`${row.skuId}:${row.uomId}:${copyTo}`] = srcVal
      }
    }
    setDrafts(next)
    setCopyOpen(false)
  }

  function applyPercent() {
    if (!incTarget) {
      setIncOpen(false)
      return
    }
    const next = { ...drafts }
    for (const row of data.rows) {
      const base =
        incTarget === 'DEFAULT'
          ? cellVal(row.skuId, row.uomId, 'DEFAULT', row.defaultPrice)
          : cellVal(row.skuId, row.uomId, incTarget, row.outletPrices[incTarget] ?? null)
      if (base !== null) {
        try {
          next[`${row.skuId}:${row.uomId}:${incTarget}`] = increasePricePercent(base, incPercent)
        } catch {
          setErrorMsg(t('admin.prices.increasePercentLabel'))
          return
        }
      }
    }
    setDrafts(next)
    setIncOpen(false)
  }

  const dirtyCount = Object.keys(drafts).length
  const targetOptions = [
    ...(data.canEditDefault
      ? [{ value: 'DEFAULT', label: t('admin.prices.copyDefaultSource') }]
      : []),
    ...data.outlets.map((o) => ({ value: o.id, label: o.name })),
  ]

  if (data.rows.length === 0) {
    return (
      <EmptyState
        icon={<Tag className="size-10" />}
        title={t('admin.prices.emptyTitle')}
        description={t('admin.prices.emptyDesc')}
      />
    )
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-body text-ink-soft">{t('admin.prices.auditNote')}</p>
        <div className="flex flex-wrap items-center gap-2">
          <Button type="button" size="sm" variant="secondary" onClick={() => setCopyOpen(true)}>
            <Copy className="size-4" />
            {t('admin.prices.copyFromAction')}
          </Button>
          <Button type="button" size="sm" variant="secondary" onClick={() => setIncOpen(true)}>
            <Percent className="size-4" />
            {t('admin.prices.increasePercentAction')}
          </Button>
        </div>
      </div>

      {errorMsg ? (
        <p role="alert" className="text-body text-danger-ink">
          {errorMsg}
        </p>
      ) : null}

      {/* Mobile: select one outlet first */}
      <div className="flex flex-col gap-3 md:hidden">
        <Field label={t('admin.prices.mobileOutletLabel')} htmlFor={`${idPrefix}-mobile-outlet`}>
          <Select
            id={`${idPrefix}-mobile-outlet`}
            value={mobileOutletId}
            onValueChange={setMobileOutletId}
            options={targetOptions}
          />
        </Field>
        {data.rows.map((r) => {
          const initial =
            mobileOutletId === 'DEFAULT' ? r.defaultPrice : (r.outletPrices[mobileOutletId] ?? null)
          const current = cellVal(r.skuId, r.uomId, mobileOutletId, initial)
          const isDirty = Object.hasOwn(drafts, `${r.skuId}:${r.uomId}:${mobileOutletId}`)
          const editable = mobileOutletId !== 'DEFAULT' || data.canEditDefault
          return (
            <div
              key={`${r.skuId}:${r.uomId}`}
              className="flex flex-col gap-2 rounded-md border border-line bg-surface p-3"
            >
              <div className="flex items-center justify-between gap-2">
                <div>
                  <p className="font-medium text-ink">{r.productName}</p>
                  <p className="font-mono text-caption text-ink-soft">
                    {r.skuCode} · {r.uomCode}
                  </p>
                </div>
                {current === null && r.defaultPrice === null && !r.isOpenPrice ? (
                  <Chip status="stock_estimate_low" label={t('admin.prices.unsetChip')} />
                ) : null}
              </div>
              <MoneyInput
                value={current}
                dirty={isDirty}
                disabled={!editable || saveMut.isPending}
                ariaLabel={`${r.skuCode} ${r.uomCode}`}
                onChange={(v) => setCell(r.skuId, r.uomId, mobileOutletId, v)}
              />
            </div>
          )
        })}
      </div>

      {/* Desktop matrix */}
      <div className="hidden overflow-x-auto rounded-md border border-line bg-surface md:block">
        <table className="w-full text-left text-body">
          <thead className="border-b border-line bg-surface-sunken text-caption font-semibold text-ink-soft">
            <tr>
              <th className="sticky left-0 bg-surface-sunken px-4 py-3">{t('admin.prices.colItem')}</th>
              <th className="px-4 py-3">{t('admin.prices.colUom')}</th>
              <th className="px-4 py-3">{t('admin.prices.colDefault')}</th>
              {data.outlets.map((o) => (
                <th key={o.id} className="px-4 py-3">
                  {o.name}
                </th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-line">
            {data.rows.map((r) => {
              const defVal = cellVal(r.skuId, r.uomId, 'DEFAULT', r.defaultPrice)
              const defDirty = Object.hasOwn(drafts, `${r.skuId}:${r.uomId}:DEFAULT`)
              return (
                <tr key={`${r.skuId}:${r.uomId}`} className="align-top">
                  <td className="sticky left-0 bg-surface px-4 py-2">
                    <p className="font-medium text-ink">{r.productName}</p>
                    <p className="font-mono text-caption text-ink-soft">
                      {r.skuCode}
                      {r.variantLabel ? ` · ${r.variantLabel}` : ''}
                    </p>
                  </td>
                  <td className="px-4 py-2 font-mono text-ink-soft">{r.uomCode}</td>
                  <td className="px-4 py-2">
                    <div className="flex flex-col gap-1">
                      <MoneyInput
                        value={defVal}
                        dirty={defDirty}
                        disabled={!data.canEditDefault || saveMut.isPending}
                        ariaLabel={`${t('admin.prices.colDefault')} ${r.skuCode} ${r.uomCode}`}
                        onChange={(v) => setCell(r.skuId, r.uomId, 'DEFAULT', v)}
                      />
                      {defVal === null && !r.isOpenPrice ? (
                        <Chip
                          status="stock_estimate_low"
                          size="sm"
                          label={t('admin.prices.unsetChip')}
                          className="self-start"
                        />
                      ) : null}
                    </div>
                  </td>
                  {data.outlets.map((o) => {
                    const oVal = cellVal(
                      r.skuId,
                      r.uomId,
                      o.id,
                      r.outletPrices[o.id] ?? null,
                    )
                    const oDirty = Object.hasOwn(drafts, `${r.skuId}:${r.uomId}:${o.id}`)
                    return (
                      <td key={o.id} className="px-4 py-2">
                        <MoneyInput
                          value={oVal}
                          dirty={oDirty}
                          disabled={saveMut.isPending}
                          ariaLabel={`${o.name} ${r.skuCode} ${r.uomCode}`}
                          onChange={(v) => setCell(r.skuId, r.uomId, o.id, v)}
                        />
                      </td>
                    )
                  })}
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>

      {dirtyCount > 0 ? (
        <StickyFooter
          message={t('admin.prices.dirtySummary', { count: dirtyCount })}
          actions={
            <>
              <Button
                type="button"
                variant="secondary"
                disabled={saveMut.isPending}
                onClick={() => setDrafts({})}
              >
                {t('admin.prices.discard')}
              </Button>
              <Button type="button" loading={saveMut.isPending} onClick={() => saveMut.mutate()}>
                {t('admin.prices.saveAll')}
              </Button>
            </>
          }
        />
      ) : null}

      <Dialog open={copyOpen} onOpenChange={setCopyOpen} title={t('admin.prices.copyDialogTitle')}>
        <div className="flex flex-col gap-3">
          <Field label={t('admin.prices.copySourceLabel')} htmlFor={`${idPrefix}-copy-source`}>
            <Select
              id={`${idPrefix}-copy-source`}
              value={copyFrom}
              onValueChange={setCopyFrom}
              options={targetOptions}
            />
          </Field>
          <Field label={t('admin.prices.copyTargetLabel')} htmlFor={`${idPrefix}-copy-target`}>
            <Select
              id={`${idPrefix}-copy-target`}
              value={copyTo}
              onValueChange={setCopyTo}
              options={targetOptions.filter((o) => o.value !== copyFrom)}
            />
          </Field>
          <div className="flex justify-end gap-2">
            <Button type="button" variant="secondary" onClick={() => setCopyOpen(false)}>
              {t('common.cancel')}
            </Button>
            <Button type="button" onClick={applyCopy}>
              {t('admin.prices.copyApply')}
            </Button>
          </div>
        </div>
      </Dialog>

      <Dialog
        open={incOpen}
        onOpenChange={setIncOpen}
        title={t('admin.prices.increaseDialogTitle')}
      >
        <div className="flex flex-col gap-3">
          <Field label={t('admin.prices.increaseTargetLabel')} htmlFor={`${idPrefix}-inc-target`}>
            <Select
              id={`${idPrefix}-inc-target`}
              value={incTarget}
              onValueChange={setIncTarget}
              options={targetOptions}
            />
          </Field>
          <Field label={t('admin.prices.increasePercentLabel')} htmlFor={`${idPrefix}-inc-pct`}>
            <Input
              id={`${idPrefix}-inc-pct`}
              value={incPercent}
              onChange={(e) => setIncPercent(e.target.value)}
            />
          </Field>
          <div className="flex justify-end gap-2">
            <Button type="button" variant="secondary" onClick={() => setIncOpen(false)}>
              {t('common.cancel')}
            </Button>
            <Button type="button" onClick={applyPercent}>
              {t('admin.prices.increaseApply')}
            </Button>
          </div>
        </div>
      </Dialog>
    </div>
  )
}
