import { type IsoInstant } from '~/lib/kernel'
import { runtimeIdGenerator as idGen } from '~/lib/runtime-id'
import { getMeta } from '../../data/meta.repo'
import { addPrintJob } from '../../data/print-job.repo'
import type { SolvaDb } from '../../db/solva-db'
import type { PrintJobRecord } from '../../db/types'
import { getSessionState } from '../../session/session'
import { enqueueAudit } from '../audit/enqueue-audit'

export class OpenDrawerError extends Error {
  constructor(
    readonly code: 'FORBIDDEN' | 'DEVICE_NOT_PAIRED',
    message: string,
  ) {
    super(message)
    this.name = 'OpenDrawerError'
  }
}

/**
 * Triggers a manual cash drawer open outside checkout: enforces `drawer.open` permission,
 * writes `drawer.opened` audit command, and queues a `CASH_DRAWER` print job.
 */
export async function openDrawerManual(
  db: SolvaDb,
  opts: { staffId?: string; reasonText?: string; nowMs?: () => number } = {},
): Promise<PrintJobRecord> {
  const sessionStaff = getSessionState().staff
  const staffId = opts.staffId ?? sessionStaff?.staffId
  if (!staffId || (sessionStaff && !sessionStaff.permissions.has('drawer.open'))) {
    throw new OpenDrawerError('FORBIDDEN', 'Missing drawer.open permission')
  }

  const device = await getMeta(db, 'device')
  if (!device) {
    throw new OpenDrawerError('DEVICE_NOT_PAIRED', 'Device is not paired')
  }

  const [clock, locale] = await Promise.all([getMeta(db, 'clock'), getMeta(db, 'locale')])
  const rawMs = opts.nowMs ? opts.nowMs() : Date.now()
  const correctedMs = rawMs + (clock?.offset_ms ?? 0)
  const occurredAtIso = new Date(correctedMs).toISOString() as IsoInstant

  await enqueueAudit(db, {
    action: 'drawer.opened',
    entityType: 'device',
    entityId: device.device_id,
    registerId: device.register_id,
    actorUserId: staffId,
    reasonText: opts.reasonText?.trim() || 'Manual drawer open',
    occurredAtIso,
  })

  const job: PrintJobRecord = {
    id: idGen.newId(),
    kind: 'CASH_DRAWER',
    status: 'QUEUED',
    entity_id: device.device_id,
    entity_type: 'DEVICE',
    receipt_locale: locale === 'en-US' ? 'en-US' : 'id-ID',
    attempts: 0,
    last_error: null,
    created_at: occurredAtIso,
    updated_at: occurredAtIso,
  }
  await addPrintJob(db, job)
  return job
}
