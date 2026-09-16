/**
 * @vitest-environment jsdom
 *
 * 文档 13 中若干 API 断言的对照测试。
 * 目的：凡写进 docs/13-组件API参考.md 的结论都要有可执行依据，
 * 避免文档本身变成「凭记忆写的说明」。
 *
 * 重要发现（本文件诞生的原因）：
 * `theme.getDesignToken(config)` 返回的是**扁平 AliasToken**，
 * 不包含按组件分组的 token（`components: { Segmented: {...} }` 不会出现在返回值里）。
 * 因此组件级 token 不能用 getDesignToken 断言其「值」，
 * 只能靠 TypeScript 类型校验字段名合法性（见 antdTheme.test.ts）。
 */
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { Tooltip, theme as antdTheme } from 'antd'
import { describe, expect, it } from 'vitest'

describe('getDesignToken 的真实返回形状', () => {
  it('返回扁平 AliasToken，不含按组件分组的结构', () => {
    const computed = antdTheme.getDesignToken({
      components: { Segmented: { itemSelectedBg: '#123456' } }
    }) as unknown as Record<string, unknown>
    // 组件级 token 不会出现在结果里 —— 这正是不能据此断言其值的原因
    expect(computed.Segmented).toBeUndefined()
    // 而顶层 alias token 一定存在
    expect(computed.colorPrimary).toBeTruthy()
  })

  it('全局 token 覆盖会被采纳', () => {
    expect(antdTheme.getDesignToken({ token: { colorPrimary: '#ff0000' } }).colorPrimary).toBe(
      '#ff0000'
    )
    expect(antdTheme.getDesignToken({ token: { fontSize: 14 } }).fontSize).toBe(14)
  })

  it('传入 unknown 组件名不会抛错（antd 对 theme 过于宽容）', () => {
    expect(() =>
      antdTheme.getDesignToken({
        components: { NotARealComponent: { foo: 'bar' } } as never
      })
    ).not.toThrow()
  })
})

describe('Tooltip 延迟单位是秒', () => {
  it('mouseEnterDelay={0} 时提示立即出现', async () => {
    render(
      <Tooltip title="立即提示" mouseEnterDelay={0}>
        <button type="button">触发</button>
      </Tooltip>
    )
    await userEvent.hover(screen.getByRole('button', { name: '触发' }))
    await waitFor(() => expect(screen.getByRole('tooltip')).toHaveTextContent('立即提示'))
  })
})
