import { z } from 'zod'
import { OUTLET_TIMEZONES, validateInvoicePrefix } from '~/lib/kernel'
import { isPermissionCode, type PermissionCode } from './domain/permissions'

export * from './domain/permissions'
export * from './domain/default-roles'
export * from './domain/invoice-prefix'

export const PRICE_TAX_MODES = ['INCLUSIVE', 'EXCLUSIVE'] as const
export type PriceTaxMode = (typeof PRICE_TAX_MODES)[number]

export const TAX_PROFILES = ['NONE', 'PPN', 'PB1'] as const
export type TaxProfile = (typeof TAX_PROFILES)[number]

export const REGISTER_TYPES = ['CASHIER', 'WAITER'] as const
export type RegisterType = (typeof REGISTER_TYPES)[number]

export const REGISTER_STATUSES = ['ACTIVE', 'INACTIVE'] as const
export type RegisterStatus = (typeof REGISTER_STATUSES)[number]

export const PAPER_WIDTHS = [58, 80] as const
export type PaperWidthMm = (typeof PAPER_WIDTHS)[number]

export type OutletTimezoneValue = (typeof OUTLET_TIMEZONES)[number]

/**
 * Strips punctuation and whitespace from an NPWP string so digits-only validation applies uniformly.
 */
export function normalizeNpwpInput(raw: string): string {
  return raw.replace(/[\s.-]/g, '').trim()
}

export const legalEntityFormSchema = z
  .object({
    name: z.string().trim().min(1).max(160),
    npwp: z.string().trim().nullable().optional(),
    isPkp: z.boolean(),
    pkpSince: z
      .string()
      .regex(/^\d{4}-\d{2}-\d{2}$/)
      .nullable()
      .optional(),
    address: z.string().trim().max(400).nullable().optional(),
  })
  .superRefine((val, ctx) => {
    const cleanNpwp = val.npwp ? val.npwp.trim() : null
    if (cleanNpwp && !/^\d{15,16}$/.test(cleanNpwp)) {
      ctx.addIssue({
        code: 'custom',
        path: ['npwp'],
        message: 'admin.settings.legalEntity.npwpInvalid',
      })
    }
    if (val.isPkp && (!cleanNpwp || !/^\d{15,16}$/.test(cleanNpwp))) {
      ctx.addIssue({
        code: 'custom',
        path: ['npwp'],
        message: 'admin.settings.legalEntity.pkpRequiresNpwp',
      })
    }
  })

export const updateLegalEntitySchema = legalEntityFormSchema.safeExtend({
  id: z.string().uuid(),
})

export const createOutletSchema = z.object({
  legalEntityId: z.string().uuid(),
  code: z.string().trim().regex(/^[A-Z0-9]{1,10}$/),
  name: z.string().trim().min(1).max(120),
  address: z.string().trim().max(400).nullable().optional(),
  phone: z.string().trim().max(40).nullable().optional(),
  timezone: z.enum(['Asia/Jakarta', 'Asia/Makassar', 'Asia/Jayapura']),
  dayCutoffTime: z
    .string()
    .regex(/^([01]\d|2[0-3]):[0-5]\d$/)
    .default('00:00'),
  priceTaxMode: z.enum(PRICE_TAX_MODES),
  taxProfile: z.enum(TAX_PROFILES).default('NONE'),
})

export const updateOutletSchema = z.object({
  id: z.string().uuid(),
  code: z.string().optional(),
  name: z.string().trim().min(1).max(120).optional(),
  address: z.string().trim().max(400).nullable().optional(),
  phone: z.string().trim().max(40).nullable().optional(),
  timezone: z.enum(['Asia/Jakarta', 'Asia/Makassar', 'Asia/Jayapura']).optional(),
  dayCutoffTime: z
    .string()
    .regex(/^([01]\d|2[0-3]):[0-5]\d$/)
    .optional(),
  isActive: z.boolean().optional(),
})

export const createRegisterSchema = z
  .object({
    outletId: z.string().uuid(),
    code: z.string().trim().regex(/^[A-Z0-9]{1,10}$/),
    name: z.string().trim().min(1).max(80),
    registerType: z.enum(REGISTER_TYPES).default('CASHIER'),
    invoicePrefix: z.string().trim().nullable().optional(),
    paperWidthMm: z.union([z.literal(58), z.literal(80)]).default(80),
    defaultLocale: z.enum(['id-ID', 'en-US']).nullable().optional(),
  })
  .superRefine((val, ctx) => {
    const prefix = val.invoicePrefix?.trim() || null
    if (val.registerType === 'CASHIER') {
      if (!prefix) {
        ctx.addIssue({
          code: 'custom',
          path: ['invoicePrefix'],
          message: 'admin.users.register.prefixRequired',
        })
        return
      }
      if (!validateInvoicePrefix(prefix).ok) {
        ctx.addIssue({
          code: 'custom',
          path: ['invoicePrefix'],
          message: 'admin.users.register.prefixInvalid',
        })
      }
    } else if (prefix) {
      ctx.addIssue({
        code: 'custom',
        path: ['invoicePrefix'],
        message: 'admin.users.register.waiterNoPrefix',
      })
    }
  })

