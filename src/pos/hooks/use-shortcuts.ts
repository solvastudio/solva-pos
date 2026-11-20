import { useEffect } from 'react'

export interface SellShortcutHandlers {
  enabled?: boolean
  onFocusSearch: () => void
  onPay: () => void
  onSelectPrevLine: () => void
  onSelectNextLine: () => void
  onIncrementSelected: () => void
  onDecrementSelected: () => void
  onRemoveSelected: () => void
  onConfirm: () => void
  onEscape: () => void
  onOpenShortcuts: () => void
}

function isEditableElement(target: EventTarget | null): boolean {
  if (!target || typeof (target as HTMLElement).tagName !== 'string') return false
  const el = target as HTMLElement
  if (el.isContentEditable) return true
  const tag = el.tagName.toUpperCase()
  return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT'
}

/**
 * Keyboard shortcuts per `docs/DESIGN.md §7.3`:
 * `F2` / `/`, `F4`, `ArrowUp` / `ArrowDown`, `+` / `-`, `Delete`, `Enter`, `Esc`, `Ctrl+K`.
 */
export function useSellShortcuts(handlers: SellShortcutHandlers): void {
  const enabled = handlers.enabled ?? true

  useEffect(() => {
    if (!enabled) return

    const onKeyDown = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault()
        handlers.onOpenShortcuts()
        return
      }
      if (e.key === 'F2') {
        e.preventDefault()
        handlers.onFocusSearch()
        return
      }
      if (e.key === 'F4') {
        e.preventDefault()
        handlers.onPay()
        return
      }
      if (e.key === 'Escape') {
        e.preventDefault()
        handlers.onEscape()
        return
      }

      if (isEditableElement(e.target)) {
        return
      }

      if (e.key === '/') {
        e.preventDefault()
        handlers.onFocusSearch()
      } else if (e.key === 'ArrowUp') {
        e.preventDefault()
        handlers.onSelectPrevLine()
      } else if (e.key === 'ArrowDown') {
        e.preventDefault()
        handlers.onSelectNextLine()
      } else if (e.key === '+' || e.key === '=') {
        e.preventDefault()
        handlers.onIncrementSelected()
      } else if (e.key === '-' || e.key === '_') {
        e.preventDefault()
        handlers.onDecrementSelected()
      } else if (e.key === 'Delete') {
        e.preventDefault()
        handlers.onRemoveSelected()
      } else if (e.key === 'Enter') {
        handlers.onConfirm()
      }
    }

    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [enabled, handlers])
}
