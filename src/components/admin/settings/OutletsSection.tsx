import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useId, useState, type FormEvent } from 'react'
import { useTranslation } from 'react-i18next'
import {
  Button,
  Chip,
  CircleAlert,
  DataTable,
  Dialog,
  Field,
  Info,
  Input,
  PencilLine,
  Plus,
  Radio,
  Select,
  Store,
  Switch,
  useToast,
  type DataTableColumn,
} from '~/components/ui'
import { createOutletFn, updateOutletFn } from '~/functions/identity/org.fn'
import {
  createOutletSchema,
  updateOutletSchema,
  type OutletTimezoneValue,
  type OutletView,
  type PriceTaxMode,
  type TaxProfile,
} from '~/modules/identity/shared'
import { legalEntitiesQueryOptions, outletsQueryOptions } from '~/queries/identity.queries'
import { qk } from '~/queries/keys'

export interface OutletsSectionProps {
  tenantSlug: string
  canCreateOutlet: boolean
}

export function OutletsSection({ tenantSlug, canCreateOutlet }: OutletsSectionProps) {
  const { t } = useTranslation()
  const toast = useToast()
  const queryClient = useQueryClient()
  const formIdPrefix = useId()
  const { data: outlets = [], isLoading } = useQuery(outletsQueryOptions(tenantSlug))
  const { data: entities = [] } = useQuery(legalEntitiesQueryOptions(tenantSlug))

  const [dialogOpen, setDialogOpen] = useState(false)
  const [editing, setEditing] = useState<OutletView | null>(null)
  const [legalEntityId, setLegalEntityId] = useState('')
  const [code, setCode] = useState('')
  const [name, setName] = useState('')
  const [address, setAddress] = useState('')
  const [phone, setPhone] = useState('')
  const [timezone, setTimezone] = useState<OutletTimezoneValue>('Asia/Jakarta')
  const [dayCutoffTime, setDayCutoffTime] = useState('00:00')
  const [priceTaxMode, setPriceTaxMode] = useState<PriceTaxMode | ''>('')
  const [taxProfile, setTaxProfile] = useState<TaxProfile>('NONE')
  const [isActive, setIsActive] = useState(true)
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({})
  const [formError, setFormError] = useState<string | null>(null)

  const saveMutation = useMutation({
    retry: 0,
    mutationFn: async () => {
      if (editing) {
        return updateOutletFn({
          data: {
            id: editing.id,
            name: name.trim(),
            address: address.trim() || null,
            phone: phone.trim() || null,
            timezone,
            dayCutoffTime: dayCutoffTime.trim(),
            isActive,
          },
        })
      }
      return createOutletFn({
        data: {
          legalEntityId,
          code: code.trim(),
          name: name.trim(),
          address: address.trim() || null,
          phone: phone.trim() || null,
          timezone,
          dayCutoffTime: dayCutoffTime.trim(),
          priceTaxMode: priceTaxMode as PriceTaxMode,
          taxProfile,
        },
      })
    },
    onSuccess: (res) => {
      if (!res.ok) {
        setFormError(t(res.errorKey, { defaultValue: t('admin.settings.failed') }))
        return
      }
      void queryClient.invalidateQueries({ queryKey: qk.outlets(tenantSlug) })
      void queryClient.invalidateQueries({ queryKey: qk.registers(tenantSlug) })
      toast.show({ tone: 'success', message: t('admin.settings.saved') })
      setDialogOpen(false)
    },
    onError: () => {
      setFormError(t('admin.settings.failed'))
    },
  })

  function openCreate() {
    setEditing(null)
    setLegalEntityId(entities[0]?.id ?? '')
    setCode('')
    setName('')
    setAddress('')
    setPhone('')
    setTimezone('Asia/Jakarta')
    setDayCutoffTime('00:00')
    setPriceTaxMode('')
    setTaxProfile('NONE')
    setIsActive(true)
    setFieldErrors({})
    setFormError(null)
    setDialogOpen(true)
  }

  function openEdit(row: OutletView) {
    setEditing(row)
    setLegalEntityId(row.legalEntityId)
    setCode(row.code)
    setName(row.name)
    setAddress(row.address ?? '')
    setPhone(row.phone ?? '')
    setTimezone(row.timezone)
    setDayCutoffTime(row.dayCutoffTime)
    setPriceTaxMode(row.priceTaxMode)
    setTaxProfile(row.taxProfile)
    setIsActive(row.isActive)
    setFieldErrors({})
    setFormError(null)
    setDialogOpen(true)
  }

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setFormError(null)

    const schemaResult = editing
      ? updateOutletSchema.safeParse({
          id: editing.id,
          name: name.trim(),
          address: address.trim() || null,
          phone: phone.trim() || null,
          timezone,
          dayCutoffTime: dayCutoffTime.trim(),
          isActive,
        })
      : createOutletSchema.safeParse({
          legalEntityId,
          code: code.trim(),
          name: name.trim(),
          address: address.trim() || null,
          phone: phone.trim() || null,
          timezone,
          dayCutoffTime: dayCutoffTime.trim(),
          priceTaxMode: priceTaxMode || undefined,
          taxProfile,
        })

    if (!schemaResult.success) {
      const nextErrors: Record<string, string> = {}
      for (const issue of schemaResult.error.issues) {
        const key = String(issue.path[0] ?? 'form')
        if (!nextErrors[key]) {
          nextErrors[key] =
            key === 'code'
              ? t('admin.settings.outlet.codeInvalid')
              : t('admin.settings.failed')
        }
      }
      setFieldErrors(nextErrors)
      return
    }
    setFieldErrors({})
    saveMutation.mutate()
  }

  const timeSettingsChanged = Boolean(
    editing && (timezone !== editing.timezone || dayCutoffTime.trim() !== editing.dayCutoffTime),
  )

  const tzOptions = [
    { value: 'Asia/Jakarta', label: t('admin.settings.outlet.tzWib') },
    { value: 'Asia/Makassar', label: t('admin.settings.outlet.tzWita') },
    { value: 'Asia/Jayapura', label: t('admin.settings.outlet.tzWit') },
  ]

  const entityOptions = entities.map((e) => ({ value: e.id, label: e.name }))
  const taxProfileOptions = [
    { value: 'NONE', label: t('admin.settings.outlet.taxNone') },
    { value: 'PPN', label: t('admin.settings.outlet.taxPpn') },
    { value: 'PB1', label: t('admin.settings.outlet.taxPb1') },
  ]

  const columns: readonly DataTableColumn<OutletView>[] = [
    {
      id: 'code',
      header: t('admin.settings.outlet.colCode'),
      stickyFirst: true,
      sortValue: (row) => row.code,
      cell: (row) => <span className="font-mono font-semibold">{row.code}</span>,
    },
    {
      id: 'name',
      header: t('admin.settings.outlet.colName'),
      sortValue: (row) => row.name,
      cell: (row) => row.name,
    },
    {
      id: 'entity',
      header: t('admin.settings.outlet.colEntity'),
      cell: (row) => row.legalEntityName,
    },
    {
      id: 'timezone',
      header: t('admin.settings.outlet.colTimezone'),
      cell: (row) => row.timezone,
    },
    {
      id: 'cutoff',
      header: t('admin.settings.outlet.colCutoff'),
      numeric: true,
      cell: (row) => row.dayCutoffTime,
    },
    {
      id: 'tax',
      header: t('admin.settings.outlet.colTax'),
      cell: (row) => (
        <span className="inline-flex items-center rounded-md border border-line bg-surface-subtle px-2 py-0.5 text-label-sm font-medium text-ink">
          {row.taxProfile}
        </span>
      ),
    },
    {
      id: 'status',
      header: t('admin.settings.outlet.colStatus'),
      cell: (row) => (
        <Chip
          status={row.isActive ? 'active' : 'inactive'}
          label={row.isActive ? t('common.active') : t('common.inactive')}
          size="sm"
        />
      ),
    },
    {
      id: 'action',
      header: t('admin.settings.outlet.colAction'),
      align: 'right',
      hideOnMobileCard: true,
      cell: (row) => (
        <Button
          variant="ghost"
          size="md"
          leadingIcon={<PencilLine className="size-4" aria-hidden="true" />}
          onClick={() => openEdit(row)}
        >
          {t('common.edit')}
        </Button>
      ),
    },
  ]

  const entitySelectId = `${formIdPrefix}-out-entity`
  const codeId = `${formIdPrefix}-out-code`
  const nameId = `${formIdPrefix}-out-name`
  const tzId = `${formIdPrefix}-out-tz`
  const cutoffId = `${formIdPrefix}-out-cutoff`
  const taxModeId = `${formIdPrefix}-out-tax-mode`
  const taxProfileId = `${formIdPrefix}-out-tax-profile`
  const addressId = `${formIdPrefix}-out-address`
  const phoneId = `${formIdPrefix}-out-phone`

  return (
    <section aria-labelledby="outlets-heading" className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 id="outlets-heading" className="text-h2 font-semibold text-ink">
          {t('admin.settings.outlet.sectionTitle')}
        </h2>
        {canCreateOutlet ? (
          <Button
            variant="primary"
            size="md"
            leadingIcon={<Plus className="size-4" aria-hidden="true" />}
            disabled={entities.length === 0}
            onClick={openCreate}
          >
            {t('admin.settings.outlet.addButton')}
          </Button>
        ) : null}
      </div>

      <DataTable
        caption={t('admin.settings.outlet.sectionTitle')}
        columns={columns}
        rows={outlets}
        loading={isLoading}
        getRowKey={(r) => r.id}
        emptyIcon={<Store className="size-8" aria-hidden="true" />}
        emptyTitle={t('admin.settings.outlet.emptyTitle')}
        emptyDescription={t('admin.settings.outlet.emptyDesc')}
        mobileActions={(row) => (
          <Button variant="ghost" size="md" onClick={() => openEdit(row)}>
            {t('common.edit')}
          </Button>
        )}
      />

      <Dialog
        open={dialogOpen}
        onOpenChange={setDialogOpen}
        title={
          editing ? t('admin.settings.outlet.editTitle') : t('admin.settings.outlet.createTitle')
        }
        size="lg"
      >
        <form onSubmit={handleSubmit} className="flex flex-col gap-4">
          {formError ? (
            <div
              role="alert"
              className="flex items-start gap-2 rounded-control border border-danger-solid bg-danger-soft p-3 text-body-sm text-danger-ink"
            >
              <CircleAlert className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
              <span>{formError}</span>
            </div>
          ) : null}

          {timeSettingsChanged ? (
            <div className="flex items-start gap-2 rounded-control border border-info-line bg-info-soft p-3 text-body-sm text-info-ink">
              <Info className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
              <span>{t('admin.settings.outlet.nextTxBanner')}</span>
            </div>
          ) : null}

          <div className="grid gap-4 md:grid-cols-2">
            {!editing ? (
              <Field
                label={t('admin.settings.outlet.legalEntityLabel')}
                htmlFor={entitySelectId}
                error={fieldErrors.legalEntityId}
              >
                <Select
                  id={entitySelectId}
                  value={legalEntityId}
                  onValueChange={setLegalEntityId}
                  options={entityOptions}
                  placeholder={t('admin.settings.outlet.legalEntityPlaceholder')}
                  invalid={Boolean(fieldErrors.legalEntityId)}
                  size="md"
                />
              </Field>
            ) : null}

            <Field
              label={t('admin.settings.outlet.codeLabel')}
              htmlFor={codeId}
              hint={t('admin.settings.outlet.codeHint')}
              error={fieldErrors.code}
            >
              <Input
                id={codeId}
                controlSize="md"
                value={code}
                disabled={Boolean(editing)}
                invalid={Boolean(fieldErrors.code)}
                className="font-mono uppercase"
                onChange={(e) => setCode(e.target.value.toUpperCase())}
                maxLength={10}
              />
            </Field>

            <Field
              label={t('admin.settings.outlet.nameLabel')}
              htmlFor={nameId}
              error={fieldErrors.name}
            >
              <Input
                id={nameId}
                controlSize="md"
                value={name}
                invalid={Boolean(fieldErrors.name)}
                onChange={(e) => setName(e.target.value)}
                maxLength={120}
              />
            </Field>

            <Field label={t('admin.settings.outlet.timezoneLabel')} htmlFor={tzId}>
              <Select
                id={tzId}
                value={timezone}
                onValueChange={(v) => setTimezone(v as OutletTimezoneValue)}
                options={tzOptions}
                size="md"
              />
            </Field>

            <Field
              label={t('admin.settings.outlet.cutoffLabel')}
              htmlFor={cutoffId}
              error={fieldErrors.dayCutoffTime}
            >
              <Input
                id={cutoffId}
                controlSize="md"
                value={dayCutoffTime}
                invalid={Boolean(fieldErrors.dayCutoffTime)}
                className="font-mono tabular-nums"
                onChange={(e) => setDayCutoffTime(e.target.value)}
                maxLength={5}
              />
            </Field>

            {!editing ? (
              <>
                <Field
                  label={t('admin.settings.outlet.priceTaxModeLabel')}
                  htmlFor={taxModeId}
                  error={fieldErrors.priceTaxMode}
                >
                  <Radio
                    ariaLabel={t('admin.settings.outlet.priceTaxModeLabel')}
                    value={priceTaxMode}
                    onValueChange={(v) => setPriceTaxMode(v as PriceTaxMode)}
                    options={[
                      { value: 'INCLUSIVE', label: t('admin.settings.outlet.priceInclusive') },
                      { value: 'EXCLUSIVE', label: t('admin.settings.outlet.priceExclusive') },
                    ]}
                  />
                </Field>

                <Field label={t('admin.settings.outlet.taxProfileLabel')} htmlFor={taxProfileId}>
                  <Select
                    id={taxProfileId}
                    value={taxProfile}
                    onValueChange={(v) => setTaxProfile(v as TaxProfile)}
                    options={taxProfileOptions}
                    size="md"
                  />
                </Field>
              </>
            ) : null}

            <Field
              label={t('admin.settings.outlet.addressLabel')}
              htmlFor={addressId}
              error={fieldErrors.address}
            >
              <Input
                id={addressId}
                controlSize="md"
                value={address}
                invalid={Boolean(fieldErrors.address)}
                onChange={(e) => setAddress(e.target.value)}
                maxLength={400}
              />
            </Field>

            <Field
              label={t('admin.settings.outlet.phoneLabel')}
              htmlFor={phoneId}
              error={fieldErrors.phone}
            >
              <Input
                id={phoneId}
                controlSize="md"
                value={phone}
                invalid={Boolean(fieldErrors.phone)}
                onChange={(e) => setPhone(e.target.value)}
                maxLength={40}
              />
            </Field>
          </div>

          {editing ? (
            <div className="rounded-control border border-line bg-surface-subtle px-3 py-1">
              <Switch
                label={t('admin.settings.outlet.activeLabel')}
                checked={isActive}
                onCheckedChange={setIsActive}
              />
            </div>
          ) : null}

          <div className="flex justify-end gap-2 pt-2">
            <Button
              type="button"
              variant="secondary"
              size="md"
              onClick={() => setDialogOpen(false)}
            >
              {t('common.cancel')}
            </Button>
            <Button type="submit" variant="primary" size="md" loading={saveMutation.isPending}>
              {t('common.save')}
            </Button>
          </div>
        </form>
      </Dialog>
    </section>
  )
}
