import '@tanstack/react-start/server-only'
import { hashPassword, verifyPassword } from 'better-auth/crypto'
import { z } from 'zod'
import { CODE_LENGTH_MEMBER, normalizeCode } from '~/lib/kernel'
import { appendAudit } from '~/modules/audit/public'
import { writeMaster } from '~/modules/sync/public'
import {
  checkLogin,
  recordLoginFailure,
  recordLoginSuccess,
} from '~/server/auth/rate-limit/login-limiter'
import { withTenant, type TenantTx } from '~/server/db'
import {
  deleteAllSessionsForUser,
  ensureOrgMemberRow,
  findAuthUserByEmail,
  findCredentialPasswordHash,
  insertAuthUserAndCredentialAccount,
  updateCredentialPasswordHash,
} from './auth-account.repo'
import {
  hashMemberCode,
  identityIdGen,
  type IdentityServiceDeps,
} from './code-crypto'
import {
  activateAppUserRow,
  atomicClaimMemberCode,
  callAuthAccountMembershipCount,
  findAppUserById,
  findNonDeletedAppUserByAuthUserId,
  listUserRoleCodesForAppUser,
  updateMemberCodeRedeemedAuthUser,
} from './member-code.repo'

const emailSchema = z.string().trim().toLowerCase().email().max(254)

export interface RedeemInput {
  tenantId: string
  tenantSlug: string
  authOrgId: string
  email: string
  code: string
  password: string
}

export interface RedeemDeps extends IdentityServiceDeps {
  afterClaimInTx?: (tx: TenantTx) => Promise<void>
}

export type RedeemResult =
  | { ok: true; appUserId: string; authUserId: string }
  | { ok: false }

class InvalidRedeemError extends Error {
  constructor() {
    super('INVALID_REDEEM')
    this.name = 'InvalidRedeemError'
  }
}

async function runDummyCryptoWork(): Promise<void> {
  await hashPassword('solva-uniform-redeem-dummy-password')
}

function validateRedeemCredentials(email: string, code: string, password: string): {
  normalizedEmail: string
  normalizedCode: string
} | null {
  const parsedEmail = emailSchema.safeParse(email)
  if (!parsedEmail.success) return null

  const normalizedCode = normalizeCode(code)
  if (normalizedCode.length !== CODE_LENGTH_MEMBER) return null

  if (typeof password !== 'string' || password.length < 10 || password.length > 128) {
    return null
  }

  return {
    normalizedEmail: parsedEmail.data,
    normalizedCode,
  }
}

export async function redeemInvite(
  input: RedeemInput,
  deps?: RedeemDeps,
): Promise<RedeemResult> {
  const validated = validateRedeemCredentials(input.email, input.code, input.password)
  if (!validated) {
    await runDummyCryptoWork()
    return { ok: false }
  }

  const nowIso = (deps?.nowIso ?? (() => new Date().toISOString()))()
  const nowMs = Date.parse(nowIso)
  const codeHash = hashMemberCode(validated.normalizedCode)

  try {
    return await withTenant(input.tenantId, async (tx) => {
      const claimed = await atomicClaimMemberCode(
        tx,
        input.tenantId,
        codeHash,
        'INVITE',
        validated.normalizedEmail,
        nowIso,
      )
      if (!claimed) {
        await runDummyCryptoWork()
        throw new InvalidRedeemError()
      }

      if (deps?.afterClaimInTx) {
        await deps.afterClaimInTx(tx)
      }

      const profile = await findAppUserById(tx, input.tenantId, claimed.appUserId)
      if (!profile || profile.deletedAt !== null) {
        throw new InvalidRedeemError()
      }

      const existingAuthUser = await findAuthUserByEmail(tx, validated.normalizedEmail)
      let resolvedAuthUserId: string

      if (!existingAuthUser) {
        const passwordHash = await hashPassword(input.password)
        resolvedAuthUserId = identityIdGen.newId()
        await insertAuthUserAndCredentialAccount(tx, {
          userId: resolvedAuthUserId,
          accountRowId: identityIdGen.newId(),
          name: profile.displayName,
          email: validated.normalizedEmail,
          passwordHash,
          now: new Date(nowIso),
        })
      } else {
        const loginCheck = await checkLogin({
          email: validated.normalizedEmail,
          slug: input.tenantSlug,
          nowMs,
        })
        if (!loginCheck.allowed) {
          await runDummyCryptoWork()
          throw new InvalidRedeemError()
        }

        const storedHash = await findCredentialPasswordHash(tx, existingAuthUser.id)
        if (!storedHash) {
          await runDummyCryptoWork()
          throw new InvalidRedeemError()
        }

        const passwordValid = await verifyPassword({
          hash: storedHash,
          password: input.password,
        })
        if (!passwordValid) {
          await recordLoginFailure({
            email: validated.normalizedEmail,
            slug: input.tenantSlug,
            nowMs,
          })
          throw new InvalidRedeemError()
        }

        recordLoginSuccess(validated.normalizedEmail)

        const activeOther = await findNonDeletedAppUserByAuthUserId(
          tx,
          input.tenantId,
          existingAuthUser.id,
        )
        if (activeOther) {
          throw new InvalidRedeemError()
        }

        resolvedAuthUserId = existingAuthUser.id
      }

      await ensureOrgMemberRow(tx, {
        id: identityIdGen.newId(),
        organizationId: input.authOrgId,
        userId: resolvedAuthUserId,
        roleName: 'member',
        now: new Date(nowIso),
      })

      await writeMaster(tx, { actorUserId: claimed.appUserId }, async (w) => {
        await activateAppUserRow(tx, w, claimed.appUserId, resolvedAuthUserId, nowIso)
        return true
      })

      await updateMemberCodeRedeemedAuthUser(tx, input.tenantId, claimed.id, resolvedAuthUserId)

      await appendAudit(
        tx,
        {
          action: 'member.accepted',
          entityType: 'app_user',
          entityId: claimed.appUserId,
          afterData: {
            email: validated.normalizedEmail,
            codeId: claimed.id,
          },
          actorUserId: claimed.appUserId,
          occurredAt: nowIso,
        },
        { newId: () => identityIdGen.newId(), nowIso: () => nowIso },
      )

      return {
        ok: true,
        appUserId: claimed.appUserId,
        authUserId: resolvedAuthUserId,
      }
    })
  } catch (err: unknown) {
    if (err instanceof InvalidRedeemError) {
      return { ok: false }
    }
    throw err
  }
}

