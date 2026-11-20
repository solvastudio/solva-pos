export const PRODUCT_TYPES = ['RETAIL', 'MENU_FNB'] as const
export type ProductType = (typeof PRODUCT_TYPES)[number]

export const AVAILABILITY_STATUSES = ['AVAILABLE', 'UNAVAILABLE'] as const
export type AvailabilityStatus = (typeof AVAILABILITY_STATUSES)[number]
