import { useTranslation } from 'react-i18next'
import { Banknote, CreditCard, QrCode } from '~/components/ui/icons'
import { cn } from '~/lib/cn'

export interface PayMethodOption {
  id: string
  code: string
  name: string
  kind: 'CASH' | 'NON_CASH'
  requiresReference: boolean
}

export interface MethodPickerProps {
  methods: readonly PayMethodOption[]
  selectedId: string
  onSelect: (method: PayMethodOption) => void
}

function methodIcon(method: PayMethodOption) {
  if (method.kind === 'CASH') return Banknote
  if (method.code.toUpperCase().includes('QR')) return QrCode
  return CreditCard
}

export function MethodPicker({
  methods,
  selectedId,
  onSelect,
}: MethodPickerProps) {
  const { t } = useTranslation()

  return (
    <div className="flex flex-col gap-2">
      <h2 className="text-label font-semibold text-ink">{t('pos.pay.methodHeading')}</h2>
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
        {methods.map((method) => {
          const Icon = methodIcon(method)
          const active = method.id === selectedId
          return (
            <button
              key={method.id}
              type="button"
              aria-pressed={active}
              onClick={() => onSelect(method)}
              className={cn(
                'flex min-h-touch items-center gap-2.5 rounded-card border px-3 py-2.5 text-left text-label font-medium transition-colors focus-visible:ring-2 focus-visible:ring-focus-ring focus-visible:outline-none',
                active
                  ? 'border-action bg-action text-on-action'
                  : 'border-line bg-surface text-ink hover:bg-surface-sunken',
              )}
            >
              <Icon className="size-5 shrink-0" aria-hidden="true" />
              <span className="truncate">{method.name}</span>
            </button>
          )
        })}
      </div>
    </div>
  )
}
