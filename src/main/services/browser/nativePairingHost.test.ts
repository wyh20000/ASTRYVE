import { describe, expect, it } from 'vitest'
import {
  deriveNativePairingCode,
  deriveNativePairingSecret,
  deriveNativeSessionKey,
  generateNativeEphemeralKeyPair,
  nativeHmac,
  nativePairingTranscript,
  nativeSessionTranscript
} from './nativeMessagingCrypto'
import {
  NativePairingHost,
  type BrowserPairingSecretStore
} from './nativePairingHost'
import type { ExtensionNativeMessage, HostNativeMessage } from './nativeMessagingProtocol'

class MemoryVault implements BrowserPairingSecretStore {
  pairingId?: string
  secret?: Uint8Array

  async get(pairingId: string): Promise<Uint8Array | undefined> {
    return pairingId === this.pairingId && this.secret ? new Uint8Array(this.secret) : undefined
  }

  async replace(pairingId: string, secret: Uint8Array): Promise<void> {
    this.pairingId = pairingId
    this.secret = new Uint8Array(secret)
  }

  async delete(pairingId: string): Promise<void> {
    if (pairingId === this.pairingId) {
      this.pairingId = undefined
      this.secret = undefined
    }
  }
}

describe('NativePairingHost', () => {
  it('requires both confirmations, reconnects with fresh session keys and authenticates revocation', async () => {
    const vault = new MemoryVault()
    const sent: HostNativeMessage[] = []
    const confirmation = deferred<boolean>()
    const now = 1_800_000_000_000
    const host = new NativePairingHost({
      vault,
      now: () => now,
      send: (message) => sent.push(message),
      confirmPairing: async () => confirmation.promise
    })
    const clientKeys = await generateNativeEphemeralKeyPair()
    const begin: Extract<ExtensionNativeMessage, { type: 'pairing.begin' }> = {
      type: 'pairing.begin',
      protocolVersion: 1,
      requestId: '6f14c436-f957-4f78-a264-e78116897fa8',
      extensionVersion: '0.1.0',
      clientNonce: 'A'.repeat(43),
      clientPublicKey: clientKeys.publicKey
    }

    await host.handleMessage(begin)
    const challenge = sent[0] as Extract<HostNativeMessage, { type: 'pairing.challenge' }>
    const pairingTranscript = nativePairingTranscript({
      requestId: begin.requestId,
      pairingId: challenge.pairingId,
      clientNonce: begin.clientNonce,
      clientPublicKey: begin.clientPublicKey,
      hostNonce: challenge.hostNonce,
      hostPublicKey: challenge.hostPublicKey
    })
    const pairingSecret = await deriveNativePairingSecret(
      clientKeys.privateKey, challenge.hostPublicKey, pairingTranscript)
    expect(challenge.code).toBe(await deriveNativePairingCode(pairingSecret, pairingTranscript))

    await host.handleMessage({
      type: 'pairing.confirm',
      protocolVersion: 1,
      requestId: begin.requestId,
      pairingId: challenge.pairingId,
      proof: await nativeHmac(pairingSecret, `browser-confirm|${pairingTranscript}`)
    })
    expect(sent).toHaveLength(1)
    expect(vault.secret).toBeUndefined()

    confirmation.resolve(true)
    await eventually(() => sent.some((message) => message.type === 'pairing.complete'))
    expect([...(vault.secret ?? [])]).toEqual([...pairingSecret])

    const sessionBegin: Extract<ExtensionNativeMessage, { type: 'session.begin' }> = {
      type: 'session.begin',
      protocolVersion: 1,
      requestId: 'be7b50d4-ab8c-4d46-99ae-8bc225fe80c7',
      pairingId: challenge.pairingId,
      clientNonce: 'C'.repeat(43)
    }
    await host.handleMessage(sessionBegin)
    const sessionChallenge = sent.at(-1) as Extract<
      HostNativeMessage,
      { type: 'session.challenge' }
    >
    const sessionTranscript = nativeSessionTranscript({
      requestId: sessionBegin.requestId,
      pairingId: sessionBegin.pairingId,
      sessionId: sessionChallenge.sessionId,
      clientNonce: sessionBegin.clientNonce,
      hostNonce: sessionChallenge.hostNonce,
      expiresAt: sessionChallenge.expiresAt
    })
    expect(sessionChallenge.proof).toBe(
      await nativeHmac(pairingSecret, `host-challenge|${sessionTranscript}`))
    const sessionKey = await deriveNativeSessionKey(
      pairingSecret,
      sessionBegin.clientNonce,
      sessionChallenge.hostNonce,
      sessionChallenge.sessionId
    )
    await host.handleMessage({
      type: 'session.proof',
      protocolVersion: 1,
      requestId: sessionBegin.requestId,
      sessionId: sessionChallenge.sessionId,
      proof: await nativeHmac(sessionKey, `client-ready|${sessionTranscript}`)
    })
    expect(sent.at(-1)?.type).toBe('session.ready')

    await host.handleMessage({
      type: 'pairing.revoke',
      protocolVersion: 1,
      requestId: 'c2765962-71fb-4b82-bf4c-8962c955ae36',
      pairingId: challenge.pairingId,
      sessionId: sessionChallenge.sessionId,
      sequence: 1,
      proof: await nativeHmac(
        sessionKey, `pairing.revoke|${sessionChallenge.sessionId}|1`)
    })
    expect(vault.secret).toBeUndefined()
    expect(sent.at(-1)?.type).toBe('pairing.revoked')
  })

  it('does not persist a secret when the desktop user rejects the request', async () => {
    const vault = new MemoryVault()
    const sent: HostNativeMessage[] = []
    const host = new NativePairingHost({
      vault,
      now: () => 1_800_000_000_000,
      send: (message) => sent.push(message),
      confirmPairing: async () => false
    })
    const clientKeys = await generateNativeEphemeralKeyPair()
    await host.handleMessage({
      type: 'pairing.begin',
      protocolVersion: 1,
      requestId: '6f14c436-f957-4f78-a264-e78116897fa8',
      extensionVersion: '0.1.0',
      clientNonce: 'A'.repeat(43),
      clientPublicKey: clientKeys.publicKey
    })
    await eventually(() => sent.some((message) => message.type === 'host.error'))
    expect(sent.at(-1)).toMatchObject({ type: 'host.error', code: 'PAIRING_REJECTED' })
    expect(vault.secret).toBeUndefined()
  })

  it('rejects unauthenticated or replayed revocation messages', async () => {
    const host = new NativePairingHost({
      vault: new MemoryVault(),
      now: () => 1_800_000_000_000,
      send: () => undefined,
      confirmPairing: async () => true
    })
    await expect(host.handleMessage({
      type: 'pairing.revoke',
      protocolVersion: 1,
      requestId: 'c2765962-71fb-4b82-bf4c-8962c955ae36',
      pairingId: '10cb9d04-c83f-4b3f-8de2-d521a2450a67',
      sessionId: 'd39092e9-7ebb-4e40-b1d2-11a544dc2811',
      sequence: 1,
      proof: 'C'.repeat(43)
    })).rejects.toThrow('session is invalid')
  })
})

function deferred<T>(): { promise: Promise<T>; resolve(value: T): void } {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((resolver) => { resolve = resolver })
  return { promise, resolve }
}

async function eventually(predicate: () => boolean): Promise<void> {
  for (let attempt = 0; attempt < 50; attempt += 1) {
    if (predicate()) return
    await new Promise((resolve) => setTimeout(resolve, 0))
  }
  throw new Error('Timed out waiting for asynchronous host state')
}