export async function redeemReset(
  input: RedeemInput,
  deps?: RedeemDeps,
): Promise<RedeemResult> {
  const validated = validateRedeemCredentials(input.email, input.code, input.password)
  if (!validated) {
    await runDummyCryptoWork()
    return { ok: false }
  }

  const nowIso = (deps?.nowIso ?? (() => new Date().toISOString()))()
  const codeHash = hashMemberCode(validated.normalizedCode)

  try {
    return await withTenant(input.tenantId, async (tx) => {
      const claimed = await atomicClaimMemberCode(
        tx,
        input.tenantId,
        codeHash,
        'RESET',
        validated.normalizedEmail,
        nowIso,
      )
      if (!claimed) {
        await runDummyCryptoWork()
        throw new InvalidRedeemError()
      }

      if (deps?.afterClaimInTx) {
        await deps.afterClaimInTx(tx)
      }

      const profile = await findAppUserById(tx, input.tenantId, claimed.appUserId)
      if (
        !profile ||
        profile.deletedAt !== null ||
        !profile.isActive ||
        profile.membershipStatus !== 'ACTIVE' ||
        !profile.authUserId
      ) {
        throw new InvalidRedeemError()
      }

      const roles = await listUserRoleCodesForAppUser(tx, input.tenantId, profile.id)
      if (roles.includes('OWNER')) {
        throw new InvalidRedeemError()
      }

      // Re-verify single-tenant exclusivity (R1) at redemption time.
      const membershipCount = await callAuthAccountMembershipCount(tx, profile.authUserId)
      if (membershipCount !== 1) {
        throw new InvalidRedeemError()
      }

      const newHash = await hashPassword(input.password)
      const updatedAccounts = await updateCredentialPasswordHash(
        tx,
        profile.authUserId,
        newHash,
        new Date(nowIso),
      )
      if (updatedAccounts < 1) {
        throw new InvalidRedeemError()
      }

      await deleteAllSessionsForUser(tx, profile.authUserId)
      await updateMemberCodeRedeemedAuthUser(tx, input.tenantId, claimed.id, profile.authUserId)

      await appendAudit(
        tx,
        {
          action: 'member.password_reset',
          entityType: 'app_user',
          entityId: profile.id,
          afterData: {
            codeId: claimed.id,
          },
          actorUserId: profile.id,
          occurredAt: nowIso,
        },
        { newId: () => identityIdGen.newId(), nowIso: () => nowIso },
      )

      return {
        ok: true,
        appUserId: profile.id,
        authUserId: profile.authUserId,
      }
    })
  } catch (err: unknown) {
    if (err instanceof InvalidRedeemError) {
      return { ok: false }
    }
    throw err
  }
}
