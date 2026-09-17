/**
 * @vitest-environment jsdom
 *
 * 思考过程（`Think`）的行为约束 —— 都来自用户实测反馈：
 *
 * 1. **流式期间点开不能被自动收起**：原来「思考一结束就 `setOpen(false)`」，
 *    而思考段落随时可能被工具调用结束掉，表现为
 *    「点开有时看得到、有时看不到」；
 * 2. **点开的状态要能扛住块列表重建**：主进程每来一个 delta 就重拼一次
 *    `blocks`（末尾的 activity 思考块还会随 `ev.content` 消失、下一轮再出现），
 *    状态若放在块组件内部就会被重置成收起；
 * 3. **整行都可点**：`Think` 的状态行是 `width: fit-content`（
 *    `@ant-design/x/es/think/style/index.js:23`），可点区域只有图标+文字+箭头，
 *    点偏一点就没反应；
 * 4. **思考中只保留前置图标 360° 旋转**，不再叠 loading 圈与点点点。
 */
import { fireEvent, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it } from 'vitest'
import type { MessageBlock, MessageStatus } from '@shared/types'
import { Blocks } from './Blocks'

function renderBlocks(blocks: MessageBlock[], status: MessageStatus = 'done'): HTMLElement {
  return render(<Blocks blocks={blocks} status={status} />).container
}

function thinking(overrides: Partial<Extract<MessageBlock, { kind: 'thinking' }>> = {}): MessageBlock {
  return { kind: 'thinking', content: '先读取文件，再定位问题。', ...overrides }
}

/** 流式期间重新渲染（模拟主进程推来的新快照），面板展开状态必须保持 */
function rerenderBlocks(
  view: ReturnType<typeof render>,
  blocks: MessageBlock[],
  status: MessageStatus
): void {
  view.rerender(<Blocks blocks={blocks} status={status} />)
}

describe('思考面板：流式期间点开后不被自动收起', () => {
  it('思考段落结束后仍保持展开（用户点开的面板不被抢走）', async () => {
    const view = render(<Blocks blocks={[thinking()]} status="streaming" />)
    const toggle = screen.getByRole('button', { name: /思考/ })

    await userEvent.click(toggle)
    expect(toggle).toHaveAttribute('aria-expanded', 'true')
    expect(screen.getByText('先读取文件，再定位问题。')).toBeInTheDocument()

    // 下一段工具调用会把这段思考标记为 done（真实链路里的 finishThinking）
    rerenderBlocks(view, [thinking({ done: true })], 'streaming')
    expect(screen.getByRole('button', { name: /思考/ })).toHaveAttribute('aria-expanded', 'true')
    expect(screen.getByText('先读取文件，再定位问题。')).toBeInTheDocument()

    // 整条消息结束时也不收起
    rerenderBlocks(view, [thinking({ done: true })], 'done')
    expect(screen.getByRole('button', { name: /思考/ })).toHaveAttribute('aria-expanded', 'true')
    expect(screen.getByText('先读取文件，再定位问题。')).toBeInTheDocument()
  })

  it('流式内容继续增长时面板保持展开并显示新内容', async () => {
    const view = render(<Blocks blocks={[thinking({ content: '第一段' })]} status="streaming" />)
    await userEvent.click(screen.getByRole('button', { name: /思考/ }))

    rerenderBlocks(view, [thinking({ content: '第一段第二段' })], 'streaming')
    expect(screen.getByText('第一段第二段')).toBeInTheDocument()
  })

  it('用户主动收起后不会被再次自动展开', async () => {
    const view = render(<Blocks blocks={[thinking({ done: true })]} status="streaming" />)
    const toggle = screen.getByRole('button', { name: /思考/ })

    await userEvent.click(toggle)
    await userEvent.click(toggle)
    expect(toggle).toHaveAttribute('aria-expanded', 'false')

    rerenderBlocks(view, [thinking({ done: true })], 'done')
    expect(screen.getByRole('button', { name: /思考/ })).toHaveAttribute('aria-expanded', 'false')
  })

  it('后续追加计划/文本块时，已展开的思考面板不受影响', async () => {
    // 真实 Agent 轮的块序列：思考 → 计划 → 思考 → 文本，块是逐个追加的
    const view = render(<Blocks blocks={[thinking({ content: '第一段' })]} status="streaming" />)
    await userEvent.click(screen.getByRole('button', { name: /思考/ }))

    const plan: MessageBlock = { kind: 'plan', items: [{ order: 1, title: '读取文件', done: false }] }
    rerenderBlocks(view, [thinking({ content: '第一段', done: true }), plan], 'streaming')
    expect(screen.getByText('第一段')).toBeInTheDocument()

    rerenderBlocks(
      view,
      [thinking({ content: '第一段', done: true }), plan, { kind: 'text', content: '结论' }],
      'done'
    )
    expect(screen.getByText('第一段')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /思考/ })).toHaveAttribute('aria-expanded', 'true')
  })

  it('块列表前面插入块（下标整体后移）也不丢展开状态', async () => {
    const plan: MessageBlock = { kind: 'plan', items: [{ order: 1, title: '读取文件', done: true }] }
    const view = render(<Blocks blocks={[thinking({ content: '第一段' }), plan]} status="streaming" />)
    await userEvent.click(screen.getByRole('button', { name: /思考/ }))
    expect(screen.getByText('第一段')).toBeInTheDocument()

    // skills/plugins 这类块被插到最前面 → 思考块下标 0 → 1
    const skills: MessageBlock = {
      kind: 'skills',
      trigger: '/demo',
      skills: [{ name: 'demo', displayName: 'Demo', source: 'builtin' }]
    }
    rerenderBlocks(view, [skills, thinking({ content: '第一段' }), plan], 'streaming')
    expect(screen.getByRole('button', { name: /思考/ })).toHaveAttribute('aria-expanded', 'true')
    expect(screen.getByText('第一段')).toBeInTheDocument()
  })

  it('末尾的 activity 思考块消失又出现时，展开状态仍在', async () => {
    const first = thinking({ content: '第一段', done: true })
    const view = render(<Blocks blocks={[first, thinking({ content: '正在读取文件' })]} status="streaming" />)

    await userEvent.click(screen.getAllByRole('button', { name: /思考/ })[1])
    expect(screen.getByText('正在读取文件')).toBeInTheDocument()

    // ev.content 到达 → activity 清空 → 该块整块消失
    rerenderBlocks(view, [first], 'streaming')
    expect(screen.queryByText('正在读取文件')).not.toBeInTheDocument()

    // 下一个工具轮次 activity 再次出现
    rerenderBlocks(view, [first, thinking({ content: '正在运行命令' })], 'streaming')
    expect(screen.getByText('正在运行命令')).toBeInTheDocument()
  })
})

