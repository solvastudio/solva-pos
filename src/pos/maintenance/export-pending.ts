import { APP_VERSION } from '~/lib/app-version'
import { SCHEMA_VERSION } from '~/lib/contracts'
import { readPendingOutboxDynamic } from '../data/maintenance.repo'
import { getMeta } from '../data/meta.repo'
import { listRawPendingOutboxRows } from '../data/outbox.repo'
import type { SolvaDb } from '../db/solva-db'
import type { OutboxCommandRow } from '../db/types'
import { tenantDbName } from '../locks/names'
import { trustedNowMs } from '../session/device-state'
import { enqueueAudit } from '../usecases/audit/enqueue-audit'

export interface ExportPendingHeader {
  readonly device_id: string
  readonly register_id: string
  readonly app_version: string
  readonly schema_version: number
  readonly exported_at: string
  readonly count: number
  readonly sha256: string
}

export interface ExportPendingResult {
  readonly blob: Blob
  readonly text: string
  readonly filename: string
  readonly count: number
  readonly sha256: string
  readonly header: ExportPendingHeader
}

async function computeSha256Hex(text: string): Promise<string> {
  const bytes = new TextEncoder().encode(text)
  if (globalThis.crypto?.subtle?.digest) {
    const digest = await globalThis.crypto.subtle.digest('SHA-256', bytes)
    return Array.from(new Uint8Array(digest))
      .map((b) => b.toString(16).padStart(2, '0'))
      .join('')
  }
  return ''
}

function formatUtcCompact(iso: string): string {
  return iso.replace(/[-:]/g, '').replace(/\.\d{3}Z$/, 'Z')
}

async function buildJsonlExport(opts: {
  rows: readonly OutboxCommandRow[]
  deviceId: string
  registerId: string
  exportedAt: string
}): Promise<ExportPendingResult> {
  const sorted = [...opts.rows].sort((a, b) => a.device_seq - b.device_seq)
  const commandLines = sorted.map((row) =>
    JSON.stringify({
      id: row.id,
      type: row.type,
      schema_version: row.schema_version,
      device_seq: row.device_seq,
      register_id: row.register_id,
      status: row.status,
      dependency_key: row.dependency_key,
      depends_on: row.depends_on,
      attempts: row.attempts,
      last_error_class: row.last_error_class,
      last_error_code: row.last_error_code,
      last_error_ref: row.last_error_ref,
      created_at_device: row.created_at_device,
      app_version: row.app_version,
      payload: row.payload,
    }),
  )

  const bodyForHash = commandLines.join('\n')
  const sha256 = await computeSha256Hex(bodyForHash)

  const header: ExportPendingHeader = {
    device_id: opts.deviceId,
    register_id: opts.registerId,
    app_version: APP_VERSION.slice(0, 30),
    schema_version: SCHEMA_VERSION,
    exported_at: opts.exportedAt,
    count: sorted.length,
    sha256,
  }

  const allLines = [JSON.stringify(header), ...commandLines]
  const text = `${allLines.join('\n')}\n`
  const blob = new Blob([text], { type: 'application/x-ndjson' })
  const filename = `solva-pending_${opts.deviceId}_${formatUtcCompact(opts.exportedAt)}.jsonl`

  return {
    blob,
    text,
    filename,
    count: sorted.length,
    sha256,
    header,
  }
}

/**
 * Exports all non-ACKED (and non-DISMISSED) `outbox_command` entries to offline JSON Lines
 * (`solva-pending_{deviceId}_{UTC}.jsonl`) with a SHA-256 header line and records a local audit event.
 */
export async function exportPending(
  db: SolvaDb,
  opts?: { trustedNowMs?: number; logAudit?: boolean; staffId?: string | null },
): Promise<ExportPendingResult> {
  const [device, clock, pendingRows] = await Promise.all([
    getMeta(db, 'device'),
    getMeta(db, 'clock'),
    listRawPendingOutboxRows(db),
  ])

  const nowMs = opts?.trustedNowMs ?? Date.now()
  const correctedMs = clock
    ? trustedNowMs({
        nowMs,
        clockOffsetMs: clock.offset_ms,
        maxSeenMs: Date.parse(clock.max_seen_time) || 0,
      })
    : nowMs
  const exportedAt = new Date(correctedMs).toISOString()

  const deviceId = device?.device_id ?? 'unknown-device'
  const registerId = device?.register_id ?? 'unknown-register'

  const result = await buildJsonlExport({
    rows: pendingRows,
    deviceId,
    registerId,
    exportedAt,
  })

  if (opts?.logAudit !== false && device) {
    try {
      await enqueueAudit(db, {
        action: 'pending.exported',
        entityType: 'outbox',
        registerId: device.register_id,
        actorUserId: opts?.staffId ?? null,
        afterData: {
          count: result.count,
          sha256: result.sha256,
        },
        occurredAtIso: exportedAt,
        occurredAtDeviceIso: new Date(nowMs).toISOString(),
      })
    } catch {
      // Best-effort audit must not block offline/recovery export (e.g. quota/IDB read-only).
    }
  }

  return result
}

/**
 * Dynamic-mode Dexie recovery export (ARCH §3.2): reads via `readPendingOutboxDynamic`
 * without schema declarations so pending transactions remain exportable when DB upgrade fails.
 */
export async function exportPendingDynamic(
  tenantIdOrDbName: string,
  opts?: { trustedNowMs?: number },
): Promise<ExportPendingResult | null> {
  const dbName = tenantIdOrDbName.startsWith('solva-pos:')
    ? tenantIdOrDbName
    : tenantDbName(tenantIdOrDbName)

  const snap = await readPendingOutboxDynamic(dbName)
  if (!snap) return null

  const exportedAt = new Date((opts?.trustedNowMs ?? Date.now()) + snap.offsetMs).toISOString()
  return buildJsonlExport({
    rows: snap.rows,
    deviceId: snap.deviceId,
    registerId: snap.registerId,
    exportedAt,
  })
}

export function triggerBlobDownload(blob: Blob, filename: string): boolean {
  if (typeof document === 'undefined' || typeof URL === 'undefined' || !URL.createObjectURL) {
    return false
  }
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  document.body.appendChild(a)
  a.click()
  a.remove()
  URL.revokeObjectURL(url)
  return true
}
