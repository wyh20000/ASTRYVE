import { describe, expect, it } from 'vitest'
import {
  DuplicateToolCallError,
  InvalidTaskTransitionError,
  TaskStateMachine,
  canTransition
} from './taskStateMachine'

function createMachine(): TaskStateMachine {
  return new TaskStateMachine({
    id: 'task-1',
    sessionId: 'session-1',
    workspaceId: 'workspace-1',
    permissionMode: 'ask-every-time',
    environment: 'docker',
    now: 100
  })
}

describe('TaskStateMachine', () => {
  it('emits monotonically increasing event sequences', () => {
    const machine = createMachine()
    const planning = machine.transition('planning', 'model started', 101)
    const running = machine.transition('running', undefined, 102)
    const output = machine.emit('task.output', { chunk: 'ok' }, 103)

    expect([planning.sequence, running.sequence, output.sequence]).toEqual([1, 2, 3])
    expect(machine.snapshot.sequence).toBe(3)
    expect(machine.snapshot.status).toBe('running')
  })

  it('rejects transitions out of terminal states and impossible transitions', () => {
    const machine = createMachine()
    expect(() => machine.transition('completed')).toThrow(InvalidTaskTransitionError)

    machine.transition('running')
    machine.transition('completed')
    expect(() => machine.transition('running')).toThrow(InvalidTaskTransitionError)
    expect(canTransition('completed', 'running')).toBe(false)
  })

  it('rejects duplicate tool call ids within a task', () => {
    const machine = createMachine()
    machine.registerToolCall('call-1')
    expect(() => machine.registerToolCall('call-1')).toThrow(DuplicateToolCallError)
  })

  it('supports explicit stopping and cancellation', () => {
    const machine = createMachine()
    machine.transition('planning')
    machine.transition('stopping')
    machine.transition('cancelled')
    expect(machine.snapshot.status).toBe('cancelled')
  })
})
