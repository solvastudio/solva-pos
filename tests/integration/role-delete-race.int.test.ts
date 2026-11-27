import { afterAll, describe, expect, it } from 'vitest'
import {
  changeMemberRoleAndOutlets,
  createInvite,
  createRole,
  listRolesWithPermissions,
} from '~/modules/identity/public'
import { findRoleById, softDeleteRoleRows } from '~/modules/identity/server/role.repo'
import { writeMaster } from '~/modules/sync/public'
import { closePools, withTenant } from '~/server/db'
import { bootstrapIdentityTenant } from './helpers/identity-actor'
import { uniqueSlug } from './helpers/tenants'

type Boot = Awaited<ReturnType<typeof bootstrapIdentityTenant>>

function deferred() {
  let resolve!: () => void
  const promise = new Promise<void>((r) => {
    resolve = r
  })
  return { promise, resolve }
}

/**
 * Deletes `roleId` in a transaction that stays open (holding the master write lock) until the returned
 * `commit()` is called, so a concurrent assignment reads the role before the delete becomes visible.
 */
async function deleteRoleHoldingLock(t: Boot, roleId: string) {
  const locked = deferred()
  const release = deferred()
  const done = withTenant(t.tenantId, async (tx) => {
    await findRoleById(tx, t.tenantId, roleId)
    await writeMaster(tx, { actorUserId: null }, async (w) => {
      await softDeleteRoleRows(tx, w, { roleId, nowIso: new Date().toISOString() })
    })
    locked.resolve()
    await release.promise
  })
  await locked.promise
  return { commit: () => release.resolve(), done }
}

/** Starts `work`, waits until the lock holder had time to block it, then commits the delete. */
async function runBlockedThenCommit<T>(
  holder: Awaited<ReturnType<typeof deleteRoleHoldingLock>>,
  work: () => Promise<T>,
) {
  let settled = false
  const outcome = work().then(
    (value) => ({ value }),
    (error: unknown) => ({ error }),
  )
  void outcome.then(() => {
    settled = true
  })
  await new Promise((r) => setTimeout(r, 1000))
  // Still waiting means it already read the role and is blocked on the master write lock.
  expect(settled).toBe(false)
  holder.commit()
  await holder.done
  return outcome
}

describe('deleting a role while a member is being assigned to it', () => {
  afterAll(async () => {
    await closePools()
  })

  it('rejects an invite that read the role before the delete committed', async () => {
    const t = await bootstrapIdentityTenant(uniqueSlug('rrace1'))
    const custom = await createRole(t.actor, {
      name: 'Sementara',
      discountLimitPct: 0,
      permissions: ['bill.edit'],
    })
    const holder = await deleteRoleHoldingLock(t, custom.id)

    const result = await runBlockedThenCommit(holder, () =>
      createInvite(t.actor, {
        email: `race-${uniqueSlug('r')}@example.test`,
        displayName: `Race ${uniqueSlug('n')}`,
        roleId: custom.id,
        outletIds: null,
      }),
    )

    expect(result).toMatchObject({
      error: { code: 'VALIDATION_FAILED', message: 'member.add.failed' },
    })
    // No member was left bound to the deleted role.
    expect((await listRolesWithPermissions(t.actor)).some((r) => r.id === custom.id)).toBe(false)
  })

  it('rejects an access change that read the role before the delete committed', async () => {
    const t = await bootstrapIdentityTenant(uniqueSlug('rrace2'))
    const waiter = (await listRolesWithPermissions(t.actor)).find((r) => r.code === 'WAITER')!
    const custom = await createRole(t.actor, {
      name: 'Sementara Dua',
      discountLimitPct: 0,
      permissions: ['bill.edit'],
    })
    const target = await createInvite(t.actor, {
      email: `race2-${uniqueSlug('r')}@example.test`,
      displayName: `Race ${uniqueSlug('n')}`,
      roleId: waiter.id,
      outletIds: null,
    })
    const holder = await deleteRoleHoldingLock(t, custom.id)

    const result = await runBlockedThenCommit(holder, () =>
      changeMemberRoleAndOutlets(t.actor, {
        appUserId: target.appUserId,
        assignments: [{ outletId: null, roleId: custom.id }],
      }),
    )

    expect(result).toMatchObject({
      error: { code: 'VALIDATION_FAILED', message: 'Invalid role id' },
    })
  })
})
