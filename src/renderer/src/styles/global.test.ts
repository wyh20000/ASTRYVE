import fs from 'fs'
import path from 'path'
import { describe, expect, it } from 'vitest'
import { THEME_VAR_NAMES, resolveTheme, toCssVariables } from '../theme/applyTheme'

/**
 * 基础样式层的一致性测试。
 *
 * global.css 是首帧兜底与全局排版规范的唯一载体，
 * 它必须与 theme/applyTheme.ts 输出的变量清单保持同步，
 * 否则某个令牌会缺少静态兜底值（JS 未执行时解析为空）。
 */
const CSS_PATH = path.resolve(__dirname, 'global.css')
const css = fs.readFileSync(CSS_PATH, 'utf-8')

/** 取出 :root { ... } 中声明的变量名 */
function declaredRootVars(): Set<string> {
  const block = /:root\s*\{([\s\S]*?)\n\}/.exec(css)
  if (!block) throw new Error('global.css 缺少 :root 声明块')
  const names = new Set<string>()
  for (const match of block[1].matchAll(/(--[a-z0-9-]+)\s*:/g)) {
    names.add(match[1])
  }
  return names
}

describe('global.css 与令牌引擎保持同步', () => {
  it('theme/applyTheme 输出的每个变量都有静态兜底值', () => {
    const declared = declaredRootVars()
    const emitted = new Set(Object.values(THEME_VAR_NAMES))
    const missing = [...emitted].filter((name) => !declared.has(name))
    expect(missing, `global.css :root 缺少兜底变量: ${missing.join(', ')}`).toEqual([])
  })

  it('兜底值与深色默认令牌一致（首帧不会闪成别的配色）', () => {
    const block = /:root\s*\{([\s\S]*?)\n\}/.exec(css)![1]
    const vars = toCssVariables(resolveTheme({ mode: 'dark', isDark: true }))
    const read = (name: string): string | null => {
      const m = new RegExp(`${name}\\s*:\\s*([^;]+);`).exec(block)
      return m ? m[1].trim() : null
    }
    // 旧变量别名在 CSS 里是 var() 引用，这里只比对直接写色的语义令牌
    for (const name of ['--surface-app', '--surface-sidebar', '--surface-raised', '--accent']) {
      expect(read(name), `${name} 兜底值与令牌不一致`).toBe(vars[name])
    }
  })
})

describe('排版规范', () => {
  it('CSS 兜底字号为 14px，不再有 9~13px 的全局字号', () => {
    expect(css).toContain('--font-size-base: 14px;')
    expect(css).toContain('--line-height-base: 22px;')
    // 全局层（.markdown / .btn / .input / body）不得再出现小字号声明
    for (const size of [9, 10, 11, 12, 13]) {
      const matches = css.match(new RegExp(`font-size:\\s*${size}px`, 'g')) ?? []
      expect(matches, `global.css 仍有 font-size:${size}px`).toEqual([])
    }
  })

  it('字体栈以微软雅黑优先，等宽字体独立', () => {
    const sans = /--font-sans:\s*([^;]+);/.exec(css)?.[1] ?? ''
    const mono = /--font-mono:\s*([^;]+);/.exec(css)?.[1] ?? ''
    expect(sans.indexOf('Microsoft YaHei')).toBeLessThan(sans.indexOf('PingFang SC'))
    expect(mono).toContain('JetBrains Mono')
    expect(mono).not.toContain('Microsoft YaHei')
    // body 使用令牌而不是重新写一份字体栈
    expect(css).toMatch(/body\s*\{[\s\S]*?font-family:\s*var\(--font-sans\)/)
  })

  it('markdown 正文行高 1.65，代码块等宽且不小于 14px', () => {
    expect(css).toMatch(/\.markdown\s*\{[\s\S]*?font-size:\s*14px/)
    expect(css).toMatch(/\.markdown\s*\{[\s\S]*?line-height:\s*1\.65/)
    expect(css).toMatch(/\.markdown pre code\s*\{[\s\S]*?font-size:\s*14px/)
  })

  it('窄窗口通过间距折叠适配，而不是缩小字号', () => {
    const narrow = /@media \(max-width: 1500px\)\s*\{([\s\S]*?)\n\}/.exec(css)
    if (narrow) {
      expect(narrow[1]).not.toMatch(/font-size/)
    }
  })
})

describe('可访问性', () => {
  it('reduced-motion 全局压缩动效并关闭思考动画', () => {
    const block = /@media \(prefers-reduced-motion: reduce\)\s*\{([\s\S]*?)\n\}/.exec(css)
    expect(block, 'global.css 缺少 prefers-reduced-motion 处理').toBeTruthy()
    const body = block![1]
    expect(body).toMatch(/animation:\s*none/)
    expect(body).toMatch(/animation-duration:\s*0\.01ms/)
    expect(body).toMatch(/transition-duration:\s*0\.01ms/)
  })

  it('键盘焦点环使用 focus 令牌，且紧贴控件（offset 为 0）', () => {
    /*
     * 只断言不变式，不写死线宽：
     * - 必须使用 --border-focus 令牌（主题切换时焦点色跟随）；
     * - outline-offset 必须为 0（否则圆角控件上只露外缘，像多了一条边）。
     * 线宽曾经历 2px → 1px 的视觉调整，不应让测试锁死具体数值。
     */
    const focusBlock = /:where\(button, a\):focus-visible\s*\{([\s\S]*?)\}/.exec(css)
    expect(focusBlock, "缺少按钮/链接的 focus-visible 规则").not.toBeNull()
    const body = focusBlock![1]
    expect(body).toMatch(/outline:\s*\d+px solid var\(--border-focus\)/)
    expect(body).toMatch(/outline-offset:\s*0/)
  })

  it('Ant Design 按钮不再叠加 focus 阴影（避免聚焦态过重）', () => {
    expect(css).toMatch(/\.ant-btn:focus-visible[\s\S]{0,200}box-shadow:\s*none/)
  })

  it('可选中区域显式声明，正文默认不可选中（桌面应用语义）', () => {
    expect(css).toMatch(/body\s*\{[\s\S]*?user-select:\s*none/)
    expect(css).toMatch(/\.selectable\s*\{[\s\S]*?user-select:\s*text/)
  })
})
