export const CONNECT_TIMEOUT_MESSAGE = 'MODEL_CONNECT_TIMEOUT'
export const REQUEST_TIMEOUT_MESSAGE = 'MODEL_REQUEST_TIMEOUT'

export interface TimedFetch {
  response: Response
  dispose: () => void
  throwIfAborted: () => void
}

/** 连接阶段与整个响应阶段分别计时，并把会话取消信号传递给 fetch/响应流。 */
export async function fetchWithRequestTimeout(
  input: string,
  init: RequestInit,
  parentSignal?: AbortSignal,
  connectTimeoutMs = 20_000,
  totalTimeoutMs = 180_000
): Promise<TimedFetch> {
  const controller = new AbortController()
  const abortFromParent = (): void => controller.abort(parentSignal?.reason ?? 'user')
  if (parentSignal?.aborted) abortFromParent()
  else parentSignal?.addEventListener('abort', abortFromParent, { once: true })

  const connectTimer = setTimeout(
    () => controller.abort(new Error(CONNECT_TIMEOUT_MESSAGE)),
    connectTimeoutMs
  )
  const totalTimer = setTimeout(
    () => controller.abort(new Error(REQUEST_TIMEOUT_MESSAGE)),
    totalTimeoutMs
  )
  const dispose = (): void => {
    clearTimeout(connectTimer)
    clearTimeout(totalTimer)
    parentSignal?.removeEventListener('abort', abortFromParent)
  }
  const throwIfAborted = (): void => {
    if (controller.signal.aborted && controller.signal.reason instanceof Error) {
      throw controller.signal.reason
    }
  }

  try {
    const response = await fetch(input, { ...init, signal: controller.signal })
    clearTimeout(connectTimer)
    return { response, dispose, throwIfAborted }
  } catch (error) {
    dispose()
    if (controller.signal.aborted && controller.signal.reason instanceof Error) {
      throw controller.signal.reason
    }
    throw error
  }
}
