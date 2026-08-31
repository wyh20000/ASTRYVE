import type { ModelPreset, ReasoningEffort, SourceCitation } from '@shared/types'
import { readSseStream } from './sse'
import {
  CONNECT_TIMEOUT_MESSAGE,
  REQUEST_TIMEOUT_MESSAGE,
  fetchWithRequestTimeout
} from './requestTimeout'

/** 多模态内容片段（文本 / 图片） */
export type ChatContentPart =
  | { type: 'text'; text: string }
  | { type: 'image_url'; image_url: { url: string } }

export interface ToolCall {
  id: string
  type: 'function' | 'builtin_function'
  function: { name: string; arguments: string }
}

export interface ChatMessage {
  role: 'system' | 'user' | 'assistant' | 'tool'
  content: string | ChatContentPart[] | null
  tool_calls?: ToolCall[]
  tool_call_id?: string
  name?: string
}

export interface StreamEvent {
  reasoning?: string
  content?: string
  sources?: SourceCitation[]
  activity?: string
  done?: boolean
}

type OnEvent = (ev: StreamEvent) => void | Promise<void>

export const MODEL_RESOURCE_ERROR = 'MODEL_INSUFFICIENT_SYSTEM_RESOURCE'
export { CONNECT_TIMEOUT_MESSAGE, REQUEST_TIMEOUT_MESSAGE }

/** Node fetch/undici 在服务端中途关闭流时常见的可重试错误。 */
export function isRetryableStreamError(error: unknown): boolean {
  const e = error as { message?: string; code?: string; cause?: { code?: string; message?: string } }
  const text = [e?.message, e?.code, e?.cause?.message, e?.cause?.code].filter(Boolean).join(' ').toLowerCase()
  return /terminated|fetch failed|econnreset|und_err_socket|socket|network connection|premature close/.test(text)
}

export interface RuntimeModel {
  baseUrl: string
  apiKey: string
  model: string
  reasoningEffort?: ReasoningEffort
  /** 是否为视觉（图片）请求；为 true 时跳过 thinking/reasoning_effort（视觉模型通常不支持） */
  vision?: boolean
  signal?: AbortSignal
}

