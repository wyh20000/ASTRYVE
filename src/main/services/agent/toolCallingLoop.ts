import type { ToolResult } from '../../../shared/agent'
import {
  streamChatTurn,
  type ChatCompletionTurn,
  type ChatMessage,
  type RuntimeModel,
  type StreamChatOptions,
  type StreamEvent
} from '../modelProvider'
import { isTerminalToolFailureCode, type TaskRuntime } from './taskRuntime'
import type { ToolRegistry } from './toolRegistry'
import {
  REQUEST_USER_INPUT_TOOL,
  REQUEST_USER_INPUT_TOOL_NAME
} from './userInput'

// This is an emergency runaway fuse, not a normal task/product limit.
const DEFAULT_MAX_TOOL_ROUNDS = 64
const MAX_TOOL_RESULT_CONTENT_LENGTH = 200_000

type OnEvent = (event: StreamEvent) => void | Promise<void>
export interface ToolActivity {
  callId: string
  toolName: string
  args: unknown
  status: 'requested' | 'completed'
  ok?: boolean
  result?: unknown
}
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
  onToolActivity?: (activity: ToolActivity) => void | Promise<void>
  maxToolRounds?: number
  maxToolResultChars?: number
  runRound?: RunRound
  allowedToolNames?: ReadonlySet<string>
  requireInitialTool?: boolean
  requestUserInput?: (args: unknown) => Promise<ToolResult<unknown>>
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
  const maxToolResultChars = input.maxToolResultChars ?? 400_000
  if (!Number.isSafeInteger(maxRounds) || maxRounds <= 0 || maxRounds > 64) {
    throw new Error('工具调用轮数限制无效')
  }
  if (!Number.isSafeInteger(maxToolResultChars) || maxToolResultChars < 1_000 || maxToolResultChars > 2_000_000) {
    throw new Error('工具结果总预算无效')
  }

  const messages = [...input.messages]
  const tools = [
    ...input.taskRuntime.listNativeFunctionTools(input.taskId, input.allowedToolNames),
    ...(input.requestUserInput ? [REQUEST_USER_INPUT_TOOL] : [])
  ]
  const exposedToolNames = new Set(tools.map((tool) => tool.function.name))
  const runRound = input.runRound ?? streamChatTurn
  let acceptedToolResultChars = 0
  let hasUsedTool = false
  let requiredToolMisses = 0
  input.taskRuntime.startTask(input.taskId)
  const signal = input.taskRuntime.getTaskSignal(input.taskId)

  const forwardEvent = async (event: StreamEvent): Promise<void> => {
    if (event.reasoning) input.taskRuntime.appendOutput(input.taskId, 'reasoning', event.reasoning)
    if (event.content) input.taskRuntime.appendOutput(input.taskId, 'model', event.content)
    if (event.activity) input.taskRuntime.appendOutput(input.taskId, 'model', event.activity)
    if (!event.done) await input.onEvent(event)
  }

  try {
    for (let round = 1; round <= maxRounds; round += 1) {
      const requireTool = input.requireInitialTool !== false && tools.length > 0 && !hasUsedTool
      const bufferForUserInput = Boolean(input.requestUserInput)
      const bufferedEvents: StreamEvent[] = []
      const turn = await runRound(
        { ...input.model, signal },
        messages,
        async (event) => {
          if (requireTool || bufferForUserInput) bufferedEvents.push(event)
          else await forwardEvent(event)
        },
        {
          tools,
          // A Coding task must begin with observed project state. Later rounds
          // use auto so the model can stop calling tools and present findings.
          toolChoice: requireTool ? 'required' : tools.length > 0 ? 'auto' : 'none'
        }
      )
      messages.push(turn.message)
      const calls = turn.message.tool_calls ?? []
      const asksForUserInput = calls.some((call) =>
        call.type === 'function' && call.function.name === REQUEST_USER_INPUT_TOOL_NAME
      )
      if (requireTool && calls.length === 0) {
        requiredToolMisses += 1
        if (requiredToolMisses < 2) {
          messages.push({
            role: 'system',
            content: '上一条回复没有执行要求的原生工具，已被应用丢弃。不要输出命令或代码块；现在必须调用一个已提供的工具获取真实项目状态。'
          })
          continue
        }
        input.taskRuntime.failTask(input.taskId, 'model_ignored_required_tool')
        return {
          status: 'failed', rounds: round, messages,
          error: { code: 'MODEL_TOOL_CALL_REQUIRED', message: '当前模型未按要求调用 Coding 工具，请更换支持原生工具调用的模型' }
        }
      }
      if (requireTool) {
        hasUsedTool = true
      }
      if (!asksForUserInput) {
        for (const event of bufferedEvents) await forwardEvent(event)
      }
      if (calls.length === 0) {
        input.taskRuntime.completeTask(input.taskId)
        await input.onEvent({ done: true })
        return { status: 'completed', rounds: round, messages }
      }

      for (const call of calls) {
        let parsedArgs: unknown
        try { parsedArgs = JSON.parse(call.function.arguments) } catch { parsedArgs = undefined }
        const isUserInput = call.type === 'function' && call.function.name === REQUEST_USER_INPUT_TOOL_NAME
        if (!isUserInput) await input.onToolActivity?.({
          callId: call.id, toolName: call.function.name, args: parsedArgs, status: 'requested'
        })
        let result: ToolResult<unknown>
        if (isUserInput && input.requestUserInput) {
          try { result = await input.requestUserInput(parsedArgs) }
          catch (error) { result = { ok: false, error: { code: 'INVALID_USER_INPUT_REQUEST', message: String((error as Error)?.message ?? error) } } }
        } else {
          result = call.type !== 'function' || exposedToolNames.has(call.function.name)
            ? await input.taskRuntime.submitNativeToolCall(input.taskId, call)
            : { ok: false, error: { code: 'SKILL_TOOL_NOT_ALLOWED', message: '当前 Skill 未声明此工具，调用已阻止' } }
        }
        if (!isUserInput) await input.onToolActivity?.({
          callId: call.id, toolName: call.function.name, args: parsedArgs,
          status: 'completed', ok: result.ok,
          result: result.ok ? result.value : { error: result.error }
        })
        if (!result.ok && isTerminalToolFailureCode(result.error?.code)) {
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
        if (acceptedToolResultChars + content.length > maxToolResultChars) {
          input.taskRuntime.failTask(input.taskId, 'tool_result_budget_exceeded')
          return {
            status: 'failed', rounds: round, messages,
            error: { code: 'TOOL_RESULT_BUDGET', message: '本任务读取内容超过上下文预算，请缩小文件或行范围' }
          }
        }
        acceptedToolResultChars += content.length
        messages.push({
          role: 'tool',
          tool_call_id: call.id,
          name: call.function.name,
          content
        })
      }
    }

    // If the emergency fuse is ever reached, stop exposing tools and request a
    // final answer from the evidence already collected instead of surfacing a
    // technical round-limit error to the user.
    messages.push({
      role: 'system',
      content: '已完成大量项目检查。现在停止调用工具，请仅根据已获取的证据给出最终结论，并说明尚未覆盖的范围。'
    })
    const finalTurn = await runRound(
      { ...input.model, signal },
      messages,
      forwardEvent,
      { tools: [], toolChoice: 'none' }
    )
    messages.push(finalTurn.message)
    input.taskRuntime.completeTask(input.taskId)
    await input.onEvent({ done: true })
    return { status: 'completed', rounds: maxRounds + 1, messages }
  } catch (error) {
    input.taskRuntime.failTask(input.taskId, 'model_tool_loop_failed')
    throw error
  }
}

