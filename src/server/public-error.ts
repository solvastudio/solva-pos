import '@tanstack/react-start/server-only'
import {
  formatPublicCode,
  type ErrorClass,
  type ErrorCode,
} from '~/lib/contracts/error-codes'
import { classifyError } from './error-classify'
import { recordInternalError } from './notify/error-spike'

export interface PublicErrorResult {
  code: ErrorCode
  ref: string
  class: ErrorClass
  status: number
  message: string
}

export function toPublicError(err: unknown, reqId: string): PublicErrorResult {
  const classified = classifyError(err)
  if (classified.code === 'INTERNAL_ERROR') {
    recordInternalError()
  }
  return {
    code: classified.code,
    ref: reqId,
    class: classified.class,
    status: classified.status,
    message: formatPublicCode(classified.code, reqId),
  }
}
