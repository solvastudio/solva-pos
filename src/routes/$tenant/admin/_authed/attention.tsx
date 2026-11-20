import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { createFileRoute, redirect } from '@tanstack/react-router'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { AttentionSection } from '~/components/admin/attention/AttentionSection'
import { GapTable } from '~/components/admin/attention/GapTable'
import { AuditTable } from '~/components/admin/audit/AuditTable'
import { Tabs, useToast, type TabItem } from '~/components/ui'
import { exportAuditCsvFn, listAuditFn, verifyAuditChainFn } from '~/functions/audit/audit.fn'
import {
  acceptManualAttentionFn,
  annotateGapFn,
  dismissAttentionFn,
  escalateAttentionFn,
  importPendingFileFn,
  listAttentionFn,
  listGapsFn,
} from '~/functions/sync/attention.fn'
import { useCurrentTenant } from '~/hooks/use-current-tenant'
import { tenantHref } from '~/lib/tenancy/tenant-href'
import type { VerifyChainStatus } from '~/modules/audit/shared'
import type { PendingImportResult } from '~/modules/sync/shared'

export const Route = createFileRoute('/$tenant/admin/_authed/attention')({
  beforeLoad: ({ params, context }) => {
    const perms = context.session?.permissions ?? []
    if (
      !perms.includes('user.manage') &&
      !perms.includes('gap.annotate') &&
      !perms.includes('audit.view')
    ) {
      throw redirect({ href: tenantHref(params.tenant, '/admin') })
    }
  },
  component: AdminAttentionPage,
})

function downloadTextFile(text: string, filename: string, mime: string) {
  if (typeof document === 'undefined') return
  const blob = new Blob([text], { type: mime })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  document.body.appendChild(a)
  a.click()
  a.remove()
  URL.revokeObjectURL(url)
}

