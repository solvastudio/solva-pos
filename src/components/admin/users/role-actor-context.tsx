import { createContext, useContext, type ReactNode } from 'react'
import type { PermissionCode } from '~/modules/identity/shared'

/** What the signed-in member may do with roles; provided once by the roles tab. */
export interface RoleActor {
  permissions: ReadonlySet<PermissionCode>
  discountLimitPct: number
  canEditRoles: boolean
  canViewMembers: boolean
}

const RoleActorContext = createContext<RoleActor | null>(null)

export function RoleActorProvider({ value, children }: { value: RoleActor; children: ReactNode }) {
  return <RoleActorContext.Provider value={value}>{children}</RoleActorContext.Provider>
}

export function useRoleActor(): RoleActor {
  const value = useContext(RoleActorContext)
  if (!value) {
    throw new Error('useRoleActor must be used inside RoleActorProvider')
  }
  return value
}
