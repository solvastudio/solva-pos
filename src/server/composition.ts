import '@tanstack/react-start/server-only'

let composed = false

/**
 * Server composition root registering cross-module adapters (FeedSource, CommandHandler)
 * into Sync without creating direct module-to-module compile-time dependencies (BR-ARC-004).
 */
export function composeServer(): void {
  if (composed) return
  composed = true
}

export function resetCompositionForTests(): void {
  composed = false
}
