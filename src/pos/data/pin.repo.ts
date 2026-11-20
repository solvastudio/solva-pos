import { ReportPinStatePayloadV1, SCHEMA_VERSION } from '~/lib/contracts'
import type { SolvaDb } from '../db/solva-db'
import type { StaffPinRecord, StaffPinStateRecord } from '../db/types'
import { enqueueCommand } from './outbox.repo'

export interface PosStaffSummary {
  readonly userId: string
  readonly displayName: string
  readonly roleCodes: readonly string[]
  readonly roleNames: readonly string[]
  readonly permissions: readonly string[]
  readonly discountLimitPct: number
  readonly outletIds: readonly string[] | null
}

function parseLimitPct(val: string | number | undefined): number {
  if (typeof val === 'number') return Number.isFinite(val) ? val : 0
  if (typeof val === 'string') {
    const n = Number(val)
    return Number.isFinite(n) ? n : 0
  }
  return 0
}

/**
 * Lists all active tenant staff members who have an active `staff_pin` credential
 * downloaded for this device and belong to `outletId` (or tenant-wide `outlet_id IS NULL`).
 */
export async function listPosStaffWithPins(
  db: SolvaDb,
  outletId: string,
): Promise<PosStaffSummary[]> {
  const [users, pins, assignments, roles, rolePerms] = await Promise.all([
    db.app_user.toArray(),
    db.staff_pin.toArray(),
    db.user_outlet.toArray(),
    db.role.toArray(),
    db.role_permission.toArray(),
  ])

  const pinSet = new Set(pins.filter((p) => !p.deleted_at).map((p) => p.user_id))
  const roleMap = new Map(roles.filter((r) => !r.deleted_at).map((r) => [r.id, r]))
  const permsByRole = new Map<string, string[]>()
  for (const rp of rolePerms) {
    if (rp.deleted_at) continue
    const list = permsByRole.get(rp.role_id) ?? []
    list.push(rp.permission_code)
    permsByRole.set(rp.role_id, list)
  }

  const assignmentsByUser = new Map<string, typeof assignments>()
  for (const a of assignments) {
    if (a.deleted_at) continue
    if (a.outlet_id !== null && a.outlet_id !== outletId) continue
    const list = assignmentsByUser.get(a.user_id) ?? []
    list.push(a)
    assignmentsByUser.set(a.user_id, list)
  }

  const out: PosStaffSummary[] = []
  for (const user of users) {
    if (!user.is_active || user.deleted_at || !pinSet.has(user.id)) continue
    const userAssigns = assignmentsByUser.get(user.id) ?? []
    if (userAssigns.length === 0) continue

    const roleCodes: string[] = []
    const roleNames: string[] = []
    const permSet = new Set<string>()
    let maxDiscountPct = 0
    let isTenantWide = false
    const outletList: string[] = []

    for (const a of userAssigns) {
      if (a.outlet_id === null) {
        isTenantWide = true
      } else {
        outletList.push(a.outlet_id)
      }
      const r = roleMap.get(a.role_id)
      if (!r) continue
      if (!roleCodes.includes(r.code)) roleCodes.push(r.code)
      if (!roleNames.includes(r.name)) roleNames.push(r.name)
      maxDiscountPct = Math.max(maxDiscountPct, parseLimitPct(r.discount_limit_pct))
      for (const code of permsByRole.get(r.id) ?? []) {
        permSet.add(code)
      }
    }

    if (roleCodes.length === 0) continue
    out.push({
      userId: user.id,
      displayName: user.display_name,
      roleCodes,
      roleNames,
      permissions: [...permSet],
      discountLimitPct: maxDiscountPct,
      outletIds: isTenantWide ? null : [...new Set(outletList)],
    })
  }

  out.sort((a, b) => a.displayName.localeCompare(b.displayName))
  return out
}

export async function getStaffPinRecord(
  db: SolvaDb,
  userId: string,
): Promise<StaffPinRecord | null> {
  const row = await db.staff_pin.where('user_id').equals(userId).first()
  return row && !row.deleted_at ? row : null
}

export async function getStaffPinStateRecord(
  db: SolvaDb,
  userId: string,
  deviceId: string,
): Promise<StaffPinStateRecord | null> {
  const row = await db.staff_pin_state.get([userId, deviceId])
  return row ?? null
}

export async function listStaffPinStatesForDevice(
  db: SolvaDb,
  deviceId: string,
): Promise<Map<string, StaffPinStateRecord>> {
  const all = await db.staff_pin_state.toArray()
  const out = new Map<string, StaffPinStateRecord>()
  for (const row of all) {
    if (row.device_id === deviceId) {
      out.set(row.user_id, row)
    }
  }
  return out
}

/**
 * Persists local `staff_pin_state` inside a single short IndexedDB transaction, optionally
 * queueing `ReportPinState` in the same transaction when `lock_tier` changes or epoch resets.
 */
export async function savePinStateWithOptionalReport(
  db: SolvaDb,
  params: {
    state: StaffPinStateRecord
    registerId: string
    createdAtDevice: string
    reportPayload?: {
      user_id: string
      failed_count: number
      lock_tier: 0 | 1 | 2 | 3
      locked_until: string | null
      last_failed_at: string | null
      pin_epoch_seen: number
    } | null
  },
): Promise<void> {
  const validatedPayload = params.reportPayload
    ? ReportPinStatePayloadV1.parse(params.reportPayload)
    : null

  await db.transaction('rw', db.staff_pin_state, db.outbox_command, db.local_counter, async (tx) => {
    await tx.table<StaffPinStateRecord, [string, string]>('staff_pin_state').put(params.state)
    if (validatedPayload) {
      await enqueueCommand(tx, {
        type: 'ReportPinState',
        payload: validatedPayload,
        schemaVersion: SCHEMA_VERSION,
        registerId: params.registerId,
        dependencyKey: null,
        createdAtDevice: params.createdAtDevice,
      })
    }
  })
}

export async function loadStaffSessionSummary(
  db: SolvaDb,
  staffId: string,
  outletId: string,
): Promise<PosStaffSummary | null> {
  const all = await listPosStaffWithPins(db, outletId)
  return all.find((s) => s.userId === staffId) ?? null
}

/**
 * Counts and deletes any local `cart_draft` rows when a screen unlock override forces
 * closing the previous cashier's shift (`screen.unlock_override`).
 */
export async function discardOpenCartDrafts(db: SolvaDb): Promise<number> {
  return db.transaction('rw', db.cart_draft, async () => {
    const count = await db.cart_draft.count()
    if (count > 0) {
      await db.cart_draft.clear()
    }
    return count
  })
}
