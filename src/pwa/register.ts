import { Workbox } from 'workbox-window'
import { UpdateManager } from './update-manager'

export interface RegisterPosSwOptions {
  onUpdateAvailable?: (manager: UpdateManager) => void
  onUpdateCheck?: (checkFn: () => Promise<void>) => void
}

function isPosScopePath(pathname: string, slug: string): boolean {
  const prefix = `/${slug}/pos`
  return pathname === prefix || pathname.startsWith(`${prefix}/`)
}

/**
 * Registers the shared `/sw.js` under the tenant-specific scope `/<slug>/pos/`.
 * Uses `workbox-window` with `registerType: 'prompt'` (never auto-skips waiting).
 */
export async function registerPosServiceWorker(
  slug: string,
  options?: RegisterPosSwOptions,
): Promise<UpdateManager | null> {
  if (typeof window === 'undefined' || !('serviceWorker' in navigator)) {
    return null
  }
  if (!isPosScopePath(window.location.pathname, slug)) {
    return null
  }

  const scope = `/${slug}/pos/`
  const wb = new Workbox('/sw.js', { scope })

  const manager = new UpdateManager({
    sendSkipWaiting: () => {
      wb.messageSkipWaiting()
    },
    reloadPage: () => {
      window.location.reload()
    },
  })

  wb.addEventListener('waiting', () => {
    manager.markAvailable()
    options?.onUpdateAvailable?.(manager)
  })

  wb.addEventListener('controlling', () => {
    manager.handleControllerChange()
  })

  await wb.register()

  // Also check if an update worker is already waiting prior to listener attachment.
  try {
    const existingReg = await navigator.serviceWorker.getRegistration(scope)
    if (existingReg?.waiting) {
      manager.markAvailable()
      options?.onUpdateAvailable?.(manager)
    }
  } catch {
    // Non-fatal; Workbox waiting event covers normal updates.
  }

  options?.onUpdateCheck?.(async () => {
    try {
      await wb.update()
    } catch {
      // Offline update checks fail harmlessly.
    }
  })

  return manager
}

/**
 * Signals the controlling POS service worker that the app rendered cleanly,
 * unlocking safe cross-version cache pruning for superseded asset builds.
 */
export function notifyPosBootOk(input: { appVersion: string; dbVersion: number }): boolean {
  if (typeof navigator === 'undefined' || !('serviceWorker' in navigator)) {
    return false
  }
  const controller = navigator.serviceWorker.controller
  if (!controller) {
    return false
  }
  controller.postMessage({
    type: 'BOOT_OK',
    appVersion: input.appVersion,
    dbVersion: input.dbVersion,
  })
  return true
}
