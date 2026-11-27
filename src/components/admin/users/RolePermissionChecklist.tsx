import { useTranslation } from 'react-i18next'
import { Checkbox } from '~/components/ui'
import {
  PERMISSION_DEFINITIONS,
  type PermissionCode,
  type PermissionModule,
} from '~/modules/identity/shared'

const MODULE_ORDER: readonly PermissionModule[] = [
  'sales',
  'fnb',
  'shift',
  'catalog',
  'inventory',
  'identity',
  'reporting',
  'audit',
]

export interface RolePermissionChecklistProps {
  selected: ReadonlySet<PermissionCode>
  onToggle: (code: PermissionCode, checked: boolean) => void
  isDisabled: (code: PermissionCode) => boolean
}

export function RolePermissionChecklist({
  selected,
  onToggle,
  isDisabled,
}: RolePermissionChecklistProps) {
  const { t } = useTranslation()

  return (
    <div className="columns-1 gap-3 sm:columns-2">
      {MODULE_ORDER.map((moduleName) => {
        const items = PERMISSION_DEFINITIONS.filter((d) => d.module === moduleName)
        if (items.length === 0) {
          return null
        }
        return (
          <div
            key={moduleName}
            className="mb-3 break-inside-avoid rounded-control border border-line-subtle bg-surface-subtle p-3"
          >
            <fieldset className="flex flex-col gap-0.5">
              <legend className="mb-1 text-label font-semibold text-ink">
                {t(`admin.users.role.module.${moduleName}`)}
              </legend>
              {items.map((d) => (
                <Checkbox
                  key={d.code}
                  label={t(`permission.${d.code}`)}
                  checked={selected.has(d.code)}
                  disabled={isDisabled(d.code)}
                  onCheckedChange={(next) => onToggle(d.code, next)}
                />
              ))}
            </fieldset>
          </div>
        )
      })}
    </div>
  )
}
