import '@tanstack/react-start/server-only'
import { createLogger } from '../log'
import type { TenantTx } from './tenant-tx'

const log = createLogger('db:after-commit')

export type AfterCommitCallback = () => void | Promise<void>

const registry = new WeakMap<object, AfterCommitCallback[]>()

export function registerAfterCommit(tx: TenantTx, cb: AfterCommitCallback): void {
  const existing = registry.get(tx)
  if (existing) {
    existing.push(cb)
  } else {
    registry.set(tx, [cb])
  }
}

export async function runAfterCommit(tx: object): Promise<void> {
  const callbacks = registry.get(tx)
  if (!callbacks) return
  registry.delete(tx)

  for (const cb of callbacks) {
    try {
      await cb()
    } catch (err) {
      log.warn({ err, reason: 'after_commit_callback_failed' }, 'after-commit callback failed')
    }
  }
}

export function clearAfterCommit(tx: object): void {
  registry.delete(tx)
}
