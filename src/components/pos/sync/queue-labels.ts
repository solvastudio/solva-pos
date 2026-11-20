import type { TFunction } from 'i18next'

export function formatQueueTypeLabel(t: TFunction, type: string, ref: string): string {
  switch (type) {
    case 'FinalizeSale':
      return t('pos.queue.types.FinalizeSale', { ref })
    case 'VoidSale':
      return t('pos.queue.types.VoidSale', { ref })
    case 'FinalizeCreditNote':
      return t('pos.queue.types.FinalizeCreditNote', { ref })
    case 'OpenShift':
      return t('pos.queue.types.OpenShift', { ref })
    case 'CloseShift':
      return t('pos.queue.types.CloseShift', { ref })
    case 'RecordCashMovement':
      return t('pos.queue.types.RecordCashMovement', { ref })
    case 'AppendAudit':
      return t('pos.queue.types.AppendAudit', { ref })
    case 'ReportPinState':
      return t('pos.queue.types.ReportPinState', { ref })
    default:
      return `${type} ${ref}`
  }
}
