export const DB_BATCH_SIZE = 1000

export function chunkArray<T>(items: readonly T[], size = DB_BATCH_SIZE): T[][] {
  if (items.length === 0) return []
  const chunks: T[][] = []
  for (let i = 0; i < items.length; i += size) {
    chunks.push(items.slice(i, i + size))
  }
  return chunks
}
