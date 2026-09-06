import { describe, expect, it } from 'vitest'
import { appendToolTimelineText, createToolTimeline, updateToolTimeline } from './toolTimeline'

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
})
