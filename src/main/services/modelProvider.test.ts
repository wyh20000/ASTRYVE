import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  isRetryableStreamError,
  streamChatTurn,
  streamDeepSeekSearch,
  streamSearchChat
} from './modelProvider'

function sseResponse(lines: string[]): Response {
  const encoder = new TextEncoder()
  return new Response(
    new ReadableStream({
      start(controller) {
        for (const line of lines) controller.enqueue(encoder.encode(`${line}\n\n`))
        controller.close()
      }
    }),
    { status: 200, headers: { 'Content-Type': 'text/event-stream' } }
  )
}

afterEach(() => vi.unstubAllGlobals())

describe('isRetryableStreamError', () => {
  it.each([
    new TypeError('terminated'),
    new TypeError('fetch failed', { cause: { code: 'UND_ERR_SOCKET' } }),
    Object.assign(new Error('socket closed'), { code: 'ECONNRESET' })
  ])('识别可重试的流中断：%s', (error) => {
    expect(isRetryableStreamError(error)).toBe(true)
  })

  it.each([new Error('HTTP 401'), new Error('HTTP 400'), new Error('invalid request')])(
    '不重试配置或请求错误：%s',
    (error) => {
      expect(isRetryableStreamError(error)).toBe(false)
    }
  )
})

describe('streamChatTurn', () => {
  it('assembles only provider-native streamed function calls and sends closed schemas', async () => {
    const fetchMock = vi.fn().mockResolvedValueOnce(
      sseResponse([
        'data: {"choices":[{"delta":{"tool_calls":[{"index":0,"id":"call-","type":"function","function":{"name":"workspace_","arguments":"{\\"path\\":"}}]},"finish_reason":null}]}',
        'data: {"choices":[{"delta":{"tool_calls":[{"index":0,"id":"1","function":{"name":"readFile","arguments":"\\"README.md\\"}"}}]},"finish_reason":"tool_calls"}]}',
        'data: [DONE]'
      ])
    )
    vi.stubGlobal('fetch', fetchMock)
    const tools = [{
      type: 'function' as const,
      function: {
        name: 'workspace.readFile',
        description: 'Read a file',
        parameters: {
          type: 'object' as const,
          properties: { path: { type: 'string' } },
          required: ['path'],
          additionalProperties: false as const
        }
      }
    }]

    const turn = await streamChatTurn(
      { baseUrl: 'https://api.example.com/v1', apiKey: 'key', model: 'model' },
      [{ role: 'user', content: '读取 README' }],
      () => undefined,
      { tools }
    )

    expect(turn).toEqual({
      message: {
        role: 'assistant',
        content: null,
        tool_calls: [{
          id: 'call-1',
          type: 'function',
          function: { name: 'workspace.readFile', arguments: '{"path":"README.md"}' }
        }]
      },
      finishReason: 'tool_calls'
    })
    const body = JSON.parse(String(fetchMock.mock.calls[0][1]?.body))
    expect(body.tools).toEqual([{
      ...tools[0],
      function: { ...tools[0].function, name: 'workspace_readFile' }
    }])
    expect(body.tool_choice).toBe('auto')
  })

  it('replays DeepSeek reasoning content and keeps canonical tool names inside the app', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(sseResponse([
        'data: {"choices":[{"delta":{"reasoning_content":"先读取文件"},"finish_reason":null}]}',
        'data: {"choices":[{"delta":{"tool_calls":[{"index":0,"id":"call-1","type":"function","function":{"name":"workspace_readFile","arguments":"{\\"path\\":\\"README.md\\"}"}}]},"finish_reason":"tool_calls"}]}',
        'data: [DONE]'
      ]))
      .mockResolvedValueOnce(sseResponse([
        'data: {"choices":[{"delta":{"content":"读取完成"},"finish_reason":"stop"}]}',
        'data: [DONE]'
      ]))
    vi.stubGlobal('fetch', fetchMock)
    const tools = [{
      type: 'function' as const,
      function: {
        name: 'workspace.readFile',
        description: 'Read a file',
        parameters: {
          type: 'object' as const,
          properties: { path: { type: 'string' } },
          required: ['path'],
          additionalProperties: false as const
        }
      }
    }]

    const first = await streamChatTurn(
      { provider: 'deepseek', baseUrl: 'https://api.deepseek.com/v1', apiKey: 'key', model: 'deepseek-v4-pro', reasoningEffort: 'high' },
      [{ role: 'user', content: '读取 README' }],
      () => undefined,
      { tools }
    )
    expect(first.message).toMatchObject({
      reasoning_content: '先读取文件',
      tool_calls: [{ function: { name: 'workspace.readFile' } }]
    })

    await streamChatTurn(
      { provider: 'deepseek', baseUrl: 'https://api.deepseek.com/v1', apiKey: 'key', model: 'deepseek-v4-pro', reasoningEffort: 'high' },
      [
        { role: 'user', content: '读取 README' },
        first.message,
        { role: 'tool', tool_call_id: 'call-1', name: 'workspace.readFile', content: '{"ok":true}' }
      ],
      () => undefined,
      { tools }
    )

    const secondBody = JSON.parse(String(fetchMock.mock.calls[1][1]?.body))
    expect(secondBody.messages[1]).toMatchObject({
      reasoning_content: '先读取文件',
      tool_calls: [{ function: { name: 'workspace_readFile' } }]
    })
    expect(secondBody.messages[2].name).toBe('workspace_readFile')
  })

  it('rejects malformed native tool-call deltas instead of inspecting text', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValueOnce(
      sseResponse([
        'data: {"choices":[{"delta":{"content":"```json {\\"type\\":\\"function\\"} ```"},"finish_reason":null}]}',
        'data: {"choices":[{"delta":{"tool_calls":{"index":0}},"finish_reason":"tool_calls"}]}'
      ])
    ))
    await expect(streamChatTurn(
      { baseUrl: 'https://api.example.com/v1', apiKey: 'key', model: 'model' },
      [{ role: 'user', content: 'test' }],
      () => undefined
    )).rejects.toThrow('无效的原生工具调用')
  })
})

