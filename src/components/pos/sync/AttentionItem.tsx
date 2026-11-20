import { useTranslation } from 'react-i18next'
import { Card } from '~/components/ui/Card'
import { ErrorCodeBlock } from '~/components/ui/ErrorCodeBlock'
import { TriangleAlert } from '~/components/ui/icons'
import type { SanitizedOutboxQueueItem } from '~/pos/data/outbox.repo'
import { formatQueueTypeLabel } from './queue-labels'

export interface AttentionItemProps {
  item: SanitizedOutboxQueueItem
}

export function AttentionItem({ item }: AttentionItemProps) {
  const { t } = useTranslation()
  const code = item.errorCode ?? 'VALIDATION_FAILED'
  const refId = item.errorRef ?? item.id.slice(0, 8)

  return (
    <Card className="border-danger-line bg-surface p-4" data-testid={`attention-item-${item.id}`}>
      <div className="flex flex-col gap-3">
        <div className="flex items-start justify-between gap-3">
          <div className="flex items-start gap-2.5">
            <TriangleAlert className="mt-0.5 size-5 shrink-0 text-danger-ink" aria-hidden="true" />
            <div>
              <p className="text-label font-semibold text-ink">
                {formatQueueTypeLabel(t, item.type, item.referenceLabel)}
              </p>
              <p className="text-caption text-ink-soft">
                {t('pos.queue.cashierSafeNote')}
              </p>
            </div>
          </div>
        </div>

        <ErrorCodeBlock code={code} refId={refId} />
      </div>
    </Card>
  )
}
