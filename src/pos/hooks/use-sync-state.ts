import { useEffect, useState } from 'react'
import {
  deriveSyncIndicator,
  getGlobalSyncStore,
  type DerivedSyncIndicator,
  type SyncState,
} from '../sync'

export function useSyncState(): {
  syncState: SyncState
  indicator: DerivedSyncIndicator
} {
  const store = getGlobalSyncStore()
  const [syncState, setSyncState] = useState<SyncState>(() => store.getState())
  const [tickNowMs, setTickNowMs] = useState<number>(() => Date.now())

  useEffect(() => {
    const unsub = store.subscribe((next) => {
      setSyncState(next)
      setTickNowMs(Date.now())
    })
    return unsub
  }, [store])

  // Update elapsed syncing timer after 400ms threshold when actively syncing.
  useEffect(() => {
    if (syncState.conn !== 'SYNCING' || syncState.syncingSinceMs === null) {
      return
    }
    const timer = setTimeout(() => {
      setTickNowMs(Date.now())
    }, 450)
    return () => {
      clearTimeout(timer)
    }
  }, [syncState.conn, syncState.syncingSinceMs])

  return {
    syncState,
    indicator: deriveSyncIndicator(syncState, tickNowMs),
  }
}
