import { useTranslation } from 'react-i18next'
import { Button } from '~/components/ui/Button'
import { Chip } from '~/components/ui/Chip'
import type { BillRecord } from '~/pos/db/types'

export interface ChildBillListProps {
  currentBillId: string
  childrenBills: readonly BillRecord[]
  onSelectBill: (billId: string) => void
}

export function ChildBillList({
  currentBillId,
  childrenBills,
  onSelectBill,
}: ChildBillListProps) {
  const { t } = useTranslation()
  if (childrenBills.length === 0) return null

  return (
    <div className="flex flex-col gap-1.5 border-b border-line bg-surface-sunken px-3.5 py-2">
      <div className="text-caption font-semibold text-ink-soft">
        {t('pos.split.siblingsLabel')}
      </div>
      <div className="flex flex-wrap gap-1.5">
        {childrenBills.map((child) => {
          const isCurrent = child.id === currentBillId
          const chipStatus =
            child.status === 'PAID'
              ? 'synced'
              : child.status === 'CANCELED'
                ? 'void'
                : 'pending'
          const label =
            child.share_index !== null && child.share_count !== null
              ? `${child.share_index}/${child.share_count}`
              : child.bill_ref
          return (
            <Button
              key={child.id}
              type="button"
              size="sm"
              variant={isCurrent ? 'primary' : 'secondary'}
              onClick={() => onSelectBill(child.id)}
            >
              <span>{label}</span>
              <Chip status={chipStatus} size="sm" label={child.status} />
            </Button>
          )
        })}
      </div>
    </div>
  )
}
