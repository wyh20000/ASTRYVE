import { describe, expect, it, vi } from 'vitest'
import {
  beginGeneration,
  cancelGeneration,
  finishGeneration,
  isCurrentGeneration,
  setGenerationCancelHandler,
  updateGenerationSnapshot
} from './generationTasks'

describe('generationTasks', () => {
  it('replacing a generation cancels the old transaction exactly once', () => {
    const cancelled = vi.fn()
    const first = beginGeneration('session-replace', 1, 'generation-1')
    setGenerationCancelHandler(first, cancelled)
    const second = beginGeneration('session-replace', 1, 'generation-2')

    expect(first.controller.signal.aborted).toBe(true)
    expect(first.controller.signal.reason).toBe('replaced')
    expect(cancelled).toHaveBeenCalledTimes(1)
    expect(isCurrentGeneration('session-replace', second)).toBe(true)
    finishGeneration('session-replace', second)
  })

  it('passes the latest correlated snapshot to cancellation finalization', () => {
    const onCancel = vi.fn()
    const task = beginGeneration('session-stop', 2, 'generation-stop')
    const snapshot = {
      id: 'assistant', sessionId: 'session-stop', generationId: 'generation-stop', revision: 4,
      role: 'assistant' as const, content: 'partial', status: 'streaming' as const, timestamp: 1
    }
    updateGenerationSnapshot(task, snapshot)
    setGenerationCancelHandler(task, onCancel)

    expect(cancelGeneration('session-stop', 'user')).toBe(true)
    expect(onCancel).toHaveBeenCalledWith('user', snapshot)
    expect(cancelGeneration('session-stop', 'user')).toBe(false)
  })
})
