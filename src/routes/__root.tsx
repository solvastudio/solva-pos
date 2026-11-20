import '~/i18n'
import type { QueryClient } from '@tanstack/react-query'
import type { ReactNode } from 'react'
import { HeadContent, Outlet, Scripts, createRootRouteWithContext, type ErrorComponentProps } from '@tanstack/react-router'
import { NotFoundView } from '~/components/layout/NotFoundView'
import { RecoveryScreen } from '~/components/layout/RecoveryScreen'
import { getPublicLocaleFn } from '~/functions/i18n/public-locale.fn'
import { getLocale, i18next, type Locale } from '~/i18n'
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
    let publicLocale: Locale = getLocale()
    try {
      publicLocale = await getPublicLocaleFn()
    } catch {
      // Offline cold starts from the precached /pos shell cannot reach server functions.
    }
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

const POS_BOOT_WATCHDOG_SCRIPT = `(function(){
  try {
    var p = location.pathname;
    var m = /^\\/([^/]+)\\/pos(?:\\/|$)/.exec(p);
    if (!m || /\\/pos\\/recovery(?:\\/|$)/.test(p)) return;
    var slug = m[1];
    var key = 'solva:' + slug + ':bootfail';
    window.__solvaPosBooted = false;
    function makeRef() {
      var d = new Date();
      function pad(n) { return String(n).padStart(2, '0'); }
      var day = d.getUTCFullYear() + pad(d.getUTCMonth() + 1) + pad(d.getUTCDate());
      var tm = pad(d.getUTCHours()) + pad(d.getUTCMinutes()) + pad(d.getUTCSeconds());
      return 'D-' + day + '-' + tm + '-00000';
    }
    function goRecovery() {
      location.replace('/' + slug + '/pos/recovery?code=APP_ERROR&ref=' + makeRef());
    }
    var timer = setTimeout(function() {
      if (!window.__solvaPosBooted) goRecovery();
    }, 15000);
    function onCrash() {
      if (window.__solvaPosBooted) return;
      var now = Date.now();
      var cut = now - 60000;
      var arr = [];
      try {
        var raw = sessionStorage.getItem(key);
        if (raw) {
          var parsed = JSON.parse(raw);
          if (Array.isArray(parsed)) {
            arr = parsed.filter(function(ts) { return typeof ts === 'number' && ts >= cut && ts <= now; });
          }
        }
        arr.push(now);
        sessionStorage.setItem(key, JSON.stringify(arr));
      } catch (_e) {}
      if (arr.length >= 2) goRecovery();
    }
    window.addEventListener('error', onCrash);
    window.addEventListener('unhandledrejection', onCrash);
    window.__solvaPosMarkBootOk = function() {
      window.__solvaPosBooted = true;
      clearTimeout(timer);
      window.removeEventListener('error', onCrash);
      window.removeEventListener('unhandledrejection', onCrash);
      try { sessionStorage.removeItem(key); } catch (_e) {}
    };
  } catch (_e) {}
})();`

function RootDocument({ children, lang }: { children: ReactNode; lang: string }) {
  return (
    <html lang={lang}>
      <head>
        <HeadContent />
      </head>
      <body>
        {children}
        <script dangerouslySetInnerHTML={{ __html: POS_BOOT_WATCHDOG_SCRIPT }} />
        <Scripts />
      </body>
    </html>
  )
}
