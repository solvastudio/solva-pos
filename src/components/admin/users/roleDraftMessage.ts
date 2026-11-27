import type { TFunction } from 'i18next'
import type { RoleDraftIssue } from '~/modules/identity/shared'

/** Translates one client-side role draft issue into the message shown next to the form. */
export function roleDraftIssueMessage(t: TFunction, issue: RoleDraftIssue): string {
  switch (issue.field) {
    case 'name':
      return t('validation.fieldRequired', { field: t('admin.users.role.nameLabel') })
    case 'discount':
      return issue.reason === 'invalid'
        ? t('admin.users.role.discountInvalid')
        : t('admin.users.role.discountAboveOwn', { limit: issue.limit })
    case 'permissions':
      return t('admin.users.role.permissionsRequired')
  }
}
