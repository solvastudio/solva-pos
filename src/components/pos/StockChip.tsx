import { useTranslation } from 'react-i18next'
import { Chip } from '~/components/ui/Chip'
import { isEstimateLow } from '~/pos/domain/stock-estimate'
import type { Qty } from '~/lib/kernel'

/**
 * Warning chip for estimated stock ≤ 0 (FR-POS-011, DESIGN §5.2 #11). Non-blocking: it disables
 * no button and opens no dialog. Icon + text (not color alone); announced to screen readers.
 */
export function StockChip({ estimate, className }: { estimate: Qty | null; className?: string }) {
  const { t } = useTranslation()
  if (!isEstimateLow(estimate)) return null
  return (
    <Chip
      status="stock_estimate_low"
      label={t('pos.stock.estimateLow')}
      size="sm"
      announce
      className={className}
    />
  )
}
