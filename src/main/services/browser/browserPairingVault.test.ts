import { mkdtemp, readFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  BrowserPairingVault,
  type BrowserPairingEncryptionAdapter
} from './browserPairingVault'

const reversibleEncryption = (): BrowserPairingEncryptionAdapter => ({
  available: async () => true,
  encrypt: async (value) => Buffer.from(`cipher:${value}`),
  decrypt: async (value) => value.subarray('cipher:'.length).toString()
})

describe('browser pairing vault', () => {
  it('stores only encrypted pairing material and atomically replaces rotations', async () => {
    const root = await mkdtemp(join(tmpdir(), 'browser-pairing-'))
    const vault = new BrowserPairingVault(root, reversibleEncryption())
    const firstId = '10cb9d04-c83f-4b3f-8de2-d521a2450a67'
    const secondId = 'd39092e9-7ebb-4e40-b1d2-11a544dc2811'
    const firstSecret = new Uint8Array(32).fill(7)
    const secondSecret = new Uint8Array(32).fill(9)

    await vault.replace(firstId, firstSecret, 1_800_000_000_000)
    const persisted = await readFile(join(root, 'browser-pairing.json'), 'utf8')
    expect(persisted).not.toContain(Buffer.from(firstSecret).toString('base64url'))
    expect([...(await vault.get(firstId)) ?? []]).toEqual([...firstSecret])

    await vault.replace(secondId, secondSecret, 1_800_000_001_000)
    expect(await vault.get(firstId)).toBeUndefined()
    expect([...(await vault.get(secondId)) ?? []]).toEqual([...secondSecret])
    await vault.delete(secondId)
    expect(await vault.get(secondId)).toBeUndefined()
  })

  it('refuses to persist when operating-system encryption is unavailable', async () => {
    const root = await mkdtemp(join(tmpdir(), 'browser-pairing-unavailable-'))
    const unavailable: BrowserPairingEncryptionAdapter = {
      available: async () => false,
      encrypt: async () => Buffer.alloc(0),
      decrypt: async () => ''
    }
    const vault = new BrowserPairingVault(root, unavailable)
    await expect(vault.replace(
      '10cb9d04-c83f-4b3f-8de2-d521a2450a67', new Uint8Array(32), 1
    )).rejects.toThrow('encryption unavailable')
  })
})
