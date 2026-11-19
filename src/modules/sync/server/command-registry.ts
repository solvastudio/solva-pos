import '@tanstack/react-start/server-only'
import type { TenantTx } from '~/server/db'
import type { CommandHandler } from '../domain/command-types'

export type ServerCommandHandler<P = unknown> = CommandHandler<P, TenantTx>

const registry = new Map<string, ServerCommandHandler<unknown>>()

export function registerCommandHandler<P>(handler: ServerCommandHandler<P>): void {
  if (registry.has(handler.type)) {
    throw new Error(`Duplicate command handler registered for type: ${handler.type}`)
  }
  registry.set(handler.type, handler as ServerCommandHandler<unknown>)
}

export function getCommandHandler(type: string): ServerCommandHandler<unknown> | null {
  return registry.get(type) ?? null
}

export function __clearCommandHandlersForTests(): void {
  registry.clear()
}
