import type { ChatMessage } from '../modelProvider'

export function composeSkillSystemPrompt(base: string, codingPrompt: string | undefined, skillPrompt: string): string {
  const interactionPrompt = skillPrompt.trim()
    ? 'Skill 需要用户作出选择或补充信息时，必须调用 request_user_input 并等待回答；不要把未回答的问题只写在正文里就结束。收到工具结果后，继续完成同一个 Skill 工作流。'
    : ''
  return [base, codingPrompt, interactionPrompt, skillPrompt]
    .filter((part): part is string => Boolean(part?.trim())).join('\n\n')
}

export function replaceActiveUserRequest(messages: ChatMessage[], activeRequest?: string): void {
  if (activeRequest === undefined) return
  const lastUser = [...messages].reverse().find((message) => message.role === 'user')
  if (lastUser && typeof lastUser.content === 'string') lastUser.content = activeRequest
}
