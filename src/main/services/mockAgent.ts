import { randomUUID } from 'crypto'
import type { Message, MessageBlock } from '@shared/types'

export interface MockStep {
  delayMs: number
  message: Message
}

/**
 * 本地 Mock：按设计稿「实现登录功能」示例，生成一条持续演进的 assistant 消息。
 * 消息 id 恒定，各阶段通过 upsert 刷新 blocks / status，渲染层按 id 合并即可呈现渐进式回复。
 */
export function buildMockReply(sessionId: string, options?: { id?: string; generationId?: string; startRevision?: number; timestamp?: number }): MockStep[] {
  const id = options?.id ?? randomUUID()
  const base: Pick<Message, 'id' | 'sessionId' | 'role'> = {
    id,
    sessionId,
    role: 'assistant'
  }

  const thinking: MessageBlock = {
    kind: 'thinking',
    content: '已深度思考：先确认登录链路的前后端边界，再决定验证码的存储方式。'
  }
  const opening: MessageBlock = {
    kind: 'text',
    content:
      '好的，我来帮你实现一个完整的手机号 + 验证码登录功能。这个功能包含前端Vue3 + Element Plus 和后端 FastAPI 的完整实现。'
  }
  const plan: MessageBlock = {
    kind: 'plan',
    items: [
      { order: 1, title: '设计数据库表结构', done: true },
      { order: 2, title: '实现后端 API 接口', done: true },
      { order: 3, title: '创建前端登录页面', done: true },
      { order: 4, title: '集成前后端接口', done: true },
      { order: 5, title: '测试登录功能', done: true }
    ]
  }
  const transition: MessageBlock = { kind: 'text', content: '开始实现...' }
  const files: MessageBlock = {
    kind: 'files',
    files: [
      { path: 'backend/main.py', addedLines: 156 },
      { path: 'backend/models/user.py', addedLines: 32 },
      { path: 'backend/routers/auth.py', addedLines: 89 },
      { path: 'frontend/src/views/Login.vue', addedLines: 243 },
      { path: 'frontend/src/api/auth.ts', addedLines: 45 },
      { path: 'frontend/src/utils/request.ts', addedLines: 67 }
    ]
  }
  const closing: MessageBlock = {
    kind: 'text',
    content:
      '登录功能已实现。数据库表、后端接口与前端页面均已创建，请运行 `uvicorn main:app --reload` 启动后端进行测试。'
  }

  const t = options?.timestamp ?? Date.now()
  const generation = options?.generationId
  const revision = options?.startRevision ?? 0
  const steps: MockStep[] = [
    {
      delayMs: 0,
      message: {
        ...base,
        content: '',
        blocks: [thinking],
        status: 'streaming',
        timestamp: t,
        generationId: generation,
        revision: revision + 1
      }
    },
    {
      delayMs: 700,
      message: {
        ...base,
        content: opening.content,
        blocks: [thinking, opening, plan],
        status: 'streaming',
        timestamp: t,
        generationId: generation,
        revision: revision + 2
      }
    },
    {
      delayMs: 1400,
      message: {
        ...base,
        content: opening.content,
        blocks: [thinking, opening, plan, transition, files],
        status: 'streaming',
        timestamp: t,
        generationId: generation,
        revision: revision + 3
      }
    },
    {
      delayMs: 2100,
      message: {
        ...base,
        content: closing.content,
        blocks: [thinking, opening, plan, transition, files, closing],
        status: 'done',
        timestamp: t,
        generationId: generation,
        revision: revision + 4,
        finishReason: 'completed'
      }
    }
  ]

  return steps
}
