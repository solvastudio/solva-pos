import type { Table, Transaction } from 'dexie'
import {
  COMMAND_PAYLOAD_SCHEMAS,
  COMMAND_TYPE,
  SCHEMA_VERSION,
  migrateCommandPayload,
  type CommandType,
  type MigrateOptions,
} from '~/lib/contracts'
import type { OutboxCommandRow } from '../types'

const VALID_COMMAND_TYPES = new Set<string>(COMMAND_TYPE)

export interface OutboxMigrationSummary {
  readonly scanned: number
  readonly migrated: number
  readonly unmigratable: number
}

export interface MigrateOutboxOptions {
  targetSchemaVersion?: number
  migrateOptions?: MigrateOptions
}

/**
 * Forward-migrates non-ACKED/non-DISMISSED `outbox_command` payloads whose stored
 * `schema_version < targetSchemaVersion` during a Dexie schema upgrade (`N-1 -> N`).
 * Unmigratable rows are NEVER deleted — they are marked `SCHEMA_NOT_MIGRATABLE`
 * and held (`last_error_class='SCHEMA'`) so cashiers can always export them (EC-007).
 */
export async function migrateOutbox(
  tx: Transaction,
  fromVersion: number,
  toVersion: number,
  opts?: MigrateOutboxOptions,
): Promise<OutboxMigrationSummary> {
  const targetSchema = opts?.targetSchemaVersion ?? SCHEMA_VERSION
  if (!Number.isInteger(fromVersion) || !Number.isInteger(toVersion) || toVersion <= fromVersion) {
    return { scanned: 0, migrated: 0, unmigratable: 0 }
  }

  const outboxTable: Table<OutboxCommandRow, string> = tx.table('outbox_command')
  const rows = await outboxTable.toArray()

  let scanned = 0
  let migrated = 0
  let unmigratable = 0

  for (const row of rows) {
    if (row.status === 'ACKED' || row.status === 'DISMISSED') continue
    if (row.schema_version >= targetSchema) continue
    scanned += 1

    try {
      if (!VALID_COMMAND_TYPES.has(row.type)) {
        throw new Error(`Unknown command type ${row.type}`)
      }
      const nextPayload = migrateCommandPayload(
        row.type as CommandType,
        row.schema_version,
        targetSchema,
        row.payload,
        {
          migrators: opts?.migrateOptions?.migrators,
          schemas: opts?.migrateOptions?.schemas ?? COMMAND_PAYLOAD_SCHEMAS,
        },
      )

      const wasNotMigratableHold =
        row.last_error_class === 'SCHEMA' && row.last_error_code === 'SCHEMA_NOT_MIGRATABLE'

      await outboxTable.update(row.id, {
        payload: nextPayload,
        schema_version: targetSchema,
        ...(wasNotMigratableHold
          ? { last_error_class: null, last_error_code: null }
          : {}),
      })
      migrated += 1
    } catch {
      await outboxTable.update(row.id, {
        last_error_class: 'SCHEMA',
        last_error_code: 'SCHEMA_NOT_MIGRATABLE',
      })
      unmigratable += 1
    }
  }

  return { scanned, migrated, unmigratable }
}
