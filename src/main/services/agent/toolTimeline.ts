import type { MessageBlock } from '../../../shared/types'
import type { PatchManifest } from './patchWorkspaceService'

export interface ToolTimelineState {
  blocks: MessageBlock[]
  locations: Map<string, { blockIndex: number; itemIndex: number }>
  nextOrder: number
}

export function createToolTimeline(): ToolTimelineState {
  return { blocks: [], locations: new Map(), nextOrder: 1 }
}

export function appendToolTimelineText(state: ToolTimelineState, delta: string): void {
  if (!delta) return
  finishThinking(state)
  const last = state.blocks.at(-1)
  if (last?.kind === 'text') last.content += delta
  else state.blocks.push({ kind: 'text', content: delta })
}

export function appendToolTimelineThinking(state: ToolTimelineState, delta: string): void {
  if (!delta) return
  const last = state.blocks.at(-1)
  if (last?.kind === 'thinking' && !last.done) last.content += delta
  else state.blocks.push({ kind: 'thinking', content: delta })
}

export function updateToolTimeline(
  state: ToolTimelineState,
  callId: string,
  title: string,
  done: boolean
): void {
  const location = state.locations.get(callId)
  if (location) {
    const block = state.blocks[location.blockIndex]
    if (block?.kind === 'plan' && block.items[location.itemIndex]) {
      block.items[location.itemIndex] = { ...block.items[location.itemIndex], title, done }
    }
    return
  }
  finishThinking(state)
  let blockIndex = state.blocks.length - 1
  let block = state.blocks[blockIndex]
  if (!block || block.kind !== 'plan') {
    state.blocks.push({ kind: 'plan', items: [] })
    blockIndex = state.blocks.length - 1
    block = state.blocks[blockIndex]
  }
  if (block.kind !== 'plan') return
  const itemIndex = block.items.length
  block.items.push({ order: state.nextOrder++, title, done })
  state.locations.set(callId, { blockIndex, itemIndex })
}

export function resetToolTimeline(state: ToolTimelineState): void {
  state.blocks.length = 0
  state.locations.clear()
  state.nextOrder = 1
}

export function appendPatchTimeline(
  state: ToolTimelineState,
  taskId: string,
  manifest: PatchManifest,
  contents: Array<{ path: string; originalContent: string; modifiedContent: string }> = []
): void {
  finishThinking(state)
  const contentByPath = new Map(contents.map((content) => [content.path, content]))
  state.blocks.push({
    kind: 'diff', taskId, patchHash: manifest.patchHash,
    files: manifest.files.map(({ path, previousPath, status, linesAdded, linesDeleted, diff }) => ({
      path, previousPath, status, linesAdded, linesDeleted, diff, ...contentByPath.get(path)
    })),
    linesAdded: manifest.linesAdded, linesDeleted: manifest.linesDeleted
  })
}

export function appendCommandTimeline(
  state: ToolTimelineState,
  callId: string,
  input: { executable: string; args: string[] },
  result: { exitCode: number | null; durationMs: number; truncated: boolean; stdout: string; stderr: string }
): void {
  finishThinking(state)
  state.blocks.push({ kind: 'command', callId, executable: input.executable, args: [...input.args], ...result })
}

export function appendTaskReport(
  state: ToolTimelineState,
  approvals: Array<{ toolName: string; target: string }>,
  failure?: string
): void {
  finishThinking(state)
  const diffs = state.blocks.filter((block): block is Extract<MessageBlock, { kind: 'diff' }> => block.kind === 'diff')
  const commands = state.blocks.filter((block): block is Extract<MessageBlock, { kind: 'command' }> => block.kind === 'command')
  const plans = state.blocks.filter((block): block is Extract<MessageBlock, { kind: 'plan' }> => block.kind === 'plan')
  const lastDiff = diffs.at(-1)
  const unresolved = [
    ...(failure ? [failure] : []),
    ...commands.filter((command) => command.exitCode !== 0)
      .map((command) => `${command.executable} ${command.args.join(' ')} 退出码 ${command.exitCode ?? '未知'}`),
    ...plans.flatMap((plan) => plan.items).filter((item) => !item.done).map((item) => item.title)
  ]
  state.blocks.push({
    kind: 'report',
    files: lastDiff?.files.map((file) => ({ path: file.path, status: file.status })) ?? [],
    commands: commands.map((command) => ({
      command: `${command.executable} ${command.args.join(' ')}`.trim(),
      exitCode: command.exitCode, durationMs: command.durationMs
    })),
    tests: commands.filter((command) => /(?:test|typecheck|type-check|lint|build|check|verify)/i.test(command.args.join(' ')))
      .map((command) => ({ command: `${command.executable} ${command.args.join(' ')}`.trim(), passed: command.exitCode === 0 })),
    approvals: [...approvals],
    unresolved: [...new Set(unresolved)]
  })
}

/**
 * 结算最后一段思考。
 *
 * 消息结束时最后一段思考后面可能没有文本或工具块 —— 不补这一刀它就永远
 * 不会变成 `done`，界面上会一直停在「思考中」。
 */
export function settleToolTimeline(state: ToolTimelineState): void {
  finishThinking(state)
}

function finishThinking(state: ToolTimelineState): void {
  const last = state.blocks.at(-1)
  if (last?.kind === 'thinking') last.done = true
}
