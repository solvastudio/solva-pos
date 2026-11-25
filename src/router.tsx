import { QueryClient } from '@tanstack/react-query'
import { createRouter } from '@tanstack/react-router'
import { setupRouterSsrQueryIntegration } from '@tanstack/react-router-ssr-query'
import { NotFoundView } from '~/components/layout/NotFoundView'
import { ensureAdminI18n, needsAdminI18n } from '~/i18n'
import { routeTree } from './routeTree.gen'

export function getRouter() {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: {
        staleTime: 30_000,
      },
      mutations: {
        retry: 0,
      },
    },
  })

  const router = createRouter({
    routeTree,
    context: { queryClient },
    scrollRestoration: true,
    trailingSlash: 'never',
    defaultNotFoundComponent: NotFoundView,
    // `beforeLoad` does not re-run for the server-rendered match on first load, so the admin dictionary
    // must be ready before hydration or the client renders raw keys (React hydration error #418).
    hydrate: async () => {
      if (needsAdminI18n(window.location.pathname)) {
        await ensureAdminI18n()
      }
    },
  })

  setupRouterSsrQueryIntegration({
    router,
    queryClient: queryClient as unknown as Parameters<
      typeof setupRouterSsrQueryIntegration
    >[0]['queryClient'],
  })

  return router
}

declare module '@tanstack/react-router' {
  interface Register {
    router: ReturnType<typeof getRouter>
  }
}
