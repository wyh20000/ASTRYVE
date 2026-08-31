export interface SseEvent {
  event?: string
  data: string
}

type EventHandler = (event: SseEvent) => void | Promise<void>

/**
 * 读取标准 SSE 流。支持 CRLF、多行 data，以及服务端未以空行/换行结尾的最后事件。
 */
export async function readSseStream(
  body: ReadableStream<Uint8Array>,
  onEvent: EventHandler
): Promise<void> {
  const reader = body.getReader()
  const decoder = new TextDecoder()
  let buffer = ''
  let eventName: string | undefined
  let dataLines: string[] = []

  const dispatch = async (): Promise<void> => {
    if (dataLines.length === 0) {
      eventName = undefined
      return
    }
    await onEvent({ event: eventName, data: dataLines.join('\n') })
    eventName = undefined
    dataLines = []
  }

  const consumeLine = async (line: string): Promise<void> => {
    const normalized = line.endsWith('\r') ? line.slice(0, -1) : line
    if (normalized === '') {
      await dispatch()
      return
    }
    if (normalized.startsWith(':')) return
    const colon = normalized.indexOf(':')
    const field = colon < 0 ? normalized : normalized.slice(0, colon)
    let value = colon < 0 ? '' : normalized.slice(colon + 1)
    if (value.startsWith(' ')) value = value.slice(1)
    if (field === 'event') eventName = value
    else if (field === 'data') dataLines.push(value)
  }

  while (true) {
    const { done, value } = await reader.read()
    if (done) break
    buffer += decoder.decode(value, { stream: true })
    const lines = buffer.split('\n')
    buffer = lines.pop() ?? ''
    for (const line of lines) await consumeLine(line)
  }

  buffer += decoder.decode()
  if (buffer.length > 0) await consumeLine(buffer)
  await dispatch()
}
