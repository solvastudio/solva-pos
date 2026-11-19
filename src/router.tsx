import { createRouter } from '@tanstack/react-router'
import { NotFoundView } from '~/components/layout/NotFoundView'
import { routeTree } from './routeTree.gen'

export function getRouter() {
  const router = createRouter({
    routeTree,
    scrollRestoration: true,
    trailingSlash: 'never',
    defaultNotFoundComponent: NotFoundView,
  })
  return router
}

declare module '@tanstack/react-router' {
  interface Register {
    router: ReturnType<typeof getRouter>
  }
}
