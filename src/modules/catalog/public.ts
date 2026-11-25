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
export { catalogFeedSources } from './server/feed'
export { catalogFnbFeedSources } from './server/feed-fnb'
export {
  type ModifierGroupRow,
  type ModifierIngredientDetailRow,
  type ModifierRow,
} from './server/modifier.repo'
export {
  computeGroupNegativeDeltaWarning,
  createModifier,
  createModifierGroup,
  deleteModifier,
  deleteModifierGroup,
  linkModifierGroupProduct,
  listModifierGroups,
  listProductModifierGroups,
  unlinkModifierGroupProduct,
  updateModifier,
  updateModifierGroup,
} from './server/modifier.service'
export {
  getRecipeForMenuSku,
  listIngredientOptions,
  registerRecipeCostReaderPort,
  saveRecipe,
  type RecipeCostReaderPort,
} from './server/recipe.service'
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
export { exportCatalogCsv, type ExportCatalogCsvOptions } from './server/export.service'
export {
  commitAvailabilityImport,
  previewAvailabilityImport,
} from './server/import/availability-import'
export {
  commitCatalogImport,
  previewCatalogImport,
} from './server/import/catalog-import'
export {
  __clearImportPlansForTests,
  getIdempotentImportResult,
  storeIdempotentImportResult,
} from './server/import/plan-cache'
export { commitPriceImport, previewPriceImport } from './server/import/price-import'
export type {
  CommitImportResult,
  EntityDiffCounts,
  ImportKind,
  ImportReport,
  ImportRowErrorCode,
  RowError,
} from './server/import/types'
export { type OutletSummary } from './server/query.repo'
export {
  getAdminProductDetail,
  getAvailabilityMatrix,
  getPriceMatrix,
  listAdminProducts,
  listCatalogOutlets,
  type AdminProductDetail,
  type AdminProductListItem,
  type AdminProductListResult,
  type AvailabilityMatrixResult,
  type AvailabilityMatrixRow,
  type PriceMatrixResult,
  type PriceMatrixRow,
} from './server/query.service'
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
export {
  modifier,
  modifierGroup,
  modifierGroupProduct,
  modifierIngredient,
  recipeItem,
} from './server/schema-fnb'
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
export {
  filterMissingCatalogRefs,
  findMissingModifierId,
  getCurrentPrice,
  getEffectiveAvailabilityRow,
  getModifierIngredients,
  getProductSkuState,
  getRecipeFor,
  getSkuProductTypes,
} from './server/catalog-read.repo'
