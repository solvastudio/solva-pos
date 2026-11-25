import { APP_VERSION } from '~/lib/app-version'
import {
  BillDetailResponseSchema,
  SCHEMA_VERSION,
  type BillDetailResponse,
} from '~/lib/contracts'
import { createIdGenerator } from '~/lib/kernel'
import {
  markLocalBillHandoverCanceled,
  markLocalBillHandoverPending,
  nextStandaloneDeviceSeq,
} from '../data/bill.repo'
import { materializeAcceptedBill } from '../data/bill-snapshot.repo'
import { getMeta } from '../data/meta.repo'
import type { SolvaDb } from '../db/solva-db'
import type { BillRecord } from '../db/types'
import { deviceFetch, type DeviceFetchOptions } from './device-http'

const HANDOVER_TIMEOUT_MS = 10_000
const MAX_429_RETRIES = 3

const idGen = createIdGenerator({
  nowMs: () => Date.now(),
  nextUint32: () => {
    const buf = new Uint32Array(1)
    globalThis.crypto.getRandomValues(buf)
    return buf[0]!
  },
})

export type HandoverClientErrorCode =
  | 'OFFLINE'
  | 'DEVICE_NOT_PAIRED'
  | 'EVENTS_PENDING'
  | 'HANDOVER_NOT_PENDING'
  | 'FORBIDDEN'
  | 'RATE_LIMITED'
  | 'TIMEOUT'
  | 'VALIDATION_FAILED'
  | 'NETWORK'

export type HandoverClientResult =
  | { readonly ok: true; readonly billId: string; readonly lastEventSeq: number; readonly acceptedBill?: BillRecord }
  | { readonly ok: false; readonly code: HandoverClientErrorCode }

export interface HandoverClientDeps {
  readonly fetch?: typeof fetch
  readonly sleep?: (ms: number) => Promise<void>
  readonly newId?: () => string
  readonly nowMs?: () => number
  readonly isOnline?: () => boolean
}

interface HandoverServerAck {
  bill_id: string
  bill_seq: number
  status: 'ACK'
  lease_register_id: string
  last_event_seq: number
  server_time: string
}

async function fetchWith429Retry<T>(
  path: string,
  opts: DeviceFetchOptions,
  sleepFn: (ms: number) => Promise<void>,
) {
  let attempt = 0
  while (true) {
    const res = await deviceFetch<T>(path, opts)
    if (res.kind === 'rate_limited' && attempt < MAX_429_RETRIES) {
      attempt += 1
      await sleepFn(Math.min(res.retryAfterMs, 2_000))
      continue
    }
    return res
  }
}

function mapFailureCode(
  res: Exclude<Awaited<ReturnType<typeof deviceFetch>>, { kind: 'ok' }>,
): HandoverClientErrorCode {
  if (res.kind === 'rate_limited') return 'RATE_LIMITED'
  if (res.kind === 'timeout') return 'TIMEOUT'
  if (res.kind === 'auth') return res.code === 'FORBIDDEN' ? 'FORBIDDEN' : 'DEVICE_NOT_PAIRED'
  if (res.kind === 'invalid') return 'VALIDATION_FAILED'
  if (res.kind === 'server_error') {
    if (res.code === 'EVENTS_PENDING') return 'EVENTS_PENDING'
    if (res.code === 'HANDOVER_NOT_PENDING') return 'HANDOVER_NOT_PENDING'
    if (res.status === 409) return 'HANDOVER_NOT_PENDING'
    return 'VALIDATION_FAILED'
  }
  return 'NETWORK'
}

export async function handOverBillClient(
  db: SolvaDb,
  input: {
    billId: string
    targetRegisterId: string
    clientLastEventSeq: number
    staffId: string
    eventId?: string
  },
  deps: HandoverClientDeps = {},
): Promise<HandoverClientResult> {
  if (deps.isOnline && !deps.isOnline()) {
    return { ok: false, code: 'OFFLINE' }
  }
  if (!deps.isOnline && typeof navigator !== 'undefined' && navigator.onLine === false) {
    return { ok: false, code: 'OFFLINE' }
  }

  const [device, clock] = await Promise.all([getMeta(db, 'device'), getMeta(db, 'clock')])
  if (!device) return { ok: false, code: 'DEVICE_NOT_PAIRED' }

  const nowMs = (deps.nowMs ?? Date.now)()
  const createdAtDevice = new Date(nowMs).toISOString()
  const deviceSeq = await nextStandaloneDeviceSeq(db, device.register_id, createdAtDevice)
  const eventId = input.eventId ?? (deps.newId ?? (() => idGen.newId()))()
  const sleep = deps.sleep ?? ((ms) => new Promise((r) => setTimeout(r, ms)))

  const res = await fetchWith429Retry<HandoverServerAck>(
    '/api/pos/v1/bills/handover',
    {
      method: 'POST',
      db,
      fetch: deps.fetch,
      timeoutMs: HANDOVER_TIMEOUT_MS,
      body: {
        bill_id: input.billId,
        event_id: eventId,
        target_register_id: input.targetRegisterId,
        client_last_event_seq: input.clientLastEventSeq,
        device_seq: deviceSeq,
        staff_id: input.staffId,
        created_at_device: createdAtDevice,
        clock_offset_ms: clock?.offset_ms ?? 0,
        schema_version: SCHEMA_VERSION,
        app_version: APP_VERSION.slice(0, 30),
      },
    },
    sleep,
  )

  if (res.kind !== 'ok') {
    return { ok: false, code: mapFailureCode(res) }
  }

  await markLocalBillHandoverPending(db, {
    billId: input.billId,
    targetRegisterId: input.targetRegisterId,
    handoverEventId: eventId,
    lastEventSeq: res.data.last_event_seq,
    nowIso: res.data.server_time,
  })

  return {
    ok: true,
    billId: input.billId,
    lastEventSeq: res.data.last_event_seq,
  }
}

