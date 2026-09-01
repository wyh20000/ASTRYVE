import { describe, expect, it } from 'vitest'
import { NativeToolCallError, parseNativeFunctionToolCall } from './nativeToolCall'

function nativeCall(argumentsValue = '{"path":"README.md"}') {
  return {
    type: 'function',
    id: 'call-1',
    function: { name: 'workspace.readFile', arguments: argumentsValue }
  }
}

function expectNativeError(action: () => unknown, code: NativeToolCallError['code']): void {
  let caught: unknown
  try {
    action()
  } catch (error) {
    caught = error
  }
  expect(caught).toBeInstanceOf(NativeToolCallError)
  expect((caught as NativeToolCallError).code).toBe(code)
}

describe('parseNativeFunctionToolCall', () => {
  it('accepts only explicit native function calls', () => {
    expect(parseNativeFunctionToolCall(nativeCall())).toEqual({
      callId: 'call-1',
      toolName: 'workspace.readFile',
      args: { path: 'README.md' }
    })

    for (const value of [
      '```json\n{"type":"function"}\n```',
      '{"type":"function"}',
      { type: 'builtin_function', id: 'call-1', function: { name: 'workspace.readFile', arguments: '{}' } },
      { type: 'function', id: 'call-1', function: { name: 'workspace.readFile', arguments: {} } }
    ]) {
      expect(() => parseNativeFunctionToolCall(value)).toThrow(NativeToolCallError)
    }
  })

  it('rejects invalid JSON and unsafe argument values before tools are reached', () => {
    expectNativeError(() => parseNativeFunctionToolCall(nativeCall('{invalid')), 'INVALID_JSON')

    let deep: Record<string, unknown> = {}
    const root = deep
    for (let index = 0; index < 20; index += 1) {
      deep.next = {}
      deep = deep.next as Record<string, unknown>
    }
    expectNativeError(
      () => parseNativeFunctionToolCall(nativeCall(JSON.stringify(root))),
      'UNSAFE_ARGUMENTS'
    )

    expectNativeError(
      () => parseNativeFunctionToolCall(nativeCall(JSON.stringify(Array.from({ length: 10_001 }, () => 0)))),
      'UNSAFE_ARGUMENTS'
    )
    expectNativeError(
      () => parseNativeFunctionToolCall(nativeCall(`{"value":"${'x'.repeat(100_001)}"}`)),
      'UNSAFE_ARGUMENTS'
    )
  })
})
