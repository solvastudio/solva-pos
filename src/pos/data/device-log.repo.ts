import Dexie from 'dexie'
import type { SolvaDb } from '../db/solva-db'
import { DeviceLogRowInputSchema, type DeviceLogRow } from '../db/types'

export const MAX_DEVICE_LOG_ROWS = 500

export async function appendDeviceLogRow(
  db: SolvaDb,
  entry: Omit<DeviceLogRow, 'id'>,
): Promise<number> {
  const validated = DeviceLogRowInputSchema.parse(entry)
  return db.transaction('rw', db.device_log, async () => {
    const insertedId = await db.device_log.add(validated)
    const total = await db.device_log.count()
    if (total > MAX_DEVICE_LOG_ROWS) {
      const excess = total - MAX_DEVICE_LOG_ROWS
      const oldestKeys = await db.device_log.orderBy(':id').limit(excess).primaryKeys()
      if (oldestKeys.length > 0) {
        await db.device_log.bulkDelete(oldestKeys)
      }
    }
    return insertedId
  })
}

export async function takePendingDeviceLogBatch(
  db: SolvaDb,
  limit: number = 100,
): Promise<DeviceLogRow[]> {
  return db.device_log
    .where('[send_status+id]')
    .between(['PENDING', Dexie.minKey], ['PENDING', Dexie.maxKey])
    .limit(limit)
    .toArray()
}

export async function markDeviceLogSent(db: SolvaDb, ids: readonly number[]): Promise<void> {
  if (ids.length === 0) return
  await db.device_log.bulkDelete([...ids])
}

export async function countDeviceLogs(db: SolvaDb): Promise<number> {
  return db.device_log.count()
}
