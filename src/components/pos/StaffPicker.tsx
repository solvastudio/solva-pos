import { useTranslation } from 'react-i18next'
import { cn } from '~/lib/cn'
import { Lock, Users } from '~/components/ui/icons'
import { EmptyState } from '~/components/ui/EmptyState'
import type { PosStaffSummary } from '~/pos/data/pin.repo'

export interface StaffPickerProps {
  staff: readonly PosStaffSummary[]
  selectedUserId: string | null
  lockedUserIds?: ReadonlySet<string>
  onSelect: (userId: string) => void
}

function getInitials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean)
  if (parts.length === 0) return 'ST'
  if (parts.length === 1) return parts[0]!.slice(0, 2).toUpperCase()
  return `${parts[0]![0] ?? ''}${parts[1]![0] ?? ''}`.toUpperCase()
}

export function StaffPicker({
  staff,
  selectedUserId,
  lockedUserIds,
  onSelect,
}: StaffPickerProps) {
  const { t } = useTranslation()

  if (staff.length === 0) {
    return (
      <EmptyState
        icon={<Users className="size-8" aria-hidden="true" />}
        title={t('pos.login.selectStaff')}
        description={t('pos.login.noStaff')}
      />
    )
  }

  return (
    <div
      role="listbox"
      aria-label={t('pos.login.selectStaff')}
      className="flex flex-col gap-2"
    >
      {staff.map((member) => {
        const isSelected = member.userId === selectedUserId
        const isLocked = lockedUserIds?.has(member.userId) ?? false
        const roleLabel = member.roleCodes
          .map((c) => t(`role.${c}`, { defaultValue: c }))
          .join(', ')

        return (
          <button
            key={member.userId}
            type="button"
            role="option"
            aria-selected={isSelected}
            onClick={() => onSelect(member.userId)}
            className={cn(
              'flex min-h-14 w-full items-center gap-3 rounded-control border px-3.5 py-2.5 text-left transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus-ring',
              isSelected
                ? 'border-accent bg-accent-soft text-ink ring-1 ring-accent'
                : 'border-line bg-surface text-ink hover:bg-surface-hover',
            )}
          >
            <span
              aria-hidden="true"
              className="flex size-10 shrink-0 items-center justify-center rounded-full bg-surface-subtle text-label font-semibold text-ink"
            >
              {getInitials(member.displayName)}
            </span>
            <span className="min-w-0 flex-1">
              <span className="block truncate text-body font-semibold text-ink">
                {member.displayName}
              </span>
              <span className="block truncate text-caption text-ink-soft">{roleLabel}</span>
            </span>
            {isLocked ? (
              <Lock className="size-4 shrink-0 text-danger-ink" aria-hidden="true" />
            ) : null}
          </button>
        )
      })}
    </div>
  )
}
