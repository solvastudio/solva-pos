import type { FeedKey } from './feed-types'

function compareFeedKeys(a: FeedKey, b: FeedKey): number {
  if (a.version !== b.version) {
    return a.version - b.version
  }
  if (a.id !== b.id) {
    return a.id < b.id ? -1 : 1
  }
  if (a.entity !== b.entity) {
    return a.entity < b.entity ? -1 : 1
  }
  return 0
}

/**
 * Merge multiple pre-sorted `(version, id)` feed key lists and return up to `limit` smallest entries.
 */
export function kWayMerge(lists: readonly (readonly FeedKey[])[], limit: number): FeedKey[] {
  if (limit <= 0 || lists.length === 0) {
    return []
  }

  const indices = new Array<number>(lists.length).fill(0)
  const out: FeedKey[] = []

  while (out.length < limit) {
    let bestListIdx = -1
    let bestKey: FeedKey | null = null

    for (let i = 0; i < lists.length; i += 1) {
      const list = lists[i]!
      const pos = indices[i]!
      if (pos >= list.length) continue
      const candidate = list[pos]!
      if (bestKey === null || compareFeedKeys(candidate, bestKey) < 0) {
        bestKey = candidate
        bestListIdx = i
      }
    }

    if (bestListIdx === -1 || bestKey === null) {
      break
    }
    out.push(bestKey)
    indices[bestListIdx] = indices[bestListIdx]! + 1
  }

  return out
}
