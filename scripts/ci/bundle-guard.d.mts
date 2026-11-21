export interface PrecacheEntry {
  url: string
  revision: string | null
  size: number
}
export const POS_INITIAL_GZIP_LIMIT_BYTES: number
export const TOTAL_PRECACHE_LIMIT_BYTES: number
export function getPosInitialAssetPaths(clientDir?: string): string[]
export function getNonPosManifestFiles(clientDir?: string): Set<string>
export function createPosPrecacheTransform(
  clientDir?: string,
): (entries: PrecacheEntry[]) => Promise<{ manifest: PrecacheEntry[]; warnings: string[] }>
