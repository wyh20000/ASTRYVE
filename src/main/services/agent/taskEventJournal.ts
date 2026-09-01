import fs from 'node:fs'
import { basename, dirname, join } from 'node:path'
import type { TaskEvent, TaskSnapshot, TaskStatus } from '../../../shared/agent'
import { TASK_STATUSES, TERMINAL_TASK_STATUSES } from '../../../shared/agent'
import { isEntityId, isExecutionEnvironment, isPermissionMode } from './validation'

const JOURNAL_VERSION = 1
const DEFAULT_FLUSH_MS = 200
const MAX_STORED_EVENTS = 5_000

export interface StoredTaskRecord {
  snapshot: TaskSnapshot
  terminalReason?: string
  staleAt?: number
}

interface JournalFileShape {
  version: 1
  tasks: StoredTaskRecord[]
  events: TaskEvent[]
}

export interface TaskEventStore {
  append(events: TaskEvent[]): Promise<void>
  recoverStaleTasks(now?: number): Promise<string[]>
}

export class FileTaskEventStore implements TaskEventStore {
  private readonly tasks = new Map<string, StoredTaskRecord>()
  private events: TaskEvent[] = []
  private persistChain: Promise<void> = Promise.resolve()

  constructor(private readonly filePath: string) {
    this.load()
  }

  append(events: TaskEvent[]): Promise<void> {
    if (events.length === 0) return this.persistChain
    const write = async (): Promise<void> => {
      for (const event of events) this.applyEvent(event)
      this.events.push(...events.map(cloneEvent))
      if (this.events.length > MAX_STORED_EVENTS) {
        this.events = this.events.slice(-MAX_STORED_EVENTS)
      }
      await this.persist()
    }
    this.persistChain = this.persistChain.then(write, write)
    return this.persistChain
  }

  recoverStaleTasks(now = Date.now()): Promise<string[]> {
    const recover = async (): Promise<string[]> => {
      const staleIds: string[] = []
      const recoveryEvents: TaskEvent[] = []
      for (const record of this.tasks.values()) {
        if (isTerminalStatus(record.snapshot.status)) continue
        const from = record.snapshot.status
        record.snapshot = {
          ...record.snapshot,
          status: 'stale',
          sequence: record.snapshot.sequence + 1,
          updatedAt: now
        }
        record.terminalReason = 'process_restarted'
        record.staleAt = now
        staleIds.push(record.snapshot.id)
        recoveryEvents.push({
          taskId: record.snapshot.id,
          sessionId: record.snapshot.sessionId,
          sequence: record.snapshot.sequence,
          type: 'task.status-changed',
          timestamp: now,
          payload: { from, to: 'stale', reason: 'process_restarted' }
        })
      }
      if (recoveryEvents.length > 0) {
        this.events.push(...recoveryEvents)
        if (this.events.length > MAX_STORED_EVENTS) {
          this.events = this.events.slice(-MAX_STORED_EVENTS)
        }
        await this.persist()
      }
      return staleIds
    }
    this.persistChain = this.persistChain.then(recover, recover).then(() => undefined)
    return this.persistChain.then(() =>
      [...this.tasks.values()]
        .filter((record) => record.staleAt === now)
        .map((record) => record.snapshot.id)
    )
  }

  snapshotForTests(): JournalFileShape {
    return this.toFileShape()
  }

  async cleanupInterruptedWrites(): Promise<number> {
    const directory = dirname(this.filePath)
    const prefix = `${basename(this.filePath)}.`
    let removed = 0
    try {
      for (const entry of await fs.promises.readdir(directory, { withFileTypes: true })) {
        if (!entry.isFile() || !entry.name.startsWith(prefix) || !entry.name.endsWith('.tmp')) continue
        await fs.promises.rm(join(directory, entry.name), { force: true })
        removed += 1
      }
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
    }
    return removed
  }

  private load(): void {
    try {
      if (!fs.existsSync(this.filePath)) return
      const parsed = JSON.parse(fs.readFileSync(this.filePath, 'utf8')) as Partial<JournalFileShape>
      if (parsed.version !== JOURNAL_VERSION || !Array.isArray(parsed.tasks) || !Array.isArray(parsed.events)) {
        throw new Error('Task journal format is invalid')
      }
      for (const record of parsed.tasks) {
        if (isStoredTaskRecord(record)) this.tasks.set(record.snapshot.id, cloneRecord(record))
      }
      this.events = parsed.events.filter(isStoredEvent).slice(-MAX_STORED_EVENTS).map(cloneEvent)
    } catch (error) {
      console.warn('[agent] task journal load failed:', error)
      this.tasks.clear()
      this.events = []
    }
  }

