import '@tanstack/react-start/server-only'

export { cashCashier, cashMovement } from './server/schema'
export { getShiftForCommand, type ShiftCommandSummary } from './server/shift.repo'
export { openShiftCommandHandler } from './server/open-shift.command'
export { recordCashMovementCommandHandler } from './server/cash-movement.command'
export { closeShiftCommandHandler } from './server/close-shift.command'
export { recomputeRecapIfClosed, recomputeShiftRecap } from './server/recap.service'
export {
  forceCloseShift,
  listOpenShiftsForAdmin,
  type ForceCloseShiftInput,
  type OpenShiftAdminRow,
} from './server/force-close.service'
export {
  __clearShiftRecapSalesPortForTests,
  registerShiftRecapSalesPort,
  type ShiftRecapSalesPort,
  type ShiftRecapSalesTotals,
} from './server/ports'
