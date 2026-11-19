import { createFileRoute, notFound } from '@tanstack/react-router'

export const Route = createFileRoute('/')({
  beforeLoad: () => {
    throw notFound()
  },
  notFoundComponent: RootNotFound,
})

function RootNotFound() {
  // TODO-i18n Fase 08
  return <div>404</div>
}
