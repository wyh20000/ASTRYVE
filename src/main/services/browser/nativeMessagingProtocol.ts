import {
  NATIVE_MESSAGING_MESSAGE_LIMIT_BYTES,
  NATIVE_MESSAGING_PROTOCOL_VERSION
} from './nativeMessagingConstants'

export type ExtensionNativeMessage =
  | {
      type: 'pairing.begin'
      protocolVersion: 1
      requestId: string
      extensionVersion: string
      clientNonce: string
      clientPublicKey: string
    }
  | {
      type: 'pairing.confirm'
      protocolVersion: 1
      requestId: string
      pairingId: string
      proof: string
    }
  | { type: 'pairing.cancel'; protocolVersion: 1; requestId: string; pairingId: string }
  | {
      type: 'session.begin'
      protocolVersion: 1
      requestId: string
      pairingId: string
      clientNonce: string
    }
  | {
      type: 'session.proof'
      protocolVersion: 1
      requestId: string
      sessionId: string
      proof: string
    }
  | {
      type: 'pairing.revoke'
      protocolVersion: 1
      requestId: string
      pairingId: string
      sessionId: string
      sequence: number
      proof: string
    }

export type HostNativeMessage =
  | {
      type: 'pairing.challenge'
      protocolVersion: 1
      requestId: string
      pairingId: string
      hostNonce: string
      hostPublicKey: string
      code: string
      expiresAt: number
    }
  | {
      type: 'pairing.complete'
      protocolVersion: 1
      requestId: string
      pairingId: string
      proof: string
    }
  | {
      type: 'session.challenge'
      protocolVersion: 1
      requestId: string
      pairingId: string
      sessionId: string
      hostNonce: string
      proof: string
      expiresAt: number
    }
  | {
      type: 'session.ready'
      protocolVersion: 1
      requestId: string
      pairingId: string
      sessionId: string
      proof: string
      expiresAt: number
    }
  | {
      type: 'pairing.revoked'
      protocolVersion: 1
      requestId: string
      pairingId: string
      sessionId: string
      sequence: number
      proof: string
    }
  | {
      type: 'host.error'
      protocolVersion: 1
      requestId?: string
      code: string
      message: string
    }

export function isExtensionNativeMessage(value: unknown): value is ExtensionNativeMessage {
  if (!record(value) || value.protocolVersion !== NATIVE_MESSAGING_PROTOCOL_VERSION ||
      typeof value.type !== 'string') return false
  switch (value.type) {
    case 'pairing.begin':
      return exact(value, ['type', 'protocolVersion', 'requestId', 'extensionVersion',
        'clientNonce', 'clientPublicKey']) && uuid(value.requestId) &&
        version(value.extensionVersion) && encoded(value.clientNonce, 32, 64) &&
        encoded(value.clientPublicKey, 80, 120)
    case 'pairing.confirm':
      return exact(value, ['type', 'protocolVersion', 'requestId', 'pairingId', 'proof']) &&
        uuid(value.requestId) && uuid(value.pairingId) && encoded(value.proof, 40, 64)
    case 'pairing.cancel':
      return exact(value, ['type', 'protocolVersion', 'requestId', 'pairingId']) &&
        uuid(value.requestId) && uuid(value.pairingId)
    case 'session.begin':
      return exact(value, ['type', 'protocolVersion', 'requestId', 'pairingId', 'clientNonce']) &&
        uuid(value.requestId) && uuid(value.pairingId) && encoded(value.clientNonce, 32, 64)
    case 'session.proof':
      return exact(value, ['type', 'protocolVersion', 'requestId', 'sessionId', 'proof']) &&
        uuid(value.requestId) && uuid(value.sessionId) && encoded(value.proof, 40, 64)
    case 'pairing.revoke':
      return exact(value, ['type', 'protocolVersion', 'requestId', 'pairingId', 'sessionId',
        'sequence', 'proof']) && uuid(value.requestId) && uuid(value.pairingId) && uuid(value.sessionId) &&
        positiveInteger(value.sequence) && encoded(value.proof, 40, 64)
    default:
      return false
  }
}

export function serializedNativeMessageSize(message: unknown): number {
  try {
    const encodedMessage = JSON.stringify(message)
    return encodedMessage === undefined
      ? Number.POSITIVE_INFINITY
      : Buffer.byteLength(encodedMessage, 'utf8')
  } catch {
    return Number.POSITIVE_INFINITY
  }
}

export function assertExtensionNativeMessage(value: unknown): asserts value is ExtensionNativeMessage {
  if (serializedNativeMessageSize(value) > NATIVE_MESSAGING_MESSAGE_LIMIT_BYTES) {
    throw new Error('Native Messaging message exceeds the internal size limit')
  }
  if (!isExtensionNativeMessage(value)) throw new Error('Invalid Native Messaging message')
}

function record(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

function exact(value: Record<string, unknown>, keys: readonly string[]): boolean {
  const actual = Object.keys(value)
  return actual.length === keys.length && actual.every((key) => keys.includes(key))
}

function uuid(value: unknown): value is string {
  return typeof value === 'string' &&
    /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
      .test(value)
}

function version(value: unknown): value is string {
  return typeof value === 'string' && /^[0-9A-Za-z][0-9A-Za-z.+-]{0,63}$/.test(value)
}

function encoded(value: unknown, min: number, max: number): value is string {
  return typeof value === 'string' && value.length >= min && value.length <= max &&
    /^[A-Za-z0-9_-]+$/.test(value)
}

function positiveInteger(value: unknown): value is number {
  return Number.isSafeInteger(value) && Number(value) > 0
}
