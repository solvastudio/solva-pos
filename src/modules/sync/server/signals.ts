import '@tanstack/react-start/server-only'
import { createLogger } from '~/server/log'

const log = createLogger('sync:signals')

type MasterChangedListener = (version: number) => void
type BillsChangedListener = (outletId: string) => void

const subs = new Map<string, Set<MasterChangedListener>>()
const billSubs = new Map<string, Set<BillsChangedListener>>()

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

export function subscribeBillsChanged(
  tenantId: string,
  cb: BillsChangedListener,
): () => void {
  const tKey = tenantId.toLowerCase()
  let set = billSubs.get(tKey)
  if (!set) {
    set = new Set()
    billSubs.set(tKey, set)
  }
  set.add(cb)

  return () => {
    const current = billSubs.get(tKey)
    if (!current) return
    current.delete(cb)
    if (current.size === 0) {
      billSubs.delete(tKey)
    }
  }
}

export function publishBillsChanged(tenantId: string, outletId: string): void {
  const tKey = tenantId.toLowerCase()
  const listeners = billSubs.get(tKey)
  if (!listeners || listeners.size === 0) return

  const oKey = outletId.toLowerCase()
  for (const cb of [...listeners]) {
    try {
      cb(oKey)
    } catch (err) {
      log.warn({ err, tenantId: tKey, outletId: oKey, reason: 'bill_signal_listener_failed' }, 'bill signal listener failed')
    }
  }
}
