export type UpdateStatus = 'none' | 'available' | 'pending_apply' | 'applying'

export interface SafeMomentInput {
  cartActive: boolean
  paymentActive: boolean
  shiftOpen: boolean
  queueNonAcked: number
}

/**
 * An automatic/prompted SW reload is only safe when no cart/payment flow is active,
 * the shift is closed, and no non-SCHEMA-held outbox command remains unacknowledged.
 */
export function isSafeMoment(input: SafeMomentInput): boolean {
  return !input.cartActive && !input.paymentActive && !input.shiftOpen && input.queueNonAcked === 0
}

export interface UpdateTransport {
  sendSkipWaiting(): void
  reloadPage(): void
}

export class UpdateManager {
  private status: UpdateStatus = 'none'
  private listeners = new Set<(status: UpdateStatus) => void>()
  private reloadTriggered = false
  private readonly transport: UpdateTransport

  constructor(transport?: Partial<UpdateTransport>) {
    this.transport = {
      sendSkipWaiting: transport?.sendSkipWaiting ?? (() => {}),
      reloadPage:
        transport?.reloadPage ??
        (() => {
          if (typeof window !== 'undefined' && window.location) {
            window.location.reload()
          }
        }),
    }
  }

  getStatus(): UpdateStatus {
    return this.status
  }

  subscribe(listener: (status: UpdateStatus) => void): () => void {
    this.listeners.add(listener)
    return () => {
      this.listeners.delete(listener)
    }
  }

  private setStatus(next: UpdateStatus): void {
    if (this.status === next) return
    this.status = next
    for (const listener of this.listeners) {
      listener(next)
    }
  }

  markAvailable(): void {
    if (this.status === 'none') {
      this.setStatus('available')
    }
  }

  markPendingApply(): void {
    if (this.status === 'available') {
      this.setStatus('pending_apply')
    }
  }

  applyUpdate(): boolean {
    if (this.status !== 'available' && this.status !== 'pending_apply') {
      return false
    }
    this.setStatus('applying')
    this.transport.sendSkipWaiting()
    return true
  }

  handleControllerChange(): boolean {
    if (this.status !== 'applying' || this.reloadTriggered) {
      return false
    }
    this.reloadTriggered = true
    this.transport.reloadPage()
    return true
  }
}
