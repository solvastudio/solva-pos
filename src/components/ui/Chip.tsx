import type { ComponentType } from 'react'
import { cn } from '~/lib/cn'
import {
  Ban,
  Check,
  CircleMinus,
  CirclePlay,
  CircleStop,
  ClockAlert,
  Download,
  EyeOff,
  Hourglass,
  Inbox,
  Lock,
  LockKeyhole,
  PencilLine,
  Printer,
  RefreshCw,
  Send,
  ShieldAlert,
  TriangleAlert,
  Truck,
  Unlink,
  Upload,
  Wifi,
  WifiOff,
} from './icons'

export type ChipStatus =
  | 'online'
  | 'offline'
  | 'syncing'
  | 'server_busy'
  | 'synced'
  | 'pending'
  | 'sync_error'
  | 'needs_attention'
  | 'lease_warning'
  | 'device_locked'
  | 'update_available'
  | 'update_required'
  | 'stock_negative'
  | 'stock_estimate_low'
  | 'void'
  | 'in_transit'
  | 'lease_other'
  | 'handover_pending'
  | 'handover_incoming'
  | 'screen_locked'
  | 'item_unavailable'
  | 'open_price'
  | 'reprint'
  | 'print_failed'
  | 'shift_open'
  | 'shift_closed'
  | 'force_closed'
  | 'gap_open'
  | 'gap_explained'

type FamilyStyle =
  | 'success'
  | 'warning'
  | 'danger'
  | 'danger-solid'
  | 'warning-solid'
  | 'info'
  | 'violet'
  | 'teal'
  | 'neutral'

const FAMILY_CLASSES: Record<FamilyStyle, string> = {
  success: 'bg-success-soft border-success-line text-success-ink',
  warning: 'bg-warning-soft border-warning-line text-warning-ink',
  danger: 'bg-danger-soft border-danger-line text-danger-ink',
  'danger-solid': 'bg-danger-solid border-danger-solid text-on-action',
  'warning-solid': 'bg-warning-solid border-warning-solid text-on-action',
  info: 'bg-info-soft border-info-line text-info-ink',
  violet: 'bg-violet-soft border-violet-line text-violet-ink',
  teal: 'bg-teal-soft border-teal-line text-teal-ink',
  neutral: 'bg-surface-sunken border-line text-ink',
}

interface StatusMeta {
  family: FamilyStyle
  icon: ComponentType<{ className?: string; 'aria-hidden'?: boolean | 'true' }>
  spin?: boolean
}

const STATUS_META: Record<ChipStatus, StatusMeta> = {
  online: { family: 'success', icon: Wifi },
  offline: { family: 'warning', icon: WifiOff },
  syncing: { family: 'info', icon: RefreshCw, spin: true },
  server_busy: { family: 'info', icon: Hourglass },
  synced: { family: 'success', icon: Check },
  pending: { family: 'warning', icon: Upload },
  sync_error: { family: 'danger', icon: TriangleAlert },
  needs_attention: { family: 'danger', icon: TriangleAlert },
  lease_warning: { family: 'warning', icon: ClockAlert },
  device_locked: { family: 'danger-solid', icon: Lock },
  update_available: { family: 'info', icon: Download },
  update_required: { family: 'warning-solid', icon: Download },
  stock_negative: { family: 'danger', icon: CircleMinus },
  stock_estimate_low: { family: 'warning', icon: TriangleAlert },
  void: { family: 'neutral', icon: Ban },
  in_transit: { family: 'teal', icon: Truck },
  lease_other: { family: 'violet', icon: Lock },
  handover_pending: { family: 'violet', icon: Send },
  handover_incoming: { family: 'info', icon: Inbox },
  screen_locked: { family: 'neutral', icon: LockKeyhole },
  item_unavailable: { family: 'neutral', icon: EyeOff },
  open_price: { family: 'info', icon: PencilLine },
  reprint: { family: 'neutral', icon: Printer },
  print_failed: { family: 'danger', icon: Printer },
  shift_open: { family: 'success', icon: CirclePlay },
  shift_closed: { family: 'neutral', icon: CircleStop },
  force_closed: { family: 'warning', icon: ShieldAlert },
  gap_open: { family: 'danger', icon: Unlink },
  gap_explained: { family: 'neutral', icon: Unlink },
}

export interface ChipProps {
  status: ChipStatus
  label: string
  size?: 'sm' | 'md'
  className?: string
  announce?: boolean
}

export function Chip({ status, label, size = 'md', className, announce = false }: ChipProps) {
  const meta = STATUS_META[status]
  const Icon = meta.icon
  const heightCls = size === 'sm' ? 'h-chip-sm px-2' : 'h-chip-md px-2.5'

  return (
    <span
      role={announce ? 'status' : undefined}
      className={cn(
        'inline-flex items-center gap-1 rounded-md border text-label-sm whitespace-nowrap',
        heightCls,
        FAMILY_CLASSES[meta.family],
        className,
      )}
    >
      <Icon
        className={cn('size-4 shrink-0', meta.spin ? 'motion-safe:animate-spin' : '')}
        aria-hidden="true"
      />
      <span>{label}</span>
    </span>
  )
}
