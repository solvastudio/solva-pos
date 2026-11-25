import type { z } from 'zod'
import type { CommandType } from '../enums'
import { upcastStoredPayload, type CommandUpcasterMap } from '../upcasters'
import { AppendAuditPayloadV1 } from './append-audit'
import { FinalizeCreditNotePayloadV1 } from './finalize-credit-note'
import { FinalizeSalePayloadV1 } from './finalize-sale'
import {
  AcceptBillPayloadV1,
  AppendBillEventsPayloadV1,
  CancelBillHandoverPayloadV1,
  HandOverBillPayloadV1,
} from './fnb'
import { ReportPinStatePayloadV1 } from './report-pin-state'
import { CloseShiftPayloadV1, OpenShiftPayloadV1, RecordCashMovementPayloadV1 } from './shift'
import { VoidSalePayloadV1 } from './void-sale'

export * from './append-audit'
export * from './finalize-credit-note'
export * from './finalize-sale'
export * from './fnb'
export * from './report-pin-state'
export * from './shift'
export * from './void-sale'

export type ContractErrorCode = 'UPDATE_REQUIRED' | 'VALIDATION_FAILED'

/**
 * Shared client/server contract error raised when a command schema version is retired or unrecognized.
 */
export class ContractError extends Error {
  constructor(
    public readonly code: ContractErrorCode,
    message: string,
  ) {
    super(message)
    this.name = 'ContractError'
  }
}

export const COMMAND_PAYLOAD_SCHEMAS: Record<CommandType, Record<number, z.ZodType>> = {
  FinalizeSale: { 1: FinalizeSalePayloadV1 },
  VoidSale: { 1: VoidSalePayloadV1 },
  FinalizeCreditNote: { 1: FinalizeCreditNotePayloadV1 },
  OpenShift: { 1: OpenShiftPayloadV1 },
  RecordCashMovement: { 1: RecordCashMovementPayloadV1 },
  CloseShift: { 1: CloseShiftPayloadV1 },
  AppendAudit: { 1: AppendAuditPayloadV1 },
  AppendBillEvents: { 1: AppendBillEventsPayloadV1 },
  HandOverBill: { 1: HandOverBillPayloadV1 },
  AcceptBill: { 1: AcceptBillPayloadV1 },
  CancelBillHandover: { 1: CancelBillHandoverPayloadV1 },
  ReportPinState: { 1: ReportPinStatePayloadV1 },
}

export function hasRegisteredCommandSchema(type: CommandType): boolean {
  return Object.keys(COMMAND_PAYLOAD_SCHEMAS[type]).length > 0
}

export function getLatestSchemaVersion(
  type: CommandType,
  schemas: Partial<Record<CommandType, Record<number, z.ZodType>>> = COMMAND_PAYLOAD_SCHEMAS,
): number | null {
  const versionMap = schemas[type]
  if (!versionMap) return null
  const versions = Object.keys(versionMap)
    .map(Number)
    .filter((v) => Number.isInteger(v) && v >= 1)
    .sort((a, b) => a - b)
  return versions.length > 0 ? versions[versions.length - 1]! : null
}

/**
 * Selects the schema matching `(type, schemaVersion)`, validates structurally with Zod,
 * and upcasts the parsed payload to the latest contract version for `type`.
 */
export function parseCommandPayload(
  type: CommandType,
  schemaVersion: number,
  payload: unknown,
  overrides?: {
    schemas?: Partial<Record<CommandType, Record<number, z.ZodType>>>
    upcasters?: CommandUpcasterMap
  },
): unknown {
  const schemas = overrides?.schemas ?? COMMAND_PAYLOAD_SCHEMAS
  const versionMap = schemas[type]
  if (!versionMap) {
    throw new ContractError('VALIDATION_FAILED', `No payload schemas registered for ${type}`)
  }

  const versions = Object.keys(versionMap)
    .map(Number)
    .filter((v) => Number.isInteger(v) && v >= 1)
    .sort((a, b) => a - b)

  if (versions.length === 0) {
    throw new ContractError('VALIDATION_FAILED', `No schema versions registered for ${type}`)
  }

  const minVersion = versions[0]!
  const maxVersion = versions[versions.length - 1]!

  if (!Number.isInteger(schemaVersion) || schemaVersion < minVersion) {
    throw new ContractError(
      'UPDATE_REQUIRED',
      `Schema version ${schemaVersion} for ${type} is below minimum supported v${minVersion}`,
    )
  }

  const schema = versionMap[schemaVersion]
  if (!schema) {
    throw new ContractError(
      'VALIDATION_FAILED',
      `Unknown schema version ${schemaVersion} for ${type}`,
    )
  }

  const parsed = schema.parse(payload)
  return upcastStoredPayload(type, schemaVersion, parsed, {
    upcasters: overrides?.upcasters,
    targetVersion: maxVersion,
  })
}
