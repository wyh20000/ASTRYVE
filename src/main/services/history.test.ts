import { describe, expect, it } from 'vitest'
import {
  estimateTextTokens,
  fitHistoryToTokenBudget,
  injectDocuments,
  toChatMessage
} from './history'
import type { Message } from '@shared/types'
import type { ChatMessage } from './modelProvider'

const imgMsg = (): Message => ({
  id: 'm1',
  sessionId: 's1',
  role: 'user',
  content: '分析一下这个页面',
  attachments: [
    { id: 'a1', kind: 'image', name: 'x.png', contentType: 'image/png', dataRef: 'data:image/png;base64,AAA' }
  ],
  status: 'done',
  timestamp: 1
})

const textMsg = (role: Message['role'], content: string): Message => ({
  id: 'm2',
  sessionId: 's1',
  role,
  content,
  status: 'done',
  timestamp: 2
})

describe('toChatMessage', () => {
  it('视觉请求：带图消息转为 image_url 多模态内容', () => {
    const c = toChatMessage(imgMsg(), true)
    expect(Array.isArray(c.content)).toBe(true)
    expect(c.content).toEqual([
      { type: 'text', text: '分析一下这个页面' },
      { type: 'image_url', image_url: { url: 'data:image/png;base64,AAA' } }
    ])
  })

  it('非视觉请求：剥掉历史图片只留文字（回归：修掉“This model does not support image”400）', () => {
    const c = toChatMessage(imgMsg(), false)
    expect(typeof c.content).toBe('string')
    expect(c.content).toBe('分析一下这个页面')
  })

  it('纯文本消息返回字符串内容', () => {
    const c = toChatMessage(textMsg('user', '你好'), false)
    expect(c.content).toBe('你好')
  })

  it('回传助手思考内容以支持 DeepSeek 跨轮工具调用', () => {
    const message: Message = {
      ...textMsg('assistant', '结论'),
      blocks: [{ kind: 'thinking', content: '完整思考内容' }]
    }
    expect(toChatMessage(message, false)).toMatchObject({
      role: 'assistant', content: '结论', reasoning_content: '完整思考内容'
    })
  })

  it('无文字的图片消息在非视觉请求下 content 为空字符串', () => {
    const m: Message = { ...imgMsg(), content: '' }
    expect(toChatMessage(m, false).content).toBe('')
  })
})

describe('injectDocuments', () => {
  it('文档文本追加到最后一条 user 消息', () => {
    const history: ChatMessage[] = [
      { role: 'system', content: 'sys' },
      { role: 'user', content: '问题' }
    ]
    injectDocuments(history, ['[文档：a.pdf]\n内容一'])
    const last = history[history.length - 1]
    expect(typeof last.content).toBe('string')
    if (typeof last.content === 'string') {
      expect(last.content).toContain('[文档：a.pdf]')
      expect(last.content).toContain('内容一')
    }
  })

  it('无 user 消息时追加一条 user 消息', () => {
    const history: ChatMessage[] = [{ role: 'system', content: 'sys' }]
    injectDocuments(history, ['内容'])
    expect(history[history.length - 1]).toEqual({ role: 'user', content: '内容' })
  })

  it('空文档文本不改变历史', () => {
    const history: ChatMessage[] = [{ role: 'user', content: 'q' }]
    injectDocuments(history, [])
    expect(history).toHaveLength(1)
  })
})

describe('context token budget', () => {
  it('estimates CJK more conservatively than ASCII', () => {
    expect(estimateTextTokens('中文中文')).toBeGreaterThan(estimateTextTokens('abcd'))
  })

  it('keeps the system prompt and newest messages under a constrained budget', () => {
    const history = [
      { role: 'system' as const, content: 'system' },
      { role: 'user' as const, content: 'old '.repeat(4_000) },
      { role: 'assistant' as const, content: 'old reply '.repeat(4_000) },
      { role: 'user' as const, content: 'new question' }
    ]
    const result = fitHistoryToTokenBudget(history, 8_000)
    expect(result[0]).toEqual(history[0])
    expect(result.at(-1)?.content).toBe('new question')
    expect(result.length).toBeLessThan(history.length)
  })
})
