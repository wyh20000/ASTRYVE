import { endianness } from 'node:os'
import { NATIVE_MESSAGING_MESSAGE_LIMIT_BYTES } from './nativeMessagingConstants'

const HEADER_BYTES = 4
const littleEndian = endianness() === 'LE'
const decoder = new TextDecoder('utf-8', { fatal: true })

export class NativeMessageFrameDecoder {
  private buffered: Buffer<ArrayBufferLike> = Buffer.alloc(0)

  push(chunk: Buffer): unknown[] {
    if (!Buffer.isBuffer(chunk)) throw new Error('Native Messaging input must be a buffer')
    this.buffered = this.buffered.length ? Buffer.concat([this.buffered, chunk]) : chunk
    const messages: unknown[] = []
    while (this.buffered.length >= HEADER_BYTES) {
      const length = littleEndian
        ? this.buffered.readUInt32LE(0)
        : this.buffered.readUInt32BE(0)
      if (length === 0 || length > NATIVE_MESSAGING_MESSAGE_LIMIT_BYTES) {
        throw new Error('Native Messaging frame length is invalid')
      }
      if (this.buffered.length < HEADER_BYTES + length) break
      const payload = this.buffered.subarray(HEADER_BYTES, HEADER_BYTES + length)
      this.buffered = this.buffered.subarray(HEADER_BYTES + length)
      messages.push(JSON.parse(decoder.decode(payload)) as unknown)
    }
    return messages
  }

  finish(): void {
    if (this.buffered.length) throw new Error('Native Messaging stream ended mid-frame')
  }
}

export function encodeNativeMessageFrame(message: unknown): Buffer {
  const payload = Buffer.from(JSON.stringify(message), 'utf8')
  if (!payload.length || payload.length > NATIVE_MESSAGING_MESSAGE_LIMIT_BYTES) {
    throw new Error('Native Messaging response size is invalid')
  }
  const frame = Buffer.allocUnsafe(HEADER_BYTES + payload.length)
  if (littleEndian) frame.writeUInt32LE(payload.length, 0)
  else frame.writeUInt32BE(payload.length, 0)
  payload.copy(frame, HEADER_BYTES)
  return frame
}
