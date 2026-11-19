import '@tanstack/react-start/server-only'
import { createLogger } from '~/server/log'

const log = createLogger('sync:signals')

type MasterChangedListener = (version: number) => void

const subs = new Map<string, Set<MasterChangedListener>>()

export function subscribeMasterChanged(
  tenantId: string,
  cb: MasterChangedListener,
): () => void {
  let set = subs.get(tenantId)
  if (!set) {
    set = new Set()
    subs.set(tenantId, set)
  }
  set.add(cb)

  return () => {
    const current = subs.get(tenantId)
    if (!current) return
    current.delete(cb)
    if (current.size === 0) {
      subs.delete(tenantId)
    }
  }
}

export function publishMasterChanged(tenantId: string, version: number): void {
  const listeners = subs.get(tenantId)
  if (!listeners || listeners.size === 0) return

  for (const cb of [...listeners]) {
    try {
      cb(version)
    } catch (err) {
      log.warn({ err, tenantId, reason: 'master_signal_listener_failed' }, 'signal listener failed')
    }
  }
}
