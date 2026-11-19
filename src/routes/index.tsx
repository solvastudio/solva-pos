import { createFileRoute, notFound } from '@tanstack/react-router'
import { NotFoundView } from '~/components/layout/NotFoundView'

export const Route = createFileRoute('/')({
  beforeLoad: () => {
    throw notFound()
  },
  notFoundComponent: NotFoundView,
})