export interface RunInteractiveChatLoopInput {
  model: RuntimeModel
  messages: ChatMessage[]
  onEvent: OnEvent
  requestUserInput: (args: unknown) => Promise<ToolResult<unknown>>
  maxRounds?: number
  runRound?: RunRound
}

/** A small provider-native loop for non-project conversations that only exposes user interaction. */
export async function runInteractiveChatLoop(input: RunInteractiveChatLoopInput): Promise<void> {
  const messages = [...input.messages]
  const runRound = input.runRound ?? streamChatTurn
  const maxRounds = Math.max(1, Math.min(input.maxRounds ?? 16, 32))
  for (let round = 0; round < maxRounds; round += 1) {
    const bufferedEvents: StreamEvent[] = []
    const turn = await runRound(input.model, messages, (event) => {
      bufferedEvents.push(event)
    }, {
      tools: [REQUEST_USER_INPUT_TOOL],
      toolChoice: 'auto'
    })
    messages.push(turn.message)
    const calls = turn.message.tool_calls ?? []
    const asksForUserInput = calls.some((call) =>
      call.type === 'function' && call.function.name === REQUEST_USER_INPUT_TOOL_NAME
    )
    if (!asksForUserInput) {
      for (const event of bufferedEvents) await input.onEvent(event)
    }
    if (!calls.length) {
      await input.onEvent({ done: true })
      return
    }
    for (const call of calls) {
      let result: ToolResult<unknown>
      if (call.type !== 'function' || call.function.name !== REQUEST_USER_INPUT_TOOL_NAME) {
        result = { ok: false, error: { code: 'TOOL_NOT_AVAILABLE', message: '此对话只支持向用户提问' } }
      } else {
        try {
          result = await input.requestUserInput(JSON.parse(call.function.arguments))
        } catch (error) {
          result = { ok: false, error: { code: 'INVALID_USER_INPUT_REQUEST', message: String((error as Error)?.message ?? error) } }
        }
      }
      messages.push({
        role: 'tool',
        tool_call_id: call.id,
        name: call.function.name,
        content: JSON.stringify(result)
      })
    }
  }
  messages.push({ role: 'system', content: '停止继续提问；请根据已收到的回答给出当前结论。' })
  await runRound(input.model, messages, input.onEvent, { tools: [], toolChoice: 'none' })
  await input.onEvent({ done: true })
}

function serializeToolResult(result: ToolResult<unknown>): string | null {
  try {
    const content = JSON.stringify(result)
    return content.length <= MAX_TOOL_RESULT_CONTENT_LENGTH ? content : null
  } catch {
    return null
  }
}
