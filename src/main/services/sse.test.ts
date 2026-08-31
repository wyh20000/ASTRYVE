import { describe, expect, it } from 'vitest'
import { readSseStream } from './sse'

function body(...chunks: string[]): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder()
  return new ReadableStream({
    start(controller) {
      for (const chunk of chunks) controller.enqueue(encoder.encode(chunk))
      controller.close()
    }
  })
}

describe('readSseStream', () => {
  it('flushes a final event without a trailing newline', async () => {
    const data: string[] = []
    await readSseStream(body('data: {"a":', '1}'), (event) => {
      data.push(event.data)
    })
    expect(data).toEqual(['{"a":1}'])
  })

  it('supports CRLF and multiline data', async () => {
    const events: Array<{ event?: string; data: string }> = []
    await readSseStream(body('event: result\r\ndata: one\r\ndata: two\r\n\r\n'), (event) => {
      events.push(event)
    })
    expect(events).toEqual([{ event: 'result', data: 'one\ntwo' }])
  })
})
