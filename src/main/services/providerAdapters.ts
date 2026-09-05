import type { NativeFunctionToolDefinition } from '@shared/agent'
import type { ModelProvider, ReasoningEffort } from '@shared/types'

export interface ProviderToolCall {
  id: string
  type: 'function' | 'builtin_function'
  function: { name: string; arguments: string }
}

export interface ProviderChatMessage {
  role: 'system' | 'user' | 'assistant' | 'tool'
  content: unknown
  tool_calls?: ProviderToolCall[]
  tool_call_id?: string
  name?: string
  reasoning_content?: string
}

export interface ProviderToolBridge {
  tools: NativeFunctionToolDefinition[]
  toProviderMessages: (messages: ProviderChatMessage[]) => ProviderChatMessage[]
  toCanonicalToolCall: (call: ProviderToolCall) => ProviderToolCall
}

export interface ProviderAdapter {
  provider: ModelProvider
  createToolBridge: (tools: NativeFunctionToolDefinition[]) => ProviderToolBridge
  applyReasoning: (
    body: Record<string, unknown>,
    effort: ReasoningEffort | undefined,
    vision: boolean
  ) => void
}

const PROVIDER_FUNCTION_NAME = /^[a-zA-Z0-9_-]{1,64}$/

/**
 * Internal tool names are stable policy identifiers (for example
 * `workspace.readFile`). Provider-facing names use the conservative function
 * name subset shared by OpenAI-compatible APIs, then map back before entering
 * the trusted runtime.
 */
export function createProviderToolBridge(
  tools: NativeFunctionToolDefinition[],
  preserveReasoningContent: boolean
): ProviderToolBridge {
  const canonicalToWire = new Map<string, string>()
  const wireToCanonical = new Map<string, string>()

  for (const tool of tools) {
    const canonical = tool.function.name
    let base = canonical.replace(/[^a-zA-Z0-9_-]/g, '_') || 'tool'
    if (!/^[a-zA-Z0-9]/.test(base)) base = `tool_${base}`
    base = base.slice(0, 64)
    let wire = base
    let suffix = 2
    while (wireToCanonical.has(wire) && wireToCanonical.get(wire) !== canonical) {
      const tail = `_${suffix++}`
      wire = `${base.slice(0, 64 - tail.length)}${tail}`
    }
    if (!PROVIDER_FUNCTION_NAME.test(wire)) {
      throw new Error(`无法为工具生成兼容的提供方名称：${canonical}`)
    }
    canonicalToWire.set(canonical, wire)
    wireToCanonical.set(wire, canonical)
  }

  const mapCallToWire = (call: ProviderToolCall): ProviderToolCall => ({
    ...call,
    function: {
      ...call.function,
      name: canonicalToWire.get(call.function.name) ?? call.function.name
    }
  })

  return {
    tools: tools.map((tool) => ({
      ...tool,
      function: {
        ...tool.function,
        name: canonicalToWire.get(tool.function.name) ?? tool.function.name
      }
    })),
    toProviderMessages: (messages) => messages.map((message) => {
      const mapped: ProviderChatMessage = {
        ...message,
        tool_calls: message.tool_calls?.map(mapCallToWire),
        name: message.name ? (canonicalToWire.get(message.name) ?? message.name) : undefined
      }
      if (!preserveReasoningContent) delete mapped.reasoning_content
      return mapped
    }),
    toCanonicalToolCall: (call) => ({
      ...call,
      function: {
        ...call.function,
        name: wireToCanonical.get(call.function.name) ?? call.function.name
      }
    })
  }
}

function applyDeepSeekReasoning(
  body: Record<string, unknown>,
  effort: ReasoningEffort | undefined,
  vision: boolean
): void {
  if (vision) return
  if (effort === 'low' || effort === 'medium' || effort === 'high') {
    body.thinking = { type: 'enabled' }
    body.reasoning_effort = effort === 'low' ? 'low' : effort === 'high' ? 'max' : 'high'
  } else {
    body.temperature = 0.7
  }
}

function applyKimiReasoning(
  body: Record<string, unknown>,
  effort: ReasoningEffort | undefined,
  vision: boolean
): void {
  if (vision) return
  if (effort === 'low' || effort === 'medium' || effort === 'high') {
    body.thinking = { type: 'enabled' }
    body.reasoning_effort = effort === 'low' ? 'low' : effort === 'high' ? 'max' : 'high'
  } else {
    body.temperature = 0.7
  }
}

function applyCompatibleReasoning(
  body: Record<string, unknown>,
  effort: ReasoningEffort | undefined,
  vision: boolean
): void {
  if (vision) return
  if (effort) body.reasoning_effort = effort
  else body.temperature = 0.7
}

const adapters: Record<ModelProvider, ProviderAdapter> = {
  deepseek: {
    provider: 'deepseek',
    createToolBridge: (tools) => createProviderToolBridge(tools, true),
    applyReasoning: applyDeepSeekReasoning
  },
  kimi: {
    provider: 'kimi',
    createToolBridge: (tools) => createProviderToolBridge(tools, false),
    applyReasoning: applyKimiReasoning
  },
  custom: {
    provider: 'custom',
    createToolBridge: (tools) => createProviderToolBridge(tools, false),
    applyReasoning: applyCompatibleReasoning
  }
}

export function getProviderAdapter(provider: ModelProvider | undefined): ProviderAdapter {
  return adapters[provider ?? 'custom']
}
