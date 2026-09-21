import { randomUUID } from 'node:crypto'
import { lstat, mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { BROWSER_EXTENSION_ORIGIN } from './nativeMessagingConstants'

const FILE = 'browser-pairing.json'
const MAX_FILE_BYTES = 64 * 1024
const MAX_CIPHERTEXT_BYTES = 4096
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
const queues = new Map<string, Promise<unknown>>()

export interface BrowserPairingEncryptionAdapter {
  available(): Promise<boolean>
  encrypt(value: string): Promise<Buffer>
  decrypt(value: Buffer): Promise<string>
}

interface StoredPairing {
  pairingId: string
  extensionOrigin: string
  createdAt: number
  encryptedSecret: string
}

const electronEncryption: BrowserPairingEncryptionAdapter = {
  async available() {
    try {
      const { safeStorage } = await import('electron')
      if (!safeStorage.isAsyncEncryptionAvailable()) return false
      return process.platform !== 'linux' || safeStorage.getSelectedStorageBackend() !== 'basic_text'
    } catch {
      return false
    }
  },
  async encrypt(value) {
    const { safeStorage } = await import('electron')
    return safeStorage.encryptStringAsync(value)
  },
  async decrypt(value) {
    const { safeStorage } = await import('electron')
    return (await safeStorage.decryptStringAsync(value)).result
  }
}

export class BrowserPairingVault {
  constructor(
    private readonly dataRoot: string,
    private readonly encryption: BrowserPairingEncryptionAdapter = electronEncryption
  ) {}

  async get(pairingId: string): Promise<Uint8Array | undefined> {
    validatePairingId(pairingId)
    const pairing = await readPairing(this.dataRoot)
    if (!pairing || pairing.pairingId !== pairingId ||
        pairing.extensionOrigin !== BROWSER_EXTENSION_ORIGIN) return undefined
    if (!await this.encryption.available()) throw new Error('Browser pairing encryption unavailable')
    try {
      const secret = Buffer.from(await this.encryption.decrypt(
        Buffer.from(pairing.encryptedSecret, 'base64')), 'base64url')
      if (secret.length !== 32) throw new Error('invalid secret')
      return new Uint8Array(secret)
    } catch {
      throw new Error('Browser pairing credential decryption failed')
    }
  }

  async replace(pairingId: string, secret: Uint8Array, createdAt: number): Promise<void> {
    validatePairingId(pairingId)
    if (secret.byteLength !== 32 || !Number.isSafeInteger(createdAt) || createdAt < 0) {
      throw new Error('Browser pairing credential is invalid')
    }
    if (!await this.encryption.available()) {
      throw new Error('Browser pairing encryption unavailable')
    }
    const encrypted = await this.encryption.encrypt(Buffer.from(secret).toString('base64url'))
    if (!encrypted.length || encrypted.length > MAX_CIPHERTEXT_BYTES) {
      throw new Error('Browser pairing encrypted credential is invalid')
    }
    await serialize(this.dataRoot, () => writePairing(this.dataRoot, {
      pairingId,
      extensionOrigin: BROWSER_EXTENSION_ORIGIN,
      createdAt,
      encryptedSecret: encrypted.toString('base64')
    }))
  }

  async delete(pairingId: string): Promise<void> {
    validatePairingId(pairingId)
    await serialize(this.dataRoot, async () => {
      const pairing = await readPairing(this.dataRoot)
      if (pairing?.pairingId !== pairingId) return
      await rm(join(this.dataRoot, FILE), { force: true })
    })
  }
}

async function readPairing(dataRoot: string): Promise<StoredPairing | undefined> {
  try {
    const path = join(dataRoot, FILE)
    const info = await lstat(path)
    if (!info.isFile() || info.isSymbolicLink() || info.size > MAX_FILE_BYTES) return undefined
    const value = JSON.parse(await readFile(path, 'utf8')) as unknown
    if (!record(value) || !exact(value, ['schemaVersion', 'pairing']) ||
        value.schemaVersion !== 1 || !record(value.pairing)) return undefined
    const pairing = value.pairing
    if (!exact(pairing, ['pairingId', 'extensionOrigin', 'createdAt', 'encryptedSecret']) ||
        !UUID.test(String(pairing.pairingId)) || pairing.extensionOrigin !== BROWSER_EXTENSION_ORIGIN ||
        !Number.isSafeInteger(pairing.createdAt) || Number(pairing.createdAt) < 0 ||
        typeof pairing.encryptedSecret !== 'string' ||
        !canonicalBase64(pairing.encryptedSecret) ||
        Buffer.from(pairing.encryptedSecret, 'base64').length > MAX_CIPHERTEXT_BYTES) return undefined
    return pairing as unknown as StoredPairing
  } catch {
    return undefined
  }
}

async function writePairing(dataRoot: string, pairing: StoredPairing): Promise<void> {
  await mkdir(dataRoot, { recursive: true })
  const path = join(dataRoot, FILE)
  const temporary = `${path}.${randomUUID()}.tmp`
  await writeFile(temporary, JSON.stringify({ schemaVersion: 1, pairing }), {
    flag: 'wx', mode: 0o600
  })
  try {
    await rename(temporary, path)
  } finally {
    await rm(temporary, { force: true }).catch(() => undefined)
  }
}

function serialize(dataRoot: string, operation: () => Promise<void>): Promise<void> {
  const previous = queues.get(dataRoot) ?? Promise.resolve()
  const current = previous.catch(() => undefined).then(operation)
  queues.set(dataRoot, current)
  void current.finally(() => {
    if (queues.get(dataRoot) === current) queues.delete(dataRoot)
  }).catch(() => undefined)
  return current
}

function validatePairingId(value: string): void {
  if (!UUID.test(value)) throw new Error('Browser pairing identifier is invalid')
}

function canonicalBase64(value: string): boolean {
  return Boolean(value) && /^[A-Za-z0-9+/]+={0,2}$/.test(value) &&
    Buffer.from(value, 'base64').toString('base64') === value
}

function record(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

function exact(value: Record<string, unknown>, keys: readonly string[]): boolean {
  const actual = Object.keys(value)
  return actual.length === keys.length && actual.every((key) => keys.includes(key))
}
