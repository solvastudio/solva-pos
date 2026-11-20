import { useId, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import {
  Button,
  Card,
  Chip,
  DataTable,
  Dialog,
  Field,
  Input,
  Select,
  Switch,
  type DataTableColumn,
} from '~/components/ui'
import type { PaymentMethodView, SavePaymentMethodInput } from '~/modules/identity/shared'

export interface PaymentMethodsTableProps {
  readonly methods: readonly PaymentMethodView[]
  readonly isPending?: boolean
  readonly onSaveMethod: (input: SavePaymentMethodInput) => Promise<void>
}

export function PaymentMethodsTable({
  methods,
  isPending = false,
  onSaveMethod,
}: PaymentMethodsTableProps) {
  const { t } = useTranslation()
  const idPrefix = useId()

  const [dialogOpen, setDialogOpen] = useState(false)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [code, setCode] = useState('')
  const [name, setName] = useState('')
  const [kind, setKind] = useState<'CASH' | 'NON_CASH'>('NON_CASH')
  const [requiresReference, setRequiresReference] = useState(false)
  const [sortOrder, setSortOrder] = useState(10)
  const [isActive, setIsActive] = useState(true)

  const activeCashMethod = useMemo(
    () => methods.find((m) => m.kind === 'CASH' && m.isActive) ?? null,
    [methods],
  )
  const isEditingActiveCash = Boolean(editingId && activeCashMethod && activeCashMethod.id === editingId)
  const hasOtherCashMethod = useMemo(
    () => methods.some((m) => m.kind === 'CASH' && m.id !== editingId),
    [editingId, methods],
  )

  const openCreate = (template?: { code: string; name: string; requiresReference: boolean }) => {
    setEditingId(null)
    setCode(template?.code ?? '')
    setName(template?.name ?? '')
    setKind('NON_CASH')
    setRequiresReference(template?.requiresReference ?? false)
    setSortOrder((methods.length + 1) * 10)
    setIsActive(true)
    setDialogOpen(true)
  }

  const openEdit = (row: PaymentMethodView) => {
    setEditingId(row.id)
    setCode(row.code)
    setName(row.name)
    setKind(row.kind)
    setRequiresReference(row.requiresReference)
    setSortOrder(row.sortOrder)
    setIsActive(row.isActive)
    setDialogOpen(true)
  }

  const columns: readonly DataTableColumn<PaymentMethodView>[] = [
    {
      id: 'code',
      header: t('admin.settings.paymentMethods.colCode'),
      cell: (row) => <span className="font-mono text-body-sm font-medium text-ink">{row.code}</span>,
    },
    {
      id: 'name',
      header: t('admin.settings.paymentMethods.colName'),
      cell: (row) => <span className="text-body-sm text-ink">{row.name}</span>,
    },
    {
      id: 'kind',
      header: t('admin.settings.paymentMethods.colKind'),
      cell: (row) => (
        <span className="text-body-sm text-ink">
          {row.kind === 'CASH'
            ? t('admin.settings.paymentMethods.kindCASH')
            : t('admin.settings.paymentMethods.kindNON_CASH')}
        </span>
      ),
    },
    {
      id: 'requiresReference',
      header: t('admin.settings.paymentMethods.colRef'),
      cell: (row) => (
        <span className="text-body-sm text-ink">
          {row.requiresReference
            ? t('admin.settings.paymentMethods.refYes')
            : t('admin.settings.paymentMethods.refNo')}
        </span>
      ),
    },
    {
      id: 'status',
      header: t('admin.settings.paymentMethods.colActive'),
      cell: (row) => (
        <Chip
          status={row.isActive ? 'online' : 'item_unavailable'}
          label={
            row.isActive
              ? t('admin.settings.paymentMethods.activeYes')
              : t('admin.settings.paymentMethods.activeNo')
          }
          size="sm"
        />
      ),
    },
    {
      id: 'actions',
      header: t('admin.settings.paymentMethods.colAction'),
      align: 'right',
      cell: (row) => (
        <Button size="sm" variant="secondary" onClick={() => openEdit(row)}>
          {t('admin.settings.paymentMethods.editButton')}
        </Button>
      ),
    },
  ]

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault()
    if (!code.trim() || !name.trim()) return
    await onSaveMethod({
      ...(editingId ? { id: editingId } : {}),
      code: code.trim().toUpperCase(),
      name: name.trim(),
      kind,
      requiresReference,
      sortOrder,
      isActive,
    })
    setDialogOpen(false)
  }

  return (
    <Card className="flex flex-col gap-4 p-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-h2 font-semibold text-ink">
            {t('admin.settings.paymentMethods.sectionTitle')}
          </h2>
          <p className="text-caption text-ink-soft">
            {t('admin.settings.paymentMethods.singleCashRule')}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Button
            size="sm"
            variant="ghost"
            onClick={() =>
              openCreate({ code: 'QRIS', name: 'QRIS Static/Dynamic', requiresReference: true })
            }
          >
            {t('admin.settings.paymentMethods.templateQris')}
          </Button>
          <Button
            size="sm"
            variant="ghost"
            onClick={() =>
              openCreate({ code: 'TRANSFER', name: 'Bank Transfer', requiresReference: true })
            }
          >
            {t('admin.settings.paymentMethods.templateTransfer')}
          </Button>
          <Button
            size="sm"
            variant="ghost"
            onClick={() =>
              openCreate({ code: 'CARD', name: 'EDC Debit / Credit Card', requiresReference: true })
            }
          >
            {t('admin.settings.paymentMethods.templateCard')}
          </Button>
          <Button size="sm" variant="primary" onClick={() => openCreate()}>
            {t('admin.settings.paymentMethods.addButton')}
          </Button>
        </div>
      </div>

      <DataTable
        caption={t('admin.settings.paymentMethods.sectionTitle')}
        columns={columns}
        rows={methods}
        getRowKey={(r) => r.id}
        emptyTitle={t('admin.settings.paymentMethods.sectionTitle')}
      />

      <Dialog
        open={dialogOpen}
        onOpenChange={setDialogOpen}
        title={
          editingId
            ? t('admin.settings.paymentMethods.dialogEditTitle')
            : t('admin.settings.paymentMethods.dialogCreateTitle')
        }
        footer={
          <>
            <Button variant="ghost" onClick={() => setDialogOpen(false)}>
              {t('common.cancel')}
            </Button>
            <Button
              variant="primary"
              loading={isPending}
              disabled={!code.trim() || !name.trim()}
              onClick={(e) => void handleSubmit(e)}
            >
              {t('admin.settings.paymentMethods.saveButton')}
            </Button>
          </>
        }
      >
        <form onSubmit={(e) => void handleSubmit(e)} className="flex flex-col gap-4">
          <Field
            label={t('admin.settings.paymentMethods.codeLabel')}
            htmlFor={`${idPrefix}-pm-code`}
          >
            <Input
              id={`${idPrefix}-pm-code`}
              value={code}
              onChange={(e) => setCode(e.target.value.toUpperCase())}
              disabled={isEditingActiveCash}
              required
            />
          </Field>

          <Field
            label={t('admin.settings.paymentMethods.nameLabel')}
            htmlFor={`${idPrefix}-pm-name`}
          >
            <Input
              id={`${idPrefix}-pm-name`}
              value={name}
              onChange={(e) => setName(e.target.value)}
              required
            />
          </Field>

          <Field
            label={t('admin.settings.paymentMethods.kindLabel')}
            htmlFor={`${idPrefix}-pm-kind`}
          >
            <Select
              id={`${idPrefix}-pm-kind`}
              value={kind}
              onValueChange={(v) => setKind(v as 'CASH' | 'NON_CASH')}
              disabled={isEditingActiveCash}
              options={[
                { value: 'NON_CASH', label: t('admin.settings.paymentMethods.kindNON_CASH') },
                ...(!hasOtherCashMethod || kind === 'CASH'
                  ? [{ value: 'CASH', label: t('admin.settings.paymentMethods.kindCASH') }]
                  : []),
              ]}
            />
          </Field>

          <Field
            label={t('admin.settings.paymentMethods.sortOrderLabel')}
            htmlFor={`${idPrefix}-pm-sort`}
          >
            <Input
              id={`${idPrefix}-pm-sort`}
              type="number"
              value={String(sortOrder)}
              onChange={(e) => setSortOrder(Number(e.target.value) || 0)}
            />
          </Field>

          <div className="flex flex-wrap items-center gap-6 pt-2">
            <Switch
              id={`${idPrefix}-pm-ref`}
              checked={requiresReference}
              onCheckedChange={setRequiresReference}
              label={t('admin.settings.paymentMethods.requiresRefLabel')}
            />
            <Switch
              id={`${idPrefix}-pm-active`}
              checked={isActive}
              onCheckedChange={setIsActive}
              disabled={isEditingActiveCash}
              label={t('admin.settings.paymentMethods.isActiveLabel')}
            />
          </div>
        </form>
      </Dialog>
    </Card>
  )
}
