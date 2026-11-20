/// <reference lib="webworker" />
import { cacheNames, setCacheNameDetails } from 'workbox-core'
import { PrecacheController, PrecacheRoute } from 'workbox-precaching'
import { NavigationRoute, registerRoute } from 'workbox-routing'
import {
  consumePendingFirstClaim,
  entriesToDelete,
  lastGoodKey,
  MANIFEST_CACHE_NAME,
  META_CACHE_NAME,
  prepareFirstClaimOnInstall,
  readAllManifests,
  readProtectedLastGoodUrls,
  recordManifest,
  removeManifest,
  unionManifests,
  writeLastGood,
} from './cache-cleanup'

declare const __APP_VERSION__: string

declare const self: ServiceWorkerGlobalScope & {
  __WB_MANIFEST: Array<{ url: string; revision: string | null }>
}

setCacheNameDetails({ precache: 'solva-precache', prefix: '', suffix: '' })

const pc = new PrecacheController({ cacheName: cacheNames.precache })
pc.addToCacheList(self.__WB_MANIFEST)

function currentPrecacheUrls(): string[] {
  return Array.from(pc.getURLsToCacheKeys().values())
}

async function runCrossTenantCacheCleanup(): Promise<void> {
  const mCache = await caches.open(MANIFEST_CACHE_NAME)
  const metaCache = await caches.open(META_CACHE_NAME)
  const records = await readAllManifests(mCache)
  const union = unionManifests(records)
  const protectLastGood = await readProtectedLastGoodUrls(metaCache)

  const pCache = await caches.open(cacheNames.precache)
  const pKeys = await pCache.keys()
  const staleUrls = entriesToDelete(
    pKeys.map((req) => req.url),
    union,
    protectLastGood,
  )

  for (const url of staleUrls) {
    await pCache.delete(url)
  }
}

self.addEventListener('install', (event) => {
  const hasActiveWorker = Boolean(self.registration.active)
  const installPromise = pc.install(event)
  event.waitUntil(
    (async () => {
      await installPromise
      const [mCache, metaCache] = await Promise.all([
        caches.open(MANIFEST_CACHE_NAME),
        caches.open(META_CACHE_NAME),
      ])
      await Promise.all([
        recordManifest(mCache, self.registration.scope, currentPrecacheUrls()),
        prepareFirstClaimOnInstall(metaCache, self.registration.scope, hasActiveWorker),
      ])
    })(),
  )
})

self.addEventListener('activate', (event) => {
  event.waitUntil(
    (async () => {
      const metaCache = await caches.open(META_CACHE_NAME)
      if (await consumePendingFirstClaim(metaCache, self.registration.scope)) {
        await self.clients.claim()
      }
      await runCrossTenantCacheCleanup()
    })(),
  )
})

self.addEventListener('message', (event) => {
  const payload = event.data as
    | { type?: string; appVersion?: string; dbVersion?: number }
    | undefined
  if (!payload || typeof payload.type !== 'string') {
    return
  }

  if (payload.type === 'SKIP_WAITING') {
    // Only skipWaiting on explicit user/app UpdateManager command (registerType: 'prompt').
    void self.skipWaiting()
    return
  }

  if (payload.type === 'GET_VERSION') {
    const appVersion = typeof __APP_VERSION__ !== 'undefined' ? __APP_VERSION__ : 'dev'
    event.ports[0]?.postMessage({ type: 'VERSION', version: appVersion })
    return
  }

  if (payload.type === 'BOOT_OK') {
    event.waitUntil(
      (async () => {
        const metaCache = await caches.open(META_CACHE_NAME)
        await writeLastGood(metaCache, {
          scope: self.registration.scope,
          appVersion:
            typeof payload.appVersion === 'string'
              ? payload.appVersion
              : typeof __APP_VERSION__ !== 'undefined'
                ? __APP_VERSION__
                : 'dev',
          dexieVersion:
            typeof payload.dbVersion === 'number' && Number.isFinite(payload.dbVersion)
              ? payload.dbVersion
              : 0,
          urls: currentPrecacheUrls(),
          markedAt: new Date().toISOString(),
        })
        await runCrossTenantCacheCleanup()
      })(),
    )
    return
  }

  if (payload.type === 'RESET_TENANT') {
    event.waitUntil(
      (async () => {
        const mCache = await caches.open(MANIFEST_CACHE_NAME)
        await removeManifest(mCache, self.registration.scope)
        const metaCache = await caches.open(META_CACHE_NAME)
        await metaCache.delete(lastGoodKey(self.registration.scope))
        await runCrossTenantCacheCleanup()
      })(),
    )
  }
})

registerRoute(new PrecacheRoute(pc))

const recoveryHandler = pc.createHandlerBoundToURL('/recovery.html')
registerRoute(
  ({ request, url }) =>
    request.mode === 'navigate' && /^\/[^/]+\/pos\/recovery\/?$/.test(url.pathname),
  async (ctx) => {
    const res = await recoveryHandler(ctx)
    const headers = new Headers(res.headers)
    headers.set('X-From-SW', '1')
    return new Response(res.body, {
      status: res.status,
      statusText: res.statusText,
      headers,
    })
  },
)

const shellHandler = pc.createHandlerBoundToURL('/pos-shell.html')
registerRoute(
  new NavigationRoute(
    async (ctx) => {
      const res = await shellHandler(ctx)
      const headers = new Headers(res.headers)
      headers.set('X-From-SW', '1')
      return new Response(res.body, {
        status: res.status,
        statusText: res.statusText,
        headers,
      })
    },
    {
      allowlist: [/^\/[^/]+\/pos(\/|$)/],
      denylist: [
        /^\/api\//,
        /^\/[^/]+\/admin/,
        /^\/[^/]+\/(join|reset)/,
        /^\/platform/,
        /\/manifest\.webmanifest$/,
        /^\/[^/]+\/pos\/recovery(\/|$)/,
      ],
    },
  ),
)
