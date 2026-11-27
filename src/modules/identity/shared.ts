export * from './domain/permissions'
export * from './domain/default-roles'
export * from './domain/role-rules'
export * from './domain/role-validation'
export * from './domain/invoice-prefix'
export * from './domain/pin-policy'
export * from './domain/org-schemas'
export * from './domain/member-schemas'
export * from './domain/role-schemas'
export * from './domain/device-schemas'
export * from './domain/settings-schemas'

export type MutationActionResult<T> =
  | { ok: true; data: T }
  | { ok: false; errorKey: string }
