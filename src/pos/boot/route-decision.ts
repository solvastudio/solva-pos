import type { BootResult } from './boot'

export type SystemVariant =
  | 'lease_expired'
  | 'clock_back'
  | 'update_required'
  | 'duplicate_instance'
  | 'revoked'
  | 'credential_expired'
  | 'tenant_suspended'
  | 'local_db_failed'

export type RouteDecision =
  | { to: 'pair' }
  | { to: 'login' }
  | { to: 'system'; variant: SystemVariant }

/**
 * Pure mapping from `bootPos()` outcome to destination child route under `/$tenant/pos`.
 */
export function decideRoute(result: BootResult): RouteDecision {
  if (result.kind === 'NEEDS_PAIRING') {
    return { to: 'pair' }
  }
  if (result.kind === 'PASSIVE_DUPLICATE') {
    return { to: 'system', variant: 'duplicate_instance' }
  }
  if (result.kind === 'LOCAL_DB_FAILED') {
    return { to: 'system', variant: 'local_db_failed' }
  }

  switch (result.state.kind) {
    case 'UNPAIRED':
      return { to: 'pair' }
    case 'REVOKED':
      return { to: 'system', variant: 'revoked' }
    case 'CREDENTIAL_EXPIRED':
      return { to: 'system', variant: 'credential_expired' }
    case 'TENANT_SUSPENDED':
      return { to: 'system', variant: 'tenant_suspended' }
    case 'LOCKED_CLOCK':
      return { to: 'system', variant: 'clock_back' }
    case 'LOCKED_LEASE':
      return { to: 'system', variant: 'lease_expired' }
    case 'OK':
    case 'LEASE_WARNING':
    case 'UPDATE_REQUIRED':
      return { to: 'login' }
  }
}
