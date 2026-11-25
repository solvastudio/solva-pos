// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { cleanup, render, screen, waitFor } from '@testing-library/react'
import axe from 'axe-core'
import type { ReactElement } from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { ToastProvider } from '~/components/ui'
import type { AdminProductDetail } from '~/modules/catalog/shared'
import '~/i18n'
import { ModifierGroupsEditor } from './ModifierGroupsEditor'
import { RecipeEditor } from './RecipeEditor'
import { TablesTable } from './TablesTable'

vi.mock('~/functions/fnb/tables.fn', () => ({
  createTableFn: vi.fn(),
  updateTableFn: vi.fn(),
  deleteOrDeactivateTableFn: vi.fn(),
}))

vi.mock('~/functions/catalog/modifier.fn', () => ({
  listModifierGroupsFn: vi.fn(async () => [
    {
      id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa2',
      name: 'Level Pedas',
      selectionType: 'SINGLE',
      minSelect: 0,
      maxSelect: 1,
      isActive: true,
      version: 1,
      deletedAt: null,
      modifiers: [],
      linkedProductCount: 0,
    },
  ]),
  listProductModifierGroupsFn: vi.fn(async () => [
    {
      linkId: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb1',
      modifierGroupId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1',
      name: 'Topping',
      selectionType: 'MULTI',
      minSelect: 0,
      maxSelect: 2,
      isActive: true,
      sortOrder: 0,
      negativeDeltaWarning: true,
      modifiers: [
        {
          id: 'cccccccc-cccc-4ccc-8ccc-ccccccccccc1',
          modifierGroupId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1',
          name: 'Tanpa Acar',
          priceDelta: -5000,
          isActive: true,
          sortOrder: 0,
          version: 1,
          deletedAt: null,
          ingredients: [],
        },
      ],
    },
  ]),
  createModifierGroupFn: vi.fn(),
  updateModifierGroupFn: vi.fn(),
  deleteModifierGroupFn: vi.fn(),
  createModifierFn: vi.fn(),
  updateModifierFn: vi.fn(),
  deleteModifierFn: vi.fn(),
  linkModifierGroupProductFn: vi.fn(),
  unlinkModifierGroupProductFn: vi.fn(),
}))

vi.mock('~/functions/catalog/recipe.fn', () => ({
  getRecipeForMenuSkuFn: vi.fn(async () => ({
    menuSkuId: 'dddddddd-dddd-4ddd-8ddd-ddddddddddd1',
    items: [
      {
        id: 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeee1',
        menuSkuId: 'dddddddd-dddd-4ddd-8ddd-ddddddddddd1',
        ingredientSkuId: 'ffffffff-ffff-4fff-8fff-fffffffffff1',
        ingredientSkuCode: 'RAW-BERAS',
        ingredientProductName: 'Beras Putih',
        ingredientTrackStock: true,
        uomCode: 'kg',
        qty: '0.2000',
        estimatedUnitCost: 15000,
        estimatedLineCost: 3000,
      },
      {
        id: 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeee2',
        menuSkuId: 'dddddddd-dddd-4ddd-8ddd-ddddddddddd1',
        ingredientSkuId: 'ffffffff-ffff-4fff-8fff-fffffffffff2',
        ingredientSkuCode: 'NON-GARAM',
        ingredientProductName: 'Garam Dapur',
        ingredientTrackStock: false,
        uomCode: 'gr',
        qty: '2',
        estimatedUnitCost: null,
        estimatedLineCost: null,
      },
    ],
    estimatedTotalCost: null,
    warnings: [],
  })),
  listIngredientOptionsFn: vi.fn(async () => [
    {
      skuId: 'ffffffff-ffff-4fff-8fff-fffffffffff3',
      skuCode: 'RAW-TELUR',
      productId: '99999999-9999-4999-8999-999999999993',
      productName: 'Telur Ayam',
      productType: 'RETAIL',
      trackStock: true,
      uomCode: 'pcs',
    },
  ]),
  saveRecipeFn: vi.fn(),
}))

function renderWithProviders(ui: ReactElement) {
  const qc = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  })
  return render(
    <QueryClientProvider client={qc}>
      <ToastProvider>{ui}</ToastProvider>
    </QueryClientProvider>,
  )
}

afterEach(() => {
  cleanup()
})

describe('Admin F5 F&B UI components', () => {
  it('renders TablesTable with active/in-use badges and disabled delete on open bill, passing axe', async () => {
    const { container } = renderWithProviders(
      <TablesTable
        tenantSlug="acme"
        outlets={[
          {
            id: '11111111-1111-4111-8111-111111111111',
            code: 'OUT-01',
            name: 'Cabang Pusat',
          },
        ]}
        tables={[
          {
            id: '22222222-2222-4222-8222-222222222221',
            outletId: '11111111-1111-4111-8111-111111111111',
            code: 'M01',
            area: 'Indoor',
            capacity: 4,
            sortOrder: 1,
            isActive: true,
            hasOpenBill: true,
            hasAnyBill: true,
          },
        ]}
      />,
    )

    expect(screen.getAllByText('M01').length).toBeGreaterThan(0)
    const disableBtn = screen.getByRole('button', { name: /nonaktifkan/i })
    expect((disableBtn as HTMLButtonElement).disabled).toBe(true)

    const results = await axe.run(container)
    expect(results.violations).toEqual([])
  })

  it('renders ModifierGroupsEditor with negative-delta warning and passes axe', async () => {
    const { container } = renderWithProviders(
      <ModifierGroupsEditor
        tenantSlug="acme"
        productId="77777777-7777-4777-8777-777777777771"
        canEdit={true}
      />,
    )

    await waitFor(() => expect(screen.getByText('Topping')).toBeTruthy())
    expect(screen.getByRole('status')).toBeTruthy()
    expect(screen.getByText('Tanpa Acar')).toBeTruthy()

    const results = await axe.run(container)
    expect(results.violations).toEqual([])
  })

  it('renders RecipeEditor with ingredient rows and untracked stock warning, passing axe', async () => {
    const detail = {
      product: {
        id: '77777777-7777-4777-8777-777777777771',
        name: 'Nasi Goreng',
        productType: 'MENU_FNB',
      },
      skus: [
        {
          id: 'dddddddd-dddd-4ddd-8ddd-ddddddddddd1',
          skuCode: 'NSG-01',
          deletedAt: null,
        },
      ],
    } as unknown as AdminProductDetail

    const { container } = renderWithProviders(
      <RecipeEditor tenantSlug="acme" detail={detail} canEdit={true} />,
    )

    await waitFor(() => expect(screen.getByText('Beras Putih')).toBeTruthy())
    expect(screen.getByText('Garam Dapur')).toBeTruthy()
    expect(screen.getByRole('status')).toBeTruthy()

    const results = await axe.run(container)
    expect(results.violations).toEqual([])
  })
})
