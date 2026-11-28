import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { DataTableCmp10 } from '~/components/admin/reports/DataTableCmp10'
import { Button, Field, Input, useToast, type DataTableColumn } from '~/components/ui'
import { listSuppliersFn } from '~/functions/inventory/stock-read.fn'
import { deleteSupplierFn, saveSupplierFn } from '~/functions/inventory/stock-write.fn'
import { useCurrentTenant } from '~/hooks/use-current-tenant'
import type { SupplierView } from './stock-doc-types'

export interface SuppliersTabProps {
  canManage: boolean
}

export function SuppliersTab({ canManage }: SuppliersTabProps) {
  const { t } = useTranslation()
  const { slug } = useCurrentTenant()
  const toast = useToast()
  const queryClient = useQueryClient()
  const listQuery = useQuery({
    queryKey: ['admin', slug, 'stock', 'suppliers', false],
    queryFn: () => listSuppliersFn({ data: {} }),
  })
  const [name, setName] = useState('')
  const [contact, setContact] = useState('')

  const refresh = () => queryClient.invalidateQueries({ queryKey: ['admin', slug, 'stock', 'suppliers'] })

  const saveMut = useMutation({
    mutationFn: () => saveSupplierFn({ data: { name: name.trim(), contact: contact.trim() || null } }),
    onSuccess: async () => {
      setName('')
      setContact('')
      toast.show({ tone: 'success', message: t('admin.stock.supplierSaved') })
      await refresh()
    },
    onError: () => toast.show({ tone: 'danger', message: t('admin.stock.actionFailed') }),
  })

  const deleteMut = useMutation({
    mutationFn: (id: string) => deleteSupplierFn({ data: { id } }),
    onSuccess: async () => {
      toast.show({ tone: 'success', message: t('admin.stock.supplierDeleted') })
      await refresh()
    },
    onError: () => toast.show({ tone: 'danger', message: t('admin.stock.actionFailed') }),
  })

  const actionsColumn: DataTableColumn<SupplierView> = {
    id: 'actions',
    header: '',
    cell: (r) => (
      <Button variant="ghost" size="sm" onClick={() => deleteMut.mutate(r.id)}>
        {t('admin.stock.deleteAction')}
      </Button>
    ),
  }

  const columns: readonly DataTableColumn<SupplierView>[] = [
    { id: 'name', header: t('admin.stock.colSupplierName'), cell: (r) => r.name },
    { id: 'contact', header: t('admin.stock.colContact'), cell: (r) => r.contact ?? t('common.dash') },
    ...(canManage ? [actionsColumn] : []),
  ]

  return (
    <div className="flex flex-col gap-6">
      {canManage ? (
      <section aria-labelledby="sup-form-title" className="flex flex-col gap-4 rounded-card border border-line bg-surface p-4">
        <h2 id="sup-form-title" className="text-h3 font-semibold text-ink">{t('admin.stock.supplierFormTitle')}</h2>
        <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
          <Field label={t('admin.stock.colSupplierName')} htmlFor="sup-name">
            <Input id="sup-name" maxLength={120} value={name} onChange={(e) => setName(e.target.value)} />
          </Field>
          <Field label={t('admin.stock.colContact')} htmlFor="sup-contact">
            <Input id="sup-contact" maxLength={200} value={contact} onChange={(e) => setContact(e.target.value)} />
          </Field>
          <div className="flex items-end">
            <Button variant="primary" size="md" disabled={name.trim().length === 0} loading={saveMut.isPending} onClick={() => saveMut.mutate()}>
              {t('admin.stock.addSupplierAction')}
            </Button>
          </div>
        </div>
      </section>
      ) : null}
      <DataTableCmp10
        caption={t('admin.stock.supplierListCaption')}
        columns={columns}
        rows={listQuery.data ?? []}
        getRowKey={(r) => r.id}
        emptyTitle={t('admin.stock.emptyTitle')}
      />
    </div>
  )
}
