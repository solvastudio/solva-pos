import { useEffect, useId, useState } from 'react'
import { useTranslation } from 'react-i18next'
import {
  Button,
  Card,
  DataTable,
  Dialog,
  Field,
  Input,
  Select,
  Switch,
  type DataTableColumn,
} from '~/components/ui'
import type {
  AddTaxRateInput,
  OutletTaxSettingsView,
  TaxRateHistoryView,
  UpdateOutletTaxSettingsInput,
} from '~/modules/identity/shared'

export interface TaxSettingsSectionProps {
  readonly tax: OutletTaxSettingsView
  readonly taxRates: readonly TaxRateHistoryView[]
  readonly isPending?: boolean
  readonly onSaveTaxSettings: (input: UpdateOutletTaxSettingsInput) => Promise<void>
  readonly onAddTaxRate: (input: AddTaxRateInput) => Promise<void>
}

export function TaxSettingsSection({
  tax,
  taxRates,
  isPending = false,
  onSaveTaxSettings,
  onAddTaxRate,
}: TaxSettingsSectionProps) {
  const { t } = useTranslation()
  const idPrefix = useId()

  const [taxProfile, setTaxProfile] = useState<'NONE' | 'PPN' | 'PB1'>(tax.taxProfile)
  const [priceTaxMode, setPriceTaxMode] = useState<'INCLUSIVE' | 'EXCLUSIVE'>(tax.priceTaxMode)
  const [cashRoundingUnit, setCashRoundingUnit] = useState<0 | 100 | 500 | 1000>(
    tax.cashRoundingUnit,
  )
  const [serviceChargeEnabled, setServiceChargeEnabled] = useState(tax.serviceChargeEnabled)
  const [serviceChargeRate, setServiceChargeRate] = useState(tax.serviceChargeRate)
  const [serviceChargeTaxable, setServiceChargeTaxable] = useState(tax.serviceChargeTaxable)

  const [addRateOpen, setAddRateOpen] = useState(false)
  const [newTaxCode, setNewTaxCode] = useState<'PPN' | 'PB1'>('PPN')
  const [newTaxScope, setNewTaxScope] = useState<'OUTLET' | 'GLOBAL'>('OUTLET')
  const [newTaxRate, setNewTaxRate] = useState('11.0000')
  const [newEffectiveFrom, setNewEffectiveFrom] = useState(() => {
    const tomorrow = new Date(Date.now() + 86_400_000)
    return tomorrow.toISOString().slice(0, 10)
  })

  useEffect(() => {
    setTaxProfile(tax.taxProfile)
    setPriceTaxMode(tax.priceTaxMode)
    setCashRoundingUnit(tax.cashRoundingUnit)
    setServiceChargeEnabled(tax.serviceChargeEnabled)
    setServiceChargeRate(tax.serviceChargeRate)
    setServiceChargeTaxable(tax.serviceChargeTaxable)
  }, [tax])

  const columns: readonly DataTableColumn<TaxRateHistoryView>[] = [
    {
      id: 'taxCode',
      header: t('admin.settings.tax.colCode'),
      cell: (row) => <span className="font-mono font-semibold text-ink">{row.taxCode}</span>,
    },
    {
      id: 'scope',
      header: t('admin.settings.tax.colScope'),
      cell: (row) => (
        <span className="text-body-sm text-ink">
          {row.outletId ? t('admin.settings.tax.scopeOutlet') : t('admin.settings.tax.scopeGlobal')}
        </span>
      ),
    },
    {
      id: 'effectiveFrom',
      header: t('admin.settings.tax.colEffectiveFrom'),
      cell: (row) => <span className="font-mono text-caption text-ink">{row.effectiveFrom}</span>,
    },
    {
      id: 'rate',
      header: t('admin.settings.tax.colRate'),
      align: 'right',
      numeric: true,
      cell: (row) => <span className="font-mono text-body-sm text-ink">{row.rate}</span>,
    },
  ]

  const handleSave = async (event: React.FormEvent) => {
    event.preventDefault()
    await onSaveTaxSettings({
      outletId: tax.outletId,
      taxProfile,
      priceTaxMode,
      cashRoundingUnit,
      serviceChargeEnabled,
      serviceChargeRate,
      serviceChargeTaxable,
    })
  }

  const handleAddRate = async (event: React.FormEvent) => {
    event.preventDefault()
    await onAddTaxRate({
      outletId: newTaxScope === 'OUTLET' ? tax.outletId : null,
      taxCode: newTaxCode,
      rate: newTaxRate,
      effectiveFrom: newEffectiveFrom,
    })
    setAddRateOpen(false)
  }

  return (
    <div className="flex flex-col gap-6">
      <div className="rounded-control border border-info-border bg-info-soft p-4 text-body-sm text-info-ink">
        <p className="font-medium">{t('admin.settings.tax.nextTxBanner')}</p>
        <p className="mt-1 text-caption">{t('admin.settings.tax.rsk06Help')}</p>
      </div>

      {!tax.legalEntityIsPkp ? (
        <div
          role="alert"
          className="rounded-control border border-warning-border bg-warning-soft p-4 text-body-sm text-warning-ink"
        >
          {t('admin.settings.tax.ppnRequiresPkpWarning')}
        </div>
      ) : null}

      <Card className="p-5">
        <form onSubmit={(e) => void handleSave(e)} className="flex flex-col gap-5">
          <div className="border-b border-line pb-3">
            <h2 className="text-h2 font-semibold text-ink">
              {t('admin.settings.tax.sectionTitle')}
            </h2>
          </div>

          <div className="grid gap-4 md:grid-cols-3">
            <Field
              label={t('admin.settings.tax.taxProfileLabel')}
              htmlFor={`${idPrefix}-tax-profile`}
            >
              <Select
                id={`${idPrefix}-tax-profile`}
                value={taxProfile}
                onValueChange={(v) => setTaxProfile(v as 'NONE' | 'PPN' | 'PB1')}
                options={[
                  { value: 'NONE', label: t('admin.settings.tax.profileNONE') },
                  ...(tax.legalEntityIsPkp || taxProfile === 'PPN'
                    ? [{ value: 'PPN', label: t('admin.settings.tax.profilePPN') }]
                    : []),
                  { value: 'PB1', label: t('admin.settings.tax.profilePB1') },
                ]}
              />
            </Field>

            <Field
              label={t('admin.settings.tax.priceTaxModeLabel')}
              htmlFor={`${idPrefix}-price-mode`}
            >
              <Select
                id={`${idPrefix}-price-mode`}
                value={priceTaxMode}
                onValueChange={(v) => setPriceTaxMode(v as 'INCLUSIVE' | 'EXCLUSIVE')}
                options={[
                  { value: 'EXCLUSIVE', label: t('admin.settings.tax.modeEXCLUSIVE') },
                  { value: 'INCLUSIVE', label: t('admin.settings.tax.modeINCLUSIVE') },
                ]}
              />
            </Field>

            <Field
              label={t('admin.settings.tax.roundingLabel')}
              htmlFor={`${idPrefix}-rounding`}
            >
              <Select
                id={`${idPrefix}-rounding`}
                value={String(cashRoundingUnit)}
                onValueChange={(v) => setCashRoundingUnit(Number(v) as 0 | 100 | 500 | 1000)}
                options={[
                  { value: '0', label: t('admin.settings.tax.rounding0') },
                  { value: '100', label: t('admin.settings.tax.rounding100') },
                  { value: '500', label: t('admin.settings.tax.rounding500') },
                  { value: '1000', label: t('admin.settings.tax.rounding1000') },
                ]}
              />
            </Field>
          </div>

          <div className="grid gap-4 border-t border-line pt-4 md:grid-cols-3">
            <div className="flex items-center pt-2">
              <Switch
                id={`${idPrefix}-sc-enabled`}
                checked={serviceChargeEnabled}
                onCheckedChange={setServiceChargeEnabled}
                label={t('admin.settings.tax.serviceChargeEnabledLabel')}
              />
            </div>

            <Field
              label={t('admin.settings.tax.serviceChargeRateLabel')}
              htmlFor={`${idPrefix}-sc-rate`}
            >
              <Input
                id={`${idPrefix}-sc-rate`}
                value={serviceChargeRate}
                onChange={(e) => setServiceChargeRate(e.target.value)}
                disabled={!serviceChargeEnabled}
              />
            </Field>

            <div className="flex items-center pt-2">
              <Switch
                id={`${idPrefix}-sc-taxable`}
                checked={serviceChargeTaxable}
                onCheckedChange={setServiceChargeTaxable}
                disabled={!serviceChargeEnabled}
                label={t('admin.settings.tax.serviceChargeTaxableLabel')}
              />
            </div>
          </div>

          <div className="flex justify-end">
            <Button type="submit" variant="primary" loading={isPending}>
              {t('admin.settings.tax.saveButton')}
            </Button>
          </div>
        </form>
      </Card>

      <Card className="flex flex-col gap-4 p-5">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h3 className="text-h3 font-semibold text-ink">
              {t('admin.settings.tax.ratesHeading')}
            </h3>
            <p className="text-caption text-ink-soft">{t('admin.settings.tax.ratesHint')}</p>
          </div>
          <Button variant="secondary" size="sm" onClick={() => setAddRateOpen(true)}>
            {t('admin.settings.tax.addRateButton')}
          </Button>
        </div>

        <DataTable
          caption={t('admin.settings.tax.ratesHeading')}
          columns={columns}
          rows={taxRates}
          getRowKey={(r) => r.id}
          emptyTitle={t('admin.settings.tax.ratesHeading')}
        />
      </Card>

      <Dialog
        open={addRateOpen}
        onOpenChange={setAddRateOpen}
        title={t('admin.settings.tax.addRateButton')}
        footer={
          <>
            <Button variant="ghost" onClick={() => setAddRateOpen(false)}>
              {t('common.cancel')}
            </Button>
            <Button
              variant="primary"
              loading={isPending}
              onClick={(e) => void handleAddRate(e)}
            >
              {t('common.save')}
            </Button>
          </>
        }
      >
        <form onSubmit={(e) => void handleAddRate(e)} className="flex flex-col gap-4">
          <Field label={t('admin.settings.tax.taxCodeLabel')} htmlFor={`${idPrefix}-new-code`}>
            <Select
              id={`${idPrefix}-new-code`}
              value={newTaxCode}
              onValueChange={(v) => setNewTaxCode(v as 'PPN' | 'PB1')}
              options={[
                { value: 'PPN', label: t('admin.settings.tax.profilePPN') },
                { value: 'PB1', label: t('admin.settings.tax.profilePB1') },
              ]}
            />
          </Field>

          <Field label={t('admin.settings.tax.scopeLabel')} htmlFor={`${idPrefix}-new-scope`}>
            <Select
              id={`${idPrefix}-new-scope`}
              value={newTaxScope}
              onValueChange={(v) => setNewTaxScope(v as 'OUTLET' | 'GLOBAL')}
              options={[
                { value: 'OUTLET', label: t('admin.settings.tax.scopeOutlet') },
                { value: 'GLOBAL', label: t('admin.settings.tax.scopeGlobal') },
              ]}
            />
          </Field>

          <Field label={t('admin.settings.tax.ratePctLabel')} htmlFor={`${idPrefix}-new-rate`}>
            <Input
              id={`${idPrefix}-new-rate`}
              value={newTaxRate}
              onChange={(e) => setNewTaxRate(e.target.value)}
            />
          </Field>

          <Field
            label={t('admin.settings.tax.effectiveFromLabel')}
            htmlFor={`${idPrefix}-new-effective`}
          >
            <Input
              id={`${idPrefix}-new-effective`}
              type="date"
              value={newEffectiveFrom}
              onChange={(e) => setNewEffectiveFrom(e.target.value)}
            />
          </Field>
        </form>
      </Dialog>
    </div>
  )
}
