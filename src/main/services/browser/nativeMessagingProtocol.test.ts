import { describe, expect, it } from 'vitest'
import { isExtensionNativeMessage } from './nativeMessagingProtocol'

describe('desktop Native Messaging protocol', () => {
  it('accepts exact versioned messages and rejects unknown fields', () => {
    const begin = {
      type: 'pairing.begin',
      protocolVersion: 1,
      requestId: '6f14c436-f957-4f78-a264-e78116897fa8',
      extensionVersion: '0.1.0',
      clientNonce: 'A'.repeat(43),
      clientPublicKey: 'B'.repeat(87)
    }
    expect(isExtensionNativeMessage(begin)).toBe(true)
    expect(isExtensionNativeMessage({ ...begin, token: 'unexpected' })).toBe(false)
    expect(isExtensionNativeMessage({ ...begin, protocolVersion: 2 })).toBe(false)
    expect(isExtensionNativeMessage({ ...begin, requestId: 'not-a-uuid' })).toBe(false)
  })

  it('requires strictly increasing positive sequence numbers', () => {
    const revoke = {
      type: 'pairing.revoke',
      protocolVersion: 1,
      requestId: '6f14c436-f957-4f78-a264-e78116897fa8',
      pairingId: '10cb9d04-c83f-4b3f-8de2-d521a2450a67',
      sessionId: 'd39092e9-7ebb-4e40-b1d2-11a544dc2811',
      sequence: 1,
      proof: 'C'.repeat(43)
    }
    expect(isExtensionNativeMessage(revoke)).toBe(true)
    expect(isExtensionNativeMessage({ ...revoke, sequence: 0 })).toBe(false)
  })
})
