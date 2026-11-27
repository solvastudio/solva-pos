import { useMutation } from '@tanstack/react-query'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Button, CircleAlert, Dialog } from '~/components/ui'
import { issueResetCodeFn } from '~/functions/identity/members.fn'
import type { MemberDirectoryView } from '~/modules/identity/shared'

export interface MemberResetDialogProps {
  target: MemberDirectoryView
  onClose: () => void
  onIssued: (res: { code: string; expiresAt: string }) => void
}

/** Confirms and issues a one-time password reset code for one member. */
export function MemberResetDialog({ target, onClose, onIssued }: MemberResetDialogProps) {
  const { t } = useTranslation()
  const [error, setError] = useState<string | null>(null)

  const mutation = useMutation({
    retry: 0,
    mutationFn: () => issueResetCodeFn({ data: { appUserId: target.appUserId } }),
    onSuccess: (res) => {
      onClose()
      onIssued(res)
    },
    onError: () => {
      setError(t('admin.users.reset.denied'))
    },
  })

  return (
    <Dialog
      open
      onOpenChange={(open) => !open && onClose()}
      title={t('admin.users.reset.confirmTitle', { name: target.displayName })}
      description={t('admin.users.reset.confirmDesc')}
      size="sm"
      footer={
        <>
          <Button variant="secondary" size="md" onClick={onClose}>
            {t('common.cancel')}
          </Button>
          <Button
            variant="primary"
            size="md"
            loading={mutation.isPending}
            onClick={() => mutation.mutate()}
          >
            {t('admin.users.reset.confirmAction')}
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
