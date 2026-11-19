/**
 * Daftar field log tertutup (BR-LOG-006, FR-LOG-003).
 * Penambahan field baru wajib didaftarkan di sini sebelum dipakai di pemanggil logger.
 */
export const LOG_FIELD_NAMES = [
  'err',
  'reason',
  'label',
  'durationMs',
  'fn',
  'publicCode',
  'method',
  'path',
  'status',
  'ip',
  'commandId',
  'commandType',
  'outcome',
  'saleId',
  'invoiceNo',
  'outletId',
  'cursorFrom',
  'cursorTo',
  'rowCount',
  'schemaVersion',
  'appVersion',
  'origin',
  'route',
  'userAgent',
  'componentStack',
  'clientError',
  'usernameHash',
  'usernameLength',
  'refLocal',
  'errorClass',
  'notifyKind',
  'idempotencyKey',
  'scope',
  'tenantId',
  'userId',
  'deviceId',
  'registerId',
  'reqId',
  'jobId',
  'parentReqId',
  'env',
] as const

export type LogFieldName = (typeof LOG_FIELD_NAMES)[number]

export type LogFields = Partial<{
  err: unknown
  reason: string
  label: string
  durationMs: number
  fn: string
  publicCode: string
  method: string
  path: string
  status: number
  ip: string
  commandId: string
  commandType: string
  outcome: 'ACK' | 'RETRY' | 'ATTENTION' | string
  saleId: string
  invoiceNo: string
  outletId: string
  cursorFrom: number
  cursorTo: number
  rowCount: number
  schemaVersion: number
  appVersion: string
  origin: string
  route: string
  userAgent: string
  componentStack: string
  clientError: { name: string; message: string; stack?: string }
  usernameHash: string
  usernameLength: number
  refLocal: string
  errorClass: string
  notifyKind: string
  idempotencyKey: string
  scope: string
  tenantId: string
  userId: string
  deviceId: string
  registerId: string
  reqId: string
  jobId: string
  parentReqId: string
  env: string
}>
