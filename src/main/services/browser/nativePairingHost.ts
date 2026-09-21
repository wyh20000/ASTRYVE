import type { BrowserPairingVault } from './browserPairingVault'
import {
  BROWSER_SESSION_TTL_MS,
  NATIVE_MESSAGING_PROTOCOL_VERSION,
  PAIRING_CHALLENGE_TTL_MS
} from './nativeMessagingConstants'
import {
  deriveNativePairingCode,
  deriveNativePairingSecret,
  deriveNativeSessionKey,
  generateNativeEphemeralKeyPair,
  nativeHmac,
  nativePairingTranscript,
  nativeRandomId,
  nativeRandomNonce,
  nativeSessionTranscript,
  verifyNativeHmac
} from './nativeMessagingCrypto'
import {
  assertExtensionNativeMessage,
  type ExtensionNativeMessage,
  type HostNativeMessage
} from './nativeMessagingProtocol'

export interface BrowserPairingSecretStore {
  get(pairingId: string): Promise<Uint8Array | undefined>
  replace(pairingId: string, secret: Uint8Array, createdAt: number): Promise<void>
  delete(pairingId: string): Promise<void>
}

export interface DesktopPairingConfirmation {
  code: string
  extensionVersion: string
  expiresAt: number
}

export interface NativePairingHostDependencies {
  vault: BrowserPairingSecretStore | BrowserPairingVault
  now(): number
  send(message: HostNativeMessage): void
  confirmPairing(details: DesktopPairingConfirmation): Promise<boolean>
}

interface PendingPairing {
  requestId: string
  pairingId: string
  extensionVersion: string
  secret: Uint8Array
  transcript: string
  expiresAt: number
  browserConfirmed: boolean
  desktopConfirmed: boolean
  finalizing: boolean
}

interface PendingSession {
  requestId: string
  pairingId: string
  sessionId: string
  sessionKey: Uint8Array
  transcript: string
  expiresAt: number
}

interface ActiveSession {
  pairingId: string
  sessionId: string
  key: Uint8Array
  expiresAt: number
  lastSequence: number
}

export class NativePairingHost {
  private pendingPairing?: PendingPairing
  private pendingSession?: PendingSession
  private activeSession?: ActiveSession

  constructor(private readonly dependencies: NativePairingHostDependencies) {}

  async handleMessage(raw: unknown): Promise<void> {
    assertExtensionNativeMessage(raw)
    this.cleanupExpired()
    switch (raw.type) {
      case 'pairing.begin':
        await this.beginPairing(raw)
        return
      case 'pairing.confirm':
        await this.confirmBrowserPairing(raw)
        return
      case 'pairing.cancel':
        this.cancelPairing(raw)
        return
      case 'session.begin':
        await this.beginSession(raw)
        return
      case 'session.proof':
        await this.confirmSession(raw)
        return
      case 'pairing.revoke':
        await this.revokePairing(raw)
    }
  }

  cleanupExpired(): void {
    const now = this.dependencies.now()
    if (this.pendingPairing && this.pendingPairing.expiresAt <= now) {
      this.pendingPairing = undefined
    }
    if (this.pendingSession && this.pendingSession.expiresAt <= now) {
      this.pendingSession = undefined
    }
    if (this.activeSession && this.activeSession.expiresAt <= now) {
      this.activeSession = undefined
    }
  }

