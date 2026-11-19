import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react'
import { useTranslation } from 'react-i18next'
import { cn } from '~/lib/cn'
import { IconButton } from './IconButton'
import { Check, Info, TriangleAlert, X } from './icons'

export type ToastTone = 'success' | 'danger' | 'info' | 'warning'

export interface ToastInput {
  tone: ToastTone
  message: string
  durationMs?: number
}

interface ToastItem extends ToastInput {
  id: number
}

interface ToastContextValue {
  show: (input: ToastInput) => number
  dismiss: (id: number) => void
}

const ToastContext = createContext<ToastContextValue | null>(null)

const DEFAULT_DURATION_MS: Record<ToastTone, number> = {
  success: 3000,
  info: 5000,
  warning: 6000,
  danger: 8000,
}

const MAX_TOASTS = 3

function ToastIcon({ tone }: { tone: ToastTone }) {
  switch (tone) {
    case 'success':
      return <Check className="size-5 text-success-line shrink-0" aria-hidden="true" />
    case 'danger':
      return <TriangleAlert className="size-5 text-danger-line shrink-0" aria-hidden="true" />
    case 'warning':
      return <TriangleAlert className="size-5 text-warning-line shrink-0" aria-hidden="true" />
    default:
      return <Info className="size-5 text-info-line shrink-0" aria-hidden="true" />
  }
}

export function ToastProvider({ children }: { children: ReactNode }) {
  const { t } = useTranslation()
  const [items, setItems] = useState<ToastItem[]>([])
  const seqRef = useRef(0)
  const timersRef = useRef<Map<number, ReturnType<typeof setTimeout>>>(new Map())

  const dismiss = useCallback((id: number) => {
    const timer = timersRef.current.get(id)
    if (timer) {
      clearTimeout(timer)
      timersRef.current.delete(id)
    }
    setItems((prev) => prev.filter((item) => item.id !== id))
  }, [])

  const show = useCallback(
    (input: ToastInput): number => {
      seqRef.current += 1
      const id = seqRef.current
      const duration = input.durationMs ?? DEFAULT_DURATION_MS[input.tone]

      setItems((prev) => {
        const next = [...prev, { ...input, id }]
        if (next.length > MAX_TOASTS) {
          const evicted = next.slice(0, next.length - MAX_TOASTS)
          for (const e of evicted) {
            const tm = timersRef.current.get(e.id)
            if (tm) clearTimeout(tm)
            timersRef.current.delete(e.id)
          }
          return next.slice(next.length - MAX_TOASTS)
        }
        return next
      })

      if (duration > 0) {
        const timer = setTimeout(() => dismiss(id), duration)
        timersRef.current.set(id, timer)
      }
      return id
    },
    [dismiss],
  )

  useEffect(() => {
    const map = timersRef.current
    return () => {
      for (const timer of map.values()) clearTimeout(timer)
      map.clear()
    }
  }, [])

  const value = useMemo<ToastContextValue>(() => ({ show, dismiss }), [show, dismiss])

  return (
    <ToastContext.Provider value={value}>
      {children}
      <div className="pointer-events-none fixed inset-x-0 bottom-4 z-toast flex flex-col items-center gap-2 px-4">
        {items.map((item) => (
          <div
            key={item.id}
            role={item.tone === 'danger' ? 'alert' : 'status'}
            aria-live={item.tone === 'danger' ? 'assertive' : 'polite'}
            className={cn(
              'pointer-events-auto flex w-full max-w-md items-center gap-3 rounded-lg bg-surface-inverse px-4 py-3 text-body text-ink-inverse shadow-popover',
            )}
          >
            <ToastIcon tone={item.tone} />
            <span className="min-w-0 flex-1">{item.message}</span>
            <IconButton
              label={t('common.close')}
              icon={<X className="size-4 text-ink-inverse" aria-hidden="true" />}
              size="md"
              variant="ghost"
              className="text-ink-inverse hover:bg-surface-inverse"
              onClick={() => dismiss(item.id)}
            />
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  )
}

export function useToast(): ToastContextValue {
  const ctx = useContext(ToastContext)
  if (!ctx) {
    throw new Error('useToast must be used within ToastProvider')
  }
  return ctx
}
