import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useId, useMemo, useState, type FormEvent } from 'react'
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
  Printer,
  Segmented,
  Select,
  Switch,
  useToast,
  type DataTableColumn,
} from '~/components/ui'
import {
  changeInvoicePrefixFn,
  createRegisterFn,
  updateRegisterFn,
} from '~/functions/identity/register.fn'
import { validateInvoicePrefix } from '~/lib/kernel'
import {
  formatPeriodMmYy,
  nextMonthFirstDay,
  previewInvoiceNumbers,
  suggestPrefix,
  type PaperWidthMm,
  type RegisterType,
  type RegisterView,
} from '~/modules/identity/shared'
import { outletsQueryOptions, registersQueryOptions } from '~/queries/identity.queries'
import { qk } from '~/queries/keys'

export interface RegistersTabProps {
  tenantSlug: string
}

const LOCALE_FOLLOW_OUTLET = '__FOLLOW__'

export function RegistersTab({ tenantSlug }: RegistersTabProps) {
  const { t } = useTranslation()
  const toast = useToast()
  const queryClient = useQueryClient()
  const formIdPrefix = useId()

  const { data: registers = [], isLoading } = useQuery(registersQueryOptions(tenantSlug))
  const { data: outlets = [] } = useQuery(outletsQueryOptions(tenantSlug))

  const todayYmd = useMemo(() => new Date().toISOString().slice(0, 10), [])
  const nextMonthMmYy = useMemo(() => formatPeriodMmYy(nextMonthFirstDay(todayYmd)), [todayYmd])

  const [createOpen, setCreateOpen] = useState(false)
  const [outletId, setOutletId] = useState('')
  const [code, setCode] = useState('')
  const [name, setName] = useState('')
  const [registerType, setRegisterType] = useState<RegisterType>('CASHIER')
  const [invoicePrefix, setInvoicePrefix] = useState('')
  const [prefixTouched, setPrefixTouched] = useState(false)
  const [paperWidthMm, setPaperWidthMm] = useState<PaperWidthMm>(80)
  const [defaultLocale, setDefaultLocale] = useState<string>(LOCALE_FOLLOW_OUTLET)
  const [createFieldErrors, setCreateFieldErrors] = useState<Record<string, string>>({})
  const [createError, setCreateError] = useState<string | null>(null)

  const [editing, setEditing] = useState<RegisterView | null>(null)
  const [editName, setEditName] = useState('')
  const [editActive, setEditActive] = useState(true)
  const [editPaper, setEditPaper] = useState<PaperWidthMm>(80)
  const [editLocale, setEditLocale] = useState<string>(LOCALE_FOLLOW_OUTLET)
  const [editFieldErrors, setEditFieldErrors] = useState<Record<string, string>>({})
  const [editError, setEditError] = useState<string | null>(null)

  const [prefixTarget, setPrefixTarget] = useState<RegisterView | null>(null)
  const [nextPrefixInput, setNextPrefixInput] = useState('')
  const [prefixError, setPrefixError] = useState<string | null>(null)

  const createMutation = useMutation({
    retry: 0,
    mutationFn: () =>
      createRegisterFn({
        data: {
          outletId,
          code: code.trim(),
          name: name.trim(),
          registerType,
          invoicePrefix: registerType === 'CASHIER' ? invoicePrefix.trim() : null,
          paperWidthMm,
          defaultLocale:
            defaultLocale === LOCALE_FOLLOW_OUTLET
              ? null
              : (defaultLocale as 'id-ID' | 'en-US'),
        },
      }),
    onSuccess: (res) => {
      if (!res.ok) {
        setCreateError(t(res.errorKey, { defaultValue: t('admin.users.failed') }))
        return
      }
      void queryClient.invalidateQueries({ queryKey: qk.registers(tenantSlug) })
      toast.show({ tone: 'success', message: t('admin.users.saved') })
      setCreateOpen(false)
    },
    onError: () => {
      setCreateError(t('admin.users.failed'))
    },
  })

  const editMutation = useMutation({
    retry: 0,
    mutationFn: () =>
      updateRegisterFn({
        data: {
          id: editing!.id,
          name: editName.trim(),
          status: editActive ? 'ACTIVE' : 'INACTIVE',
          paperWidthMm: editPaper,
          defaultLocale:
            editLocale === LOCALE_FOLLOW_OUTLET ? null : (editLocale as 'id-ID' | 'en-US'),
        },
      }),
    onSuccess: (res) => {
      if (!res.ok) {
        setEditError(t(res.errorKey, { defaultValue: t('admin.users.failed') }))
        return
      }
      void queryClient.invalidateQueries({ queryKey: qk.registers(tenantSlug) })
      toast.show({ tone: 'success', message: t('admin.users.saved') })
      setEditing(null)
    },
    onError: () => {
      setEditError(t('admin.users.failed'))
    },
  })

  const changePrefixMutation = useMutation({
    retry: 0,
    mutationFn: () =>
      changeInvoicePrefixFn({
        data: {
          registerId: prefixTarget!.id,
          newPrefix: nextPrefixInput.trim(),
        },
      }),
    onSuccess: (res) => {
      if (!res.ok) {
        setPrefixError(t(res.errorKey, { defaultValue: t('admin.users.failed') }))
        return
      }
      void queryClient.invalidateQueries({ queryKey: qk.registers(tenantSlug) })
      toast.show({ tone: 'success', message: t('admin.users.saved') })
      setPrefixTarget(null)
    },
    onError: () => {
      setPrefixError(t('admin.users.failed'))
    },
  })

  function openCreateDialog() {
    const firstOutlet = outlets[0]
    setOutletId(firstOutlet?.id ?? '')
    setCode('')
    setName('')
    setRegisterType('CASHIER')
    setInvoicePrefix(firstOutlet ? suggestPrefix(firstOutlet.code, 'POS01') : '')
    setPrefixTouched(false)
    setPaperWidthMm(80)
    setDefaultLocale(LOCALE_FOLLOW_OUTLET)
    setCreateFieldErrors({})
    setCreateError(null)
    setCreateOpen(true)
  }

  function handleCodeChange(nextCodeRaw: string) {
    const clean = nextCodeRaw.toUpperCase()
    setCode(clean)
    if (!prefixTouched && registerType === 'CASHIER') {
      const selectedOutlet = outlets.find((o) => o.id === outletId)
      if (selectedOutlet && clean) {
        setInvoicePrefix(suggestPrefix(selectedOutlet.code, clean))
      }
    }
  }

  function handleOutletChange(nextOutletId: string) {
    setOutletId(nextOutletId)
    if (!prefixTouched && registerType === 'CASHIER') {
      const selectedOutlet = outlets.find((o) => o.id === nextOutletId)
      if (selectedOutlet && code) {
        setInvoicePrefix(suggestPrefix(selectedOutlet.code, code))
      }
    }
  }

  function openEditDialog(row: RegisterView) {
    setEditing(row)
    setEditName(row.name)
    setEditActive(row.status === 'ACTIVE')
    setEditPaper(row.paperWidthMm)
    setEditLocale(row.defaultLocale ?? LOCALE_FOLLOW_OUTLET)
    setEditFieldErrors({})
    setEditError(null)
  }

  function openChangePrefixDialog(row: RegisterView) {
    setPrefixTarget(row)
    setNextPrefixInput(row.pendingNextPrefix?.invoicePrefix ?? row.currentPrefix ?? '')
    setPrefixError(null)
  }

  function clearCreateFieldError(field: string) {
    setCreateFieldErrors((prev) => {
      if (!prev[field]) return prev
      const copy = { ...prev }
      delete copy[field]
      return copy
    })
  }

  function handleCreateSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault()
    setCreateError(null)
    const nextErrors: Record<string, string> = {}
    if (!outletId) {
      nextErrors.outletId = t('validation.selectRequired', {
        field: t('admin.users.register.outletLabel'),
      })
    }
    if (!/^[A-Z0-9]{1,10}$/.test(code.trim())) {
      nextErrors.code = t('admin.users.register.codeHint')
    }
    if (!name.trim()) {
      nextErrors.name = t('validation.fieldRequired', {
        field: t('admin.users.register.nameLabel'),
      })
    }
    if (registerType === 'CASHIER') {
      const cleanPrefix = invoicePrefix.trim()
      if (!cleanPrefix) {
        nextErrors.invoicePrefix = t('admin.users.register.prefixRequired')
      } else if (!validateInvoicePrefix(cleanPrefix).ok) {
        nextErrors.invoicePrefix = t('admin.users.register.prefixInvalid')
      }
    }
    if (Object.keys(nextErrors).length > 0) {
      setCreateFieldErrors(nextErrors)
      return
    }
    setCreateFieldErrors({})
    createMutation.mutate()
  }

  function handleEditSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault()
    setEditError(null)
    if (!editName.trim()) {
      setEditFieldErrors({
        name: t('validation.fieldRequired', { field: t('admin.users.register.nameLabel') }),
      })
      return
    }
    setEditFieldErrors({})
    editMutation.mutate()
  }

  function handleChangePrefixSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault()
    const clean = nextPrefixInput.trim()
    if (!validateInvoicePrefix(clean).ok) {
      setPrefixError(t('admin.users.register.prefixInvalid'))
      return
    }
    setPrefixError(null)
    changePrefixMutation.mutate()
  }

  const createPreview = useMemo(() => {
    const clean = invoicePrefix.trim()
    if (registerType !== 'CASHIER' || !validateInvoicePrefix(clean).ok) return null
    return previewInvoiceNumbers(clean, todayYmd)
  }, [invoicePrefix, registerType, todayYmd])

  const changePrefixPreview = useMemo(() => {
    const clean = nextPrefixInput.trim()
    if (!validateInvoicePrefix(clean).ok) return null
    return previewInvoiceNumbers(clean, todayYmd)
  }, [nextPrefixInput, todayYmd])

  const localeOptions = [
    { value: LOCALE_FOLLOW_OUTLET, label: t('admin.users.register.localeDefault') },
    { value: 'id-ID', label: t('sys.lang.id') },
    { value: 'en-US', label: t('sys.lang.en') },
  ]

  const columns: readonly DataTableColumn<RegisterView>[] = [
    {
      id: 'code',
      header: t('admin.users.register.colCode'),
      stickyFirst: true,
      sortValue: (r) => r.code,
      cell: (r) => <span className="font-mono font-semibold">{r.code}</span>,
    },
    {
      id: 'name',
      header: t('admin.users.register.colName'),
      sortValue: (r) => r.name,
      cell: (r) => r.name,
    },
    {
      id: 'outlet',
      header: t('admin.users.register.colOutlet'),
      cell: (r) => `${r.outletCode} · ${r.outletName}`,
    },
    {
      id: 'type',
      header: t('admin.users.register.colType'),
      cell: (r) => (
        <span className="inline-flex items-center rounded-md border border-line bg-surface-subtle px-2 py-0.5 text-label-sm font-medium text-ink">
          {t(`admin.users.register.type${r.registerType}`)}
        </span>
      ),
    },
    {
      id: 'prefix',
      header: t('admin.users.register.colPrefix'),
      cell: (r) =>
        r.currentPrefix ? (
          <div className="flex flex-col gap-0.5">
            <span className="font-mono">{r.currentPrefix}</span>
            {r.pendingNextPrefix ? (
              <span className="font-mono text-caption text-ink-soft">
                {t('admin.users.register.nextPrefixScheduled', {
                  month: formatPeriodMmYy(r.pendingNextPrefix.effectiveMonth),
                  prefix: r.pendingNextPrefix.invoicePrefix,
                })}
              </span>
            ) : null}
          </div>
        ) : (
          t('common.dash')
        ),
    },
    {
      id: 'paper',
      header: t('admin.users.register.colPaper'),
      numeric: true,
      cell: (r) => t(`admin.users.register.paper${r.paperWidthMm}`),
    },
    {
      id: 'status',
      header: t('admin.users.register.colStatus'),
      cell: (r) => (
        <Chip
          status={r.status === 'ACTIVE' ? 'active' : 'inactive'}
          label={r.status === 'ACTIVE' ? t('common.active') : t('common.inactive')}
          size="sm"
        />
      ),
    },
    {
      id: 'action',
      header: t('admin.users.register.colAction'),
      align: 'right',
      hideOnMobileCard: true,
      cell: (r) => (
        <div className="flex items-center justify-end gap-1">
          <Button
            variant="ghost"
            size="md"
            leadingIcon={<PencilLine className="size-4" aria-hidden="true" />}
            onClick={() => openEditDialog(r)}
          >
            {t('common.edit')}
          </Button>
          {r.registerType === 'CASHIER' ? (
            <Button variant="secondary" size="md" onClick={() => openChangePrefixDialog(r)}>
              {t('admin.users.register.changePrefix')}
            </Button>
          ) : null}
        </div>
      ),
    },
  ]

  const createOutletId = `${formIdPrefix}-reg-outlet`
  const createCodeId = `${formIdPrefix}-reg-code`
  const createNameId = `${formIdPrefix}-reg-name`
  const createPrefixId = `${formIdPrefix}-reg-prefix`
  const createLocaleId = `${formIdPrefix}-reg-locale`
  const editNameId = `${formIdPrefix}-reg-edit-name`
  const editLocaleId = `${formIdPrefix}-reg-edit-locale`
  const changePrefixId = `${formIdPrefix}-reg-next-prefix`

  return (
    <section className="flex flex-col gap-4">
      <div className="flex justify-end">
        <Button
          variant="primary"
          size="md"
          disabled={outlets.length === 0}
          leadingIcon={<Plus className="size-4" aria-hidden="true" />}
          onClick={openCreateDialog}
        >
          {t('admin.users.register.addButton')}
        </Button>
      </div>

      <DataTable
        caption={t('admin.users.tabRegisters')}
        columns={columns}
        rows={registers}
        loading={isLoading}
        getRowKey={(r) => r.id}
        emptyIcon={<Printer className="size-8" aria-hidden="true" />}
        emptyTitle={t('admin.users.register.emptyTitle')}
        emptyDescription={t('admin.users.register.emptyDesc')}
        mobileActions={(r) => (
          <div className="flex flex-wrap gap-1">
            <Button variant="ghost" size="md" onClick={() => openEditDialog(r)}>
              {t('common.edit')}
            </Button>
            {r.registerType === 'CASHIER' ? (
              <Button variant="secondary" size="md" onClick={() => openChangePrefixDialog(r)}>
                {t('admin.users.register.changePrefix')}
              </Button>
            ) : null}
          </div>
        )}
      />

      <Dialog
        open={createOpen}
        onOpenChange={setCreateOpen}
        title={t('admin.users.register.createTitle')}
        size="md"
      >
        <form onSubmit={handleCreateSubmit} className="flex flex-col gap-4">
          {createError ? (
            <div
              role="alert"
              className="flex items-start gap-2 rounded-control border border-danger-solid bg-danger-soft p-3 text-body-sm text-danger-ink"
            >
              <CircleAlert className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
              <span>{createError}</span>
            </div>
          ) : null}

          <Field
            label={t('admin.users.register.outletLabel')}
            htmlFor={createOutletId}
            error={createFieldErrors.outletId}
          >
            <Select
              id={createOutletId}
              value={outletId}
              onValueChange={(v) => {
                handleOutletChange(v)
                clearCreateFieldError('outletId')
              }}
              options={outlets.map((o) => ({ value: o.id, label: `${o.code} · ${o.name}` }))}
              placeholder={t('admin.users.register.outletPlaceholder')}
              invalid={Boolean(createFieldErrors.outletId)}
              size="md"
            />
          </Field>

          <div className="grid gap-4 md:grid-cols-2">
            <Field
              label={t('admin.users.register.codeLabel')}
              htmlFor={createCodeId}
              hint={t('admin.users.register.codeHint')}
              error={createFieldErrors.code}
            >
              <Input
                id={createCodeId}
                controlSize="md"
                value={code}
                invalid={Boolean(createFieldErrors.code)}
                className="font-mono uppercase"
                onChange={(e) => {
                  handleCodeChange(e.target.value)
                  clearCreateFieldError('code')
                }}
                maxLength={10}
              />
            </Field>

            <Field
              label={t('admin.users.register.nameLabel')}
              htmlFor={createNameId}
              error={createFieldErrors.name}
            >
              <Input
                id={createNameId}
                controlSize="md"
                value={name}
                invalid={Boolean(createFieldErrors.name)}
                onChange={(e) => {
                  setName(e.target.value)
                  clearCreateFieldError('name')
                }}
                maxLength={80}
              />
            </Field>
          </div>

          <div className="flex flex-col gap-1.5">
            <span className="text-label font-medium text-ink">
              {t('admin.users.register.typeLabel')}
            </span>
            <Segmented
              ariaLabel={t('admin.users.register.typeLabel')}
              value={registerType}
              onChange={(v) => setRegisterType(v as RegisterType)}
              options={[
                { value: 'CASHIER', label: t('admin.users.register.typeCASHIER') },
                { value: 'WAITER', label: t('admin.users.register.typeWAITER') },
              ]}
            />
          </div>

          {registerType === 'WAITER' ? (
            <div className="flex items-start gap-2 rounded-control border border-info-line bg-info-soft p-3 text-body-sm text-info-ink">
              <Info className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
              <span>{t('admin.users.register.waiterNotice')}</span>
            </div>
          ) : (
            <div className="flex flex-col gap-2">
              <Field
                label={t('admin.users.register.prefixLabel')}
                htmlFor={createPrefixId}
                hint={t('admin.users.register.prefixHint')}
                error={createFieldErrors.invoicePrefix}
              >
                <Input
                  id={createPrefixId}
                  controlSize="md"
                  value={invoicePrefix}
                  invalid={Boolean(createFieldErrors.invoicePrefix)}
                  className="font-mono uppercase"
                  onChange={(e) => {
                    setPrefixTouched(true)
                    setInvoicePrefix(e.target.value.toUpperCase())
                    clearCreateFieldError('invoicePrefix')
                  }}
                  maxLength={16}
                />
              </Field>
              {createPreview ? (
                <div className="rounded-control border border-line bg-surface-subtle p-3 text-body-sm">
                  <p className="font-medium text-ink-soft">
                    {t('admin.users.register.previewLabel')}
                  </p>
                  <p className="mt-1 font-mono text-ink">
                    {t('admin.users.register.previewInvoice', { value: createPreview.invoice })}
                  </p>
                  <p className="font-mono text-ink-soft">
                    {t('admin.users.register.previewCreditNote', {
                      value: createPreview.creditNote,
                    })}
                  </p>
                </div>
              ) : null}
            </div>
          )}

          <div className="grid gap-4 md:grid-cols-2">
            <div className="flex flex-col gap-1.5">
              <span className="text-label font-medium text-ink">
                {t('admin.users.register.paperLabel')}
              </span>
              <Segmented
                ariaLabel={t('admin.users.register.paperLabel')}
                value={String(paperWidthMm)}
                onChange={(v) => setPaperWidthMm(v === '58' ? 58 : 80)}
                options={[
                  { value: '58', label: t('admin.users.register.paper58') },
                  { value: '80', label: t('admin.users.register.paper80') },
                ]}
              />
            </div>

            <Field label={t('admin.users.register.localeLabel')} htmlFor={createLocaleId}>
              <Select
                id={createLocaleId}
                value={defaultLocale}
                onValueChange={setDefaultLocale}
                options={localeOptions}
                size="md"
              />
            </Field>
          </div>

          <div className="flex justify-end gap-2 pt-2">
            <Button
              type="button"
              variant="secondary"
              size="md"
              onClick={() => setCreateOpen(false)}
            >
              {t('common.cancel')}
            </Button>
            <Button type="submit" variant="primary" size="md" loading={createMutation.isPending}>
              {t('common.save')}
            </Button>
          </div>
        </form>
      </Dialog>

      <Dialog
        open={Boolean(editing)}
        onOpenChange={(open) => !open && setEditing(null)}
        title={t('admin.users.register.editTitle', { code: editing?.code ?? '' })}
        size="md"
      >
        <form onSubmit={handleEditSubmit} className="flex flex-col gap-4" noValidate>
          {editError ? (
            <div
              role="alert"
              className="flex items-start gap-2 rounded-control border border-danger-solid bg-danger-soft p-3 text-body-sm text-danger-ink"
            >
              <CircleAlert className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
              <span>{editError}</span>
            </div>
          ) : null}

          <Field
            label={t('admin.users.register.nameLabel')}
            htmlFor={editNameId}
            error={editFieldErrors.name}
          >
            <Input
              id={editNameId}
              controlSize="md"
              value={editName}
              invalid={Boolean(editFieldErrors.name)}
              onChange={(e) => {
                setEditName(e.target.value)
                setEditFieldErrors({})
              }}
              maxLength={80}
            />
          </Field>

          <div className="flex flex-col gap-1.5">
            <span className="text-label font-medium text-ink">
              {t('admin.users.register.paperLabel')}
            </span>
            <Segmented
              ariaLabel={t('admin.users.register.paperLabel')}
              value={String(editPaper)}
              onChange={(v) => setEditPaper(v === '58' ? 58 : 80)}
              options={[
                { value: '58', label: t('admin.users.register.paper58') },
                { value: '80', label: t('admin.users.register.paper80') },
              ]}
            />
          </div>

          <Field label={t('admin.users.register.localeLabel')} htmlFor={editLocaleId}>
            <Select
              id={editLocaleId}
              value={editLocale}
              onValueChange={setEditLocale}
              options={localeOptions}
              size="md"
            />
          </Field>

          <div className="rounded-control border border-line bg-surface-subtle px-3 py-1">
            <Switch
              label={t('admin.users.register.statusLabel')}
              checked={editActive}
              onCheckedChange={setEditActive}
            />
          </div>

          <div className="flex justify-end gap-2 pt-2">
            <Button type="button" variant="secondary" size="md" onClick={() => setEditing(null)}>
              {t('common.cancel')}
            </Button>
            <Button type="submit" variant="primary" size="md" loading={editMutation.isPending}>
              {t('common.save')}
            </Button>
          </div>
        </form>
      </Dialog>

      <Dialog
        open={Boolean(prefixTarget)}
        onOpenChange={(open) => !open && setPrefixTarget(null)}
        title={t('admin.users.register.changePrefixTitle', { code: prefixTarget?.code ?? '' })}
        size="md"
      >
        <form onSubmit={handleChangePrefixSubmit} className="flex flex-col gap-4">
          <div className="flex items-start gap-2 rounded-control border border-info-line bg-info-soft p-3 text-body-sm text-info-ink">
            <Info className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
            <span>{t('admin.users.register.prefixNextMonth', { month: nextMonthMmYy })}</span>
          </div>

          <Field
            label={t('admin.users.register.newPrefixLabel')}
            htmlFor={changePrefixId}
            hint={t('admin.users.register.prefixHint')}
            error={prefixError ?? undefined}
          >
            <Input
              id={changePrefixId}
              controlSize="md"
              value={nextPrefixInput}
              invalid={Boolean(prefixError)}
              className="font-mono uppercase"
              onChange={(e) => {
                setNextPrefixInput(e.target.value.toUpperCase())
                setPrefixError(null)
              }}
              maxLength={16}
            />
          </Field>

          {changePrefixPreview ? (
            <div className="rounded-control border border-line bg-surface-subtle p-3 text-body-sm">
              <p className="font-medium text-ink-soft">{t('admin.users.register.previewLabel')}</p>
              <p className="mt-1 font-mono text-ink">
                {t('admin.users.register.previewInvoice', { value: changePrefixPreview.invoice })}
              </p>
              <p className="font-mono text-ink-soft">
                {t('admin.users.register.previewCreditNote', {
                  value: changePrefixPreview.creditNote,
                })}
              </p>
            </div>
          ) : null}

          <div className="flex justify-end gap-2 pt-2">
            <Button
              type="button"
              variant="secondary"
              size="md"
              onClick={() => setPrefixTarget(null)}
            >
              {t('common.cancel')}
            </Button>
            <Button
              type="submit"
              variant="primary"
              size="md"
              loading={changePrefixMutation.isPending}
            >
              {t('common.save')}
            </Button>
          </div>
        </form>
      </Dialog>
    </section>
  )
}
