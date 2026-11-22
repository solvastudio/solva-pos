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
  Input,
  Landmark,
  PencilLine,
  Plus,
  Switch,
  useToast,
  type DataTableColumn,
} from '~/components/ui'
import { createLegalEntityFn, updateLegalEntityFn } from '~/functions/identity/org.fn'
import {
  legalEntityFormSchema,
  normalizeNpwpInput,
  type LegalEntityView,
} from '~/modules/identity/shared'
import { legalEntitiesQueryOptions } from '~/queries/identity.queries'
import { qk } from '~/queries/keys'

export interface LegalEntitiesSectionProps {
  tenantSlug: string
  canManageTenantWide: boolean
}

export function LegalEntitiesSection({
  tenantSlug,
  canManageTenantWide,
}: LegalEntitiesSectionProps) {
  const { t } = useTranslation()
  const toast = useToast()
  const queryClient = useQueryClient()
  const formIdPrefix = useId()
  const { data: entities = [], isLoading } = useQuery(legalEntitiesQueryOptions(tenantSlug))

  const [dialogOpen, setDialogOpen] = useState(false)
  const [editing, setEditing] = useState<LegalEntityView | null>(null)
  const [name, setName] = useState('')
  const [npwp, setNpwp] = useState('')
  const [isPkp, setIsPkp] = useState(false)
  const [pkpSince, setPkpSince] = useState('')
  const [address, setAddress] = useState('')
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({})
  const [formError, setFormError] = useState<string | null>(null)

  const saveMutation = useMutation({
    retry: 0,
    mutationFn: async () => {
      const normalizedNpwp = npwp.trim() ? normalizeNpwpInput(npwp) : null
      const payload = {
        name: name.trim(),
        npwp: normalizedNpwp,
        isPkp,
        pkpSince: isPkp && pkpSince.trim() ? pkpSince.trim() : null,
        address: address.trim() || null,
      }
      if (editing) {
        return updateLegalEntityFn({ data: { id: editing.id, ...payload } })
      }
      return createLegalEntityFn({ data: payload })
    },
    onSuccess: (res) => {
      if (!res.ok) {
        setFormError(t(res.errorKey, { defaultValue: t('admin.settings.failed') }))
        return
      }
      void queryClient.invalidateQueries({ queryKey: qk.legalEntities(tenantSlug) })
      void queryClient.invalidateQueries({ queryKey: qk.outlets(tenantSlug) })
      toast.show({ tone: 'success', message: t('admin.settings.saved') })
      setDialogOpen(false)
    },
    onError: () => {
      setFormError(t('admin.settings.failed'))
    },
  })

  function openCreate() {
    setEditing(null)
    setName('')
    setNpwp('')
    setIsPkp(false)
    setPkpSince('')
    setAddress('')
    setFieldErrors({})
    setFormError(null)
    setDialogOpen(true)
  }

  function openEdit(row: LegalEntityView) {
    setEditing(row)
    setName(row.name)
    setNpwp(row.npwp ?? '')
    setIsPkp(row.isPkp)
    setPkpSince(row.pkpSince ?? '')
    setAddress(row.address ?? '')
    setFieldErrors({})
    setFormError(null)
    setDialogOpen(true)
  }

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setFormError(null)
    const normalizedNpwp = npwp.trim() ? normalizeNpwpInput(npwp) : null
    const parsed = legalEntityFormSchema.safeParse({
      name: name.trim(),
      npwp: normalizedNpwp,
      isPkp,
      pkpSince: isPkp && pkpSince.trim() ? pkpSince.trim() : null,
      address: address.trim() || null,
    })

    if (!parsed.success) {
      const nextErrors: Record<string, string> = {}
      for (const issue of parsed.error.issues) {
        const key = String(issue.path[0] ?? 'form')
        if (!nextErrors[key]) {
          nextErrors[key] = t(issue.message, { defaultValue: t('admin.settings.failed') })
        }
      }
      setFieldErrors(nextErrors)
      return
    }
    setFieldErrors({})
    saveMutation.mutate()
  }

  const columns: readonly DataTableColumn<LegalEntityView>[] = [
    {
      id: 'name',
      header: t('admin.settings.legalEntity.colName'),
      stickyFirst: true,
      sortValue: (row) => row.name,
      cell: (row) => row.name,
    },
    {
      id: 'npwp',
      header: t('admin.settings.legalEntity.colNpwp'),
      cell: (row) =>
        row.npwp ? <span className="font-mono text-body-sm">{row.npwp}</span> : t('common.dash'),
    },
    {
      id: 'pkp',
      header: t('admin.settings.legalEntity.colPkp'),
      cell: (row) => (
        <Chip
          status={row.isPkp ? 'tax_pkp' : 'tax_non_pkp'}
          label={
            row.isPkp
              ? t('admin.settings.legalEntity.pkpYes')
              : t('admin.settings.legalEntity.pkpNo')
          }
          size="sm"
        />
      ),
    },
    {
      id: 'address',
      header: t('admin.settings.legalEntity.colAddress'),
      cell: (row) => row.address ?? t('common.dash'),
    },
    {
      id: 'action',
      header: t('admin.settings.legalEntity.colAction'),
      align: 'right',
      hideOnMobileCard: true,
      cell: (row) =>
        canManageTenantWide ? (
          <Button
            variant="ghost"
            size="md"
            leadingIcon={<PencilLine className="size-4" aria-hidden="true" />}
            onClick={() => openEdit(row)}
          >
            {t('common.edit')}
          </Button>
        ) : null,
    },
  ]

  const nameId = `${formIdPrefix}-le-name`
  const npwpId = `${formIdPrefix}-le-npwp`
  const pkpSinceId = `${formIdPrefix}-le-pkp-since`
  const addressId = `${formIdPrefix}-le-address`

  return (
    <section aria-labelledby="legal-entities-heading" className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 id="legal-entities-heading" className="text-h2 font-semibold text-ink">
          {t('admin.settings.legalEntity.sectionTitle')}
        </h2>
        {canManageTenantWide ? (
          <Button
            variant="secondary"
            size="md"
            leadingIcon={<Plus className="size-4" aria-hidden="true" />}
            onClick={openCreate}
          >
            {t('admin.settings.legalEntity.addButton')}
          </Button>
        ) : null}
      </div>

      <DataTable
        caption={t('admin.settings.legalEntity.sectionTitle')}
        columns={columns}
        rows={entities}
        loading={isLoading}
        getRowKey={(r) => r.id}
        emptyIcon={<Landmark className="size-8" aria-hidden="true" />}
        emptyTitle={t('admin.settings.legalEntity.emptyTitle')}
        emptyDescription={t('admin.settings.legalEntity.emptyDesc')}
        mobileActions={(row) =>
          canManageTenantWide ? (
            <Button variant="ghost" size="md" onClick={() => openEdit(row)}>
              {t('common.edit')}
            </Button>
          ) : null
        }
      />

      <Dialog
        open={dialogOpen}
        onOpenChange={setDialogOpen}
        title={
          editing
            ? t('admin.settings.legalEntity.editTitle')
            : t('admin.settings.legalEntity.createTitle')
        }
        size="md"
      >
        <form id="legal-entity-form" onSubmit={handleSubmit} className="flex flex-col gap-4">
          {formError ? (
            <div
              role="alert"
              className="flex items-start gap-2 rounded-control border border-danger-solid bg-danger-soft p-3 text-body-sm text-danger-ink"
            >
              <CircleAlert className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
              <span>{formError}</span>
            </div>
          ) : null}

          <Field
            label={t('admin.settings.legalEntity.nameLabel')}
            htmlFor={nameId}
            error={fieldErrors.name}
          >
            <Input
              id={nameId}
              controlSize="md"
              value={name}
              invalid={Boolean(fieldErrors.name)}
              onChange={(e) => setName(e.target.value)}
              maxLength={160}
            />
          </Field>

          <Field
            label={t('admin.settings.legalEntity.npwpLabel')}
            htmlFor={npwpId}
            hint={t('admin.settings.legalEntity.npwpHint')}
            error={fieldErrors.npwp}
          >
            <Input
              id={npwpId}
              controlSize="md"
              value={npwp}
              invalid={Boolean(fieldErrors.npwp)}
              onChange={(e) => setNpwp(e.target.value)}
              inputMode="numeric"
            />
          </Field>

          <div className="rounded-control border border-line bg-surface-subtle px-3 py-1">
            <Switch
              label={t('admin.settings.legalEntity.isPkpLabel')}
              checked={isPkp}
              onCheckedChange={setIsPkp}
            />
          </div>

          {isPkp ? (
            <Field
              label={t('admin.settings.legalEntity.pkpSinceLabel')}
              htmlFor={pkpSinceId}
              error={fieldErrors.pkpSince}
            >
              <Input
                id={pkpSinceId}
                controlSize="md"
                type="date"
                value={pkpSince}
                invalid={Boolean(fieldErrors.pkpSince)}
                onChange={(e) => setPkpSince(e.target.value)}
              />
            </Field>
          ) : null}

          <Field
            label={t('admin.settings.legalEntity.addressLabel')}
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
