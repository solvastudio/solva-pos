import { useState } from 'react'
import {
  diffPermissionCodes,
  parseDiscountInput,
  type PermissionCode,
  type RoleMatrixView,
} from '~/modules/identity/shared'

/** Local edit state of one role plus everything derived from it (what changed, what to send). */
export function useRoleDraft(role: RoleMatrixView) {
  const [name, setName] = useState(role.name)
  const [discount, setDiscount] = useState(String(role.discountLimitPct))
  const [permissions, setPermissions] = useState<Set<PermissionCode>>(
    () => new Set(role.permissions),
  )

  const trimmedName = name.trim()
  const discountValue = parseDiscountInput(discount)
  const nameChanged = trimmedName !== role.name
  const discountChanged = discountValue !== null && discountValue !== role.discountLimitPct
  const diff = diffPermissionCodes(new Set(role.permissions), permissions)
  const permsChanged = diff.added.length > 0 || diff.removed.length > 0

  function togglePermission(code: PermissionCode, checked: boolean) {
    setPermissions((prev) => {
      const next = new Set(prev)
      if (checked) {
        next.add(code)
      } else {
        next.delete(code)
      }
      return next
    })
  }

  return {
    name,
    setName,
    discount,
    setDiscount,
    permissions,
    togglePermission,
    trimmedName,
    discountValue,
    nameChanged,
    discountChanged,
    permsChanged,
    diff,
    dirty: nameChanged || discountChanged || permsChanged,
    /** Only the fields that changed, ready to merge into the update request. */
    changes: {
      ...(nameChanged ? { name: trimmedName } : {}),
      ...(discountChanged && discountValue !== null ? { discountLimitPct: discountValue } : {}),
      ...(permsChanged ? { permissions: Array.from(permissions) } : {}),
    },
  }
}

export type RoleDraft = ReturnType<typeof useRoleDraft>