describe('streamSearchChat', () => {
  it('完成 $web_search 两轮闭环并禁用思考模式', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            choices: [
              {
                finish_reason: 'tool_calls',
                message: {
                  role: 'assistant',
                  content: null,
                  tool_calls: [
                    {
                      id: 'call-1',
                      type: 'builtin_function',
                      function: {
                        name: '$web_search',
                        arguments: '{"query":"最新消息","usage":{"total_tokens":42}}'
                      }
                    }
                  ]
                }
              }
            ]
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } }
        )
      )
      .mockResolvedValueOnce(
        sseResponse([
          'data: {"choices":[{"delta":{"content":"结果见 [官方](https://example.com/news)"},"finish_reason":null}]}',
          'data: [DONE]'
        ])
      )
    vi.stubGlobal('fetch', fetchMock)
    let content = ''

    await streamSearchChat(
      { baseUrl: 'https://api.example.com/v1', apiKey: 'key', model: 'kimi-k2.6' },
      [{ role: 'user', content: '查询最新消息' }],
      (event) => {
        content += event.content ?? ''
      }
    )

    expect(content).toContain('https://example.com/news')
    expect(fetchMock).toHaveBeenCalledTimes(2)
    const firstBody = JSON.parse(String(fetchMock.mock.calls[0][1]?.body))
    const secondBody = JSON.parse(String(fetchMock.mock.calls[1][1]?.body))
    expect(firstBody.tools[0]).toEqual({
      type: 'builtin_function',
      function: { name: '$web_search' }
    })
    expect(firstBody.thinking).toEqual({ type: 'disabled' })
    expect(secondBody.thinking).toEqual({ type: 'disabled' })
    expect(secondBody.messages.at(-1)).toMatchObject({
      role: 'tool',
      tool_call_id: 'call-1',
      name: '$web_search',
      content: '{"query":"最新消息","usage":{"total_tokens":42}}'
    })
  })

  it('模型未触发工具时直接返回首轮答案', async () => {
    const fetchMock = vi.fn().mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          choices: [{ finish_reason: 'stop', message: { role: 'assistant', content: '无需搜索' } }]
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } }
      )
    )
    vi.stubGlobal('fetch', fetchMock)
    const events: string[] = []
    await streamSearchChat(
      { baseUrl: 'https://api.example.com/v1', apiKey: 'key', model: 'kimi-k2.6' },
      [{ role: 'user', content: '你好' }],
      (event) => {
        if (event.content) events.push(event.content)
      }
    )
    expect(events).toEqual(['无需搜索'])
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })
})

describe('streamDeepSeekSearch', () => {
  it('通过 Responses API 强制 web_search 并解析流式正文、思考和引用', async () => {
    const fetchMock = vi.fn().mockResolvedValueOnce(
      sseResponse([
        'event: response.reasoning_text.delta',
        'data: {"type":"response.reasoning_text.delta","delta":"正在检索"}',
        '',
        'event: response.web_search_call.searching',
        'data: {"type":"response.web_search_call.searching"}',
        '',
        'event: response.output_text.delta',
        'data: {"type":"response.output_text.delta","delta":"搜索结果"}',
        '',
        'event: response.completed',
        'data: {"type":"response.completed","response":{"output":[{"content":[{"annotations":[{"type":"url_citation","title":"官方来源","url":"https://example.com/source"}]}]}]}}',
        ''
      ])
    )
    vi.stubGlobal('fetch', fetchMock)
    const events: Array<{ reasoning?: string; content?: string; sources?: unknown[]; done?: boolean }> = []

    await streamDeepSeekSearch(
      {
        baseUrl: 'https://api.deepseek.com/v1',
        apiKey: 'key',
        model: 'deepseek-v4-pro',
        reasoningEffort: 'high'
      },
      [
        { role: 'system', content: '请给出处' },
        { role: 'user', content: '今天的新闻' }
      ],
      (event) => {
        events.push(event)
      }
    )

    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(fetchMock.mock.calls[0][0]).toBe('https://api.deepseek.com/responses')
    const body = JSON.parse(String(fetchMock.mock.calls[0][1]?.body))
    expect(body).toMatchObject({
      model: 'deepseek-v4-pro',
      stream: true,
      tools: [{ type: 'web_search' }],
      tool_choice: { type: 'web_search' },
      reasoning: { effort: 'max' }
    })
    expect(body.input).toEqual([
      { role: 'system', content: '请给出处' },
      { role: 'user', content: '今天的新闻' }
    ])
    expect(events).toContainEqual({ reasoning: '正在检索' })
    expect(events).toContainEqual({ activity: '正在联网检索…' })
    expect(events).toContainEqual({ content: '搜索结果' })
    expect(events).toContainEqual({
      sources: [{ title: '官方来源', url: 'https://example.com/source' }]
    })
    expect(events.at(-1)).toEqual({ activity: '', done: true })
  })

  it('将 Responses API 的失败事件转为异常，以便上层降级普通回答', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValueOnce(
        sseResponse([
          'data: {"type":"response.failed","response":{"error":{"message":"search unavailable"}}}'
        ])
      )
    )
    await expect(
      streamDeepSeekSearch(
        { baseUrl: 'https://proxy.example.com/v1', apiKey: 'key', model: 'deepseek-v4-pro' },
        [{ role: 'user', content: '搜索' }],
        () => undefined
      )
    ).rejects.toThrow('search unavailable')
  })
})
