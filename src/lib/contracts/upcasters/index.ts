import type { z } from 'zod'
import type { CommandType } from '../enums'

export type PayloadUpcasterFn = (payload: unknown) => unknown
export type CommandUpcasterMap = Partial<Record<CommandType, Record<number, PayloadUpcasterFn>>>
export type CommandUpcasterSchemaRegistry = Partial<Record<CommandType, Record<number, z.ZodType>>>

/**
 * Server-side command payload upcasters (`storedVersion -> storedVersion + 1`).
 *
 * Contract evolution rules (AD-29, SCHEMA §2.5):
 * - Upcaster runs on the server so old supported command versions or historical stored payloads can always be lifted
 *   to the latest in-memory representation without mutating historical DB logs (`upcaster != migrator`).
 * - Keep all prior schemas and golden fixtures intact forever.
 * - When bumping to v2: add `1: (p) => ...` upcaster here alongside the client migrator and v2 schema.
 */
export const UPCASTERS: CommandUpcasterMap = {
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

export interface UpcastOptions {
  upcasters?: CommandUpcasterMap
  targetVersion?: number
}

/**
 * Lifts a validated `version` command payload up to `targetVersion` (or current latest if already latest).
 */
export function upcastStoredPayload(
  type: CommandType,
  version: number,
  payload: unknown,
  options?: UpcastOptions,
): unknown {
  if (!Number.isInteger(version) || version < 1) {
    throw new Error(`Invalid stored payload version for ${type}: ${version}`)
  }

  const targetVersion = options?.targetVersion ?? version
  if (version > targetVersion) {
    throw new Error(`Cannot downcast ${type} payload from v${version} to v${targetVersion}`)
  }

  const upcasters = options?.upcasters ?? UPCASTERS
  let current = payload

  for (let v = version; v < targetVersion; v += 1) {
    const step = upcasters[type]?.[v]
    if (!step) {
      throw new Error(`Missing server upcaster for ${type} from v${v} to v${v + 1}`)
    }
    current = step(current)
  }

  return current
}
