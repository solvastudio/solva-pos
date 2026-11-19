import type { AttentionReasonClass, CommandType } from '~/lib/contracts'

export interface SyncDeviceIdentity {
  tenantId: string
  deviceId: string
  registerId: string
  outletId: string
  registerType: 'CASHIER' | 'WAITER'
}

export class CommandRejected extends Error {
  constructor(
    public readonly reasonClass: AttentionReasonClass,
    public readonly reasonCode: string,
    public readonly detail?: string,
  ) {
    super(reasonCode)
    this.name = 'CommandRejected'
  }
}

export interface CommandContext {
  commandId: string
  deviceSeq: number
  schemaVersion: number
  appVersion: string | null
  createdAtDevice: string
  clockOffsetMs: number
  receivedAtIso: string
  requestRef: string
  device: SyncDeviceIdentity
}

export interface CommandHandler<P = unknown, Tx = unknown> {
  readonly type: CommandType
  parse(payload: unknown, schemaVersion: number): P
  handle(tx: Tx, ctx: CommandContext, payload: P): Promise<Record<string, unknown>>
}

export const WAITER_FORBIDDEN_TYPES: ReadonlySet<string> = new Set<CommandType>([
  'FinalizeSale',
  'FinalizeCreditNote',
  'OpenShift',
  'CloseShift',
  'RecordCashMovement',
  'VoidSale',
])