describe('思考面板：可见性只由展开状态决定，不等折叠动画', () => {
  /*
   * 真实窗口实测（Electron + 真实 DOM + 真实 CSS）：
   * `Think` 的折叠走 rc-motion 的高度动画 —— 点开后先给包装层写内联
   * `height: 0; opacity: 0`，再等**两帧 rAF** 才切到内容高度。
   * 流式期间渲染密集、rAF 被推迟（实测 300ms 只跑到 1 帧），
   * 这期间面板就是「箭头转了、内容被裁成 0 高度且全透明」——
   * 用户看到的是「展开了但里面空的」，而且 motionDeadline 只在
   * STEP_ACTIVE 才挂，这条链没跑完就**一直**空着。
   *
   * 所以约定：正文的挂载与可见性只跟着 `open` 走（同步 fireEvent 点击后
   * 立刻断言，不给动画任何机会），配套的 CSS 覆盖见 global.test.ts。
   */
  it('收起时正文不在 DOM 中，不依赖离场动画', () => {
    const container = renderBlocks([thinking()], 'streaming')
    expect(container.querySelector('.ant-think-content')).toBeNull()
    expect(screen.queryByText('先读取文件，再定位问题。')).not.toBeInTheDocument()
  })

  it('点击展开后正文立即出现，不必等动画的两帧 rAF', () => {
    const container = renderBlocks([thinking()], 'streaming')

    fireEvent.click(screen.getByRole('button', { name: /思考/ }))

    // 同步断言：此刻 rAF 一次都还没跑
    expect(screen.getByText('先读取文件，再定位问题。')).toBeInTheDocument()
    // 根节点带 .thinking-panel，CSS 才能把展开态从 height:0 里救回来
    expect(container.querySelector('.thinking-panel')).not.toBeNull()
  })

  it('点击收起后正文立即从 DOM 消失', () => {
    renderBlocks([thinking()], 'streaming')

    fireEvent.click(screen.getByRole('button', { name: /思考/ }))
    expect(screen.getByText('先读取文件，再定位问题。')).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: /思考/ }))
    expect(screen.queryByText('先读取文件，再定位问题。')).not.toBeInTheDocument()
  })
})

describe('思考面板：只保留前置图标旋转', () => {
  it('思考中的根节点带旋转类，且不再渲染 loading 与点点点', () => {
    const container = renderBlocks([thinking()], 'streaming')

    // 旋转动画挂在根节点的类上，选中 Think 自己的前置图标
    expect(container.querySelector('.thinking-streaming')).not.toBeNull()
    // 点点点与 loading 圈都被移除，只留一个动效元素
    expect(container.querySelector('.thinking-dots')).toBeNull()
    expect(container.querySelector('.anticon-loading')).toBeNull()
    expect(container.querySelector('.ant-think-status-icon .anticon-loading')).toBeNull()
  })

  it('思考结束后不再有旋转与闪烁', () => {
    const container = renderBlocks([thinking({ done: true })], 'done')

    expect(container.querySelector('.thinking-streaming')).toBeNull()
    expect(container.querySelector('.ant-think-motion-blink')).toBeNull()
  })
})