export async function acceptBillClient(
  db: SolvaDb,
  input: { billId: string; staffId: string; eventId?: string },
  deps: HandoverClientDeps = {},
): Promise<HandoverClientResult> {
  if (deps.isOnline && !deps.isOnline()) {
    return { ok: false, code: 'OFFLINE' }
  }
  if (!deps.isOnline && typeof navigator !== 'undefined' && navigator.onLine === false) {
    return { ok: false, code: 'OFFLINE' }
  }

  const [device, clock] = await Promise.all([getMeta(db, 'device'), getMeta(db, 'clock')])
  if (!device) return { ok: false, code: 'DEVICE_NOT_PAIRED' }

  const nowMs = (deps.nowMs ?? Date.now)()
  const createdAtDevice = new Date(nowMs).toISOString()
  const deviceSeq = await nextStandaloneDeviceSeq(db, device.register_id, createdAtDevice)
  const eventId = input.eventId ?? (deps.newId ?? (() => idGen.newId()))()
  const sleep = deps.sleep ?? ((ms) => new Promise((r) => setTimeout(r, ms)))

  const res = await fetchWith429Retry<HandoverServerAck>(
    '/api/pos/v1/bills/accept',
    {
      method: 'POST',
      db,
      fetch: deps.fetch,
      timeoutMs: HANDOVER_TIMEOUT_MS,
      body: {
        bill_id: input.billId,
        event_id: eventId,
        device_seq: deviceSeq,
        staff_id: input.staffId,
        created_at_device: createdAtDevice,
        clock_offset_ms: clock?.offset_ms ?? 0,
        schema_version: SCHEMA_VERSION,
        app_version: APP_VERSION.slice(0, 30),
      },
    },
    sleep,
  )

  if (res.kind !== 'ok') {
    return { ok: false, code: mapFailureCode(res) }
  }

  // Fetch full bill details (including customer_phone and modifiers) to materialize into local store.
  const detailRes = await fetchWith429Retry<BillDetailResponse>(
    `/api/pos/v1/bills/${input.billId}`,
    {
      method: 'GET',
      db,
      fetch: deps.fetch,
      timeoutMs: HANDOVER_TIMEOUT_MS,
    },
    sleep,
  )

  if (detailRes.kind !== 'ok') {
    return { ok: false, code: mapFailureCode(detailRes) }
  }

  const parsedDetail = BillDetailResponseSchema.parse(detailRes.data)
  const acceptedBill = await materializeAcceptedBill(db, parsedDetail)

  return {
    ok: true,
    billId: input.billId,
    lastEventSeq: acceptedBill.last_event_seq,
    acceptedBill,
  }
}

export async function cancelBillHandoverClient(
  db: SolvaDb,
  input: { billId: string; staffId: string; eventId?: string },
  deps: HandoverClientDeps = {},
): Promise<HandoverClientResult> {
  if (deps.isOnline && !deps.isOnline()) {
    return { ok: false, code: 'OFFLINE' }
  }
  if (!deps.isOnline && typeof navigator !== 'undefined' && navigator.onLine === false) {
    return { ok: false, code: 'OFFLINE' }
  }

  const [device, clock] = await Promise.all([getMeta(db, 'device'), getMeta(db, 'clock')])
  if (!device) return { ok: false, code: 'DEVICE_NOT_PAIRED' }

  const nowMs = (deps.nowMs ?? Date.now)()
  const createdAtDevice = new Date(nowMs).toISOString()
  const deviceSeq = await nextStandaloneDeviceSeq(db, device.register_id, createdAtDevice)
  const eventId = input.eventId ?? (deps.newId ?? (() => idGen.newId()))()
  const sleep = deps.sleep ?? ((ms) => new Promise((r) => setTimeout(r, ms)))

  const res = await fetchWith429Retry<HandoverServerAck>(
    '/api/pos/v1/bills/handover/cancel',
    {
      method: 'POST',
      db,
      fetch: deps.fetch,
      timeoutMs: HANDOVER_TIMEOUT_MS,
      body: {
        bill_id: input.billId,
        event_id: eventId,
        device_seq: deviceSeq,
        staff_id: input.staffId,
        created_at_device: createdAtDevice,
        clock_offset_ms: clock?.offset_ms ?? 0,
        schema_version: SCHEMA_VERSION,
        app_version: APP_VERSION.slice(0, 30),
      },
    },
    sleep,
  )

  if (res.kind !== 'ok') {
    return { ok: false, code: mapFailureCode(res) }
  }

  await markLocalBillHandoverCanceled(db, {
    billId: input.billId,
    lastEventSeq: res.data.last_event_seq,
    nowIso: res.data.server_time,
  })

  return {
    ok: true,
    billId: input.billId,
    lastEventSeq: res.data.last_event_seq,
  }
}
