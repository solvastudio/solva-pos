import { z } from 'zod'

export const memberOutletAssignmentSchema = z.object({
  outletId: z.string().uuid().nullable(),
  roleId: z.string().uuid(),
})

export const changeMemberRoleAndOutletsSchema = z.object({
  appUserId: z.string().uuid(),
  assignments: z.array(memberOutletAssignmentSchema).min(1),
})

export type ChangeMemberRoleAndOutletsInput = z.infer<typeof changeMemberRoleAndOutletsSchema>

export interface MemberAssignmentView {
  outletId: string | null
  outletCode: string | null
  outletName: string | null
  roleId: string
  roleCode: string
  roleName: string
}

export type MemberPinStatus = 'unset' | 'active' | 'locked'

export interface MemberDirectoryView {
  appUserId: string
  displayName: string
  email: string | null
  membershipStatus: 'ACTIVE' | 'PENDING'
  isActive: boolean
  pinStatus: MemberPinStatus
  assignments: readonly MemberAssignmentView[]
}
