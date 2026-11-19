import { useTranslation } from 'react-i18next'
import { Button, Copy, Dialog, useToast } from '~/components/ui'

export interface OneTimeCodeDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  title: string
  codeLabel: string
  copyCodeLabel: string
  urlLabel: string
  copyUrlLabel: string
  expiryNotice: string
  onceNotice: string
  code: string
  url: string
}

export function OneTimeCodeDialog({
  open,
  onOpenChange,
  title,
  codeLabel,
  copyCodeLabel,
  urlLabel,
  copyUrlLabel,
  expiryNotice,
  onceNotice,
  code,
  url,
}: OneTimeCodeDialogProps) {
  const { t } = useTranslation()
  const toast = useToast()

  async function copyText(text: string) {
    try {
      await navigator.clipboard.writeText(text)
      toast.show({ tone: 'success', message: t('common.copied') })
    } catch {
      // Clipboard API may be blocked on insecure origins.
    }
  }

  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      title={title}
      size="md"
      footer={
        <Button variant="primary" size="md" onClick={() => onOpenChange(false)}>
          {t('common.close')}
        </Button>
      }
    >
      <div className="flex flex-col gap-4">
        <div className="rounded-card border border-line bg-surface-subtle p-4 flex flex-col gap-3">
          <p className="text-label-sm font-medium text-ink-soft">{codeLabel}</p>
          <p className="font-mono text-code-id font-bold tracking-wider text-ink select-all break-all">
            {code}
          </p>
          <Button
            variant="secondary"
            size="xl"
            leadingIcon={<Copy className="size-4" aria-hidden="true" />}
            onClick={() => void copyText(code)}
          >
            {copyCodeLabel}
          </Button>
        </div>

        <div className="rounded-card border border-line bg-surface p-3 flex flex-col gap-2">
          <p className="text-label-sm font-medium text-ink-soft">{urlLabel}</p>
          <div className="flex flex-wrap items-center justify-between gap-2">
            <code className="font-mono text-body-sm text-ink break-all">{url}</code>
            <Button
              variant="ghost"
              size="md"
              leadingIcon={<Copy className="size-4" aria-hidden="true" />}
              onClick={() => void copyText(url)}
            >
              {copyUrlLabel}
            </Button>
          </div>
        </div>

        <p className="text-body-sm font-medium text-ink">{expiryNotice}</p>
        <p className="text-body-sm text-ink-soft">{onceNotice}</p>
      </div>
    </Dialog>
  )
}
