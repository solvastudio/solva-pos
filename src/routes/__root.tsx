import '~/i18n'
import type { QueryClient } from '@tanstack/react-query'
import type { ReactNode } from 'react'
import { HeadContent, Outlet, Scripts, createRootRouteWithContext, type ErrorComponentProps } from '@tanstack/react-router'
import { NotFoundView } from '~/components/layout/NotFoundView'
import { RecoveryScreen } from '~/components/layout/RecoveryScreen'
import { getPublicLocaleFn } from '~/functions/i18n/public-locale.fn'
import { i18next, type Locale } from '~/i18n'
import { BRAND_NAME } from '~/lib/brand'
import appCss from '~/styles/app.css?url'

export interface RootRouterContext {
  queryClient: QueryClient
}

export interface RootRouteContext {
  publicLocale: Locale
}

export const Route = createRootRouteWithContext<RootRouterContext>()({
  beforeLoad: async (): Promise<RootRouteContext> => {
    const publicLocale = await getPublicLocaleFn()
    if (i18next.language !== publicLocale) {
      await i18next.changeLanguage(publicLocale)
    }
    return { publicLocale }
  },
  head: () => ({
    meta: [
      { charSet: 'utf-8' },
      { name: 'viewport', content: 'width=device-width, initial-scale=1' },
      { title: BRAND_NAME },
    ],
    links: [{ rel: 'stylesheet', href: appCss }],
  }),
  notFoundComponent: NotFoundView,
  errorComponent: RootErrorComponent,
  component: RootComponent,
})

function RootErrorComponent({ error, reset }: ErrorComponentProps) {
  return <RecoveryScreen error={error} onReload={reset} />
}

function RootComponent() {
  const { publicLocale } = Route.useRouteContext()
  const htmlLang = publicLocale === 'en-US' ? 'en' : 'id'

  return (
    <RootDocument lang={htmlLang}>
      <Outlet />
    </RootDocument>
  )
}

function RootDocument({ children, lang }: { children: ReactNode; lang: string }) {
  return (
    <html lang={lang}>
      <head>
        <HeadContent />
      </head>
      <body>
        {children}
        <Scripts />
      </body>
    </html>
  )
}
