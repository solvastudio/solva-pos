import { afterEach, describe, expect, it, vi } from 'vitest'
import { OpenShiftPayloadV1 } from '~/lib/contracts'
import { listSendable } from '../../data/outbox.repo'
import { setMeta } from '../../data/meta.repo'
import { deleteTenantDbForTests, openTenantDb } from '../../db/solva-db'
import { openShift } from './open-shift'

const T1 = '0192a000-0000-7000-8000-00000000b201'
const OUT = '0192a000-0000-7000-8000-00000000b202'
const REG = '0192a000-0000-7000-8000-00000000b203'
const DEV = '0192a000-0000-7000-8000-00000000b204'
const STAFF = '0192a000-0000-7000-8000-00000000b205'

afterEach(async () => {
  await deleteTenantDbForTests(T1)
  vi.restoreAllMocks()
})

async function seedPairedDevice() {
  const db = await openTenantDb(T1)
  await setMeta(db, 'device', {
    device_id: DEV,
    credential: 'cred-1',
    credential_expires_at: '2027-01-01T00:00:00.000Z',
    tenant_id: T1,
    slug: 'demo',
    register_id: REG,
    outlet_id: OUT,
    register_type: 'CASHIER',
  })
  await setMeta(db, 'clock', {
    offset_ms: 5000,
    offset_at: '2026-11-20T00:00:00.000Z',
    max_seen_time: '2026-11-20T00:00:00.000Z',
  })
  await db.outlet.put({
    id: OUT,
    legal_entity_id: '0192a000-0000-7000-8000-00000000b299',
    code: 'OUT1',
    name: 'Outlet Utama',
    timezone: 'Asia/Jakarta',
    day_cutoff_time: '04:00',
    price_tax_mode: 'EXCLUSIVE',
    tax_profile: 'PPN',
    cash_rounding_unit: 100,
    service_charge_enabled: false,
    service_charge_rate: '0',
    service_charge_taxable: true,
    deleted_at: null,
  })
  return db
}

describe('pos/usecases/shift/open-shift', () => {
  it('opens a shift completely offline, writes 1 shift + 1 valid OpenShift command, and rejects duplicate open shift', async () => {
    const db = await seedPairedDevice()
    const fetchSpy = vi.fn()
    vi.stubGlobal('fetch', fetchSpy)

    let seq = 1
    const ids = [
      '0192a000-0000-7000-8000-00000000b210',
      '0192a000-0000-7000-8000-00000000b211',
    ]

    // 2026-11-17T21:00:00Z + 5s -> 04:00:05 WIB -> business_date 2026-11-18
    const nowMs = () => Date.parse('2026-11-17T21:00:00.000Z')
    const res = await openShift(
      db,
      { openingCash: 250_000, staffId: STAFF },
      { nowMs, newId: () => ids[seq++ - 1]! },
    )

    expect(res.ok).toBe(true)
    if (!res.ok) throw new Error('expected ok')
    expect(res.shift.status).toBe('OPEN')
    expect(res.shift.opening_cash).toBe(250_000)
    expect(res.shift.business_date).toBe('2026-11-18')
    expect(res.shift.sync_status).toBe('PENDING')
    expect(() => OpenShiftPayloadV1.parse(res.command.payload)).not.toThrow()
    expect(fetchSpy).not.toHaveBeenCalled()

    const outbox = await listSendable(db, { nowIso: '2026-11-17T21:05:00.000Z' })
    expect(outbox).toHaveLength(1)

    const dup = await openShift(db, { openingCash: 100_000, staffId: STAFF })
    expect(dup.ok).toBe(false)
    if (!dup.ok) {
      expect(dup.reason).toBe('SHIFT_ALREADY_OPEN')
      expect(dup.existingShift?.id).toBe(res.shift.id)
    }

    const neg = await openShift(db, { openingCash: -1, staffId: STAFF })
    expect(neg).toEqual({ ok: false, reason: 'INVALID_AMOUNT' })
  })
})
