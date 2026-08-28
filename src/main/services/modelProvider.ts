import type { ModelConfig } from '@shared/types'

export interface ChatMessage {
  role: 'system' | 'user' | 'assistant'
  content: string
}

export interface StreamEvent {
  reasoning?: string
  content?: string
  done?: boolean
}

type OnEvent = (ev: StreamEvent) => void | Promise<void>

/** 调用 OpenAI 兼容流式接口（DeepSeek / Kimi 通用）。仅打印接口信息（模型/URL/状态/耗时），不打印 prompt 与响应内容。 */
export async function streamChat(
  config: ModelConfig,
  messages: ChatMessage[],
  onEvent: OnEvent
): Promise<void> {
  const base = config.baseUrl.replace(/\/+$/, '')
  const started = Date.now()
  console.log('[model] request model=' + config.model + ' url=' + base)
  const res = await fetch(`${base}/chat/completions`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${config.apiKey}`
    },
    body: JSON.stringify({ model: config.model, messages, stream: true, temperature: 0.7 })
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

/** 测试连通性：发一次最小请求。仅打印接口信息。 */
export async function testChat(config: ModelConfig): Promise<{ success: boolean; message: string }> {
  if (!config.apiKey || !config.baseUrl || !config.model) {
    return { success: false, message: '未配置模型（需 API Key / baseUrl / model）' }
  }
  const base = config.baseUrl.replace(/\/+$/, '')
  try {
    const res = await fetch(`${base}/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${config.apiKey}`
      },
      body: JSON.stringify({ model: config.model, messages: [{ role: 'user', content: 'ping' }], stream: false, max_tokens: 5 })
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