  private applyEvent(event: TaskEvent): void {
    if (event.type === 'task.created' && isTaskSnapshot(event.payload)) {
      this.tasks.set(event.taskId, { snapshot: { ...event.payload } })
      return
    }
    const record = this.tasks.get(event.taskId)
    if (!record || event.sequence <= record.snapshot.sequence) return
    record.snapshot = {
      ...record.snapshot,
      sequence: event.sequence,
      updatedAt: event.timestamp
    }
    if (event.type !== 'task.status-changed' || !event.payload || typeof event.payload !== 'object') return
    const payload = event.payload as { to?: unknown; reason?: unknown }
    if (!isTaskStatus(payload.to)) return
    record.snapshot.status = payload.to
    if (isTerminalStatus(payload.to) && typeof payload.reason === 'string') {
      record.terminalReason = payload.reason.slice(0, 256)
    }
  }

  private async persist(): Promise<void> {
    const target = this.filePath
    const temp = `${target}.${process.pid}.${Date.now()}.tmp`
    await fs.promises.mkdir(dirname(target), { recursive: true })
    try {
      await fs.promises.writeFile(temp, JSON.stringify(this.toFileShape(), null, 2), {
        encoding: 'utf8',
        mode: 0o600
      })
      await fs.promises.rename(temp, target)
    } catch (error) {
      await fs.promises.rm(temp, { force: true }).catch(() => undefined)
      throw error
    }
  }

  private toFileShape(): JournalFileShape {
    return {
      version: JOURNAL_VERSION,
      tasks: [...this.tasks.values()].map(cloneRecord),
      events: this.events.map(cloneEvent)
    }
  }
}

export class TaskEventJournal {
  private pending: TaskEvent[] = []
  private timer: ReturnType<typeof setTimeout> | undefined
  private flushChain: Promise<void> = Promise.resolve()

  constructor(
    private readonly store: TaskEventStore,
    private readonly flushMs = DEFAULT_FLUSH_MS
  ) {
    if (!Number.isSafeInteger(flushMs) || flushMs <= 0) throw new Error('Journal flush interval is invalid')
  }

  record(event: TaskEvent): void {
    this.pending.push(cloneEvent(event))
    if (isTerminalEvent(event)) {
      void this.flush().catch((error) => console.warn('[agent] task journal flush failed:', error))
      return
    }
    if (!this.timer) {
      this.timer = setTimeout(() => {
        this.timer = undefined
        void this.flush().catch((error) => console.warn('[agent] task journal flush failed:', error))
      }, this.flushMs)
    }
  }

  flush(): Promise<void> {
    if (this.timer) clearTimeout(this.timer)
    this.timer = undefined
    const batch = this.pending.splice(0)
    if (batch.length === 0) return this.flushChain
    const write = async (): Promise<void> => {
      try {
        await this.store.append(batch)
      } catch (error) {
        this.pending.unshift(...batch)
        throw error
      }
    }
    this.flushChain = this.flushChain.then(write, write)
    return this.flushChain
  }

  async close(): Promise<void> {
    await this.flush()
  }
}

function isTerminalEvent(event: TaskEvent): boolean {
  if (event.type !== 'task.status-changed' || !event.payload || typeof event.payload !== 'object') {
    return false
  }
  return isTerminalStatus((event.payload as { to?: unknown }).to)
}

function isTaskStatus(value: unknown): value is TaskStatus {
  return typeof value === 'string' && (TASK_STATUSES as readonly string[]).includes(value)
}

function isTerminalStatus(value: unknown): boolean {
  return typeof value === 'string' && (TERMINAL_TASK_STATUSES as readonly string[]).includes(value)
}

function isTaskSnapshot(value: unknown): value is TaskSnapshot {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false
  const snapshot = value as Partial<TaskSnapshot>
  return (
    isEntityId(snapshot.id) &&
    isEntityId(snapshot.sessionId) &&
    isEntityId(snapshot.workspaceId) &&
    Number.isSafeInteger(snapshot.ownerWebContentsId) &&
    (snapshot.ownerWebContentsId ?? 0) > 0 &&
    isPermissionMode(snapshot.permissionMode) &&
    isExecutionEnvironment(snapshot.environment) &&
    isTaskStatus(snapshot.status) &&
    Number.isSafeInteger(snapshot.sequence) &&
    (snapshot.sequence ?? -1) >= 0 &&
    Number.isSafeInteger(snapshot.createdAt) &&
    Number.isSafeInteger(snapshot.updatedAt)
  )
}

function isStoredTaskRecord(value: unknown): value is StoredTaskRecord {
  return !!value && typeof value === 'object' && !Array.isArray(value) &&
    isTaskSnapshot((value as StoredTaskRecord).snapshot)
}

function isStoredEvent(value: unknown): value is TaskEvent {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false
  const event = value as Partial<TaskEvent>
  return isEntityId(event.taskId) && isEntityId(event.sessionId) &&
    Number.isSafeInteger(event.sequence) && typeof event.type === 'string' && Number.isFinite(event.timestamp)
}

function cloneEvent(event: TaskEvent): TaskEvent {
  return JSON.parse(JSON.stringify(event)) as TaskEvent
}

function cloneRecord(record: StoredTaskRecord): StoredTaskRecord {
  return JSON.parse(JSON.stringify(record)) as StoredTaskRecord
}
