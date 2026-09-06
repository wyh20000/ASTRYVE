import type {
  ExecutionEnvironment,
  PermissionMode,
  TaskEvent,
  TaskEventType,
  TaskSnapshot,
  TaskStatus
} from '../../../shared/agent'

const TRANSITIONS: Readonly<Record<TaskStatus, readonly TaskStatus[]>> = {
  queued: ['planning', 'running', 'stopping', 'failed', 'cancelled', 'stale'],
  planning: ['running', 'waiting-approval', 'stopping', 'failed', 'cancelled', 'stale'],
  running: ['waiting-approval', 'stopping', 'completed', 'failed', 'cancelled', 'stale'],
  'waiting-approval': ['running', 'stopping', 'failed', 'cancelled', 'stale'],
  stopping: ['failed', 'cancelled', 'stale'],
  completed: [],
  failed: [],
  cancelled: [],
  stale: []
}

export interface CreateTaskStateInput {
  id: string
  sessionId: string
  workspaceId: string
  ownerWebContentsId: number
  permissionMode: PermissionMode
  environment: ExecutionEnvironment
  dockerImageId?: string
  now?: number
}

export class InvalidTaskTransitionError extends Error {
  constructor(from: TaskStatus, to: TaskStatus) {
    super(`Invalid task transition: ${from} -> ${to}`)
    this.name = 'InvalidTaskTransitionError'
  }
}

export class DuplicateToolCallError extends Error {
  constructor(callId: string) {
    super(`Duplicate tool call id: ${callId}`)
    this.name = 'DuplicateToolCallError'
  }
}

export class TaskStateMachine {
  private snapshotValue: TaskSnapshot
  private readonly usedCallIds = new Set<string>()

  constructor(input: CreateTaskStateInput) {
    const now = input.now ?? Date.now()
    this.snapshotValue = {
      id: input.id,
      sessionId: input.sessionId,
      workspaceId: input.workspaceId,
      ownerWebContentsId: input.ownerWebContentsId,
      permissionMode: input.permissionMode,
      environment: input.environment,
      dockerImageId: input.dockerImageId,
      status: 'queued',
      sequence: 0,
      createdAt: now,
      updatedAt: now
    }
  }

  get snapshot(): Readonly<TaskSnapshot> {
    return { ...this.snapshotValue }
  }

  transition(to: TaskStatus, reason?: string, now = Date.now()): TaskEvent {
    const from = this.snapshotValue.status
    if (!TRANSITIONS[from].includes(to)) throw new InvalidTaskTransitionError(from, to)
    this.snapshotValue = { ...this.snapshotValue, status: to, updatedAt: now }
    return this.emit('task.status-changed', { from, to, reason }, now)
  }

  registerToolCall(callId: string): void {
    if (this.usedCallIds.has(callId)) throw new DuplicateToolCallError(callId)
    this.usedCallIds.add(callId)
  }

  emit<TPayload>(type: TaskEventType, payload: TPayload, now = Date.now()): TaskEvent<TPayload> {
    const sequence = this.snapshotValue.sequence + 1
    this.snapshotValue = { ...this.snapshotValue, sequence, updatedAt: now }
    return {
      taskId: this.snapshotValue.id,
      sessionId: this.snapshotValue.sessionId,
      sequence,
      type,
      timestamp: now,
      payload
    }
  }
}

export function canTransition(from: TaskStatus, to: TaskStatus): boolean {
  return TRANSITIONS[from].includes(to)
}