function AdminAttentionPage() {
  const { t } = useTranslation()
  const { slug } = useCurrentTenant()
  const { session } = Route.useRouteContext()
  const toast = useToast()
  const queryClient = useQueryClient()

  const perms = session?.permissions ?? []
  const canManageAttention = perms.includes('user.manage')
  const canAnnotateGap = perms.includes('gap.annotate')
  const canViewAudit = perms.includes('audit.view')

  const defaultTab = canManageAttention ? 'attention' : canAnnotateGap ? 'gaps' : 'audit'
  const [activeTab, setActiveTab] = useState(defaultTab)
  const [actionFilter, setActionFilter] = useState('')
  const [fromDate, setFromDate] = useState('')
  const [toDate, setToDate] = useState('')
  const [importResult, setImportResult] = useState<PendingImportResult | null>(null)
  const [verifyResult, setVerifyResult] = useState<VerifyChainStatus | null>(null)

  const { data: attentionItems = [] } = useQuery({
    queryKey: ['admin', slug, 'attention'],
    queryFn: () => listAttentionFn({ data: {} }),
    enabled: canManageAttention,
  })

  const { data: gaps = [] } = useQuery({
    queryKey: ['admin', slug, 'gaps'],
    queryFn: () => listGapsFn({ data: {} }),
    enabled: canAnnotateGap,
  })

  const { data: auditRows = [] } = useQuery({
    queryKey: ['admin', slug, 'audit', actionFilter, fromDate, toDate],
    queryFn: () =>
      listAuditFn({
        data: {
          action: actionFilter || null,
          fromDate: fromDate || null,
          toDate: toDate || null,
        },
      }),
    enabled: canViewAudit,
  })

  const refreshAttention = () =>
    queryClient.invalidateQueries({ queryKey: ['admin', slug, 'attention'] })

  const acceptMut = useMutation({
    mutationFn: (itemId: string) => acceptManualAttentionFn({ data: { itemId } }),
    onSuccess: (res) => {
      if (!res.ok) {
        toast.show({ tone: 'danger', message: t('admin.settings.failed') })
        return
      }
      toast.show({ tone: 'success', message: t('admin.attention.resolvedToast') })
      void refreshAttention()
    },
  })

  const dismissMut = useMutation({
    mutationFn: (p: { itemId: string; reasonText: string }) =>
      dismissAttentionFn({ data: p }),
    onSuccess: (res) => {
      if (!res.ok) {
        toast.show({ tone: 'danger', message: t('admin.settings.failed') })
        return
      }
      toast.show({ tone: 'success', message: t('admin.attention.resolvedToast') })
      void refreshAttention()
    },
  })

  const escalateMut = useMutation({
    mutationFn: (itemId: string) => escalateAttentionFn({ data: { itemId } }),
    onSuccess: (res) => {
      if (!res.ok) {
        toast.show({ tone: 'danger', message: t('admin.settings.failed') })
        return
      }
      toast.show({ tone: 'success', message: t('admin.attention.resolvedToast') })
      void refreshAttention()
    },
  })

  const importMut = useMutation({
    mutationFn: (fileText: string) => importPendingFileFn({ data: { fileText } }),
    onSuccess: (res) => {
      if (!res.ok) {
        toast.show({ tone: 'danger', message: t('admin.settings.failed') })
        return
      }
      setImportResult(res.data)
      void refreshAttention()
    },
  })

  const annotateMut = useMutation({
    mutationFn: (p: { gapId: string; reasonText: string }) =>
      annotateGapFn({ data: p }),
    onSuccess: (res) => {
      if (!res.ok) {
        toast.show({ tone: 'danger', message: t('admin.settings.failed') })
        return
      }
      toast.show({ tone: 'success', message: t('admin.settings.saved') })
      void queryClient.invalidateQueries({ queryKey: ['admin', slug, 'gaps'] })
    },
  })

  const exportCsvMut = useMutation({
    mutationFn: () =>
      exportAuditCsvFn({
        data: {
          action: actionFilter || null,
          fromDate: fromDate || null,
          toDate: toDate || null,
        },
      }),
    onSuccess: (res) => {
      if (!res.ok) return
      downloadTextFile(res.data.csv, res.data.filename, 'text/csv;charset=utf-8')
    },
  })

  const verifyMut = useMutation({
    mutationFn: () => verifyAuditChainFn(),
    onSuccess: (res) => {
      if (res.ok) setVerifyResult(res.data)
    },
  })

  const tabs: TabItem[] = []
  if (canManageAttention) {
    tabs.push({
      value: 'attention',
      label: t('admin.attention.tabAttention', { count: attentionItems.length }),
      content: (
        <div className="mt-6">
          <AttentionSection
            items={attentionItems}
            onAcceptManual={(id) => acceptMut.mutate(id)}
            onDismiss={(itemId, reasonText) => dismissMut.mutate({ itemId, reasonText })}
            onEscalate={(id) => escalateMut.mutate(id)}
            onImportPending={(txt) => importMut.mutate(txt)}
            importResult={importResult}
            busy={
              acceptMut.isPending ||
              dismissMut.isPending ||
              escalateMut.isPending ||
              importMut.isPending
            }
          />
        </div>
      ),
    })
  }
  if (canAnnotateGap) {
    tabs.push({
      value: 'gaps',
      label: t('admin.attention.tabGaps'),
      content: (
        <div className="mt-6">
          <GapTable
            gaps={gaps}
            canAnnotate={canAnnotateGap}
            onAnnotate={(gapId, reasonText) => annotateMut.mutate({ gapId, reasonText })}
            busy={annotateMut.isPending}
          />
        </div>
      ),
    })
  }
  if (canViewAudit) {
    tabs.push({
      value: 'audit',
      label: t('admin.attention.tabAudit'),
      content: (
        <div className="mt-6">
          <AuditTable
            rows={auditRows}
            actionFilter={actionFilter}
            fromDate={fromDate}
            toDate={toDate}
            onActionFilterChange={setActionFilter}
            onFromDateChange={setFromDate}
            onToDateChange={setToDate}
            onExportCsv={() => exportCsvMut.mutate()}
            onVerifyChain={() => verifyMut.mutate()}
            verifyResult={verifyResult}
            busy={exportCsvMut.isPending || verifyMut.isPending}
          />
        </div>
      ),
    })
  }

  return (
    <div className="flex flex-col gap-6">
      <h1 className="text-h1 font-semibold text-ink">{t('admin.attention.title')}</h1>
      <Tabs
        items={tabs}
        value={activeTab}
        onValueChange={setActiveTab}
        size="md"
        ariaLabel={t('admin.attention.tabsLabel')}
      />
    </div>
  )
}
