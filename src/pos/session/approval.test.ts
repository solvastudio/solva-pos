import { afterEach, describe, expect, it } from 'vitest'
import vector from '../../../tests/fixtures/pin-kdf-vector.json'
import { deleteTenantDbForTests, openTenantDb } from '../db/solva-db'
import { requestSupervisorApproval } from './approval'

const TENANT_ID = '01950000-0000-7000-8000-00000000a301'
const OUTLET_ID = '01950000-0000-7000-8000-00000000b301'
const DEVICE_ID = '01950000-0000-7000-8000-00000000c301'
const REG_ID = '01950000-0000-7000-8000-00000000d301'
const CASHIER_ID = '01950000-0000-7000-8000-00000000e301'
const SUP_ID = '01950000-0000-7000-8000-00000000e302'
const T0 = Date.parse('2026-11-20T10:00:00.000Z')

afterEach(async () => {
  await deleteTenantDbForTests(TENANT_ID)
})

describe('pos/session/approval (BR-AUT-007, BR-DSC-003)', () => {
  it('enforces distinct approver, permission check, discount limit, and verifies PIN on approver counter', async () => {
    const db = await openTenantDb(TENANT_ID)
    await db.app_user.bulkPut([
      { id: CASHIER_ID, display_name: 'Kasir', is_active: true, deleted_at: null },
      { id: SUP_ID, display_name: 'Supervisor', is_active: true, deleted_at: null },
    ])
    await db.staff_pin.bulkPut([
      {
        id: 'pin-cashier',
        user_id: CASHIER_ID,
        device_salt: vector.device_salt,
        pin_hash: vector.pin_hash,
        kdf_algo: 'ARGON2ID',
        kdf_params: vector.kdf_params,
        kdf_salt: vector.kdf_salt,
        pin_epoch: 1,
        deleted_at: null,
      },
      {
        id: 'pin-sup',
        user_id: SUP_ID,
        device_salt: vector.device_salt,
        pin_hash: vector.pin_hash,
        kdf_algo: 'ARGON2ID',
        kdf_params: vector.kdf_params,
        kdf_salt: vector.kdf_salt,
        pin_epoch: 1,
        deleted_at: null,
      },
    ])
    await db.role.bulkPut([
      { id: 'role-cashier', code: 'CASHIER', name: 'Kasir', discount_limit_pct: '10', deleted_at: null },
      { id: 'role-sup', code: 'SUPERVISOR', name: 'Supervisor', discount_limit_pct: '25', deleted_at: null },
    ])
    await db.role_permission.bulkPut([
      { id: 'rp-c1', role_id: 'role-cashier', permission_code: 'sale.create' },
      { id: 'rp-s1', role_id: 'role-sup', permission_code: 'discount.approve' },
      { id: 'rp-s2', role_id: 'role-sup', permission_code: 'sale.void' },
    ])
    await db.user_outlet.bulkPut([
      { id: 'uo-c', user_id: CASHIER_ID, outlet_id: OUTLET_ID, role_id: 'role-cashier', deleted_at: null },
      { id: 'uo-s', user_id: SUP_ID, outlet_id: OUTLET_ID, role_id: 'role-sup', deleted_at: null },
    ])

    // Self-approval rejected
    const selfRes = await requestSupervisorApproval(db, {
      outletId: OUTLET_ID,
      deviceId: DEVICE_ID,
      registerId: REG_ID,
      requesterId: SUP_ID,
      approverId: SUP_ID,
      pin: vector.pin,
      permission: 'sale.void',
      trustedNowMs: T0,
      maxSeenMs: T0,
    })
    expect(selfRes).toEqual({ approved: false, reason: 'SELF_APPROVAL_FORBIDDEN' })

    // Missing permission rejected (Supervisor does not have return.approve)
    const noPerm = await requestSupervisorApproval(db, {
      outletId: OUTLET_ID,
      deviceId: DEVICE_ID,
      registerId: REG_ID,
      requesterId: CASHIER_ID,
      approverId: SUP_ID,
      pin: vector.pin,
      permission: 'return.approve',
      trustedNowMs: T0,
      maxSeenMs: T0,
    })
    expect(noPerm).toEqual({ approved: false, reason: 'MISSING_PERMISSION' })

    // Discount above role limit (30 > 25) rejected
    const overPct = await requestSupervisorApproval(db, {
      outletId: OUTLET_ID,
      deviceId: DEVICE_ID,
      registerId: REG_ID,
      requesterId: CASHIER_ID,
      approverId: SUP_ID,
      pin: vector.pin,
      permission: 'discount.approve',
      requestedPct: '30',
      trustedNowMs: T0,
      maxSeenMs: T0,
    })
    expect(overPct).toEqual({ approved: false, reason: 'DISCOUNT_LIMIT_EXCEEDED' })

    // Valid approval passes
    const ok = await requestSupervisorApproval(db, {
      outletId: OUTLET_ID,
      deviceId: DEVICE_ID,
      registerId: REG_ID,
      requesterId: CASHIER_ID,
      approverId: SUP_ID,
      pin: vector.pin,
      permission: 'discount.approve',
      requestedPct: '20',
      trustedNowMs: T0,
      maxSeenMs: T0,
    })
    expect(ok).toEqual({ approved: true, approverId: SUP_ID, displayName: 'Supervisor' })
  })
})
