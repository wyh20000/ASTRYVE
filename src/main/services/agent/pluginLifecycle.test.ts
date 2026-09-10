import { createHash, generateKeyPairSync, sign } from 'node:crypto'
import { describe, expect, it } from 'vitest'
import { verifyPluginArchive, verifyPluginSignature } from './pluginLifecycle'

describe('plugin lifecycle verification', () => {
  it('accepts the exact SHA-256 and rejects tampered packages', () => {
    const bytes = Buffer.from('plugin')
    const digest = createHash('sha256').update(bytes).digest('hex')
    expect(() => verifyPluginArchive(bytes, digest)).not.toThrow()
    expect(() => verifyPluginArchive(Buffer.from('tampered'), digest)).toThrow('摘要')
  })

  it('verifies Ed25519 package signatures and rejects tampering', () => {
    const { publicKey, privateKey } = generateKeyPairSync('ed25519')
    const bytes = Buffer.from('signed plugin')
    const entry = {
      signature: sign(null, bytes, privateKey).toString('base64'),
      signingPublicKey: publicKey.export({ type: 'spki', format: 'pem' }).toString()
    }
    expect(() => verifyPluginSignature(bytes, entry)).not.toThrow()
    expect(() => verifyPluginSignature(Buffer.from('tampered'), entry)).toThrow('签名')
  })
})
