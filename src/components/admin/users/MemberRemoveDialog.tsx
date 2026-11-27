import { useMutation } from '@tanstack/react-query'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Button, CircleAlert, Dialog } from '~/components/ui'
import { removeMemberFn } from '~/functions/identity/members.fn'
import type { MemberDirectoryView } from '~/modules/identity/shared'

export interface MemberRemoveDialogProps {
  target: MemberDirectoryView
  tenantName: string
  onClose: () => void
  onRemoved: () => void
}

/** Confirms and removes one member from the tenant (the account itself is kept). */
export function MemberRemoveDialog({
  target,
  tenantName,
  onClose,
  onRemoved,
}: MemberRemoveDialogProps) {
  const { t } = useTranslation()
  const [error, setError] = useState<string | null>(null)

  const mutation = useMutation({
    retry: 0,
    mutationFn: () => removeMemberFn({ data: { appUserId: target.appUserId } }),
    onSuccess: () => {
      onRemoved()
    },
    onError: () => {
      setError(t('members.remove.lastOwner'))
    },
  })

  return (
    <Dialog
      open
      onOpenChange={(open) => !open && onClose()}
      title={t('admin.users.remove.confirmTitle', { name: target.displayName, tenant: tenantName })}
      description={t('admin.users.remove.confirmDesc', {
        name: target.displayName,
        tenant: tenantName,
      })}
      size="sm"
      footer={
        <>
          <Button variant="secondary" size="md" onClick={onClose}>
            {t('common.cancel')}
          </Button>
          <Button
            variant="danger"
            size="md"
            loading={mutation.isPending}
            onClick={() => mutation.mutate()}
          >
            {t('admin.users.remove.confirmAction')}
          </Button>
        </>
      }
    >
      {error ? (
        <div
          role="alert"
          className="flex items-start gap-2 rounded-control border border-danger-solid bg-danger-soft p-3 text-body-sm text-danger-ink"
        >
          <CircleAlert className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
          <span>{error}</span>
        </div>
      ) : (
        <div />
      )}
    </Dialog>
  )
}
