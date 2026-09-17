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
/** 渲染层源码根目录，用于「旧别名是否还有引用」这类跨文件检查 */
const RENDERER_ROOT = path.resolve(__dirname, '..')

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
    for (const name of ['--surface-app', '--surface-sidebar', '--surface-raised', '--accent']) {
      expect(read(name), `${name} 兜底值与令牌不一致`).toBe(vars[name])
    }
  })

  it('阶段 A 的兼容别名已彻底清理（CSS、令牌引擎与渲染层都不再引用）', () => {
    /*
     * 阶段 E 的完成条件之一是「不再保留兼容别名」。
     * 只检查 applyTheme 是不够的：只要有一个组件还在读 --bg-app，
     * 别名就不能删。因此这里扫描整个 renderer 源码（跳过测试文件自身）。
     */
    const legacy = /--bg-(app|panel|raised|active)\b|--(ok|warn|err)\b|--border(?![-\w])/
    const offenders: string[] = []
    const walk = (directory: string): void => {
      for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
        const target = path.join(directory, entry.name)
        if (entry.isDirectory()) {
          walk(target)
          continue
        }
        if (!/\.(ts|tsx|css)$/.test(entry.name) || /\.test\.tsx?$/.test(entry.name)) continue
        for (const line of fs.readFileSync(target, 'utf-8').split('\n')) {
          const trimmed = line.trim()
          // 注释里说明「这些别名已删除」是允许的，只拦真正的引用
          if (trimmed.startsWith('*') || trimmed.startsWith('//') || trimmed.startsWith('/*')) continue
          if (legacy.test(line)) offenders.push(`${path.relative(RENDERER_ROOT, target)}: ${trimmed}`)
        }
      }
    }
    walk(RENDERER_ROOT)
    expect(offenders, `仍在引用旧变量别名:\n${offenders.join('\n')}`).toEqual([])
  })

  it('阶段 A 的工具类 .btn / .btn-icon / .input 已从样式层删除', () => {
    // 精确到「选择器」：.input 会命中 antd 的 .ant-input，因此要求前面是分隔符
    for (const selector of ['btn', 'btn-icon', 'input']) {
      const defined = new RegExp(`(^|[\\s,}}])\\.${selector}\\s*\\{`, 'm')
      expect(defined.test(css), `global.css 仍定义 .${selector}`).toBe(false)
    }
    // .chip 仍是活的（AgentControls / WorkspacePicker 在用），保留是有意为之
    expect(css).toMatch(/(^|[\s,}])\.chip\s*\{/m)
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
    // 行内代码同样不得缩小（改造前是 0.9em ≈ 12.6px）
    expect(css).toMatch(/\.markdown code\s*\{[\s\S]*?font-size:\s*14px/)
    expect(css).not.toMatch(/font-size:\s*0\.\d+em/)
  })

  it('窄窗口通过间距折叠适配，而不是缩小字号', () => {
    const narrow = /@media \(max-width: 1500px\)\s*\{([\s\S]*?)\n\}/.exec(css)
    if (narrow) {
      expect(narrow[1]).not.toMatch(/font-size/)
    }
  })
})

describe('可访问性', () => {
  it('强调色实心控件使用真实存在的对比文字工具类', () => {
    const offenders: string[] = []
    const walk = (directory: string): void => {
      for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
        const target = path.join(directory, entry.name)
        if (entry.isDirectory()) {
          walk(target)
          continue
        }
        if (!/\.tsx?$/.test(entry.name) || /\.test\.tsx?$/.test(entry.name)) continue
        if (fs.readFileSync(target, 'utf-8').includes('text-accent-contrast-text')) {
          offenders.push(path.relative(RENDERER_ROOT, target))
        }
      }
    }
    walk(RENDERER_ROOT)
    expect(offenders, '发现不存在的 Tailwind 类 text-accent-contrast-text').toEqual([])
  })

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

  it('思考面板的展开态不依赖折叠动画（rc-motion 会先写成 height:0）', () => {
    /*
     * Think 的折叠动画点开后先写内联 height:0/opacity:0，等两帧 rAF 才换到
     * 内容高度；流式期间 rAF 被推迟时面板会一直空着（真实窗口实测）。
     * 因此展开态必须由 CSS 覆盖成内容高度，收起态包装层立即不显示。
     */
    const enter = /\.thinking-panel \.ant-motion-collapse-enter\s*\{([\s\S]*?)\}/.exec(css)
    expect(enter, '缺少 .thinking-panel 展开态的覆盖规则').not.toBeNull()
    expect(enter![1]).toMatch(/height:\s*auto\s*!important/)
    expect(enter![1]).toMatch(/opacity:\s*1\s*!important/)

    const leave = /\.thinking-panel \.ant-motion-collapse-leave\s*\{([\s\S]*?)\}/.exec(css)
    expect(leave, '缺少 .thinking-panel 收起态的覆盖规则').not.toBeNull()
    expect(leave![1]).toMatch(/display:\s*none\s*!important/)
  })

  it('可选中区域显式声明，正文默认不可选中（桌面应用语义）', () => {
    expect(css).toMatch(/body\s*\{[\s\S]*?user-select:\s*none/)
    expect(css).toMatch(/\.selectable\s*\{[\s\S]*?user-select:\s*text/)
  })
})
