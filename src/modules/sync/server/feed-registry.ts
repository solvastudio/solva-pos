import '@tanstack/react-start/server-only'
import type { TenantTx } from '~/server/db'
import type { FeedSource as DomainFeedSource } from '../domain/feed-types'

export type FeedSource = DomainFeedSource<TenantTx>

const sources = new Map<string, FeedSource>()

export function registerFeedSource(source: FeedSource): void {
  if (sources.has(source.entity)) {
    throw new Error(`Duplicate feed source registered for entity: "${source.entity}"`)
  }
  sources.set(source.entity, source)
}

export function getFeedSources(): readonly FeedSource[] {
  return [...sources.values()]
}

export function __resetForTests(): void {
  sources.clear()
}
