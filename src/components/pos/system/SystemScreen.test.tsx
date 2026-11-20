// @vitest-environment jsdom
import { changeLocale } from '~/i18n'
import { cleanup, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import axe from 'axe-core'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { SystemVariant } from '~/pos/boot/route-decision'
import { SystemScreen } from './SystemScreen'

beforeEach(async () => {
  await changeLocale('en-US')
})

afterEach(() => {
  cleanup()
})

const ALL_VARIANTS: SystemVariant[] = [
  'lease_expired',
  'clock_back',
  'update_required',
  'duplicate_instance',
  'revoked',
  'credential_expired',
  'tenant_suspended',
  'local_db_failed',
]

describe('SystemScreen (SCR-P15)', () => {
  it('renders all 8 variants with zero axe violations and copyable error code when applicable', async () => {
    const user = userEvent.setup()
    const writeText = vi.fn().mockResolvedValue(undefined)
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: { writeText },
    })

    for (const variant of ALL_VARIANTS) {
      const { container, unmount } = render(
        <SystemScreen
          variant={variant}
          refId={variant === 'local_db_failed' ? 'D-20261120-010000-ab3cd' : undefined}
          onRetrySync={vi.fn()}
          onRepair={vi.fn()}
          onReload={vi.fn()}
          onExportPending={vi.fn()}
        />,
      )

      const axeRes = await axe.run(container, { rules: { 'color-contrast': { enabled: false } } })
      expect(axeRes.violations, `Variant ${variant} a11y`).toEqual([])

      if (variant === 'duplicate_instance') {
        expect(screen.queryByRole('button', { name: /use this tab/i })).toBeNull()
        expect(screen.queryByRole('button', { name: /Export Pending/i })).toBeNull()
      }

      if (variant === 'local_db_failed') {
        expect(screen.queryByRole('button', { name: /reset/i })).toBeNull()
        await user.click(screen.getByRole('button', { name: /Copy code/i }))
        expect(writeText).toHaveBeenCalledWith('LOCAL_DB_FAILED#d-20261120-010000-ab3cd')
      }

      unmount()
    }
  }, 15_000)
})
