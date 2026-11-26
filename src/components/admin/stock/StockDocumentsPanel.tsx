import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Tabs, type TabItem } from '~/components/ui'
import { ReceiptsTab } from './ReceiptsTab'
import { StocktakesTab } from './StocktakesTab'
import { SuppliersTab } from './SuppliersTab'
import { TransfersTab } from './TransfersTab'

/**
 * SCR-A06 — stock documents: goods receipt (GR), inter-outlet transfers, stocktake, and suppliers.
 * Every action calls a server service; validation and figures live entirely on the server.
 */

export function StockDocumentsPanel() {
  const { t } = useTranslation()
  const [tab, setTab] = useState('receipts')

  const items: readonly TabItem[] = [
    { value: 'receipts', label: t('admin.stock.tabReceipts'), content: <ReceiptsTab /> },
    { value: 'transfers', label: t('admin.stock.tabTransfers'), content: <TransfersTab /> },
    { value: 'stocktakes', label: t('admin.stock.tabStocktakes'), content: <StocktakesTab /> },
    { value: 'suppliers', label: t('admin.stock.tabSuppliers'), content: <SuppliersTab /> },
  ]

  return (
    <div className="flex flex-col gap-4">
      <Tabs items={items} value={tab} onValueChange={setTab} size="md" ariaLabel={t('admin.stock.documentsLabel')} />
    </div>
  )
}