  private async beginPairing(
    message: Extract<ExtensionNativeMessage, { type: 'pairing.begin' }>
  ): Promise<void> {
    const hostKeys = await generateNativeEphemeralKeyPair()
    const pairingId = nativeRandomId()
    const hostNonce = nativeRandomNonce()
    const expiresAt = this.dependencies.now() + PAIRING_CHALLENGE_TTL_MS
    const transcript = nativePairingTranscript({
      requestId: message.requestId,
      pairingId,
      clientNonce: message.clientNonce,
      clientPublicKey: message.clientPublicKey,
      hostNonce,
      hostPublicKey: hostKeys.publicKey
    })
    const secret = await deriveNativePairingSecret(
      hostKeys.privateKey, message.clientPublicKey, transcript)
    const code = await deriveNativePairingCode(secret, transcript)
    this.pendingPairing = {
      requestId: message.requestId,
      pairingId,
      extensionVersion: message.extensionVersion,
      secret,
      transcript,
      expiresAt,
      browserConfirmed: false,
      desktopConfirmed: false,
      finalizing: false
    }
    this.pendingSession = undefined
    this.dependencies.send({
      type: 'pairing.challenge',
      protocolVersion: NATIVE_MESSAGING_PROTOCOL_VERSION,
      requestId: message.requestId,
      pairingId,
      hostNonce,
      hostPublicKey: hostKeys.publicKey,
      code,
      expiresAt
    })
    void this.dependencies.confirmPairing({
      code,
      extensionVersion: message.extensionVersion,
      expiresAt
    }).then((confirmed) => this.recordDesktopDecision(pairingId, confirmed))
      .catch(() => this.recordDesktopDecision(pairingId, false))
  }

  private async confirmBrowserPairing(
    message: Extract<ExtensionNativeMessage, { type: 'pairing.confirm' }>
  ): Promise<void> {
    const pending = this.pendingPairing
    if (!pending || pending.requestId !== message.requestId ||
        pending.pairingId !== message.pairingId || pending.expiresAt <= this.dependencies.now()) {
      throw new Error('Pairing confirmation does not match an active challenge')
    }
    if (!await verifyNativeHmac(
      pending.secret, `browser-confirm|${pending.transcript}`, message.proof)) {
      throw new Error('Pairing confirmation proof is invalid')
    }
    pending.browserConfirmed = true
    try {
      await this.completePairingIfReady(pending)
    } catch {
      if (this.pendingPairing?.pairingId === pending.pairingId) this.pendingPairing = undefined
      this.sendError('STORAGE_UNAVAILABLE', '桌面端安全存储不可用', pending.requestId)
    }
  }

  private cancelPairing(
    message: Extract<ExtensionNativeMessage, { type: 'pairing.cancel' }>
  ): void {
    const pending = this.pendingPairing
    if (!pending || pending.requestId !== message.requestId || pending.pairingId !== message.pairingId) {
      throw new Error('Pairing cancellation does not match an active challenge')
    }
    this.pendingPairing = undefined
  }

  private async recordDesktopDecision(pairingId: string, confirmed: boolean): Promise<void> {
    const pending = this.pendingPairing
    if (!pending || pending.pairingId !== pairingId) return
    if (!confirmed || pending.expiresAt <= this.dependencies.now()) {
      this.pendingPairing = undefined
      this.sendError('PAIRING_REJECTED', '桌面端未确认配对', pending.requestId)
      return
    }
    pending.desktopConfirmed = true
    try {
      await this.completePairingIfReady(pending)
    } catch {
      if (this.pendingPairing?.pairingId === pairingId) this.pendingPairing = undefined
      this.sendError('STORAGE_UNAVAILABLE', '桌面端安全存储不可用', pending.requestId)
    }
  }

  private async completePairingIfReady(pending: PendingPairing): Promise<void> {
    if (!pending.browserConfirmed || !pending.desktopConfirmed || pending.finalizing) return
    if (pending.expiresAt <= this.dependencies.now()) {
      this.pendingPairing = undefined
      this.sendError('PAIRING_EXPIRED', '配对挑战已过期', pending.requestId)
      return
    }
    pending.finalizing = true
    await this.dependencies.vault.replace(
      pending.pairingId, pending.secret, this.dependencies.now())
    this.activeSession = undefined
    this.pendingPairing = undefined
    this.dependencies.send({
      type: 'pairing.complete',
      protocolVersion: NATIVE_MESSAGING_PROTOCOL_VERSION,
      requestId: pending.requestId,
      pairingId: pending.pairingId,
      proof: await nativeHmac(pending.secret, `host-confirm|${pending.transcript}`)
    })
  }

