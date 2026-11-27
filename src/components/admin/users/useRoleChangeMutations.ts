import { useMutation, useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useToast } from '~/components/ui'
import { deleteRoleFn, updateRoleFn } from '~/functions/identity/role.fn'
import type { RoleMatrixView } from '~/modules/identity/shared'
import { qk } from '~/queries/keys'
import type { RoleDraft } from './useRoleDraft'

interface Params {
  tenantSlug: string
  role: RoleMatrixView
  changes: RoleDraft['changes']
  onDeleted: () => void
}

/** Save and delete mutations for one role, with the shared inline error message. */
export function useRoleChangeMutations({ tenantSlug, role, changes, onDeleted }: Params) {
  const { t } = useTranslation()
  const toast = useToast()
  const queryClient = useQueryClient()
  const [error, setError] = useState<string | null>(null)

  function handleFailure(errorKey: string) {
    const message = t(errorKey, { defaultValue: t('admin.users.failed') })
    setError(message)
    if (errorKey === 'admin.users.role.versionConflict') {
      // The refetch remounts the panel with the fresh version and drops local state, so also toast the reason.
      void queryClient.invalidateQueries({ queryKey: qk.roles(tenantSlug) })
      toast.show({ tone: 'danger', message })
    }
  }

  const save = useMutation({
    retry: 0,
    mutationFn: () =>
      updateRoleFn({ data: { roleId: role.id, expectedVersion: role.version, ...changes } }),
    onSuccess: (res) => {
      if (!res.ok) {
        handleFailure(res.errorKey)
        return
      }
      void queryClient.invalidateQueries({ queryKey: qk.roles(tenantSlug) })
      toast.show({ tone: 'success', message: t('admin.users.role.saved') })
    },
    onError: () => {
      setError(t('admin.users.failed'))
    },
  })

  const remove = useMutation({
    retry: 0,
    mutationFn: () => deleteRoleFn({ data: { roleId: role.id, expectedVersion: role.version } }),
    onSuccess: (res) => {
      if (!res.ok) {
        handleFailure(res.errorKey)
        return
      }
      void queryClient.invalidateQueries({ queryKey: qk.roles(tenantSlug) })
      toast.show({ tone: 'success', message: t('admin.users.role.deleted') })
      onDeleted()
    },
    onError: () => {
      setError(t('admin.users.failed'))
    },
  })

  return { error, setError, save, remove }
}
