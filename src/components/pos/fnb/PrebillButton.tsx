import { useTranslation } from 'react-i18next'
import { Button } from '~/components/ui/Button'
import { Printer } from '~/components/ui/icons'

export interface PrebillButtonProps {
  disabled?: boolean
  loading?: boolean
  onClick: () => void
}

export function PrebillButton({ disabled = false, loading = false, onClick }: PrebillButtonProps) {
  const { t } = useTranslation()
  return (
    <Button
      type="button"
      variant="secondary"
      size="md"
      disabled={disabled}
      loading={loading}
      leadingIcon={<Printer className="size-4" aria-hidden="true" />}
      onClick={onClick}
    >
      {t('pos.bill.prebillButton')}
    </Button>
  )
}
