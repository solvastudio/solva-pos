import { lazy, Suspense } from 'react'
import { createFileRoute, redirect } from '@tanstack/react-router'
import { getSessionState } from '~/pos/session/session'

const LazyReturnScreen = lazy(() =>
  import('~/components/pos/returns/ReturnScreen').then((m) => ({
    default: m.ReturnScreen,
  })),
)

export const Route = createFileRoute('/$tenant/pos/return/$saleId')({
  ssr: false,
  validateSearch: (search: Record<string, unknown>) => ({
    invoiceNo: typeof search.invoiceNo === 'string' ? search.invoiceNo : undefined,
  }),
  beforeLoad: ({ params }) => {
    const cleanSlug = params.tenant.toLowerCase()
    if (!getSessionState().staff) {
      throw redirect({ href: `/${cleanSlug}/pos/login` })
    }
  },
  component: PosReturnRouteComponent,
})

function PosReturnRouteComponent() {
  const { tenant, saleId } = Route.useParams()
  const { invoiceNo } = Route.useSearch()
  const { bootResult } = Route.useRouteContext()
  return (
    <Suspense fallback={null}>
      <LazyReturnScreen
        tenant={tenant}
        saleId={saleId}
        initialInvoiceNo={invoiceNo}
        bootResult={bootResult}
      />
    </Suspense>
  )
}
