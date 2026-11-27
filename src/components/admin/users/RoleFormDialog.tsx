import { useMutation, useQueryClient } from '@tanstack/react-query'
import { useId, useState, type FormEvent } from 'react'
import { useTranslation } from 'react-i18next'
import { Button, CircleAlert, Dialog, Field, Input } from '~/components/ui'
import { createRoleFn, duplicateRoleFn } from '~/functions/identity/role.fn'
import type { PermissionCode, RoleMatrixView } from '~/modules/identity/shared'
import { qk } from '~/queries/keys'
import { RolePermissionChecklist } from './RolePermissionChecklist'

interface FormErrors {
  name?: string
  discount?: string
  permissions?: string
}

export interface RoleFormDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  tenantSlug: string
  mode: 'create' | 'duplicate'
  source: RoleMatrixView | null
  actorPermissions: ReadonlySet<PermissionCode>
  actorDiscountLimitPct: number
  onCreated: (role: RoleMatrixView) => void
}

export function RoleFormDialog({
  open,
  onOpenChange,
  tenantSlug,
  mode,
  source,
  actorPermissions,
  actorDiscountLimitPct,
  onCreated,
}: RoleFormDialogProps) {
  const { t } = useTranslation()
  const queryClient = useQueryClient()
  const formIdPrefix = useId()
  const nameId = `${formIdPrefix}-role-name`
  const discountId = `${formIdPrefix}-role-discount`

  const [name, setName] = useState(
    mode === 'duplicate' && source
      ? t('admin.users.role.duplicateDefaultName', { name: source.name }).slice(0, 60)
      : '',
  )
  const [discount, setDiscount] = useState('0')
  const [permissions, setPermissions] = useState<Set<PermissionCode>>(() => new Set())
  const [errors, setErrors] = useState<FormErrors>({})
  const [serverError, setServerError] = useState<string | null>(null)

  const mutation = useMutation({
    retry: 0,
    mutationFn: () =>
      mode === 'duplicate' && source
        ? duplicateRoleFn({ data: { sourceRoleId: source.id, name: name.trim() } })
        : createRoleFn({
            data: {
              name: name.trim(),
              discountLimitPct: Number(discount),
              permissions: Array.from(permissions),
            },
          }),
    onSuccess: (res) => {
      if (!res.ok) {
        setServerError(t(res.errorKey, { defaultValue: t('admin.users.failed') }))
        return
      }
      void queryClient.invalidateQueries({ queryKey: qk.roles(tenantSlug) })
      onCreated(res.data)
    },
    onError: () => {
      setServerError(t('admin.users.failed'))
    },
  })

  function togglePermission(code: PermissionCode, checked: boolean) {
    setPermissions((prev) => {
      const next = new Set(prev)
      if (checked) {
        next.add(code)
      } else {
        next.delete(code)
      }
      return next
    })
    setErrors((prev) => ({ ...prev, permissions: undefined }))
  }

  function handleSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault()
    setServerError(null)
    const next: FormErrors = {}
    if (!name.trim()) {
      next.name = t('validation.fieldRequired', { field: t('admin.users.role.nameLabel') })
    }
    if (mode === 'create') {
      const numeric = Number(discount)
      if (discount.trim() === '' || !Number.isFinite(numeric) || numeric < 0 || numeric > 100) {
        next.discount = t('admin.users.role.discountInvalid')
      } else if (numeric > actorDiscountLimitPct) {
        next.discount = t('admin.users.role.discountAboveOwn', { limit: actorDiscountLimitPct })
      }
      if (permissions.size === 0) {
        next.permissions = t('admin.users.role.permissionsRequired')
      }
    }
    setErrors(next)
    if (Object.keys(next).length > 0) {
      return
    }
    mutation.mutate()
  }

  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      title={
        mode === 'duplicate' && source
          ? t('admin.users.role.duplicateTitle', { name: source.name })
          : t('admin.users.role.createTitle')
      }
      size="lg"
    >
      <form onSubmit={handleSubmit} className="flex flex-col gap-4" noValidate>
        {serverError ? (
          <div
            role="alert"
            className="flex items-start gap-2 rounded-control border border-danger-solid bg-danger-soft p-3 text-body-sm text-danger-ink"
          >
            <CircleAlert className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
            <span>{serverError}</span>
          </div>
        ) : null}

        <div
          className={
            mode === 'create'
              ? 'grid grid-cols-1 gap-4 sm:grid-cols-[minmax(0,1fr)_12rem]'
              : undefined
          }
        >
          <Field label={t('admin.users.role.nameLabel')} htmlFor={nameId} error={errors.name}>
            <Input
              id={nameId}
              controlSize="md"
              value={name}
              maxLength={60}
              invalid={Boolean(errors.name)}
              onChange={(e) => {
                setName(e.target.value)
                setErrors((prev) => ({ ...prev, name: undefined }))
              }}
            />
          </Field>

          {mode === 'create' ? (
            <Field
              label={t('admin.users.role.discountLabel')}
              htmlFor={discountId}
              error={errors.discount}
            >
              <Input
                id={discountId}
                type="number"
                min={0}
                max={100}
                controlSize="md"
                className="text-right tabular-nums"
                value={discount}
                invalid={Boolean(errors.discount)}
                onChange={(e) => {
                  setDiscount(e.target.value)
                  setErrors((prev) => ({ ...prev, discount: undefined }))
                }}
              />
            </Field>
          ) : null}
        </div>

        {mode === 'create' ? (
          <div className="flex flex-col gap-2">
            <p className="text-label font-medium text-ink">
              {t('admin.users.role.permissionsHeading')}
            </p>
            <div className="max-h-[48dvh] overflow-y-auto pr-1">
              <RolePermissionChecklist
                selected={permissions}
                onToggle={togglePermission}
                isDisabled={(code) => !actorPermissions.has(code)}
              />
            </div>
            {errors.permissions ? (
              <p className="flex items-center gap-1.5 text-body-sm text-danger-ink">
                <CircleAlert className="size-4 shrink-0" aria-hidden="true" />
                <span>{errors.permissions}</span>
              </p>
            ) : null}
          </div>
        ) : null}

        <div className="flex justify-end gap-2 pt-2">
          <Button type="button" variant="secondary" size="md" onClick={() => onOpenChange(false)}>
            {t('common.cancel')}
          </Button>
          <Button type="submit" variant="primary" size="md" loading={mutation.isPending}>
            {mode === 'create'
              ? t('admin.users.role.createAction')
              : t('admin.users.role.duplicateAction')}
          </Button>
        </div>
      </form>
    </Dialog>
  )
}
