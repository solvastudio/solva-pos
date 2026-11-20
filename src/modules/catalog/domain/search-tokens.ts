/**
 * Builds deduplicated lowercase ASCII-folded search tokens from product `name` and `code`
 * for offline Dexie `multiEntry` indexing.
 */
export function buildSearchTokens(name: string, code: string): string[] {
  const seen = new Set<string>()
  const normalizedName = name
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .toLowerCase()

  for (const part of normalizedName.split(/[^a-z0-9]+/g)) {
    if (part.length > 0) {
      seen.add(part)
    }
  }

  const normalizedCode = code
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .trim()
    .toLowerCase()
  if (normalizedCode.length > 0) {
    seen.add(normalizedCode)
  }

  return [...seen]
}
