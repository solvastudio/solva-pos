import type { PriceResolution } from '~/modules/catalog/shared'
import type { ProductRecord, SkuRecord, SkuUomRecord, UomRecord } from '~/pos/db/types'

export interface SellCatalogItem {
  product: ProductRecord
  defaultSku: SkuRecord
  skus: SkuRecord[]
  baseUom: UomRecord | null
  price: PriceResolution
  stockQty: string | null
}

export interface SellSkuUomOption {
  skuUom: SkuUomRecord
  uom: UomRecord
  price: PriceResolution
}
