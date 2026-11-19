import { AppendAuditPayloadV1 } from './append-audit'

export * from './append-audit'

export const COMMAND_PAYLOAD_SCHEMAS = {
  AppendAudit: AppendAuditPayloadV1,
} as const
