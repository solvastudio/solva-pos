import type { SolvaDb } from '../db/solva-db'

export interface InitialSyncProgress {
  step: number
  total: number
  label: string
}

export interface InitialSyncHandle {
  subscribe(listener: (progress: InitialSyncProgress) => void): () => void
  done: Promise<'OK' | 'FAILED'>
}

// STUB Fase 28 — replaced with real full-resync pipeline in Fase 29.
export function startInitialSync(_db: SolvaDb): InitialSyncHandle {
  const step: InitialSyncProgress = { step: 1, total: 1, label: 'complete' }
  return {
    subscribe(listener) {
      listener(step)
      return () => {}
    },
    done: Promise.resolve('OK'),
  }
}
