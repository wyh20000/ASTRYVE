import { randomUUID, webcrypto } from 'node:crypto'

const encoder = new TextEncoder()

export interface NativeEphemeralKeyPair {
  privateKey: CryptoKey
  publicKey: string
}

export async function generateNativeEphemeralKeyPair(): Promise<NativeEphemeralKeyPair> {
  const pair = await webcrypto.subtle.generateKey(
    { name: 'ECDH', namedCurve: 'P-256' }, true, ['deriveBits'])
  const raw = await webcrypto.subtle.exportKey('raw', pair.publicKey)
  return { privateKey: pair.privateKey, publicKey: toBase64Url(raw) }
}

export function nativeRandomNonce(bytes = 32): string {
  return toBase64Url(webcrypto.getRandomValues(new Uint8Array(bytes)))
}

export function nativeRandomId(): string {
  return randomUUID()
}

export async function deriveNativePairingSecret(
  privateKey: CryptoKey,
  peerPublicKey: string,
  transcript: string
): Promise<Uint8Array> {
  const publicKey = await webcrypto.subtle.importKey(
    'raw', toArrayBuffer(fromBase64Url(peerPublicKey)),
    { name: 'ECDH', namedCurve: 'P-256' }, false, [])
  const shared = await webcrypto.subtle.deriveBits(
    { name: 'ECDH', public: publicKey }, privateKey, 256)
  const key = await webcrypto.subtle.importKey('raw', shared, 'HKDF', false, ['deriveBits'])
  const salt = await webcrypto.subtle.digest('SHA-256', encoder.encode(transcript))
  const bits = await webcrypto.subtle.deriveBits({
    name: 'HKDF', hash: 'SHA-256', salt,
    info: encoder.encode('astryve-pairing-v1')
  }, key, 256)
  return new Uint8Array(bits)
}

export async function deriveNativeSessionKey(
  pairingSecret: Uint8Array,
  clientNonce: string,
  hostNonce: string,
  sessionId: string
): Promise<Uint8Array> {
  const key = await webcrypto.subtle.importKey(
    'raw', toArrayBuffer(pairingSecret), 'HKDF', false, ['deriveBits'])
  const salt = await webcrypto.subtle.digest(
    'SHA-256', encoder.encode(`${clientNonce}|${hostNonce}`))
  const bits = await webcrypto.subtle.deriveBits({
    name: 'HKDF', hash: 'SHA-256', salt,
    info: encoder.encode(`astryve-session-v1|${sessionId}`)
  }, key, 256)
  return new Uint8Array(bits)
}

export async function nativeHmac(secret: Uint8Array, value: string): Promise<string> {
  const key = await webcrypto.subtle.importKey(
    'raw', toArrayBuffer(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign'])
  return toBase64Url(await webcrypto.subtle.sign('HMAC', key, encoder.encode(value)))
}

export async function verifyNativeHmac(
  secret: Uint8Array,
  value: string,
  proof: string
): Promise<boolean> {
  const expected = await nativeHmac(secret, value)
  if (expected.length !== proof.length) return false
  let difference = 0
  for (let index = 0; index < expected.length; index += 1) {
    difference |= expected.charCodeAt(index) ^ proof.charCodeAt(index)
  }
  return difference === 0
}

export async function deriveNativePairingCode(
  secret: Uint8Array,
  transcript: string
): Promise<string> {
  const digest = fromBase64Url(await nativeHmac(secret, `pairing-code|${transcript}`))
  const value = ((digest[0] ?? 0) * 0x1000000 + (digest[1] ?? 0) * 0x10000 +
    (digest[2] ?? 0) * 0x100 + (digest[3] ?? 0)) % 1_000_000
  return value.toString().padStart(6, '0')
}

export function nativePairingTranscript(input: {
  requestId: string
  pairingId: string
  clientNonce: string
  clientPublicKey: string
  hostNonce: string
  hostPublicKey: string
}): string {
  return ['astryve-pairing-v1', input.requestId, input.pairingId, input.clientNonce,
    input.clientPublicKey, input.hostNonce, input.hostPublicKey].join('|')
}

export function nativeSessionTranscript(input: {
  requestId: string
  pairingId: string
  sessionId: string
  clientNonce: string
  hostNonce: string
  expiresAt: number
}): string {
  return ['astryve-session-v1', input.requestId, input.pairingId, input.sessionId,
    input.clientNonce, input.hostNonce, input.expiresAt].join('|')
}

export function toBase64Url(value: ArrayBuffer | Uint8Array): string {
  return Buffer.from(value instanceof Uint8Array ? value : new Uint8Array(value))
    .toString('base64url')
}

export function fromBase64Url(value: string): Uint8Array {
  return new Uint8Array(Buffer.from(value, 'base64url'))
}

function toArrayBuffer(value: Uint8Array): ArrayBuffer {
  const copy = new Uint8Array(value.byteLength)
  copy.set(value)
  return copy.buffer
}
