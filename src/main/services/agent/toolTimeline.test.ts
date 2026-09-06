import { describe, expect, it } from 'vitest'
import {
  appendCommandTimeline,
  appendPatchTimeline,
  appendTaskReport,
  appendToolTimelineText,
  appendToolTimelineThinking,
  createToolTimeline,
  updateToolTimeline
} from './toolTimeline'

describe('tool activity timeline', () => {
  it('keeps findings between separate tool rounds in chronological order', () => {
    const state = createToolTimeline()
    appendToolTimelineText(state, '先检查入口。')
    updateToolTimeline(state, 'call-1', '读取入口', false)
    updateToolTimeline(state, 'call-1', '读取入口', true)
    appendToolTimelineText(state, '入口没有问题，继续检查存储。')
    updateToolTimeline(state, 'call-2', '读取存储', false)
    expect(state.blocks.map((block) => block.kind)).toEqual(['text', 'plan', 'text', 'plan'])
  })

  it('groups contiguous calls from the same model round and updates them in place', () => {
    const state = createToolTimeline()
    updateToolTimeline(state, 'call-1', '读取 A', false)
    updateToolTimeline(state, 'call-1', '读取 A 完成', true)
    updateToolTimeline(state, 'call-2', '读取 B', false)
    expect(state.blocks).toEqual([{ kind: 'plan', items: [
      { order: 1, title: '读取 A 完成', done: true },
      { order: 2, title: '读取 B', done: false }
    ] }])
  })

  it('splits reasoning around tool rounds and closes each completed reasoning block', () => {
    const state = createToolTimeline()
    appendToolTimelineThinking(state, '先读取文件。')
    updateToolTimeline(state, 'call-1', '读取文件', false)
    updateToolTimeline(state, 'call-1', '读取文件', true)
    appendToolTimelineThinking(state, '已经定位问题，运行测试。')
    appendCommandTimeline(state, 'call-2', { executable: 'npm', args: ['test'] }, {
      exitCode: 0, durationMs: 25, truncated: false, stdout: 'passed', stderr: ''
    })
    expect(state.blocks.map((block) => block.kind)).toEqual(['thinking', 'plan', 'thinking', 'command'])
    expect(state.blocks.filter((block) => block.kind === 'thinking'))
      .toEqual([
        { kind: 'thinking', content: '先读取文件。', done: true },
        { kind: 'thinking', content: '已经定位问题，运行测试。', done: true }
      ])
  })

  it('retains structured command output for the task workspace', () => {
    const state = createToolTimeline()
    appendCommandTimeline(state, 'call-1', { executable: 'npm', args: ['test'] }, {
      exitCode: 0, durationMs: 25, truncated: false, stdout: 'passed', stderr: ''
    })
    expect(state.blocks[0]).toEqual({
      kind: 'command', callId: 'call-1', executable: 'npm', args: ['test'],
      exitCode: 0, durationMs: 25, truncated: false, stdout: 'passed', stderr: ''
    })
  })

  it('retains exact original and modified text for the Monaco diff surface', () => {
    const state = createToolTimeline()
    appendPatchTimeline(state, 'task', {
      patchHash: 'a'.repeat(64), added: 0, modified: 1, deleted: 0, renamed: 0,
      linesAdded: 1, linesDeleted: 1,
      files: [{ path: 'a.ts', status: 'modified', linesAdded: 1, linesDeleted: 1, diff: '-old\n+new' }]
    }, [{ path: 'a.ts', originalContent: 'old', modifiedContent: 'new' }])
    expect(state.blocks[0]).toMatchObject({ kind: 'diff', files: [{
      path: 'a.ts', originalContent: 'old', modifiedContent: 'new'
    }] })
  })

  it('builds a completion report from files, commands, tests, approvals and unresolved work', () => {
    const state = createToolTimeline()
    state.blocks.push({ kind: 'diff', taskId: 'task', patchHash: 'a'.repeat(64), linesAdded: 1, linesDeleted: 0,
      files: [{ path: 'a.ts', status: 'modified', linesAdded: 1, linesDeleted: 0, diff: '+x' }] })
    appendCommandTimeline(state, 'test', { executable: 'npm', args: ['run', 'test'] }, {
      exitCode: 0, durationMs: 25, truncated: false, stdout: 'passed', stderr: ''
    })
    appendTaskReport(state, [{ toolName: 'workspace.applyPatch', target: 'a.ts' }])
    expect(state.blocks.at(-1)).toMatchObject({ kind: 'report',
      files: [{ path: 'a.ts', status: 'modified' }],
      commands: [{ command: 'npm run test', exitCode: 0 }],
      tests: [{ command: 'npm run test', passed: true }],
      approvals: [{ toolName: 'workspace.applyPatch', target: 'a.ts' }], unresolved: [] })
  })
})
