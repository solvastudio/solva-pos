import { useTranslation } from 'react-i18next'
import { Button, Dialog } from '~/components/ui'

export interface RoleDeleteDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  roleName: string
  loading: boolean
  onConfirm: () => void
}

export function RoleDeleteDialog({
  open,
  onOpenChange,
  roleName,
  loading,
  onConfirm,
}: RoleDeleteDialogProps) {
  const { t } = useTranslation()

  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      title={t('admin.users.role.deleteTitle', { name: roleName })}
      description={t('admin.users.role.deleteDesc')}
      size="sm"
      footer={
        <>
          <Button variant="secondary" size="md" onClick={() => onOpenChange(false)}>
            {t('common.cancel')}
          </Button>
          <Button variant="danger" size="md" loading={loading} onClick={onConfirm}>
            {t('admin.users.role.deleteAction')}
          </Button>
        </>
      }
    >
      <div />
    </Dialog>
  )
}
