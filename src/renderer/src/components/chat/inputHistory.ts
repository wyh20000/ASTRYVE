export interface InputHistoryState {
  index: number | null
  draft: string
}

export function stepInputHistory(
  history: string[],
  value: string,
  state: InputHistoryState,
  direction: 'previous' | 'next'
): { value: string; state: InputHistoryState } {
  if (!history.length) return { value, state }
  if (direction === 'previous') {
    const index = state.index === null
      ? history.length - 1
      : Math.max(0, state.index - 1)
    return {
      value: history[index],
      state: { index, draft: state.index === null ? value : state.draft }
    }
  }
  if (state.index === null) return { value, state }
  const index = state.index + 1
  if (index >= history.length) return { value: state.draft, state: { index: null, draft: state.draft } }
  return { value: history[index], state: { ...state, index } }
}
