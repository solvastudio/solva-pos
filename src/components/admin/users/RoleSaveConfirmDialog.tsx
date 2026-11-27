import { useTranslation } from 'react-i18next'
import { Button, Dialog } from '~/components/ui'
import type { RoleMatrixView } from '~/modules/identity/shared'
import type { RoleDraft } from './useRoleDraft'

export interface RoleSaveConfirmDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  role: RoleMatrixView
  draft: RoleDraft
  loading: boolean
  onConfirm: () => void
}

/** Confirmation shown before saving a role that members use: lists what changes and who is affected. */
export function RoleSaveConfirmDialog({
  open,
  onOpenChange,
  role,
  draft,
  loading,
  onConfirm,
}: RoleSaveConfirmDialogProps) {
  const { t } = useTranslation()

  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      title={t('admin.users.role.confirmSaveTitle', { name: role.name })}
      description={t('admin.users.role.confirmSaveDesc', { members: role.memberCount })}
      size="sm"
      footer={
        <>
          <Button variant="secondary" size="md" onClick={() => onOpenChange(false)}>
            {t('common.cancel')}
          </Button>
          <Button variant="primary" size="md" loading={loading} onClick={onConfirm}>
            {t('admin.users.role.confirmSaveAction')}
          </Button>
        </>
      }
    >
      <ul className="flex list-disc flex-col gap-1 pl-5 text-body-sm text-ink">
        {draft.nameChanged ? (
          <li>{t('admin.users.role.changeName', { from: role.name, to: draft.trimmedName })}</li>
        ) : null}
        {draft.discountChanged ? (
          <li>
            {t('admin.users.role.changeDiscount', {
              from: role.discountLimitPct,
              to: draft.discountValue,
            })}
          </li>
        ) : null}
        {draft.diff.added.length > 0 ? (
          <li>
            {t('admin.users.role.changeAdded', {
              list: draft.diff.added.map((code) => t(`permission.${code}`)).join(', '),
            })}
          </li>
        ) : null}
        {draft.diff.removed.length > 0 ? (
          <li>
            {t('admin.users.role.changeRemoved', {
              list: draft.diff.removed.map((code) => t(`permission.${code}`)).join(', '),
            })}
          </li>
        ) : null}
      </ul>
    </Dialog>
  )
}
