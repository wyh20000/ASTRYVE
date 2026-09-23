import { createHash } from 'node:crypto'
import { existsSync } from 'node:fs'
import { mkdir, readFile, readdir, rename, rm, stat, writeFile } from 'node:fs/promises'
import { join, resolve, sep } from 'node:path'
import type { Attachment, Message } from '@shared/types'

const ARTIFACT_ID = /^artifact:([a-f0-9]{64})$/
const MAX_ARTIFACT_BYTES = 25 * 1024 * 1024
const MAX_STORE_BYTES = 1024 * 1024 * 1024

export interface StoredArtifact {
  ref: string
  hash: string
  mime: string
  sizeBytes: number
  source: string
}

/** Account-scoped content-addressed binary/text store. Metadata belongs to messages. */
export class ArtifactStore {
  private usedBytes: number | undefined
  private writeQueue: Promise<void> = Promise.resolve()

  constructor(readonly root: string) {}

  private pathFor(ref: string): string {
    const match = ARTIFACT_ID.exec(ref)
    if (!match) throw new Error('无效的附件引用')
    const target = resolve(this.root, match[1].slice(0, 2), match[1])
    if (!target.startsWith(resolve(this.root) + sep)) throw new Error('附件路径无效')
    return target
  }

  private async calculateUsedBytes(): Promise<number> {
    let total = 0
    if (!existsSync(this.root)) return 0
    for (const prefix of await readdir(this.root)) {
      if (!/^[a-f0-9]{2}$/.test(prefix)) continue
      for (const name of await readdir(join(this.root, prefix))) {
        if (!/^[a-f0-9]{64}$/.test(name)) continue
        total += (await stat(join(this.root, prefix, name))).size
      }
    }
    return total
  }

  private async exclusive<T>(operation: () => Promise<T>): Promise<T> {
    const prior = this.writeQueue
    let release!: () => void
    this.writeQueue = new Promise<void>((resolve) => { release = resolve })
    await prior
    try {
      return await operation()
    } finally {
      release()
    }
  }

  async put(bytes: Buffer, mime: string, source: string): Promise<StoredArtifact> {
    if (!bytes.length || bytes.length > MAX_ARTIFACT_BYTES) throw new Error('附件大小无效')
    if (!/^[\w.+-]+\/[\w.+-]+$/.test(mime)) throw new Error('附件 MIME 类型无效')
    const hash = createHash('sha256').update(bytes).digest('hex')
    const ref = `artifact:${hash}`
    const target = this.pathFor(ref)
    await this.exclusive(async () => {
      if (existsSync(target)) return
      this.usedBytes ??= await this.calculateUsedBytes()
      if (this.usedBytes + bytes.length > MAX_STORE_BYTES) throw new Error('本地附件空间已满')
      await mkdir(join(this.root, hash.slice(0, 2)), { recursive: true })
      const temp = `${target}.${process.pid}.${crypto.randomUUID()}.tmp`
      try {
        await writeFile(temp, bytes, { mode: 0o600 })
        await rename(temp, target)
        this.usedBytes += bytes.length
      } catch (error) {
        await rm(temp, { force: true }).catch(() => undefined)
        throw error
      }
    })
    return { ref, hash, mime, sizeBytes: bytes.length, source }
  }

  async putDataUrl(dataRef: string, source: string): Promise<StoredArtifact> {
    const match = /^data:([\w.+-]+\/[\w.+-]+);base64,([A-Za-z0-9+/=]+)$/.exec(dataRef)
    if (!match) throw new Error('图片数据格式无效')
    return this.put(Buffer.from(match[2], 'base64'), match[1], source)
  }

  async putText(text: string, source: string): Promise<StoredArtifact> {
    return this.put(Buffer.from(text, 'utf8'), 'text/plain', source)
  }

  async read(ref: string): Promise<Buffer> {
    const bytes = await readFile(this.pathFor(ref))
    const expected = ARTIFACT_ID.exec(ref)?.[1]
    if (createHash('sha256').update(bytes).digest('hex') !== expected) throw new Error('附件校验失败')
    return bytes
  }

  async readDataUrl(ref: string, mime: string): Promise<string> {
    const bytes = await this.read(ref)
    return `data:${mime};base64,${bytes.toString('base64')}`
  }

  async readText(ref: string): Promise<string> {
    return (await this.read(ref)).toString('utf8')
  }

  /** Remove only content-addressed files no longer referenced by any message. */
  async collectGarbage(liveRefs: ReadonlySet<string>, graceMs = 0): Promise<number> {
    return this.exclusive(async () => {
      if (!existsSync(this.root)) return 0
      let removed = 0
      for (const prefix of await readdir(this.root)) {
        if (!/^[a-f0-9]{2}$/.test(prefix)) continue
        const directory = join(this.root, prefix)
        for (const name of await readdir(directory)) {
          if (!/^[a-f0-9]{64}$/.test(name) || liveRefs.has(`artifact:${name}`)) continue
          const target = join(directory, name)
          if (graceMs > 0 && Date.now() - (await stat(target)).mtimeMs < graceMs) continue
          await rm(target, { force: true })
          removed += 1
        }
      }
      this.usedBytes = undefined
      return removed
    })
  }
}

let activeStore: ArtifactStore | undefined

export function initArtifactStore(accountPath: string): ArtifactStore {
  activeStore = new ArtifactStore(join(accountPath, 'artifacts'))
  return activeStore
}

export function getArtifactStore(): ArtifactStore {
  if (!activeStore) throw new Error('Artifact Store 尚未初始化')
  return activeStore
}

export function isArtifactRef(value: string): boolean {
  return ARTIFACT_ID.test(value)
}

export async function materializeMessage(message: Message): Promise<Message> {
  if (!message.attachments?.some((attachment) => attachment.kind === 'image' && isArtifactRef(attachment.dataRef))) {
    return message
  }
  const attachments: Attachment[] = await Promise.all(message.attachments.map(async (attachment) => {
    if (attachment.kind !== 'image' || !isArtifactRef(attachment.dataRef)) return attachment
    return { ...attachment, dataRef: await getArtifactStore().readDataUrl(attachment.dataRef, attachment.contentType) }
  }))
  return { ...message, attachments }
}

export function messageArtifactRefs(message: Message): string[] {
  const refs = [
    ...(message.attachments ?? []).map((attachment) => attachment.dataRef),
    ...(message.attachments ?? []).map((attachment) => attachment.meta?.documentRef).filter(
      (ref): ref is string => typeof ref === 'string'
    ),
    ...(message.turn?.documentRefs ?? []),
    ...(message.turn?.imageRefs ?? [])
  ]
  return refs.filter(isArtifactRef)
}
