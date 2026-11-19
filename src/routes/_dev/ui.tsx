import { createFileRoute, notFound } from '@tanstack/react-router'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import {
  Bell,
  Button,
  Card,
  Checkbox,
  Chip,
  Dialog,
  EmptyState,
  Field,
  IconButton,
  Input,
  Package,
  Radio,
  Segmented,
  Select,
  Skeleton,
  Switch,
  Tabs,
  ToastProvider,
  Tooltip,
  useToast,
} from '~/components/ui'

export const Route = createFileRoute('/_dev/ui')({
  beforeLoad: () => {
    if (!import.meta.env.DEV) {
      throw notFound()
    }
  },
  component: DevUiPage,
})

function DevUiInner() {
  const { t } = useTranslation()
  const toast = useToast()
  const [tab, setTab] = useState('all')
  const [seg, setSeg] = useState('percent')
  const [sel, setSel] = useState('cash')
  const [checked, setChecked] = useState(true)
  const [radioVal, setRadioVal] = useState('58')
  const [sw, setSw] = useState(true)
  const [dialogOpen, setDialogOpen] = useState(false)

  return (
    <main className="mx-auto max-w-content space-y-6 px-4 py-6 sm:px-5 lg:px-6">
      <h1 className="text-h1 font-semibold text-ink">{t('dev.ui.title')}</h1>

      <Card padding="admin">
        <h2 className="text-h2 font-semibold text-ink">{t('dev.ui.buttons')}</h2>
        <div className="mt-4 flex flex-wrap items-center gap-3">
          <Button variant="primary" size="xl">
            {t('dev.ui.btnPrimary')}
          </Button>
          <Button variant="secondary" size="lg">
            {t('dev.ui.btnSecondary')}
          </Button>
          <Button variant="tonal" size="md">
            {t('dev.ui.btnTonal')}
          </Button>
          <Button variant="danger" size="lg">
            {t('dev.ui.btnDanger')}
          </Button>
          <Button loading loadingLabel={t('dev.ui.btnLoading')} size="lg">
            {t('dev.ui.btnPrimary')}
          </Button>
          <Button disabled size="lg">
            {t('dev.ui.btnDisabled')}
          </Button>
          <IconButton
            label={t('dev.ui.iconLabel')}
            icon={<Bell className="size-5" aria-hidden="true" />}
            badge={3}
          />
        </div>
      </Card>

      <Card padding="admin">
        <h2 className="text-h2 font-semibold text-ink">{t('dev.ui.inputs')}</h2>
        <div className="mt-4 grid gap-4 md:grid-cols-2">
          <Field label={t('dev.ui.fieldLabel')} htmlFor="dev-money" hint={t('dev.ui.fieldHint')}>
            <Input
              id="dev-money"
              kind="money"
              placeholder={t('dev.ui.inputPlaceholder')}
              defaultValue="112500"
            />
          </Field>
          <Field label={t('dev.ui.fieldLabel')} htmlFor="dev-money-err" error={t('dev.ui.fieldError')}>
            <Input id="dev-money-err" kind="text" invalid defaultValue="abc" />
          </Field>
          <Field label={t('dev.ui.selectLabel')} htmlFor="dev-select">
            <Select
              id="dev-select"
              ariaLabel={t('dev.ui.selectLabel')}
              placeholder={t('dev.ui.selectPlaceholder')}
              value={sel}
              onValueChange={setSel}
              options={[
                { value: 'cash', label: t('dev.ui.optCash') },
                { value: 'qris', label: t('dev.ui.optQris') },
              ]}
            />
          </Field>
        </div>
      </Card>

      <Card padding="admin">
        <h2 className="text-h2 font-semibold text-ink">{t('dev.ui.navigation')}</h2>
        <div className="mt-4 space-y-4">
          <Tabs
            value={tab}
            onValueChange={setTab}
            ariaLabel={t('dev.ui.navigation')}
            items={[
              { value: 'all', label: t('dev.ui.tabAll'), badge: 12 },
              { value: 'drink', label: t('dev.ui.tabDrink'), badge: 4 },
            ]}
          />
          <div>
            <Segmented
              ariaLabel={t('dev.ui.segLabel')}
              value={seg}
              onChange={setSeg}
              options={[
                { value: 'percent', label: t('dev.ui.segPercent') },
                { value: 'nominal', label: t('dev.ui.segNominal') },
              ]}
            />
          </div>
          <div className="flex flex-wrap gap-2">
            <Chip status="online" label={t('dev.ui.chipOnline')} />
            <Chip status="offline" label={t('dev.ui.chipOffline')} />
            <Chip status="needs_attention" label={t('dev.ui.chipAttention')} />
          </div>
        </div>
      </Card>

      <Card padding="admin">
        <h2 className="text-h2 font-semibold text-ink">{t('dev.ui.controls')}</h2>
        <div className="mt-4 flex flex-col gap-3">
          <Checkbox label={t('dev.ui.checkLabel')} checked={checked} onCheckedChange={setChecked} />
          <Radio
            ariaLabel={t('dev.ui.radioLabel')}
            value={radioVal}
            onValueChange={setRadioVal}
            options={[
              { value: '58', label: t('dev.ui.radio58') },
              { value: '80', label: t('dev.ui.radio80') },
            ]}
          />
          <Tooltip content={t('dev.ui.tooltipText')}>
            <div>
              <Switch
                label={t('dev.ui.switchLabel')}
                stateText={sw ? t('dev.ui.switchStateOn') : t('dev.ui.switchStateOff')}
                checked={sw}
                onCheckedChange={setSw}
              />
            </div>
          </Tooltip>
        </div>
      </Card>

      <Card padding="admin">
        <h2 className="text-h2 font-semibold text-ink">{t('dev.ui.overlays')}</h2>
        <div className="mt-4 flex flex-wrap gap-3">
          <Button variant="secondary" onClick={() => setDialogOpen(true)}>
            {t('dev.ui.openDialog')}
          </Button>
          <Button
            variant="tonal"
            onClick={() => toast.show({ tone: 'success', message: t('dev.ui.toastMessage') })}
          >
            {t('dev.ui.showToast')}
          </Button>
        </div>
        <div className="mt-4 grid gap-4 md:grid-cols-2">
          <EmptyState
            icon={<Package className="size-12" aria-hidden="true" />}
            title={t('dev.ui.emptyTitle')}
            description={t('dev.ui.emptyDesc')}
          />
          <div className="space-y-3 p-4">
            <Skeleton className="h-6 w-2/3" />
            <Skeleton className="h-12 w-full" />
            <Skeleton className="h-control-lg w-full" />
          </div>
        </div>
      </Card>

      <Dialog
        open={dialogOpen}
        onOpenChange={setDialogOpen}
        title={t('dev.ui.dialogTitle')}
        description={t('dev.ui.dialogDesc')}
        footer={
          <Button variant="danger" onClick={() => setDialogOpen(false)}>
            {t('dev.ui.btnDanger')}
          </Button>
        }
      >
        <p className="text-body text-ink-soft">{t('dev.ui.dialogDesc')}</p>
      </Dialog>
    </main>
  )
}

function DevUiPage() {
  return (
    <ToastProvider>
      <DevUiInner />
    </ToastProvider>
  )
}