  private async beginSession(
    message: Extract<ExtensionNativeMessage, { type: 'session.begin' }>
  ): Promise<void> {
    let pairingSecret: Uint8Array | undefined
    try {
      pairingSecret = await this.dependencies.vault.get(message.pairingId)
    } catch {
      this.sendError('STORAGE_UNAVAILABLE', '桌面端安全存储不可用', message.requestId)
      return
    }
    if (!pairingSecret) {
      this.sendError('PAIRING_NOT_FOUND', '桌面端没有对应配对', message.requestId)
      return
    }
    const sessionId = nativeRandomId()
    const hostNonce = nativeRandomNonce()
    const expiresAt = this.dependencies.now() + BROWSER_SESSION_TTL_MS
    const transcript = nativeSessionTranscript({
      requestId: message.requestId,
      pairingId: message.pairingId,
      sessionId,
      clientNonce: message.clientNonce,
      hostNonce,
      expiresAt
    })
    const sessionKey = await deriveNativeSessionKey(
      pairingSecret, message.clientNonce, hostNonce, sessionId)
    this.pendingSession = {
      requestId: message.requestId,
      pairingId: message.pairingId,
      sessionId,
      sessionKey,
      transcript,
      expiresAt
    }
    this.dependencies.send({
      type: 'session.challenge',
      protocolVersion: NATIVE_MESSAGING_PROTOCOL_VERSION,
      requestId: message.requestId,
      pairingId: message.pairingId,
      sessionId,
      hostNonce,
      proof: await nativeHmac(pairingSecret, `host-challenge|${transcript}`),
      expiresAt
    })
  }

  private async confirmSession(
    message: Extract<ExtensionNativeMessage, { type: 'session.proof' }>
  ): Promise<void> {
    const pending = this.pendingSession
    if (!pending || pending.requestId !== message.requestId ||
        pending.sessionId !== message.sessionId || pending.expiresAt <= this.dependencies.now()) {
      throw new Error('Session proof does not match an active challenge')
    }
    if (!await verifyNativeHmac(
      pending.sessionKey, `client-ready|${pending.transcript}`, message.proof)) {
      throw new Error('Session proof is invalid')
    }
    this.activeSession = {
      pairingId: pending.pairingId,
      sessionId: pending.sessionId,
      key: pending.sessionKey,
      expiresAt: pending.expiresAt,
      lastSequence: 0
    }
    this.pendingSession = undefined
    this.dependencies.send({
      type: 'session.ready',
      protocolVersion: NATIVE_MESSAGING_PROTOCOL_VERSION,
      requestId: pending.requestId,
      pairingId: pending.pairingId,
      sessionId: pending.sessionId,
      proof: await nativeHmac(pending.sessionKey, `host-ready|${pending.transcript}`),
      expiresAt: pending.expiresAt
    })
  }

  private async revokePairing(
    message: Extract<ExtensionNativeMessage, { type: 'pairing.revoke' }>
  ): Promise<void> {
    const session = this.activeSession
    if (!session || session.pairingId !== message.pairingId ||
        session.sessionId !== message.sessionId || session.expiresAt <= this.dependencies.now() ||
        message.sequence !== session.lastSequence + 1) {
      throw new Error('Pairing revocation session is invalid')
    }
    if (!await verifyNativeHmac(
      session.key, `pairing.revoke|${session.sessionId}|${message.sequence}`, message.proof)) {
      throw new Error('Pairing revocation proof is invalid')
    }
    session.lastSequence = message.sequence
    await this.dependencies.vault.delete(message.pairingId)
    this.dependencies.send({
      type: 'pairing.revoked',
      protocolVersion: NATIVE_MESSAGING_PROTOCOL_VERSION,
      requestId: message.requestId,
      pairingId: message.pairingId,
      sessionId: message.sessionId,
      sequence: message.sequence,
      proof: await nativeHmac(
        session.key,
        `host-revoked|${session.sessionId}|${message.sequence}|${message.requestId}`
      )
    })
    this.activeSession = undefined
  }

  private sendError(code: string, message: string, requestId?: string): void {
    this.dependencies.send({
      type: 'host.error',
      protocolVersion: NATIVE_MESSAGING_PROTOCOL_VERSION,
      ...(requestId ? { requestId } : {}),
      code,
      message
    })
  }
}