async function handleChatCompletionEvent(payload: string, onEvent: OnEvent): Promise<void> {
  if (payload === '[DONE]') {
    await onEvent({ done: true })
    return
  }
  let json: any
  try {
    json = JSON.parse(payload)
  } catch {
    return
  }
  const choice = json?.choices?.[0]
  if (choice?.finish_reason === 'insufficient_system_resource') {
    throw new Error(MODEL_RESOURCE_ERROR)
  }
  const delta = choice?.delta
  if (!delta) return
  if (typeof delta.reasoning_content === 'string' && delta.reasoning_content) {
    await onEvent({ reasoning: delta.reasoning_content })
  }
  if (typeof delta.content === 'string' && delta.content) {
    await onEvent({ content: delta.content })
  }
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
  const request = await fetchWithRequestTimeout(`${base}/chat/completions`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${runtime.apiKey}`
    },
    body: JSON.stringify(body)
  }, runtime.signal)
  const res = request.response
  console.log('[model] response status=' + res.status + ' elapse_ms=' + (Date.now() - started))

  try {
    if (!res.ok || !res.body) {
      const text = await res.text().catch(() => '')
      throw new Error(`模型请求失败 HTTP ${res.status}${text ? `（${text.slice(0, 120)}）` : ''}`)
    }
    await readSseStream(res.body, ({ data }) => handleChatCompletionEvent(data, onEvent))
    console.log('[model] stream done, elapse_ms=' + (Date.now() - started))
    await onEvent({ done: true })
  } catch (error) {
    request.throwIfAborted()
    throw error
  } finally {
    request.dispose()
  }
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
  await onEvent({ activity: '正在联网检索…' })

  const request1 = await fetchWithRequestTimeout(`${base}/chat/completions`, {
    method: 'POST',
    headers,
    body: JSON.stringify({
      model: runtime.model,
      messages,
      stream: false,
      tools,
      thinking: { type: 'disabled' }
    })
  }, runtime.signal)
  const r1 = request1.response
  let data1: { choices?: Array<{ message?: ChatMessage; finish_reason?: string | null }> }
  try {
    if (!r1.ok) {
      const text = await r1.text().catch(() => '')
      throw new Error(`模型请求失败 HTTP ${r1.status}${text ? `（${text.slice(0, 120)}）` : ''}`)
    }
    data1 = (await r1.json()) as typeof data1
  } catch (error) {
    request1.throwIfAborted()
    throw error
  } finally {
    request1.dispose()
  }
  const msg1 = data1.choices?.[0]?.message
  const finish = data1.choices?.[0]?.finish_reason
  const toolCalls = msg1?.tool_calls

  if (finish !== 'tool_calls' || !msg1 || !toolCalls || toolCalls.length === 0) {
    const c = msg1 && typeof msg1.content === 'string' ? msg1.content : ''
    if (c) await onEvent({ content: c })
    await onEvent({ activity: '', done: true })
    return
  }

  // 内置 $web_search：原样回传 arguments，检索由 Kimi 平台执行
  const toolMessages: ChatMessage[] = toolCalls.map((tc) => ({
    role: 'tool',
    tool_call_id: tc.id,
    name: tc.function.name,
    content: tc.function.name === '$web_search' ? (tc.function.arguments ?? '{}') : ''
  }))

  const request2 = await fetchWithRequestTimeout(`${base}/chat/completions`, {
    method: 'POST',
    headers,
    body: JSON.stringify({
      model: runtime.model,
      messages: [...messages, msg1, ...toolMessages],
      stream: true,
      tools,
      thinking: { type: 'disabled' }
    })
  }, runtime.signal)
  const r2 = request2.response
  await onEvent({ activity: '正在整理检索结果…' })
  console.log('[model] search round2 status=' + r2.status)
  try {
    if (!r2.ok || !r2.body) {
      const text = await r2.text().catch(() => '')
      throw new Error(`模型请求失败 HTTP ${r2.status}${text ? `（${text.slice(0, 120)}）` : ''}`)
    }
    await readSseStream(r2.body, ({ data }) => handleChatCompletionEvent(data, onEvent))
    console.log('[model] search done, elapse_ms=' + (Date.now() - started))
    await onEvent({ activity: '', done: true })
  } catch (error) {
    request2.throwIfAborted()
    throw error
  } finally {
    request2.dispose()
  }
}

interface ResponsesAnnotation {
  type?: string
  url?: string
  title?: string
}

interface ResponsesOutputPart {
  annotations?: ResponsesAnnotation[]
}

interface ResponsesOutputItem {
  content?: ResponsesOutputPart[]
}

interface ResponsesCompletedBody {
  output?: ResponsesOutputItem[]
  error?: { message?: string } | null
}

function responseSources(response: ResponsesCompletedBody | undefined): SourceCitation[] {
  const seen = new Map<string, SourceCitation>()
  for (const item of response?.output ?? []) {
    for (const part of item.content ?? []) {
      for (const annotation of part.annotations ?? []) {
        if (annotation.type !== 'url_citation' || !annotation.url || seen.has(annotation.url)) continue
        seen.set(annotation.url, {
          title: annotation.title?.trim() || annotation.url,
          url: annotation.url
        })
      }
    }
  }
  return [...seen.values()].slice(0, 12)
}

function deepSeekResponsesUrl(baseUrl: string): string {
  const base = baseUrl.replace(/\/+$/, '')
  try {
    const url = new URL(base)
    if (url.hostname === 'api.deepseek.com' && url.pathname.replace(/\/+$/, '') === '/v1') {
      return `${url.origin}/responses`
    }
  } catch {
    // 自定义代理地址沿用用户配置的 base URL。
  }
  return `${base}/responses`
}

function responseInput(
  messages: ChatMessage[]
): Array<{ role: 'system' | 'user' | 'assistant'; content: string }> {
  return messages
    .filter(
      (message): message is ChatMessage & { role: 'system' | 'user' | 'assistant' } =>
        message.role !== 'tool'
    )
    .map((message) => ({
      role: message.role,
      content:
        typeof message.content === 'string'
          ? message.content
          : (message.content ?? [])
              .filter(
                (part): part is Extract<ChatContentPart, { type: 'text' }> => part.type === 'text'
              )
              .map((part) => part.text)
              .join('\n')
    }))
}

/** DeepSeek Responses API 内置 web_search；搜索与续推均由服务端完成。 */
export async function streamDeepSeekSearch(
  runtime: RuntimeModel,
  messages: ChatMessage[],
  onEvent: OnEvent
): Promise<void> {
  const endpoint = deepSeekResponsesUrl(runtime.baseUrl)
  const started = Date.now()
  const effort = runtime.reasoningEffort
  const reasoningEffort = effort === 'low' ? 'low' : effort === 'high' ? 'max' : 'high'
  console.log('[model] deepseek web search request model=' + runtime.model + ' url=' + endpoint)

  const request = await fetchWithRequestTimeout(endpoint, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${runtime.apiKey}`
    },
    body: JSON.stringify({
      model: runtime.model,
      input: responseInput(messages),
      stream: true,
      tools: [{ type: 'web_search' }],
      tool_choice: { type: 'web_search' },
      reasoning: { effort: reasoningEffort }
    })
  }, runtime.signal)
  const res = request.response
  console.log(
    '[model] deepseek web search status=' + res.status + ' elapse_ms=' + (Date.now() - started)
  )
  try {
    if (!res.ok || !res.body) {
      const body = await res.text().catch(() => '')
      throw new Error(`模型请求失败 HTTP ${res.status}${body ? `（${body.slice(0, 120)}）` : ''}`)
    }

    await readSseStream(res.body, async ({ data }) => {
      let event: {
        type?: string
        delta?: string
        response?: ResponsesCompletedBody
        error?: { message?: string }
      }
      try {
        event = JSON.parse(data)
      } catch {
        return
      }
      if (event.type === 'response.reasoning_text.delta' && event.delta) {
        await onEvent({ reasoning: event.delta })
      } else if (event.type === 'response.output_text.delta' && event.delta) {
        await onEvent({ content: event.delta })
      } else if (
        event.type === 'response.web_search_call.in_progress' ||
        event.type === 'response.web_search_call.searching'
      ) {
        await onEvent({ activity: '正在联网检索…' })
      } else if (event.type === 'response.web_search_call.completed') {
        await onEvent({ activity: '正在整理检索结果…' })
      } else if (event.type === 'response.completed') {
        const sources = responseSources(event.response)
        if (sources.length) await onEvent({ sources })
      } else if (event.type === 'response.incomplete' || event.type === 'response.failed') {
        const detail = event.error?.message ?? event.response?.error?.message ?? 'DeepSeek 联网响应未完成'
        throw new Error(detail)
      }
    })
    console.log('[model] deepseek web search done, elapse_ms=' + (Date.now() - started))
    await onEvent({ activity: '', done: true })
  } catch (error) {
    request.throwIfAborted()
    throw error
  } finally {
    request.dispose()
  }
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
    const request = await fetchWithRequestTimeout(`${base}/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${preset.apiKey}`
      },
      body: JSON.stringify({ model: preset.model, messages: [{ role: 'user', content: 'ping' }], stream: false, max_tokens: 5 })
    }, undefined, 10_000, 30_000)
    try {
      const res = request.response
      console.log('[model] test status=' + res.status)
      if (!res.ok) {
        const text = await res.text().catch(() => '')
        return { success: false, message: `HTTP ${res.status}${text ? `（${text.slice(0, 120)}）` : ''}` }
      }
      return { success: true, message: '连接成功' }
    } catch (error) {
      request.throwIfAborted()
      throw error
    } finally {
      request.dispose()
    }
  } catch (e) {
    console.warn('[model] test failed: ' + ((e as Error)?.message ?? '网络错误'))
    return { success: false, message: `连接失败：${(e as Error)?.message ?? '网络错误'}` }
  }
}
