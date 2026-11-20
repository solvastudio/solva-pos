import { useEffect, useState } from 'react'
import {
  observeFailedPrintJobs,
  observePrintJobForEntity,
} from '../data/print-job.repo'
import type { SolvaDb } from '../db/solva-db'
import type { PrintJobRecord } from '../db/types'

export function usePrintJobForEntity(
  db: SolvaDb | null,
  entityId: string | null,
): PrintJobRecord | null {
  const [job, setJob] = useState<PrintJobRecord | null>(null)

  useEffect(() => {
    if (!db || !entityId) {
      setJob(null)
      return
    }
    const sub = observePrintJobForEntity(db, entityId).subscribe({
      next(row) {
        setJob(row)
      },
    })
    return () => sub.unsubscribe()
  }, [db, entityId])

  return job
}

export function useFailedPrintJobs(db: SolvaDb | null): PrintJobRecord[] {
  const [jobs, setJobs] = useState<PrintJobRecord[]>([])

  useEffect(() => {
    if (!db) {
      setJobs([])
      return
    }
    const sub = observeFailedPrintJobs(db).subscribe({
      next(rows) {
        setJobs(rows)
      },
    })
    return () => sub.unsubscribe()
  }, [db])

  return jobs
}
