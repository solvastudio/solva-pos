import { useCallback, useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { PosWorkspaceShell } from '~/components/pos/shell/PosWorkspaceShell'
import { usePosShellActions } from '~/components/pos/shell/use-pos-shell-actions'
import { Button } from '~/components/ui/Button'
import { Card } from '~/components/ui/Card'
import { Chip } from '~/components/ui/Chip'
import { Input } from '~/components/ui/Input'
import { useToast } from '~/components/ui/Toast'
import { Download, RefreshCw } from '~/components/ui/icons'
import type { BootResult } from '~/pos/boot/boot'
import {
  listSanitizedQueueItems,
  type SanitizedOutboxQueueItem,
} from '~/pos/data/outbox.repo'
import { useSyncState } from '~/pos/hooks/use-sync-state'
import { exportPending, triggerBlobDownload } from '~/pos/maintenance/export-pending'
import { kickActiveSync } from '~/pos/sync'
import { AttentionItem } from './AttentionItem'
import { formatQueueTypeLabel } from './queue-labels'

export interface QueueViewProps {
  items: readonly SanitizedOutboxQueueItem[]
  lastSuccessAt: string | null
  searchQuery: string
  onSearchChange: (q: string) => void
  onSyncNow: () => void
  onExportPending: () => void
  exporting?: boolean
}

function formatAgeLabel(createdAtIso: string): string {
  const ms = Date.parse(createdAtIso)
  if (!Number.isFinite(ms)) return '0m'
  const diffMin = Math.max(0, Math.floor((Date.now() - ms) / 60_000))
  if (diffMin < 60) return `${diffMin}m`
  const hours = Math.floor(diffMin / 60)
  return `${hours}h`
}

function formatLastSyncTime(iso: string | null): string {
  if (!iso) return ''
  const ms = Date.parse(iso)
  if (!Number.isFinite(ms)) return ''
  const d = new Date(ms)
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
}

export function QueueView({
  items,
  lastSuccessAt,
  searchQuery,
  onSearchChange,
  onSyncNow,
  onExportPending,
  exporting = false,
}: QueueViewProps) {
  const { t } = useTranslation()

  const attentionItems = items.filter((i) => i.status === 'NEEDS_ATTENTION')
  const regularItems = items.filter((i) => i.status !== 'NEEDS_ATTENTION')
  const lastSyncFormatted = formatLastSyncTime(lastSuccessAt)

  return (
    <div className="mx-auto flex w-full max-w-3xl flex-col gap-4 p-4">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-h2 font-semibold text-ink">{t('pos.queue.title')}</h1>
          <p className="text-body text-ink-soft">{t('pos.queue.cashierSafeNote')}</p>
          {lastSyncFormatted ? (
            <p className="text-caption text-ink-soft">
              {t('pos.queue.lastSyncPrefix', { time: lastSyncFormatted })}
            </p>
          ) : null}
        </div>

        <div className="flex flex-wrap gap-2">
          <Button
            type="button"
            variant="primary"
            size="md"
            leadingIcon={<RefreshCw className="size-4" aria-hidden="true" />}
            onClick={onSyncNow}
          >
            {t('pos.queue.syncNowButton')}
          </Button>
          <Button
            type="button"
            variant="secondary"
            size="md"
            loading={exporting}
            leadingIcon={<Download className="size-4" aria-hidden="true" />}
            onClick={onExportPending}
          >
            {t('pos.queue.exportButton')}
          </Button>
        </div>
      </div>

      <div>
        <Input
          type="search"
          aria-label={t('pos.queue.searchPlaceholder')}
          placeholder={t('pos.queue.searchPlaceholder')}
          value={searchQuery}
          onChange={(e) => onSearchChange(e.target.value)}
        />
      </div>

      {attentionItems.length > 0 ? (
        <section aria-labelledby="queue-attention-heading" className="flex flex-col gap-3">
          <h2 id="queue-attention-heading" className="text-h3 font-semibold text-danger-ink">
            {t('pos.queue.attentionHeading', { count: attentionItems.length })}
          </h2>
          {attentionItems.map((item) => (
            <AttentionItem key={item.id} item={item} />
          ))}
        </section>
      ) : null}

      <section aria-labelledby="queue-pending-heading" className="flex flex-col gap-3">
        <h2 id="queue-pending-heading" className="text-h3 font-semibold text-ink">
          {t('pos.queue.pendingHeading', { count: regularItems.length })}
        </h2>

        {regularItems.length === 0 ? (
          <Card className="p-4 text-body text-ink-soft">{t('pos.queue.emptyPending')}</Card>
        ) : (
          regularItems.map((item) => {
            let statusText: string
            let chipStatus: 'pending' | 'syncing' | 'synced' | 'offline'
            let reasonDetail: string | null = null

            if (item.managerDecision === 'ACCEPTED_MANUAL' && item.status === 'ACKED') {
              statusText = t('pos.queue.acceptedManualBadge')
              chipStatus = 'synced'
            } else if (item.status === 'DISMISSED') {
              statusText = t('pos.queue.dismissedBadge')
              chipStatus = 'offline'
            } else if (item.schemaHeld) {
              statusText = t('pos.queue.heldBadge')
              chipStatus = 'offline'
              if (item.schemaHoldCode === 'SERVER_BEHIND') {
                reasonDetail = t('pos.queue.heldServerBehind')
              } else if (item.schemaHoldCode === 'UPDATE_REQUIRED') {
                reasonDetail = t('pos.queue.heldUpdateRequired')
              } else if (item.schemaHoldCode === 'SCHEMA_NOT_MIGRATABLE') {
                reasonDetail = t('pos.queue.heldNotMigratable')
              }
            } else if (item.status === 'SENDING') {
              statusText = t('pos.queue.sendingBadge')
              chipStatus = 'syncing'
            } else if (item.attempts > 0) {
              statusText = t('pos.queue.retryBadge', { attempts: item.attempts })
              chipStatus = 'pending'
            } else {
              statusText = t('pos.queue.pendingAge', {
                age: formatAgeLabel(item.createdAtDevice),
              })
              chipStatus = 'pending'
            }

            return (
              <Card key={item.id} className="p-4" data-testid={`queue-item-${item.id}`}>
                <div className="flex flex-col gap-1.5 sm:flex-row sm:items-center sm:justify-between">
                  <div>
                    <p className="text-label font-semibold text-ink">
                      {formatQueueTypeLabel(t, item.type, item.referenceLabel)}
                    </p>
                    {reasonDetail ? (
                      <p className="text-caption text-ink-soft">{reasonDetail}</p>
                    ) : null}
                  </div>
                  <Chip status={chipStatus} label={statusText} size="sm" />
                </div>
              </Card>
            )
          })
        )}
      </section>
    </div>
  )
}

export interface QueueScreenProps {
  tenant: string
  bootResult: BootResult
}

export function QueueScreen({ tenant, bootResult }: QueueScreenProps) {
  const { t } = useTranslation()
  const { show: showToast } = useToast()
  const shell = usePosShellActions(tenant, bootResult)
  const { syncState } = useSyncState()
  const [query, setQuery] = useState('')
  const [items, setItems] = useState<SanitizedOutboxQueueItem[]>([])
  const [exporting, setExporting] = useState(false)

  const refreshQueue = useCallback(async () => {
    if (!shell.db) return
    const list = await listSanitizedQueueItems(shell.db, { query })
    setItems(list)
  }, [shell.db, query])

  useEffect(() => {
    void refreshQueue()
  }, [refreshQueue, syncState.queue.pending, syncState.queue.attention])

  async function handleExport() {
    if (!shell.db) return
    setExporting(true)
    try {
      const exp = await exportPending(shell.db, {
        staffId: shell.sessionStaff?.staffId ?? null,
      })
      triggerBlobDownload(exp.blob, exp.filename)
      showToast({
        tone: 'success',
        message: t('pos.queue.exportedToast', { count: exp.count }),
      })
    } finally {
      setExporting(false)
    }
  }

  return (
    <PosWorkspaceShell
      tenantName={shell.tenantName}
      tenantSlug={shell.cleanSlug}
      outletLabel={shell.outletLabel}
      staffName={shell.staffName}
      shiftOpen={Boolean(shell.openShift)}
      activeNav="more"
      onSyncNow={() => kickActiveSync('manual')}
      onLocaleChange={shell.handleLocaleChange}
      onLockScreen={() => void shell.handleLockScreen()}
      onSwitchStaff={shell.handleSwitchStaff}
    >
      <QueueView
        items={items}
        lastSuccessAt={syncState.lastSuccessAt}
        searchQuery={query}
        onSearchChange={setQuery}
        onSyncNow={() => kickActiveSync('manual')}
        onExportPending={() => void handleExport()}
        exporting={exporting}
      />
    </PosWorkspaceShell>
  )
}
