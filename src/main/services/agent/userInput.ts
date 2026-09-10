import { randomUUID } from 'crypto'
import type { WebContents } from 'electron'
import type { NativeFunctionToolDefinition, ToolResult } from '../../../shared/agent'
import type { UserInputQuestion, UserInputRequest, UserInputResponse } from '../../../shared/types'
import { EVENTS } from '../../../shared/ipc'

export const REQUEST_USER_INPUT_TOOL_NAME = 'request_user_input'

export const REQUEST_USER_INPUT_TOOL: NativeFunctionToolDefinition = {
  type: 'function',
  function: {
    name: REQUEST_USER_INPUT_TOOL_NAME,
    description: 'Ask the user one to four focused questions and wait for their answers. Put choices only in options, not in the question text. Do not add A/B/C prefixes to labels. Mark the preferred choice with recommended: true. Use this instead of ending a response with unanswered questions.',
    parameters: {
      type: 'object',
      properties: {
        questions: {
          type: 'array',
          minItems: 1,
          maxItems: 4,
          items: {
            type: 'object',
            properties: {
              id: { type: 'string', description: 'Stable short identifier, for example q1 or runtime.' },
              header: { type: 'string', description: 'Optional short label.' },
              question: { type: 'string', description: 'The question only. Do not repeat or enumerate the choices here.' },
              options: {
                type: 'array',
                minItems: 2,
                maxItems: 7,
                items: {
                  type: 'object',
                  properties: {
                    label: { type: 'string', description: 'Choice text without an A/B/C prefix or recommendation marker.' },
                    description: { type: 'string' },
                    recommended: { type: 'boolean', description: 'True only for the choice recommended by the active Skill.' }
                  },
                  required: ['label'],
                  additionalProperties: false
                }
              }
            },
            required: ['id', 'question'],
            additionalProperties: false
          }
        }
      },
      required: ['questions'],
      additionalProperties: false
    }
  }
}

interface PendingInput {
  request: UserInputRequest
  ownerWebContentsId: number
  resolve: (value: ToolResult<unknown>) => void
  abort: () => void
}

const pending = new Map<string, PendingInput>()

export function requestUserInput(
  webContents: WebContents,
  sessionId: string,
  args: unknown,
  signal: AbortSignal
): Promise<ToolResult<unknown>> {
  const questions = validateQuestions(args)
  const request: UserInputRequest = { id: randomUUID(), sessionId, questions }
  return new Promise((resolve) => {
    const finish = (value: ToolResult<unknown>): void => {
      signal.removeEventListener('abort', abort)
      pending.delete(request.id)
      if (!webContents.isDestroyed()) webContents.send(EVENTS.userInputResolved, { id: request.id, sessionId })
      resolve(value)
    }
    const abort = (): void => finish({ ok: false, error: { code: 'TASK_CANCELLED', message: '用户已停止任务' } })
    pending.set(request.id, { request, ownerWebContentsId: webContents.id, resolve: finish, abort })
    signal.addEventListener('abort', abort, { once: true })
    if (signal.aborted) abort()
    else if (!webContents.isDestroyed()) webContents.send(EVENTS.userInputRequested, request)
  })
}

export function submitUserInput(input: UserInputResponse, senderId: number): boolean {
  if (!input || typeof input !== 'object' || typeof input.requestId !== 'string' ||
      typeof input.sessionId !== 'string' || !input.answers || typeof input.answers !== 'object') return false
  const item = pending.get(input.requestId)
  if (!item || item.ownerWebContentsId !== senderId || item.request.sessionId !== input.sessionId) return false
  const answers = item.request.questions.map((question) => ({
    id: question.id,
    answer: typeof input.answers[question.id] === 'string' ? input.answers[question.id].trim() : ''
  }))
  if (answers.some((answer) => !answer.answer)) return false
  item.resolve({ ok: true, value: { answers } })
  return true
}

function validateQuestions(args: unknown): UserInputQuestion[] {
  const raw = (args as { questions?: unknown })?.questions
  if (!Array.isArray(raw) || raw.length < 1 || raw.length > 4) throw new Error('交互问题数量必须为 1 到 4 个')
  const seen = new Set<string>()
  return raw.map((entry, index) => {
    if (!entry || typeof entry !== 'object') throw new Error(`第 ${index + 1} 个交互问题无效`)
    const value = entry as Record<string, unknown>
    const id = typeof value.id === 'string' ? value.id.trim().slice(0, 64) : ''
    const rawQuestion = typeof value.question === 'string' ? value.question.trim().slice(0, 1_000) : ''
    if (!id || !rawQuestion || seen.has(id)) throw new Error(`第 ${index + 1} 个交互问题缺少唯一 id 或正文`)
    seen.add(id)
    const normalizedOptions = Array.isArray(value.options) ? value.options.slice(0, 7).map((option, optionIndex) => {
      const item = option as Record<string, unknown>
      const rawLabel = typeof item?.label === 'string' ? item.label.trim().slice(0, 160) : ''
      const letter = /^([A-G])(?:[.)、:：]|\s)+/i.exec(rawLabel)
      const withoutLetter = rawLabel.replace(/^[A-G](?:[.)、:：]|\s)+\s*/i, '')
      const recommended = item?.recommended === true || RECOMMENDATION_MARKER.test(withoutLetter)
      return {
        option: {
          label: withoutLetter.replace(RECOMMENDATION_MARKERS, ' ').replace(/\s{2,}/g, ' ').trim(),
          description: typeof item?.description === 'string' ? item.description.trim().slice(0, 400) : undefined,
          recommended
        },
        order: letter ? letter[1].toUpperCase().charCodeAt(0) - 65 : undefined,
        optionIndex
      }
    }).filter((entry) => entry.option.label) : undefined
    normalizedOptions?.sort((left, right) => {
      if (left.order !== undefined && right.order !== undefined) return left.order - right.order || left.optionIndex - right.optionIndex
      if (left.order !== undefined) return -1
      if (right.order !== undefined) return 1
      return left.optionIndex - right.optionIndex
    })
    const options = normalizedOptions?.map((entry) => entry.option)
    return {
      id,
      question: removeRepeatedOptions(rawQuestion, options),
      header: typeof value.header === 'string' ? value.header.trim().slice(0, 80) : undefined,
      options: options && options.length >= 2 ? options : undefined
    }
  })
}

const RECOMMENDATION_MARKER = /(?:\((?:recommended|推荐)\)|（(?:recommended|推荐)）|\[(?:recommended|推荐)\]|【(?:recommended|推荐)】)/i
const RECOMMENDATION_MARKERS = /(?:\((?:recommended|推荐)\)|（(?:recommended|推荐)）|\[(?:recommended|推荐)\]|【(?:recommended|推荐)】)/gi

function removeRepeatedOptions(question: string, options: UserInputQuestion['options']): string {
  const questionMark = Math.max(question.indexOf('？'), question.indexOf('?'))
  if (questionMark < 0 || !options?.length) return question
  const suffix = question.slice(questionMark + 1)
  const enumerated = suffix.match(/(?:^|[\s；;。])(?:[A-G])(?:[.)、:：]|\s)+/gi)?.length ?? 0
  const repeatedLabels = options.filter((option) => option.label.length > 1 && suffix.includes(option.label)).length
  return enumerated >= 2 || repeatedLabels >= 2 ? question.slice(0, questionMark + 1).trim() : question
}
