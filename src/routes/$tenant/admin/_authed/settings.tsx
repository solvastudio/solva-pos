import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { createFileRoute, redirect } from '@tanstack/react-router'
import { useEffect, useId, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { LegalEntitiesSection } from '~/components/admin/settings/LegalEntitiesSection'
import { OutletsSection } from '~/components/admin/settings/OutletsSection'
import { PaymentMethodsTable } from '~/components/admin/settings/PaymentMethodsTable'
import { ReceiptSettingsForm } from '~/components/admin/settings/ReceiptSettingsForm'
import { TaxSettingsSection } from '~/components/admin/settings/TaxSettingsSection'
import { Field, Select, Tabs, useToast, type TabItem } from '~/components/ui'
import {
  addTaxRateFn,
  getOutletFullSettingsFn,
  listPaymentMethodsFn,
  savePaymentMethodFn,
  updateOutletTaxSettingsFn,
  updateReceiptSettingFn,
  uploadOutletLogoFn,
} from '~/functions/identity/settings.fn'
import { useCurrentTenant } from '~/hooks/use-current-tenant'
import { tenantHref } from '~/lib/tenancy/tenant-href'
import type {
  AddTaxRateInput,
  SavePaymentMethodInput,
  UpdateOutletTaxSettingsInput,
  UpdateReceiptSettingInput,
} from '~/modules/identity/shared'
import { legalEntitiesQueryOptions, outletsQueryOptions } from '~/queries/identity.queries'
import { qk } from '~/queries/keys'

export const Route = createFileRoute('/$tenant/admin/_authed/settings')({
  beforeLoad: ({ params, context }) => {
    if (!context.session?.permissions.includes('org.manage')) {
      throw redirect({ href: tenantHref(params.tenant, '/admin') })
    }
  },
  loader: async ({ params, context }) => {
    await Promise.all([
      context.queryClient.ensureQueryData(legalEntitiesQueryOptions(params.tenant)),
      context.queryClient.ensureQueryData(outletsQueryOptions(params.tenant)),
    ])
  },
  component: AdminSettingsPage,
})

function AdminSettingsPage() {
  const { t } = useTranslation()
  const { slug } = useCurrentTenant()
  const { session } = Route.useRouteContext()
  const toast = useToast()
  const queryClient = useQueryClient()
  const outletSelectId = useId()

  const [activeTab, setActiveTab] = useState('general')
  const canManageTenantWide = session?.outletIds === null

  const { data: outlets = [] } = useQuery(outletsQueryOptions(slug))
  const [selectedOutletId, setSelectedOutletId] = useState<string>(() => outlets[0]?.id ?? '')

  useEffect(() => {
    if (!selectedOutletId && outlets[0]?.id) {
      setSelectedOutletId(outlets[0].id)
    }
  }, [outlets, selectedOutletId])

  const selectedOutlet = useMemo(
    () => outlets.find((o) => o.id === selectedOutletId) ?? outlets[0] ?? null,
    [outlets, selectedOutletId],
  )

  const outletSettingsQuery = useQuery({
    queryKey: ['admin', slug, 'outlet-settings', selectedOutlet?.id ?? ''],
    queryFn: () =>
      getOutletFullSettingsFn({
        data: { outletId: selectedOutlet!.id },
      }),
    enabled: Boolean(selectedOutlet?.id),
  })

  const paymentMethodsQuery = useQuery({
    queryKey: ['admin', slug, 'payment-methods'],
    queryFn: () => listPaymentMethodsFn(),
  })

  const invalidateOutletSettings = async () => {
    await Promise.all([
      queryClient.invalidateQueries({
        queryKey: ['admin', slug, 'outlet-settings', selectedOutlet?.id ?? ''],
      }),
      queryClient.invalidateQueries({ queryKey: qk.outlets(slug) }),
    ])
  }

  const updateTaxMutation = useMutation({
    mutationFn: (data: UpdateOutletTaxSettingsInput) => updateOutletTaxSettingsFn({ data }),
    onSuccess: async (res) => {
      if (!res.ok) {
        toast.show({
          tone: 'danger',
          message: t(res.errorKey, { defaultValue: t('admin.settings.failed') }),
        })
        return
      }
      await invalidateOutletSettings()
      toast.show({ tone: 'success', message: t('admin.settings.saved') })
    },
    onError: () => {
      toast.show({ tone: 'danger', message: t('admin.settings.failed') })
    },
  })

  const addTaxRateMutation = useMutation({
    mutationFn: (data: AddTaxRateInput) => addTaxRateFn({ data }),
    onSuccess: async (res) => {
      if (!res.ok) {
        toast.show({
          tone: 'danger',
          message: t(res.errorKey, { defaultValue: t('admin.settings.failed') }),
        })
        return
      }
      await invalidateOutletSettings()
      toast.show({ tone: 'success', message: t('admin.settings.saved') })
    },
    onError: () => {
      toast.show({ tone: 'danger', message: t('admin.settings.failed') })
    },
  })

  const updateReceiptMutation = useMutation({
    mutationFn: (data: UpdateReceiptSettingInput) => updateReceiptSettingFn({ data }),
    onSuccess: async (res) => {
      if (!res.ok) {
        toast.show({
          tone: 'danger',
          message: t(res.errorKey, { defaultValue: t('admin.settings.failed') }),
        })
        return
      }
      await invalidateOutletSettings()
      toast.show({ tone: 'success', message: t('admin.settings.saved') })
    },
    onError: () => {
      toast.show({ tone: 'danger', message: t('admin.settings.failed') })
    },
  })

  const uploadLogoMutation = useMutation({
    mutationFn: (base64Data: string) =>
      uploadOutletLogoFn({
        data: {
          outletId: selectedOutlet!.id,
          base64Data,
        },
      }),
    onSuccess: async (res) => {
      if (!res.ok) {
        toast.show({
          tone: 'danger',
          message: t(res.errorKey, { defaultValue: t('admin.settings.failed') }),
        })
        return
      }
      await invalidateOutletSettings()
      toast.show({ tone: 'success', message: t('admin.settings.receipt.logoUploaded') })
    },
    onError: () => {
      toast.show({ tone: 'danger', message: t('admin.settings.failed') })
    },
  })

  const savePaymentMethodMutation = useMutation({
    mutationFn: (data: SavePaymentMethodInput) => savePaymentMethodFn({ data }),
    onSuccess: async (res) => {
      if (!res.ok) {
        toast.show({
          tone: 'danger',
          message: t(res.errorKey, { defaultValue: t('admin.settings.failed') }),
        })
        return
      }
      await queryClient.invalidateQueries({ queryKey: ['admin', slug, 'payment-methods'] })
      toast.show({ tone: 'success', message: t('admin.settings.saved') })
    },
    onError: () => {
      toast.show({ tone: 'danger', message: t('admin.settings.failed') })
    },
  })

  const outletSelector =
    outlets.length > 0 ? (
      <div className="mb-4 max-w-xs">
        <Field label={t('admin.settings.selectOutletLabel')} htmlFor={outletSelectId}>
          <Select
            id={outletSelectId}
            value={selectedOutlet?.id ?? ''}
            onValueChange={setSelectedOutletId}
            options={outlets.map((o) => ({
              value: o.id,
              label: `${o.name} (${o.code})`,
            }))}
          />
        </Field>
      </div>
    ) : null

  const tabItems: readonly TabItem[] = [
    {
      value: 'general',
      label: t('admin.settings.tabGeneral'),
      content: (
        <div className="mt-6 flex flex-col gap-10">
          <LegalEntitiesSection
            tenantSlug={slug}
            canManageTenantWide={canManageTenantWide}
          />
          <OutletsSection tenantSlug={slug} canCreateOutlet={canManageTenantWide} />
        </div>
      ),
    },
    {
      value: 'tax',
      label: t('admin.settings.tabTax'),
      content: (
        <div className="mt-6">
          {outletSelector}
          {outletSettingsQuery.data ? (
            <TaxSettingsSection
              tax={outletSettingsQuery.data.tax}
              taxRates={outletSettingsQuery.data.taxRates}
              isPending={updateTaxMutation.isPending || addTaxRateMutation.isPending}
              onSaveTaxSettings={async (input) => {
                await updateTaxMutation.mutateAsync(input)
              }}
              onAddTaxRate={async (input) => {
                await addTaxRateMutation.mutateAsync(input)
              }}
            />
          ) : null}
        </div>
      ),
    },
    {
      value: 'receipt',
      label: t('admin.settings.tabReceipt'),
      content: (
        <div className="mt-6">
          {outletSelector}
          {outletSettingsQuery.data && selectedOutlet ? (
            <ReceiptSettingsForm
              outletId={selectedOutlet.id}
              outletName={selectedOutlet.name}
              receipt={outletSettingsQuery.data.receipt}
              isPending={updateReceiptMutation.isPending || uploadLogoMutation.isPending}
              onSaveReceipt={async (input) => {
                await updateReceiptMutation.mutateAsync(input)
              }}
              onUploadLogo={async (base64Data) => {
                await uploadLogoMutation.mutateAsync(base64Data)
              }}
            />
          ) : null}
        </div>
      ),
    },
    {
      value: 'payment-methods',
      label: t('admin.settings.tabPaymentMethods'),
      content: (
        <div className="mt-6">
          <PaymentMethodsTable
            methods={paymentMethodsQuery.data ?? []}
            isPending={savePaymentMethodMutation.isPending}
            onSaveMethod={async (input) => {
              await savePaymentMethodMutation.mutateAsync(input)
            }}
          />
        </div>
      ),
    },
  ]

  return (
    <div className="flex flex-col gap-6">
      <h1 className="text-h1 font-semibold text-ink">{t('admin.settings.title')}</h1>
      <Tabs
        items={tabItems}
        value={activeTab}
        onValueChange={setActiveTab}
        size="md"
        ariaLabel={t('admin.settings.tabsLabel')}
      />
    </div>
  )
}
