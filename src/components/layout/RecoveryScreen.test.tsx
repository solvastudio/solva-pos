// @vitest-environment jsdom
import { changeLocale } from '~/i18n'
import { cleanup, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import axe from 'axe-core'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  clearClientErrorBufferForTests,
  getClientErrorBufferForTests,
} from '~/lib/client-errors/report-schema'
import {
  clearRootBootCrash,
  recordRootBootCrash,
  RecoveryScreen,
} from './RecoveryScreen'

beforeEach(async () => {
  await changeLocale('en-US')
})

afterEach(() => {
  cleanup()
  clearClientErrorBufferForTests()
  vi.restoreAllMocks()
})

describe('RecoveryScreen (SCR-P17)', () => {
  it('renders error code block, reload button, optional export pending, and safe mode link', async () => {
    const onReload = vi.fn()
    const onExportPending = vi.fn()
    const user = userEvent.setup()

    const { container } = render(
      <RecoveryScreen
        code="APP_ERROR"
        refId="D-20261120-080000-zz11q"
        onReload={onReload}
        onExportPending={onExportPending}
        safeModeHref="/safe-mode"
      />,
    )

    expect(screen.getByRole('heading', { name: /App failed to load/i })).toBeTruthy()
    expect(screen.getByTestId('error-code-value').textContent).toBe(
      'APP_ERROR#d-20261120-080000-zz11q',
    )

    await user.click(screen.getByRole('button', { name: /Reload App/i }))
    expect(onReload).toHaveBeenCalledTimes(1)

    await user.click(screen.getByRole('button', { name: /Export Pending Transactions/i }))
    expect(onExportPending).toHaveBeenCalledTimes(1)

    const safeLink = screen.getByRole('link', { name: /Open Safe Mode/i })
    expect(safeLink.getAttribute('href')).toBe('/safe-mode')

    const axeResults = await axe.run(container, { rules: { 'color-contrast': { enabled: false } } })
    expect(axeResults.violations).toEqual([])
  }, 15_000)

  it('tracks root boot crash frequency within 60 seconds using sessionStorage without Dexie', () => {
    const map = new Map<string, string>()
    const fakeStorage = {
      getItem: (k: string) => map.get(k) ?? null,
      setItem: (k: string, v: string) => {
        map.set(k, v)
      },
      removeItem: (k: string) => {
        map.delete(k)
      },
    }

    const first = recordRootBootCrash('warung-demo', 100_000, fakeStorage)
    expect(first).toEqual({ count: 1, shouldRecover: false })

    const second = recordRootBootCrash('warung-demo', 130_000, fakeStorage)
    expect(second).toEqual({ count: 2, shouldRecover: true })

    clearRootBootCrash('warung-demo', fakeStorage)
    const afterExpiry = recordRootBootCrash('warung-demo', 200_000, fakeStorage)
    expect(afterExpiry).toEqual({ count: 1, shouldRecover: false })
  })

  it('preserves server public code and reqId from error.message instead of masking as APP_ERROR#d-...', () => {
    render(<RecoveryScreen error={new Error('INTERNAL_ERROR#20261122-022338-7h2wd')} />)

    expect(screen.getByTestId('error-code-value').textContent).toBe(
      'INTERNAL_ERROR#20261122-022338-7h2wd',
    )
    expect(screen.queryByText(/Local device reference/i)).toBeNull()

    const logged = getClientErrorBufferForTests()
    expect(logged).toHaveLength(1)
    expect(logged[0]?.code).toBe('INTERNAL_ERROR')
    expect(logged[0]?.ctx).toMatchObject({
      surface: 'recovery',
      serverRef: '20261122-022338-7h2wd',
    })
  })

  it('falls back to APP_ERROR#d-... when error.message has no public code', () => {
    render(<RecoveryScreen error={new Error('Something crashed in browser')} />)

    expect(screen.getByTestId('error-code-value').textContent).toMatch(
      /^APP_ERROR#d-\d{8}-\d{6}-[a-hj-km-np-z2-9]{5}$/,
    )
    expect(screen.getByText(/Local device reference/i)).toBeTruthy()
  })
})
