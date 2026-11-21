import { useTranslation } from 'react-i18next'
import { Chip } from '~/components/ui/Chip'
import { isEstimateLow } from '~/pos/domain/stock-estimate'
import type { Qty } from '~/lib/kernel'

/**
 * Chip peringatan stok estimasi ≤ 0 (FR-POS-011, DESIGN §5.2 #11). Non-blokir: tidak menonaktifkan
 * tombol apa pun dan tidak membuka dialog. Ikon + teks (bukan warna saja); diumumkan ke pembaca layar.
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
