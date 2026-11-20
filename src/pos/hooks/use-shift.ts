import { useEffect, useState } from 'react'
import { observeOpenShiftForRegister } from '../data/shift.repo'
import type { SolvaDb } from '../db/solva-db'
import type { ShiftRecord } from '../db/types'

export interface UseShiftResult {
  openShift: ShiftRecord | null
  loading: boolean
}

export function useShift(db: SolvaDb | null, registerId: string | null): UseShiftResult {
  const [openShift, setOpenShift] = useState<ShiftRecord | null>(null)
  const [loading, setLoading] = useState<boolean>(true)

  useEffect(() => {
    if (!db || !registerId) {
      setOpenShift(null)
      setLoading(false)
      return
    }
    setLoading(true)
    const sub = observeOpenShiftForRegister(db, registerId).subscribe({
      next(shift) {
        setOpenShift(shift)
        setLoading(false)
      },
      error() {
        setLoading(false)
      },
    })
    return () => sub.unsubscribe()
  }, [db, registerId])

  return { openShift, loading }
}
