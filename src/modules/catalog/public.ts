import '@tanstack/react-start/server-only'

export { type CatalogActor, type CatalogServiceDeps } from './server/auth'
export {
  createDefaultAvailabilityForOutlet,
  type AvailabilityRow,
} from './server/availability.repo'
export {
  bulkSetAvailability,
  clearSkuOverride,
  listEffectiveVisibleSkusForOutlet,
  listOutletAvailabilityRows,
  setProductAvailability,
  setSkuOverride,
  type BulkSetAvailabilityInput,
  type ClearSkuOverrideInput,
  type SetProductAvailabilityInput,
  type SetSkuOverrideInput,
} from './server/availability.service'
export { type CategoryRow } from './server/category.repo'
export {
  createCategory,
  deleteCategory,
  listCategories,
  updateCategory,
} from './server/category.service'
export {
  __clearHasTransactionsPortForTests,
  registerHasTransactionsPort,
  type HasTransactionsPort,
} from './server/ports'
export { type PriceEntryRow } from './server/price.repo'
export {
  clearOutletPrice,
  getEffectivePrice,
  listPricesForSku,
  setPrice,
  setPricesBulk,
  type ClearOutletPriceInput,
  type GetEffectivePriceInput,
  type SetPriceInput,
  type SetPricesBulkInput,
} from './server/price.service'
export { type ProductRow } from './server/product.repo'
export {
  createProduct,
  deleteProduct,
  getProductById,
  listProducts,
  updateProduct,
  type CreateProductResult,
} from './server/product.service'
export {
  attributeValue,
  category,
  itemOutletAvailability,
  priceEntry,
  product,
  productAttribute,
  sku,
  skuAttributeValue,
  skuUom,
  uom,
} from './server/schema'
export { type SkuUomRow } from './server/sku-uom.repo'
export {
  addSkuUom,
  listSkuUoms,
  removeSkuUom,
  updateSkuUom,
  type AddSkuUomInput,
  type UpdateSkuUomInput,
} from './server/sku-uom.service'
export { type UomRow } from './server/uom.repo'
export { createUom, deleteUom, listUoms, updateUom } from './server/uom.service'
export {
  type AttributeValueRow,
  type ProductAttributeRow,
  type SkuAttributeValueRow,
  type SkuRow,
} from './server/variant.repo'
export {
  addAttributeValue,
  listProductVariants,
  removeAttributeValue,
  updateSku,
  type AddAttributeValueInput,
  type ProductVariantsView,
  type RemoveAttributeValueInput,
  type UpdateSkuInput,
} from './server/variant.service'
