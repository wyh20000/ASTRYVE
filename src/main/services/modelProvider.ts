import type { ModelPreset, ReasoningEffort } from '@shared/types'

/** 多模态内容片段（文本 / 图片） */
export type ChatContentPart =
  | { type: 'text'; text: string }
  | { type: 'image_url'; image_url: { url: string } }

export interface ToolCall {
  id: string
  type: 'function'
  function: { name: string; arguments: string }
}

export interface ChatMessage {
  role: 'system' | 'user' | 'assistant' | 'tool'
  content: string | ChatContentPart[]
  tool_calls?: ToolCall[]
  tool_call_id?: string
  name?: string
}

export interface StreamEvent {
  reasoning?: string
  content?: string
  done?: boolean
}

type OnEvent = (ev: StreamEvent) => void | Promise<void>

export interface RuntimeModel {
  baseUrl: string
  apiKey: string
  model: string
  reasoningEffort?: ReasoningEffort
  /** 是否为视觉（图片）请求；为 true 时跳过 thinking/reasoning_effort（视觉模型通常不支持） */
  vision?: boolean
}

/** 调用 OpenAI 兼容流式接口（DeepSeek / Kimi 通用）。仅打印接口信息（模型/URL/状态/耗时），不打印 prompt 与响应内容。 */
export async function streamChat(
  runtime: RuntimeModel,
  messages: ChatMessage[],
  onEvent: OnEvent
): Promise<void> {
  const base = runtime.baseUrl.replace(/\/+$/, '')
  const started = Date.now()
  console.log('[model] request model=' + runtime.model + ' url=' + base)
  // 思考模式：三档都开启思考，强度不同：低→low / 中→high / 高→max。(DeepSeek 映射：medium/high→high，max→max)
  // 思考模式下不支持 temperature（会被忽略），故仅在未启用思考时携带。
  const body: Record<string, unknown> = { model: runtime.model, messages, stream: true }
  const e = runtime.reasoningEffort
  if (!runtime.vision) {
    if (e === 'low' || e === 'medium' || e === 'high') {
      body.thinking = { type: 'enabled' }
      body.reasoning_effort = e === 'low' ? 'low' : e === 'high' ? 'max' : 'high'
    } else {
      body.temperature = 0.7
    }
  }
  const res = await fetch(`${base}/chat/completions`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${runtime.apiKey}`
    },
    body: JSON.stringify(body)
  })
  console.log('[model] response status=' + res.status + ' elapse_ms=' + (Date.now() - started))

  if (!res.ok || !res.body) {
    const text = await res.text().catch(() => '')
    throw new Error(`模型请求失败 HTTP ${res.status}${text ? `（${text.slice(0, 120)}）` : ''}`)
  }

  const decoder = new TextDecoder()
  const reader = res.body.getReader()
  let buf = ''

  while (true) {
    const { done, value } = await reader.read()
    if (done) break
    buf += decoder.decode(value, { stream: true })
    const lines = buf.split('\n')
    buf = lines.pop() ?? ''
    for (const line of lines) {
      const trimmed = line.trim()
      if (!trimmed.startsWith('data:')) continue
      const payload = trimmed.slice(5).trim()
      if (payload === '[DONE]') {
        await onEvent({ done: true })
        continue
      }
      let json: any
      try {
        json = JSON.parse(payload)
      } catch {
        continue
      }
      const delta = json?.choices?.[0]?.delta
      if (!delta) continue
      if (typeof delta.reasoning_content === 'string' && delta.reasoning_content) {
        await onEvent({ reasoning: delta.reasoning_content })
      }
      if (typeof delta.content === 'string' && delta.content) {
        await onEvent({ content: delta.content })
      }
    }
  }
  console.log('[model] stream done, elapse_ms=' + (Date.now() - started))
  await onEvent({ done: true })
}

/** 联网搜索（Kimi 内置 $web_search）：两轮工具调用，第二轮流式输出最终答案 */
export async function streamSearchChat(
  runtime: RuntimeModel,
  messages: ChatMessage[],
  onEvent: OnEvent
): Promise<void> {
  const base = runtime.baseUrl.replace(/\/+$/, '')
  const started = Date.now()
  const headers = {
    'Content-Type': 'application/json',
    Authorization: `Bearer ${runtime.apiKey}`
  }
  const tools = [{ type: 'builtin_function', function: { name: '$web_search' } }]
  console.log('[model] search request model=' + runtime.model + ' url=' + base)

  const r1 = await fetch(`${base}/chat/completions`, {
    method: 'POST',
    headers,
    body: JSON.stringify({ model: runtime.model, messages, stream: false, tools })
  })
  if (!r1.ok) {
    const text = await r1.text().catch(() => '')
    throw new Error(`模型请求失败 HTTP ${r1.status}${text ? `（${text.slice(0, 120)}）` : ''}`)
  }
  const data1 = (await r1.json()) as {
    choices?: Array<{ message?: ChatMessage; finish_reason?: string | null }>
  }
  const msg1 = data1.choices?.[0]?.message
  const finish = data1.choices?.[0]?.finish_reason
  const toolCalls = msg1?.tool_calls

  if (finish !== 'tool_calls' || !msg1 || !toolCalls || toolCalls.length === 0) {
    const c = msg1 && typeof msg1.content === 'string' ? msg1.content : ''
    if (c) await onEvent({ content: c })
    await onEvent({ done: true })
    return
  }

  // 内置 $web_search：原样回传 arguments，检索由 Kimi 平台执行
  const toolMessages: ChatMessage[] = toolCalls.map((tc) => ({
    role: 'tool',
    tool_call_id: tc.id,
    name: tc.function.name,
    content: tc.function.name === '$web_search' ? (tc.function.arguments ?? '{}') : ''
  }))

  const r2 = await fetch(`${base}/chat/completions`, {
    method: 'POST',
    headers,
    body: JSON.stringify({
      model: runtime.model,
      messages: [...messages, msg1, ...toolMessages],
      stream: true,
      tools
    })
  })
  console.log('[model] search round2 status=' + r2.status)
  if (!r2.ok || !r2.body) {
    const text = await r2.text().catch(() => '')
    throw new Error(`模型请求失败 HTTP ${r2.status}${text ? `（${text.slice(0, 120)}）` : ''}`)
  }

  const decoder = new TextDecoder()
  const reader = r2.body.getReader()
  let buf = ''
  while (true) {
    const { done, value } = await reader.read()
    if (done) break
    buf += decoder.decode(value, { stream: true })
    const lines = buf.split('\n')
    buf = lines.pop() ?? ''
    for (const line of lines) {
      const t = line.trim()
      if (!t.startsWith('data:')) continue
      const payload = t.slice(5).trim()
      if (payload === '[DONE]') continue
      let json: any
      try {
        json = JSON.parse(payload)
      } catch {
        continue
      }
      const delta = json?.choices?.[0]?.delta
      if (!delta) continue
      if (typeof delta.reasoning_content === 'string' && delta.reasoning_content) {
        await onEvent({ reasoning: delta.reasoning_content })
      }
      if (typeof delta.content === 'string' && delta.content) {
        await onEvent({ content: delta.content })
      }
    }
  }
  console.log('[model] search done, elapse_ms=' + (Date.now() - started))
  await onEvent({ done: true })
}

/** 测试连通性：发一次最小请求。仅打印接口信息。 */
export async function testChat(
  preset: Pick<ModelPreset, 'baseUrl' | 'apiKey' | 'model'>
): Promise<{ success: boolean; message: string }> {
  if (!preset.apiKey || !preset.baseUrl || !preset.model) {
    return { success: false, message: '未配置模型（需 API Key / baseUrl / model）' }
  }
  const base = preset.baseUrl.replace(/\/+$/, '')
  try {
    const res = await fetch(`${base}/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${preset.apiKey}`
      },
      body: JSON.stringify({ model: preset.model, messages: [{ role: 'user', content: 'ping' }], stream: false, max_tokens: 5 })
    })
    console.log('[model] test status=' + res.status)
    if (!res.ok) {
      const text = await res.text().catch(() => '')
      return { success: false, message: `HTTP ${res.status}${text ? `（${text.slice(0, 120)}）` : ''}` }
    }
    return { success: true, message: '连接成功' }
  } catch (e) {
    console.warn('[model] test failed: ' + ((e as Error)?.message ?? '网络错误'))
    return { success: false, message: `连接失败：${(e as Error)?.message ?? '网络错误'}` }
  }
}
