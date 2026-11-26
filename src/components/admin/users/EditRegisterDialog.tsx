import { useMutation, useQueryClient } from '@tanstack/react-query'
import { useId, useState, type FormEvent } from 'react'
import { useTranslation } from 'react-i18next'
import {
  Button,
  CircleAlert,
  Dialog,
  Field,
  Input,
  Segmented,
  Select,
  Switch,
  useToast,
} from '~/components/ui'
import { updateRegisterFn } from '~/functions/identity/register.fn'
import type { PaperWidthMm, RegisterView } from '~/modules/identity/shared'
import { qk } from '~/queries/keys'

const LOCALE_FOLLOW_OUTLET = '__FOLLOW__'

export interface EditRegisterDialogProps {
  row: RegisterView
  tenantSlug: string
  localeOptions: readonly { value: string; label: string }[]
  onClose: () => void
}

export function EditRegisterDialog({
  row,
  tenantSlug,
  localeOptions,
  onClose,
}: EditRegisterDialogProps) {
  const { t } = useTranslation()
  const toast = useToast()
  const queryClient = useQueryClient()
  const formIdPrefix = useId()
  const editNameId = `${formIdPrefix}-reg-edit-name`
  const editLocaleId = `${formIdPrefix}-reg-edit-locale`

  const [editName, setEditName] = useState(row.name)
  const [editActive, setEditActive] = useState(row.status === 'ACTIVE')
  const [editPaper, setEditPaper] = useState<PaperWidthMm>(row.paperWidthMm)
  const [editLocale, setEditLocale] = useState<string>(row.defaultLocale ?? LOCALE_FOLLOW_OUTLET)
  const [editFieldErrors, setEditFieldErrors] = useState<Record<string, string>>({})
  const [editError, setEditError] = useState<string | null>(null)

  const editMutation = useMutation({
    retry: 0,
    mutationFn: () =>
      updateRegisterFn({
        data: {
          id: row.id,
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
      onClose()
    },
    onError: () => {
      setEditError(t('admin.users.failed'))
    },
  })

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

  return (
    <Dialog
      open
      onOpenChange={(next) => !next && onClose()}
      title={t('admin.users.register.editTitle', { code: row.code })}
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
          <Button type="button" variant="secondary" size="md" onClick={onClose}>
            {t('common.cancel')}
          </Button>
          <Button type="submit" variant="primary" size="md" loading={editMutation.isPending}>
            {t('common.save')}
          </Button>
        </div>
      </form>
    </Dialog>
  )
}
