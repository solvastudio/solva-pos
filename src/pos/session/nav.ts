export type PosNavKey = 'sell' | 'tables' | 'bills' | 'history' | 'shift' | 'more'

export interface PosNavItemSpec {
  readonly key: PosNavKey
  readonly labelKey: string
  readonly href: string
}

export function isWaiterRegister(registerType?: string | null): boolean {
  return registerType === 'WAITER'
}

const WAITER_FORBIDDEN_SUFFIXES = [
  '/pos/sell',
  '/pos/pay',
  '/pos/cash',
  '/pos/history',
  '/pos/return',
  '/pos/shift',
] as const

export function isRouteForbiddenForWaiter(pathname: string): boolean {
  const normalized = pathname.replace(/\/+$/, '').toLowerCase()
  return WAITER_FORBIDDEN_SUFFIXES.some((suffix) => {
    const idx = normalized.indexOf(suffix)
    if (idx === -1) return false
    const rest = normalized.slice(idx + suffix.length)
    return rest === '' || rest.startsWith('/')
  })
}

/**
 * Returns navigation tabs strictly filtered by `register_type`:
 * `WAITER` sees ONLY Tables (`Meja`), Bills (`Bill`), More (`Lain`), with no Sell/Shift/History.
 */
export function buildPosNavSpecs(input: {
  cleanSlug: string
  registerType?: string | null
  shiftOpen: boolean
}): PosNavItemSpec[] {
  const base = `/${input.cleanSlug}/pos`
  if (isWaiterRegister(input.registerType)) {
    return [
      { key: 'tables', labelKey: 'pos.shellNav.tables', href: `${base}/tables` },
      { key: 'bills', labelKey: 'pos.shellNav.bills', href: `${base}/bills` },
      { key: 'more', labelKey: 'pos.shellNav.more', href: `${base}/more` },
    ]
  }
  return [
    { key: 'sell', labelKey: 'pos.shellNav.sell', href: `${base}/sell` },
    { key: 'tables', labelKey: 'pos.shellNav.tables', href: `${base}/tables` },
    { key: 'bills', labelKey: 'pos.shellNav.bills', href: `${base}/bills` },
    { key: 'history', labelKey: 'pos.shellNav.history', href: `${base}/history` },
    {
      key: 'shift',
      labelKey: 'pos.shellNav.shift',
      href: input.shiftOpen ? `${base}/shift` : `${base}/shift/open`,
    },
    { key: 'more', labelKey: 'pos.shellNav.more', href: `${base}/more` },
  ]
}
