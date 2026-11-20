import type { z } from 'zod'
import type { CommandType } from '../enums'

export type PayloadStepFn = (payload: unknown) => unknown
export type CommandMigratorMap = Partial<Record<CommandType, Record<number, PayloadStepFn>>>
export type CommandSchemaRegistry = Partial<Record<CommandType, Record<number, z.ZodType>>>

/**
 * Client-side forward command payload migrators (`fromVersion -> fromVersion + 1`).
 *
 * Contract evolution rules (AD-29, SCHEMA §2.5, BR-SYN-022):
 * - Migrator (client, forward at upgrade/outbox time) is distinct from Upcaster (server, read/accept older versions).
 * - Golden fixtures for every released schema version MUST be preserved forever (`tests/fixtures/contracts/vN/`).
 * - When bumping a contract to v2: add the v2 Zod schema, add a `1: (p) => ...` entry here and in `UPCASTERS`,
 *   add v2 golden fixtures, and update `SUPPORTED_SCHEMA_VERSIONS = [2, 1]` and `SCHEMA_VERSION = 2`.
 */
export const MIGRATORS: CommandMigratorMap = {
  FinalizeSale: {},
  VoidSale: {},
  FinalizeCreditNote: {},
  OpenShift: {},
  RecordCashMovement: {},
  CloseShift: {},
  AppendAudit: {},
  AppendBillEvents: {},
  HandOverBill: {},
  AcceptBill: {},
  CancelBillHandover: {},
  ReportPinState: {},
}

export interface MigrateOptions {
  migrators?: CommandMigratorMap
  schemas?: CommandSchemaRegistry
}

/**
 * Migrates a pending client command payload forward from `fromVersion` to `toVersion`
 * by chaining step migrators (`v -> v + 1`) and validating the result against the target schema.
 */
export function migrateCommandPayload(
  type: CommandType,
  fromVersion: number,
  toVersion: number,
  payload: unknown,
  options?: MigrateOptions,
): unknown {
  if (!Number.isInteger(fromVersion) || !Number.isInteger(toVersion) || fromVersion < 1 || toVersion < fromVersion) {
    throw new Error(`Invalid migration range for ${type}: ${fromVersion} -> ${toVersion}`)
  }

  const migrators = options?.migrators ?? MIGRATORS
  let current = payload

  for (let v = fromVersion; v < toVersion; v += 1) {
    const step = migrators[type]?.[v]
    if (!step) {
      throw new Error(`Missing client migrator for ${type} from v${v} to v${v + 1}`)
    }
    current = step(current)
  }

  const targetSchema = options?.schemas?.[type]?.[toVersion]
  if (targetSchema) {
    return targetSchema.parse(current)
  }

  return current
}
