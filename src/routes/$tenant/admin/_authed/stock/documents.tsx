import { createFileRoute, redirect } from '@tanstack/react-router'
import { StockDocumentsPanel } from '~/components/admin/stock/StockDocumentsPanel'
import { tenantHref } from '~/lib/tenancy/tenant-href'

export const Route = createFileRoute('/$tenant/admin/_authed/stock/documents')({
  beforeLoad: ({ params, context }) => {
    if (!context.session?.permissions.includes('inventory.manage')) {
      throw redirect({ href: tenantHref(params.tenant, '/admin') })
    }
  },
  component: AdminStockDocumentsPage,
})

/** SCR-A06 tab dokumen: penerimaan barang, transfer, opname, dan pemasok. */
function AdminStockDocumentsPage() {
  return <StockDocumentsPanel />
}
