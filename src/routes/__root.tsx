import '~/i18n'
import type { QueryClient } from '@tanstack/react-query'
import { useEffect, type ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import { HeadContent, Outlet, Scripts, createRootRouteWithContext, type ErrorComponentProps } from '@tanstack/react-router'
import { NotFoundView } from '~/components/layout/NotFoundView'
import { RecoveryScreen } from '~/components/layout/RecoveryScreen'
import { getPublicLocaleFn } from '~/functions/i18n/public-locale.fn'
import { ensureAdminI18n, getLocale, i18next, needsAdminI18n, type Locale } from '~/i18n'
import { BRAND_NAME } from '~/lib/brand'
import appCss from '~/styles/app.css?url'

export interface RootRouterContext {
  queryClient: QueryClient
}

export const Route = createRootRouteWithContext<RootRouterContext>()({
  beforeLoad: async ({ location, cause }): Promise<void> => {
    if (needsAdminI18n(location.pathname)) {
      await ensureAdminI18n()
    }
    // Only the initial entry takes the browser language; client navigations and preloads keep the
    // current language, otherwise child routes (e.g. admin session locale) flip it back and forth.
    if (cause !== 'enter') return
    let publicLocale: Locale = getLocale()
    try {
      publicLocale = await getPublicLocaleFn()
    } catch {
      // Offline cold starts from the precached /pos shell cannot reach server functions.
    }
    if (i18next.language !== publicLocale) {
      await i18next.changeLanguage(publicLocale)
    }
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
  // Follows the active language (session locale in admin), not the browser-derived public locale.
  const { i18n } = useTranslation()
  const htmlLang = i18n.language === 'en-US' ? 'en' : 'id'
  // The server shell only knows the browser language; re-sync once the client has the session locale.
  useEffect(() => {
    document.documentElement.lang = htmlLang
  }, [htmlLang])

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
    <html lang={lang} suppressHydrationWarning>
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
