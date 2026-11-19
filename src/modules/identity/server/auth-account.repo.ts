import '@tanstack/react-start/server-only'
import { and, eq, sql } from 'drizzle-orm'
import type { NoTenantTx, TenantTx } from '~/server/db'
import { account, member, session, user } from './auth-schema'

type DbTx = NoTenantTx | TenantTx

export interface GlobalAuthUserRow {
  id: string
  name: string
  email: string
}

export async function findAuthUserByEmail(
  tx: DbTx,
  normalizedEmail: string,
): Promise<GlobalAuthUserRow | null> {
  const rows = await tx
    .select({
      id: user.id,
      name: user.name,
      email: user.email,
    })
    .from(user)
    .where(sql`lower(${user.email}) = ${normalizedEmail.trim().toLowerCase()}`)
    .limit(1)
  return rows[0] ?? null
}

export async function findAuthUserEmailById(tx: DbTx, userId: string): Promise<string | null> {
  const rows = await tx
    .select({ email: user.email })
    .from(user)
    .where(eq(user.id, userId))
    .limit(1)
  return rows[0] ? rows[0].email.toLowerCase() : null
}

export async function insertAuthUserAndCredentialAccount(
  tx: DbTx,
  params: {
    userId: string
    accountRowId: string
    name: string
    email: string
    passwordHash: string
    now: Date
  },
): Promise<void> {
  await tx.insert(user).values({
    id: params.userId,
    name: params.name,
    email: params.email.trim().toLowerCase(),
    emailVerified: true,
    createdAt: params.now,
    updatedAt: params.now,
  })

  await tx.insert(account).values({
    id: params.accountRowId,
    accountId: params.userId,
    providerId: 'credential',
    userId: params.userId,
    password: params.passwordHash,
    createdAt: params.now,
    updatedAt: params.now,
  })
}

export async function findCredentialPasswordHash(
  tx: DbTx,
  userId: string,
): Promise<string | null> {
  const rows = await tx
    .select({ password: account.password })
    .from(account)
    .where(and(eq(account.userId, userId), eq(account.providerId, 'credential')))
    .limit(1)
  return rows[0]?.password ?? null
}

export async function updateCredentialPasswordHash(
  tx: DbTx,
  userId: string,
  passwordHash: string,
  now: Date,
): Promise<number> {
  const updated = await tx
    .update(account)
    .set({ password: passwordHash, updatedAt: now })
    .where(and(eq(account.userId, userId), eq(account.providerId, 'credential')))
    .returning({ id: account.id })
  return updated.length
}

export async function ensureOrgMemberRow(
  tx: DbTx,
  params: {
    id: string
    organizationId: string
    userId: string
    roleName: string
    now: Date
  },
): Promise<void> {
  const existing = await tx
    .select({ id: member.id })
    .from(member)
    .where(and(eq(member.organizationId, params.organizationId), eq(member.userId, params.userId)))
    .limit(1)
  if (existing.length > 0) {
    return
  }

  await tx.insert(member).values({
    id: params.id,
    organizationId: params.organizationId,
    userId: params.userId,
    role: params.roleName.toLowerCase(),
    createdAt: params.now,
  })
}

export async function deleteOrgMemberRow(
  tx: DbTx,
  organizationId: string,
  userId: string,
): Promise<void> {
  await tx
    .delete(member)
    .where(and(eq(member.organizationId, organizationId), eq(member.userId, userId)))
}

export async function deleteTenantOrgSessions(
  tx: DbTx,
  organizationId: string,
  userId: string,
): Promise<void> {
  await tx
    .delete(session)
    .where(and(eq(session.userId, userId), eq(session.activeOrganizationId, organizationId)))
}

export async function deleteAllSessionsForUser(tx: DbTx, userId: string): Promise<void> {
  await tx.delete(session).where(eq(session.userId, userId))
}
