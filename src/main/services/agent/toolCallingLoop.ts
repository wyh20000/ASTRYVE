import type { ToolResult } from '../../../shared/agent'
import {
  streamChatTurn,
  type ChatCompletionTurn,
  type ChatMessage,
  type RuntimeModel,
  type StreamChatOptions,
  type StreamEvent
} from '../modelProvider'
import type { TaskRuntime } from './taskRuntime'
import type { ToolRegistry } from './toolRegistry'

const DEFAULT_MAX_TOOL_ROUNDS = 8
const MAX_TOOL_RESULT_CONTENT_LENGTH = 200_000

type OnEvent = (event: StreamEvent) => void | Promise<void>
type RunRound = (
  runtime: RuntimeModel,
  messages: ChatMessage[],
  onEvent: OnEvent,
  options: StreamChatOptions
) => Promise<ChatCompletionTurn>

export interface RunToolCallingLoopInput {
  taskRuntime: TaskRuntime
  registry: ToolRegistry
  taskId: string
  model: RuntimeModel
  messages: ChatMessage[]
  onEvent: OnEvent
  maxToolRounds?: number
  runRound?: RunRound
}

export interface ToolCallingLoopResult {
  status: 'completed' | 'failed'
  rounds: number
  messages: ChatMessage[]
  error?: ToolResult<unknown>['error']
}

/**
 * Provider-native tool loop. It never parses assistant text for calls: only
 * `message.tool_calls` assembled from native streaming deltas enter TaskRuntime.
 */
export async function runToolCallingLoop(
  input: RunToolCallingLoopInput
): Promise<ToolCallingLoopResult> {
  const maxRounds = input.maxToolRounds ?? DEFAULT_MAX_TOOL_ROUNDS
  if (!Number.isSafeInteger(maxRounds) || maxRounds <= 0 || maxRounds > 64) {
    throw new Error('工具调用轮数限制无效')
  }

  const messages = [...input.messages]
  const tools = input.registry.listNativeFunctionTools()
  const runRound = input.runRound ?? streamChatTurn
  input.taskRuntime.startTask(input.taskId)
  const signal = input.taskRuntime.getTaskSignal(input.taskId)

  try {
    for (let round = 1; round <= maxRounds; round += 1) {
      const turn = await runRound(
        { ...input.model, signal },
        messages,
        async (event) => {
          if (event.reasoning) input.taskRuntime.appendOutput(input.taskId, 'reasoning', event.reasoning)
          if (event.content) input.taskRuntime.appendOutput(input.taskId, 'model', event.content)
          if (event.activity) input.taskRuntime.appendOutput(input.taskId, 'model', event.activity)
          if (!event.done) await input.onEvent(event)
        },
        { tools, toolChoice: tools.length > 0 ? 'auto' : 'none' }
      )
      messages.push(turn.message)
      const calls = turn.message.tool_calls ?? []
      if (calls.length === 0) {
        input.taskRuntime.completeTask(input.taskId)
        await input.onEvent({ done: true })
        return { status: 'completed', rounds: round, messages }
      }

      for (const call of calls) {
        const result = await input.taskRuntime.submitNativeToolCall(input.taskId, call)
        if (!result.ok) {
          return { status: 'failed', rounds: round, messages, error: result.error }
        }
        const content = serializeToolResult(result)
        if (!content) {
          input.taskRuntime.failTask(input.taskId, 'tool_result_too_large')
          return {
            status: 'failed',
            rounds: round,
            messages,
            error: { code: 'TOOL_RESULT_TOO_LARGE', message: '工具结果超过模型回传限制' }
          }
        }
        messages.push({
          role: 'tool',
          tool_call_id: call.id,
          name: call.function.name,
          content
        })
      }
    }

    input.taskRuntime.failTask(input.taskId, 'tool_round_limit')
    return {
      status: 'failed',
      rounds: maxRounds,
      messages,
      error: { code: 'TOOL_ROUND_LIMIT', message: '模型工具调用轮数超过限制' }
    }
  } catch (error) {
    input.taskRuntime.failTask(input.taskId, 'model_tool_loop_failed')
    throw error
  }
}

function serializeToolResult(result: ToolResult<unknown>): string | null {
  try {
    const content = JSON.stringify(result)
    return content.length <= MAX_TOOL_RESULT_CONTENT_LENGTH ? content : null
  } catch {
    return null
  }
}
