import { useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { PosWorkspaceShell } from '~/components/pos/shell/PosWorkspaceShell'
import { usePosShellActions } from '~/components/pos/shell/use-pos-shell-actions'
import { Button } from '~/components/ui/Button'
import { Card } from '~/components/ui/Card'
import { Chip, type ChipStatus } from '~/components/ui/Chip'
import { EmptyState } from '~/components/ui/EmptyState'
import { Input } from '~/components/ui/Input'
import { Segmented } from '~/components/ui/Segmented'
import { ReceiptText, Search, WifiOff } from '~/components/ui/icons'
import { formatMoney, toMoney } from '~/lib/kernel'
import type { BootResult } from '~/pos/boot/boot'
import { fetchRemoteInvoice } from '~/pos/data/remote-invoice'
import { observeLocalSales } from '~/pos/data/sale.repo'
import type { SaleRecord } from '~/pos/db/types'

export interface HistoryListScreenProps {
  tenant: string
  bootResult: BootResult
}

function mapSyncChip(syncStatus: SaleRecord['sync_status']): ChipStatus {
  if (syncStatus === 'SYNCED') return 'synced'
  if (syncStatus === 'FAILED') return 'needs_attention'
  return 'pending'
}

export function HistoryListScreen({ tenant, bootResult }: HistoryListScreenProps) {
  const { t, i18n } = useTranslation()
  const locale = i18n.language === 'en-US' ? 'en-US' : 'id-ID'
  const shell = usePosShellActions(tenant, bootResult)

  const [sales, setSales] = useState<SaleRecord[]>([])
  const [searchQuery, setSearchQuery] = useState('')
  const [dateFilter, setDateFilter] = useState<'TODAY' | 'ALL'>('TODAY')
  const [statusFilter, setStatusFilter] = useState<'ALL' | 'PAID' | 'VOID'>('ALL')
  const [remoteState, setRemoteState] = useState<
    | { kind: 'idle' }
    | { kind: 'loading' }
    | { kind: 'offline' }
    | { kind: 'not_found' }
    | { kind: 'error' }
  >({ kind: 'idle' })

  useEffect(() => {
    if (!shell.db) return
    const sub = observeLocalSales(shell.db).subscribe({
      next(rows) {
        setSales(rows)
      },
    })
    return () => sub.unsubscribe()
  }, [shell.db])

  const activeBusinessDate = shell.openShift?.business_date ?? new Date().toISOString().slice(0, 10)

  const filteredSales = useMemo(() => {
    const q = searchQuery.trim().toLowerCase()
    return sales.filter((s) => {
      if (dateFilter === 'TODAY' && s.business_date !== activeBusinessDate) return false
      if (statusFilter !== 'ALL' && s.status !== statusFilter) return false
      if (q.length > 0) {
        const cashier = (shell.staffMap.get(s.created_by) ?? '').toLowerCase()
        if (!s.invoice_no.toLowerCase().includes(q) && !cashier.includes(q)) return false
      }
      return true
    })
  }, [sales, dateFilter, activeBusinessDate, statusFilter, searchQuery, shell.staffMap])

  const trimmedQuery = searchQuery.trim()
  const showRemoteCta = trimmedQuery.length >= 4 && filteredSales.length === 0

  async function handleRemoteLookup() {
    if (!shell.db || !trimmedQuery) return
    setRemoteState({ kind: 'loading' })
    const res = await fetchRemoteInvoice(shell.db, trimmedQuery)
    if (res.kind === 'ok') {
      setRemoteState({ kind: 'idle' })
      void shell.navigate({
        href: `/${shell.cleanSlug}/pos/return/lookup?invoiceNo=${encodeURIComponent(res.data.sale.invoice_no)}`,
      })
      return
    }
    if (res.kind === 'offline') setRemoteState({ kind: 'offline' })
    else if (res.kind === 'not_found') setRemoteState({ kind: 'not_found' })
    else setRemoteState({ kind: 'error' })
  }

  return (
    <PosWorkspaceShell
      tenantName={shell.tenantName}
      tenantSlug={shell.cleanSlug}
      outletLabel={shell.outletLabel}
      staffName={shell.staffName}
      shiftOpen={Boolean(shell.openShift)}
      activeNav="history"
      onSyncNow={shell.handleSyncNow}
      onLocaleChange={shell.handleLocaleChange}
      onLockScreen={() => void shell.handleLockScreen()}
      onSwitchStaff={shell.handleSwitchStaff}
    >
      <div className="mx-auto flex w-full max-w-4xl flex-col gap-4 p-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h1 className="text-h2 font-semibold text-ink">{t('pos.history.title')}</h1>
          <Button
            type="button"
            variant="secondary"
            size="md"
            onClick={() => void shell.navigate({ href: `/${shell.cleanSlug}/pos/return/lookup` })}
          >
            {t('pos.more.returnTitle')}
          </Button>
        </div>

        <div className="flex flex-wrap items-center gap-3">
          <div className="relative flex-1">
            <Input
              value={searchQuery}
              onChange={(e) => {
                setSearchQuery(e.target.value)
                if (remoteState.kind !== 'idle') setRemoteState({ kind: 'idle' })
              }}
              aria-label={t('pos.history.searchLabel')}
              placeholder={t('pos.history.searchPlaceholder')}
            />
          </div>

          <Segmented
            ariaLabel={t('pos.history.filterToday')}
            size="sm"
            value={dateFilter}
            onChange={(v) => setDateFilter(v as 'TODAY' | 'ALL')}
            options={[
              { value: 'TODAY', label: t('pos.history.filterToday') },
              { value: 'ALL', label: t('pos.history.filterAll') },
            ]}
          />

          <Segmented
            ariaLabel={t('pos.history.filterAllStatus')}
            size="sm"
            value={statusFilter}
            onChange={(v) => setStatusFilter(v as 'ALL' | 'PAID' | 'VOID')}
            options={[
              { value: 'ALL', label: t('pos.history.filterAllStatus') },
              { value: 'PAID', label: t('pos.history.filterPaid') },
              { value: 'VOID', label: t('pos.history.filterVoid') },
            ]}
          />
        </div>

        {showRemoteCta ? (
          <Card className="flex flex-col gap-3 p-4">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <p className="text-body text-ink-soft">{t('pos.history.remoteLookupPrompt')}</p>
              <Button
                type="button"
                variant="tonal"
                size="md"
                loading={remoteState.kind === 'loading'}
                leadingIcon={<Search className="size-4" />}
                onClick={() => void handleRemoteLookup()}
              >
                {t('pos.history.remoteLookupAction')}
              </Button>
            </div>
            {remoteState.kind === 'offline' ? (
              <div className="flex items-center gap-2 text-body text-warning-ink">
                <WifiOff className="size-4" />
                <span>{t('pos.history.remoteOfflineError')}</span>
              </div>
            ) : null}
            {remoteState.kind === 'not_found' ? (
              <p className="text-body text-ink-soft">{t('pos.history.remoteNotFound')}</p>
            ) : null}
            {remoteState.kind === 'error' ? (
              <p className="text-body text-danger-ink">{t('pos.history.remoteError')}</p>
            ) : null}
          </Card>
        ) : null}

        <h2 className="sr-only">{t('pos.history.summaryHeading')}</h2>
        {filteredSales.length === 0 ? (
          <EmptyState
            icon={<ReceiptText className="size-12" />}
            title={t('pos.history.emptyTitle')}
            description={t('pos.history.emptyDesc')}
          />
        ) : (
          <div className="flex flex-col gap-2">
            {filteredSales.map((sale) => {
              const cashierName = shell.staffMap.get(sale.created_by) ?? sale.created_by
              const syncLabel =
                sale.sync_status === 'SYNCED'
                  ? t('pos.history.syncSynced')
                  : sale.sync_status === 'FAILED'
                    ? t('pos.history.syncAttention')
                    : t('pos.history.syncPending')
              return (
                <Card
                  key={sale.id}
                  className="flex flex-wrap items-center justify-between gap-3 p-4"
                >
                  <button
                    type="button"
                    className="flex flex-1 flex-wrap items-center justify-between gap-3 text-left"
                    onClick={() =>
                      void shell.navigate({ href: `/${shell.cleanSlug}/pos/history/${sale.id}` })
                    }
                  >
                    <div className="flex flex-col gap-1">
                      <span className="font-mono text-label font-semibold text-ink">
                        {sale.invoice_no}
                      </span>
                      <span className="text-caption text-ink-soft">
                        {cashierName} · {new Date(sale.occurred_at).toLocaleTimeString(locale, {
                          hour: '2-digit',
                          minute: '2-digit',
                        })}
                      </span>
                    </div>

                    <div className="flex items-center gap-2">
                      {sale.status === 'VOID' ? (
                        <Chip status="void" label={t('pos.history.filterVoid')} />
                      ) : null}
                      <Chip status={mapSyncChip(sale.sync_status)} label={syncLabel} />
                      <span className="font-mono text-label font-semibold text-ink">
                        {formatMoney(toMoney(sale.total_due), locale)}
                      </span>
                    </div>
                  </button>
                </Card>
              )
            })}
          </div>
        )}
      </div>
    </PosWorkspaceShell>
  )
}
