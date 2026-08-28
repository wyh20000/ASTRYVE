import type { IpcResult } from '@shared/types'

export const ok = <T>(data: T): IpcResult<T> => ({ ok: true, data })

export const err = <T = never>(code: string, message: string): IpcResult<T> => ({
  ok: false,
  error: { code, message }
})
