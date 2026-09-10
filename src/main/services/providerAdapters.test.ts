import { describe, expect, it } from 'vitest'
import type { NativeFunctionToolDefinition } from '@shared/agent'
import { createProviderToolBridge, getProviderAdapter } from './providerAdapters'

function tool(name: string): NativeFunctionToolDefinition {
  return {
    type: 'function',
    function: {
      name,
      description: `Tool ${name}`,
      parameters: { type: 'object', properties: {}, additionalProperties: false }
    }
  }
}

describe('provider tool bridge', () => {
  it('uses portable wire names and maps calls back to canonical policy names', () => {
    const bridge = createProviderToolBridge([
      tool('workspace.readFile'),
      tool('process.run')
    ], true)

    expect(bridge.tools.map((entry) => entry.function.name)).toEqual([
      'workspace_readFile',
      'process_run'
    ])
    expect(bridge.tools.every((entry) => /^[a-zA-Z0-9_-]{1,64}$/.test(entry.function.name))).toBe(true)
    expect(bridge.toCanonicalToolCall({
      id: 'call-1',
      type: 'function',
      function: { name: 'workspace_readFile', arguments: '{}' }
    }).function.name).toBe('workspace.readFile')
  })

  it('maps canonical names in follow-up assistant and tool messages', () => {
    const bridge = createProviderToolBridge([tool('workspace.readFile')], true)
    const messages = bridge.toProviderMessages([
      {
        role: 'assistant',
        content: null,
        reasoning_content: 'reasoning',
        tool_calls: [{
          id: 'call-1', type: 'function',
          function: { name: 'workspace.readFile', arguments: '{}' }
        }]
      },
      { role: 'tool', content: '{}', tool_call_id: 'call-1', name: 'workspace.readFile' }
    ])
    expect(messages[0].tool_calls?.[0].function.name).toBe('workspace_readFile')
    expect(messages[1].name).toBe('workspace_readFile')
    expect(messages[0].reasoning_content).toBe('reasoning')
  })

  it('keeps DeepSeek reasoning replay provider-specific', () => {
    const message = [{ role: 'assistant' as const, content: null, reasoning_content: 'secret trace' }]
    expect(getProviderAdapter('deepseek').createToolBridge([]).toProviderMessages(message)[0])
      .toHaveProperty('reasoning_content', 'secret trace')
    expect(getProviderAdapter('custom').createToolBridge([]).toProviderMessages(message)[0])
      .not.toHaveProperty('reasoning_content')
  })

  it('resolves collisions without changing canonical runtime identifiers', () => {
    const bridge = createProviderToolBridge([tool('a.b_c'), tool('a_b.c')], false)
    const names = bridge.tools.map((entry) => entry.function.name)
    expect(new Set(names).size).toBe(2)
    expect(names.every((name) => name.length <= 64)).toBe(true)
  })

  it('round-trips long plugin names and provider call ids', () => {
    const canonical = 'plugin.acme.browser-tools.inspect_dom'
    const bridge = createProviderToolBridge([tool(canonical)], false)
    const call = bridge.toCanonicalToolCall({
      id: 'deepseek-call-42', type: 'function',
      function: { name: bridge.tools[0].function.name, arguments: '{"path":"index.html"}' }
    })
    expect(call.id).toBe('deepseek-call-42')
    expect(call.function.name).toBe(canonical)
    const replay = bridge.toProviderMessages([
      { role: 'assistant', content: null, tool_calls: [call] },
      { role: 'tool', content: '{}', tool_call_id: call.id, name: canonical }
    ])
    expect(replay[0].tool_calls?.[0].id).toBe('deepseek-call-42')
    expect(replay[1].tool_call_id).toBe('deepseek-call-42')
  })
})
