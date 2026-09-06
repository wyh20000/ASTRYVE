import type { MessageBlock } from '../../../shared/types'

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
  const last = state.blocks.at(-1)
  if (last?.kind === 'text') last.content += delta
  else state.blocks.push({ kind: 'text', content: delta })
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
