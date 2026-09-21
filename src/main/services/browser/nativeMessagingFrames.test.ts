import { endianness } from 'node:os'
import { describe, expect, it } from 'vitest'
import { NATIVE_MESSAGING_MESSAGE_LIMIT_BYTES } from './nativeMessagingConstants'
import { encodeNativeMessageFrame, NativeMessageFrameDecoder } from './nativeMessagingFrames'

describe('Native Messaging frames', () => {
  it('decodes fragmented and coalesced native-endian frames', () => {
    const first = encodeNativeMessageFrame({ type: 'first', text: '中' })
    const second = encodeNativeMessageFrame({ type: 'second' })
    const decoder = new NativeMessageFrameDecoder()

    expect(decoder.push(first.subarray(0, 3))).toEqual([])
    expect(decoder.push(Buffer.concat([first.subarray(3), second]))).toEqual([
      { type: 'first', text: '中' },
      { type: 'second' }
    ])
    expect(() => decoder.finish()).not.toThrow()
  })

  it('rejects oversized frames before reading their payload', () => {
    const header = Buffer.alloc(4)
    if (endianness() === 'LE') header.writeUInt32LE(NATIVE_MESSAGING_MESSAGE_LIMIT_BYTES + 1)
    else header.writeUInt32BE(NATIVE_MESSAGING_MESSAGE_LIMIT_BYTES + 1)
    expect(() => new NativeMessageFrameDecoder().push(header)).toThrow('length')
  })

  it('rejects a stream that ends mid-frame', () => {
    const decoder = new NativeMessageFrameDecoder()
    const frame = encodeNativeMessageFrame({ type: 'partial' })
    decoder.push(frame.subarray(0, frame.length - 1))
    expect(() => decoder.finish()).toThrow('mid-frame')
  })
})
