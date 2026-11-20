import '@tanstack/react-start/server-only'
import { AppError } from '~/server/error-classify'
import type { ImportKind } from './types'

export const IMPORT_PLAN_TTL_MS = 15 * 60 * 1000
export const MAX_ACTIVE_PLANS_PER_USER = 5

interface CachedPlanEntry<TPlan = unknown> {
  token: string
  tenantId: string
  userId: string
  kind: ImportKind
  createdAtMs: number
  expiresAtMs: number
  plan: TPlan
}

const planStore = new Map<string, CachedPlanEntry>()

function purgeExpired(nowMs: number): void {
  for (const [token, entry] of planStore.entries()) {
    if (entry.expiresAtMs <= nowMs) {
      planStore.delete(token)
    }
  }
}

export function storeImportPlan<TPlan>(params: {
  token: string
  tenantId: string
  userId: string
  kind: ImportKind
  plan: TPlan
  nowMs?: number
}): void {
  const nowMs = params.nowMs ?? Date.now()
  purgeExpired(nowMs)

  // Enforce per-(tenant, user) active plan cap by evicting the oldest entry
  const userTokens: CachedPlanEntry[] = []
  for (const entry of planStore.values()) {
    if (entry.tenantId === params.tenantId && entry.userId === params.userId) {
      userTokens.push(entry)
    }
  }
  while (userTokens.length >= MAX_ACTIVE_PLANS_PER_USER) {
    userTokens.sort((a, b) => a.createdAtMs - b.createdAtMs)
    const oldest = userTokens.shift()
    if (oldest) {
      planStore.delete(oldest.token)
    }
  }

  planStore.set(params.token, {
    token: params.token,
    tenantId: params.tenantId,
    userId: params.userId,
    kind: params.kind,
    createdAtMs: nowMs,
    expiresAtMs: nowMs + IMPORT_PLAN_TTL_MS,
    plan: params.plan,
  })
}

export function consumeImportPlan<TPlan>(params: {
  token: string
  tenantId: string
  userId: string
  kind: ImportKind
  nowMs?: number
}): TPlan {
  const nowMs = params.nowMs ?? Date.now()
  purgeExpired(nowMs)

  const entry = planStore.get(params.token)
  if (!entry) {
    throw new AppError('VALIDATION_FAILED', 'Import preview token missing or expired')
  }
  if (entry.tenantId !== params.tenantId || entry.userId !== params.userId) {
    throw new AppError('FORBIDDEN', 'Import preview token belongs to another user or tenant')
  }
  if (entry.kind !== params.kind) {
    throw new AppError('VALIDATION_FAILED', `Import token kind mismatch: ${entry.kind}`)
  }

  planStore.delete(params.token)
  return entry.plan as TPlan
}

export function __clearImportPlansForTests(): void {
  planStore.clear()
}
