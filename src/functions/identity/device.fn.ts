import { createServerFn } from '@tanstack/react-start'
import { createPairingCode, listDevices, revokeDevice } from '~/modules/identity/public'
import {
  createPairingCodeSchema,
  revokeDeviceSchema,
  type CreatePairingCodeResult,
  type DeviceView,
  type MutationActionResult,
} from '~/modules/identity/shared'
import { requirePermission } from '~/server/auth/auth-middleware'
import { publicErrorMiddleware, runValidatedAction } from '../middleware'

export const listDevicesFn = createServerFn({ method: 'GET' })
  .middleware([publicErrorMiddleware, requirePermission('user.manage')])
  .handler(async ({ context }): Promise<DeviceView[]> => {
    return listDevices(context.auth)
  })

export const createPairingCodeFn = createServerFn({ method: 'POST' })
  .validator((raw: unknown) => createPairingCodeSchema.parse(raw))
  .middleware([publicErrorMiddleware, requirePermission('user.manage')])
  .handler(async ({ data, context }): Promise<MutationActionResult<CreatePairingCodeResult>> => {
    return runValidatedAction(() => createPairingCode(context.auth, data.registerId))
  })

export const revokeDeviceFn = createServerFn({ method: 'POST' })
  .validator((raw: unknown) => revokeDeviceSchema.parse(raw))
  .middleware([publicErrorMiddleware, requirePermission('user.manage')])
  .handler(async ({ data, context }): Promise<MutationActionResult<{ ok: true }>> => {
    return runValidatedAction(async () => {
      await revokeDevice(context.auth, data)
      return { ok: true as const }
    })
  })
