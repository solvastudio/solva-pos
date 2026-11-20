import type { ConnectivityState } from './connectivity'

export interface SyncState {
  conn: ConnectivityState
  queue: {
    pending: number
    oldestAt: string | null
    attention: number
  }
  device: 'OK' | 'LEASE_WARNING' | 'LOCKED'
  leaseHoursLeft?: number
  update: 'NONE' | 'AVAILABLE' | 'PENDING_APPLY' | 'REQUIRED'
  lastSuccessAt: string | null
  clockWarning: boolean
  syncingSinceMs: number | null
}

export type SyncIndicatorPrimary =
  | 'device_locked'
  | 'needs_attention'
  | 'syncing'
  | 'offline'
  | 'synced'
  | 'online'

export type SyncBannerItem =
  | { kind: 'update_required' }
  | { kind: 'lease_warning'; hoursLeft: number }
  | { kind: 'offline' }
  | { kind: 'pending'; count: number; oldestAt: string | null }
  | { kind: 'clock_warning' }
  | { kind: 'update_available' }

export interface DerivedSyncIndicator {
  primary: SyncIndicatorPrimary
  pendingBadge: { count: number; oldestAt: string | null } | null
  attentionCount: number
  lastSuccessAt: string | null
  banners: SyncBannerItem[]
}

export const SYNCING_INDICATOR_THRESHOLD_MS = 400
export const MAX_VISIBLE_BANNERS = 2

/**
 * Pure UI projection for CMP-17 (status indicator + stacked banners).
 * Priority: device_locked > needs_attention > syncing (> 400ms) > offline/unstable > synced/online.
 * Additive `pendingBadge` shows whenever pending > 0. Banners stack up to 2 items.
 */
export function deriveSyncIndicator(
  state: SyncState,
  nowMs: number = 0,
): DerivedSyncIndicator {
  let primary: SyncIndicatorPrimary

  if (state.device === 'LOCKED') {
    primary = 'device_locked'
  } else if (state.queue.attention > 0) {
    primary = 'needs_attention'
  } else if (
    state.conn === 'SYNCING' &&
    state.syncingSinceMs !== null &&
    nowMs - state.syncingSinceMs > SYNCING_INDICATOR_THRESHOLD_MS
  ) {
    primary = 'syncing'
  } else if (state.conn === 'OFFLINE' || state.conn === 'UNSTABLE') {
    primary = 'offline'
  } else if (state.lastSuccessAt !== null) {
    primary = 'synced'
  } else {
    primary = 'online'
  }

  const pendingBadge =
    state.queue.pending > 0
      ? { count: state.queue.pending, oldestAt: state.queue.oldestAt }
      : null

  const allBanners: SyncBannerItem[] = []
  if (state.update === 'REQUIRED') {
    allBanners.push({ kind: 'update_required' })
  }
  if (state.device === 'LEASE_WARNING') {
    allBanners.push({ kind: 'lease_warning', hoursLeft: state.leaseHoursLeft ?? 1 })
  }
  if (state.conn === 'OFFLINE' || state.conn === 'UNSTABLE') {
    allBanners.push({ kind: 'offline' })
  } else if (state.queue.pending > 0) {
    allBanners.push({
      kind: 'pending',
      count: state.queue.pending,
      oldestAt: state.queue.oldestAt,
    })
  }
  if (state.clockWarning) {
    allBanners.push({ kind: 'clock_warning' })
  }
  if (state.update === 'AVAILABLE' || state.update === 'PENDING_APPLY') {
    allBanners.push({ kind: 'update_available' })
  }

  return {
    primary,
    pendingBadge,
    attentionCount: state.queue.attention,
    lastSuccessAt: state.lastSuccessAt,
    banners: allBanners.slice(0, MAX_VISIBLE_BANNERS),
  }
}

export function createInitialSyncState(): SyncState {
  return {
    conn: 'PROBING',
    queue: { pending: 0, oldestAt: null, attention: 0 },
    device: 'OK',
    update: 'NONE',
    lastSuccessAt: null,
    clockWarning: false,
    syncingSinceMs: null,
  }
}

export interface SyncStateStore {
  getState(): SyncState
  patch(partial: Partial<SyncState>): void
  subscribe(listener: (state: SyncState) => void): () => void
}

export function createSyncStateStore(initial?: SyncState): SyncStateStore {
  let state: SyncState = initial ?? createInitialSyncState()
  const listeners = new Set<(s: SyncState) => void>()

  return {
    getState: () => state,
    patch(partial) {
      state = { ...state, ...partial }
      for (const listener of listeners) {
        listener(state)
      }
    },
    subscribe(listener) {
      listeners.add(listener)
      return () => {
        listeners.delete(listener)
      }
    },
  }
}