export const updateRegisterSchema = z.object({
  id: z.string().uuid(),
  code: z.string().optional(),
  name: z.string().trim().min(1).max(80).optional(),
  status: z.enum(REGISTER_STATUSES).optional(),
  registerType: z.enum(REGISTER_TYPES).optional(),
  paperWidthMm: z.union([z.literal(58), z.literal(80)]).optional(),
  defaultLocale: z.enum(['id-ID', 'en-US']).nullable().optional(),
})

export const changeInvoicePrefixSchema = z.object({
  registerId: z.string().uuid(),
  newPrefix: z
    .string()
    .trim()
    .refine((v) => validateInvoicePrefix(v).ok, {
      message: 'admin.users.register.prefixInvalid',
    }),
})

export const memberOutletAssignmentSchema = z.object({
  outletId: z.string().uuid().nullable(),
  roleId: z.string().uuid(),
})

export const changeMemberRoleAndOutletsSchema = z.object({
  appUserId: z.string().uuid(),
  assignments: z.array(memberOutletAssignmentSchema).min(1),
})

export const updateRoleSchema = z.object({
  roleId: z.string().uuid(),
  name: z.string().trim().min(1).max(60).optional(),
  discountLimitPct: z.number().min(0).max(100).optional(),
  permissions: z.array(z.string().refine(isPermissionCode)).optional(),
})

export type CreateLegalEntityInput = z.infer<typeof legalEntityFormSchema>
export type UpdateLegalEntityInput = z.infer<typeof updateLegalEntitySchema>
export type CreateOutletInput = z.input<typeof createOutletSchema>
export type UpdateOutletInput = z.infer<typeof updateOutletSchema>
export type CreateRegisterInput = z.input<typeof createRegisterSchema>
export type UpdateRegisterInput = z.infer<typeof updateRegisterSchema>
export type ChangeInvoicePrefixInput = z.infer<typeof changeInvoicePrefixSchema>
export type ChangeMemberRoleAndOutletsInput = z.infer<typeof changeMemberRoleAndOutletsSchema>
export type UpdateRoleInput = z.infer<typeof updateRoleSchema>

export interface LegalEntityView {
  id: string
  name: string
  npwp: string | null
  isPkp: boolean
  pkpSince: string | null
  address: string | null
  version: number
}

export interface OutletView {
  id: string
  legalEntityId: string
  legalEntityName: string
  code: string
  name: string
  address: string | null
  phone: string | null
  timezone: OutletTimezoneValue
  dayCutoffTime: string
  priceTaxMode: PriceTaxMode
  taxProfile: TaxProfile
  isActive: boolean
  version: number
}

export interface RegisterPrefixHistoryView {
  id: string
  effectiveMonth: string
  invoicePrefix: string
}

export interface RegisterView {
  id: string
  outletId: string
  outletCode: string
  outletName: string
  code: string
  name: string
  status: RegisterStatus
  registerType: RegisterType
  paperWidthMm: PaperWidthMm
  defaultLocale: 'id-ID' | 'en-US' | null
  currentPrefix: string | null
  pendingNextPrefix: RegisterPrefixHistoryView | null
  prefixHistory: readonly RegisterPrefixHistoryView[]
  version: number
}

export interface MemberAssignmentView {
  outletId: string | null
  outletCode: string | null
  outletName: string | null
  roleId: string
  roleCode: string
  roleName: string
}

export interface MemberDirectoryView {
  appUserId: string
  displayName: string
  email: string | null
  membershipStatus: 'ACTIVE' | 'PENDING'
  isActive: boolean
  pinStatus: 'unknown'
  assignments: readonly MemberAssignmentView[]
}

export interface RoleMatrixView {
  id: string
  code: string
  name: string
  isSystem: boolean
  discountLimitPct: number
  permissions: readonly PermissionCode[]
  version: number
}

export type MutationActionResult<T> =
  | { ok: true; data: T }
  | { ok: false; errorKey: string }

export const DEVICE_REVOKE_REASONS = ['LOST', 'REPLACED', 'STOLEN', 'OTHER'] as const
export type DeviceRevokeReason = (typeof DEVICE_REVOKE_REASONS)[number]

export const DEVICE_STORAGE_PERSIST = ['GRANTED', 'DENIED', 'UNKNOWN'] as const
export type DeviceStoragePersist = (typeof DEVICE_STORAGE_PERSIST)[number]

export const createPairingCodeSchema = z.object({
  registerId: z.string().uuid(),
})

export const revokeDeviceSchema = z.object({
  deviceId: z.string().uuid(),
  reasonCode: z.enum(DEVICE_REVOKE_REASONS),
})

export interface CreatePairingCodeResult {
  code: string
  expiresAt: string
  enrollUrl: string
  baseUrl: string
}

export interface DeviceView {
  id: string
  outletId: string
  outletCode: string
  registerId: string
  registerCode: string
  registerName: string
  name: string
  enrolledAt: string
  revokedAt: string | null
  revokeReasonCode: DeviceRevokeReason | null
  lastAttemptAt: string | null
  lastSuccessSyncAt: string | null
  pendingCount: number
  oldestPendingAt: string | null
  clockOffsetMs: number | null
  appVersion: string | null
  schemaVersion: number | null
  storagePersist: DeviceStoragePersist
  neverSynced: boolean
}
