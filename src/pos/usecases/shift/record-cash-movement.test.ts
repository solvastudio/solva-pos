import { afterEach, describe, expect, it } from 'vitest'
import { parseCommandPayload } from '~/lib/contracts'
import { setMeta } from '../../data/meta.repo'
import { deleteTenantDbForTests, openTenantDb } from '../../db/solva-db'
import { openShift } from '../shift/open-shift'
import { recordCashMovement, RecordCashMovementError } from './record-cash-movement'

const T1 = '0192a000-0000-7000-8000-00000000d101'
const OUT = '0192a000-0000-7000-8000-00000000d102'
const REG = '0192a000-0000-7000-8000-00000000d103'
const DEV = '0192a000-0000-7000-8000-00000000d104'
const STAFF = '0192a000-0000-7000-8000-00000000d105'
const LE = '0192a000-0000-7000-8000-00000000d106'

afterEach(async () => {
  await deleteTenantDbForTests(T1)
})

describe('pos/usecases/shift/record-cash-movement', () => {
  it('writes cash IN/OUT + RecordCashMovement outbox depending on OpenShift, and rejects without shift/reason', async () => {
    const db = await openTenantDb(T1)
    await setMeta(db, 'device', {
      device_id: DEV,
      credential: 'c',
      credential_expires_at: '2027-01-01T00:00:00.000Z',
      tenant_id: T1,
      slug: 'demo',
      register_id: REG,
      outlet_id: OUT,
      register_type: 'CASHIER',
    })
    await db.outlet.put({
      id: OUT,
      legal_entity_id: LE,
      code: 'OUT01',
      name: 'Outlet 01',
      timezone: 'Asia/Jakarta',
      day_cutoff_time: '04:00',
      price_tax_mode: 'EXCLUSIVE',
      tax_profile: 'NONE',
      cash_rounding_unit: 100,
      deleted_at: null,
    })

    await expect(
      recordCashMovement(db, {
        direction: 'IN',
        amount: 200_000,
        reasonCode: 'FLOAT_TOPUP',
        reasonText: 'Change',
        staffId: STAFF,
      }),
    ).rejects.toMatchObject({ code: 'SHIFT_REQUIRED' } satisfies Partial<RecordCashMovementError>)

    const shiftRes = await openShift(db, { openingCash: 500_000, staffId: STAFF })
    if (!shiftRes.ok) throw new Error('expected shift open')

    const movIn = await recordCashMovement(db, {
      direction: 'IN',
      amount: 200_000,
      reasonCode: 'FLOAT_TOPUP',
      reasonText: 'Small bills topup',
      staffId: STAFF,
    })
    expect(movIn.direction).toBe('IN')
    expect(movIn.amount).toBe(200_000)

    const outbox = await db.outbox_command.toArray()
    const cmd = outbox.find((c) => c.type === 'RecordCashMovement')
    expect(cmd!.depends_on).toEqual([shiftRes.command.id])
    expect(() => parseCommandPayload('RecordCashMovement', 1, cmd!.payload)).not.toThrow()
    expect(outbox.some((c) => c.type === 'AppendAudit')).toBe(true)

    await expect(
      recordCashMovement(db, {
        direction: 'OUT',
        amount: 50_000,
        reasonCode: 'PETTY',
        reasonText: '   ',
        staffId: STAFF,
      }),
    ).rejects.toMatchObject({ code: 'REASON_REQUIRED' } satisfies Partial<RecordCashMovementError>)
  })
})
