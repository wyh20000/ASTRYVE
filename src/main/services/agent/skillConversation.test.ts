import { afterEach, describe, expect, it, vi } from 'vitest'
import type { ChatMessage } from '../modelProvider'
import { streamChatTurn } from '../modelProvider'
import { composeSkillSystemPrompt, replaceActiveUserRequest } from './skillConversation'

afterEach(() => vi.unstubAllGlobals())

describe('Skill conversation integration', () => {
  it('puts verified Skill instructions in the system message and strips the slash prefix from the active user request', () => {
    const messages: ChatMessage[] = [
      { role: 'system', content: composeSkillSystemPrompt('core safety', 'coding rules', '<active-skill>grill</active-skill>') },
      { role: 'user', content: '/grill-me inspect this plan' }
    ]
    replaceActiveUserRequest(messages, 'inspect this plan')
    expect(messages[0].content).toContain('core safety\n\ncoding rules')
    expect(messages[0].content).toContain('必须调用 request_user_input')
    expect(messages[0].content).toContain('<active-skill>grill</active-skill>')
    expect(messages[1].content).toBe('inspect this plan')
  })

  it('sends the active Skill through the real DeepSeek request adapter', async () => {
    const messages: ChatMessage[] = [
      { role: 'system', content: composeSkillSystemPrompt('core safety', undefined,
        '<active-skill name="grill-me">Ask one hard question and wait.</active-skill>') },
      { role: 'user', content: '/grill-me inspect this plan' }
    ]
    replaceActiveUserRequest(messages, 'inspect this plan')
    const fetchMock = vi.fn(async (_url: string | URL, _init?: RequestInit) => new Response(
      'data: {"choices":[{"delta":{"content":"ok"},"finish_reason":"stop"}]}\n\ndata: [DONE]\n\n',
      { status: 200, headers: { 'content-type': 'text/event-stream' } }
    ))
    vi.stubGlobal('fetch', fetchMock)

    await streamChatTurn({
      provider: 'deepseek', baseUrl: 'https://api.deepseek.com', apiKey: 'test-key',
      model: 'deepseek-chat', reasoningEffort: 'medium', vision: false
    }, messages, () => undefined)

    const body = JSON.parse(String(fetchMock.mock.calls[0][1]?.body))
    expect(body.messages[0].content).toContain('<active-skill name="grill-me">')
    expect(body.messages[1].content).toBe('inspect this plan')
    expect(JSON.stringify(body)).not.toContain('/grill-me')
  })
})
