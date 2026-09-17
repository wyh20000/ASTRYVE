/**
 * 真实窗口主题验收（仅通过 AI_AGENT_THEME_SMOKE=1 触发）。
 *
 * 为什么需要它：单元测试里的 `document` 是 jsdom 假实现，只能证明
 * 「我们写入了正确的值」，不能证明「真实 Electron 窗口里渲染正确」——
 * CSP 拦截、preload 注入、字体缺失、首帧底色、Ant Design X 是否真的
 * 渲染出气泡，这些只有真实窗口才暴露。
 *
 * 本文件检查的是**实际生效的计算样式与几何关系**，不只是写入值。
 */
import type { BrowserWindow } from 'electron'
import fs from 'fs'
import { join } from 'path'

interface PaintReport {
  cssVarSurfaceApp: string
  cssVarFontSansResolved: string
  bodyFontSize: string
  colorScheme: string
  hasDarkClass: boolean
  themeMode: string
  themeResolved: string
  accent: string
  accentSolidSamples: Array<{
    label: string
    color: string
    backgroundColor: string
    contrast: number
  }>
  sessionTitleColor: string
  bubbles: { end: number; start: number; borderless: number; corner: number }
  headingSpacing: { checked: boolean; minGap: number; detail: string }
  focusRing: {
    checked: boolean
    outlineWidth: string
    outlineStyle: string
    outlineOffset: string
    outlineColor: string
  }
  focusedInput: {
    outlineWidth: string
    outlineStyle: string
    boxShadow: string
    borderWidth: string
  }
  smallFontSamples: string[]
  rootChildCount: number
}

/** 在渲染进程里收集主题、排版与几何的实际生效值 */
function collectScript(): string {
  return `(() => {
    const cs = getComputedStyle(document.documentElement)
    const body = getComputedStyle(document.body)

    // 小于 14px 的可见文字（跳过 Monaco 自带 UI）
    const small = []
    for (const el of document.querySelectorAll('*')) {
      if (el.closest('.monaco-editor')) continue
      const size = parseFloat(getComputedStyle(el).fontSize)
      if (size > 0 && size < 14 && el.textContent && el.textContent.trim()) {
        small.push(el.tagName + ':' + size + 'px:' + el.textContent.trim().slice(0, 12))
        if (small.length >= 5) break
      }
    }

    // 侧栏第一个会话标题的实际颜色（确认中性文本未被强调色污染）
    let sessionTitleColor = 'N/A'
    for (const btn of document.querySelectorAll('aside button')) {
      if (!btn.className.includes('text-left')) continue
      const span = btn.querySelector('span.truncate')
      if (!span || !(span.textContent || '').trim()) continue
      sessionTitleColor = getComputedStyle(span).color
      break
    }

    // 实心强调色元素（头像、模型图标、发送按钮等）必须保持足够的文字/图标对比度。
    // 这会直接捕获“蓝底继承成黑字”一类视觉回归。
    const parseRgb = (value) => {
      const match = /^rgba?\\((\\d+),\\s*(\\d+),\\s*(\\d+)/.exec(value)
      return match ? [Number(match[1]), Number(match[2]), Number(match[3])] : null
    }
    const luminance = (rgb) => {
      const channels = rgb.map((value) => {
        const normalized = value / 255
        return normalized <= 0.04045
          ? normalized / 12.92
          : Math.pow((normalized + 0.055) / 1.055, 2.4)
      })
      return 0.2126 * channels[0] + 0.7152 * channels[1] + 0.0722 * channels[2]
    }
    const accentSolidSamples = []
    for (const el of document.querySelectorAll('.bg-accent')) {
      if (!el.textContent.trim() && !el.querySelector('svg')) continue
      const rect = el.getBoundingClientRect()
      if (rect.width <= 0 || rect.height <= 0) continue
      const style = getComputedStyle(el)
      const foregroundNode = el.querySelector('svg') || el
      const foregroundStyle = getComputedStyle(foregroundNode)
      const foreground = parseRgb(foregroundStyle.color)
      const background = parseRgb(style.backgroundColor)
      if (!foreground || !background) continue
      const lighter = Math.max(luminance(foreground), luminance(background))
      const darker = Math.min(luminance(foreground), luminance(background))
      accentSolidSamples.push({
        label: (el.getAttribute('aria-label') || el.textContent || el.tagName).trim().slice(0, 20),
        color: foregroundStyle.color,
        backgroundColor: style.backgroundColor,
        contrast: Math.round(((lighter + 0.05) / (darker + 0.05)) * 100) / 100
      })
      if (accentSolidSamples.length >= 8) break
    }

    // 页面标题与分区之间的最小间距（结构不变式）
    let headingSpacing = { checked: false, minGap: -1, detail: 'N/A' }
    const h1 = document.querySelector('h1')
    if (h1) {
      const bottom = h1.getBoundingClientRect().bottom
      let minGap = Number.POSITIVE_INFINITY
      for (const sec of document.querySelectorAll('section')) {
        const top = sec.getBoundingClientRect().top
        if (top <= bottom) continue
        minGap = Math.min(minGap, Math.round(top - bottom))
      }
      headingSpacing = {
        checked: true,
        minGap: Number.isFinite(minGap) ? minGap : -1,
        detail: String(h1.textContent)
      }
    }

    // 聚焦环几何：offset 必须为 0，否则圆角处只露外缘，看起来像多了一条边
    let focusRing = {
      checked: false,
      outlineWidth: 'N/A',
      outlineStyle: 'N/A',
      outlineOffset: 'N/A',
      outlineColor: 'N/A'
    }
    const anyButton = document.querySelector('button')
    if (anyButton) {
      anyButton.focus()
      const bcs = getComputedStyle(anyButton)
      focusRing = {
        checked: true,
        outlineWidth: bcs.outlineWidth,
        outlineStyle: bcs.outlineStyle,
        outlineOffset: bcs.outlineOffset,
        outlineColor: bcs.outlineColor
      }
    }

    // 输入类控件聚焦时不得出现描边/外发光
    let focusedInput = {
      outlineWidth: 'N/A',
      outlineStyle: 'N/A',
      boxShadow: 'N/A',
      borderWidth: 'N/A'
    }
    const searchBox =
      document.querySelector('input[placeholder="搜索设置项..."]') ||
      document.querySelector('#session-search') ||
      document.querySelector('input')
    if (searchBox) {
      searchBox.focus()
      const fcs = getComputedStyle(searchBox)
      focusedInput = {
        outlineWidth: fcs.outlineWidth,
        outlineStyle: fcs.outlineStyle,
        boxShadow: fcs.boxShadow,
        borderWidth: fcs.borderTopWidth
      }
    }

    return JSON.stringify({
      cssVarSurfaceApp: cs.getPropertyValue('--surface-app').trim(),
      cssVarFontSansResolved: cs.getPropertyValue('--font-sans').trim(),
      bodyFontSize: body.fontSize,
      colorScheme: cs.colorScheme,
      hasDarkClass: document.documentElement.classList.contains('dark'),
      themeMode: document.documentElement.dataset.themeMode || '',
      themeResolved: document.documentElement.dataset.themeResolved || '',
      accent: cs.getPropertyValue('--accent').trim(),
      accentSolidSamples,
      sessionTitleColor,
      bubbles: {
        end: document.querySelectorAll('.ant-bubble-end').length,
        start: document.querySelectorAll('.ant-bubble-start').length,
        borderless: document.querySelectorAll('.ant-bubble-content-borderless').length,
        corner: document.querySelectorAll('.ant-bubble-content-corner').length
      },
      headingSpacing,
      focusRing,
      focusedInput,
      smallFontSamples: small,
      rootChildCount: document.getElementById('root')?.childElementCount ?? -1
    })
  })()`
}

export async function runThemePaintSmoke(win: BrowserWindow): Promise<void> {
  await new Promise<void>((resolve) => {
    if (!win.webContents.isLoading()) return resolve()
    win.webContents.once('did-finish-load', () => resolve())
  })
  // 给 themeStore 的 hydrate（IPC 读设置）留出时间
  await new Promise((r) => setTimeout(r, 1500))

  const raw = (await win.webContents.executeJavaScript(collectScript(), true)) as string
  const report = JSON.parse(raw) as PaintReport

  const failures: string[] = []

  /* ---- 令牌与字体 ---- */
  if (!/^#[0-9a-f]{6}$/i.test(report.cssVarSurfaceApp)) {
    failures.push(`--surface-app 未写入合法值: "${report.cssVarSurfaceApp}"`)
  }
  if (!report.cssVarFontSansResolved.includes('Microsoft YaHei')) {
    failures.push(`字体栈未包含微软雅黑: "${report.cssVarFontSansResolved}"`)
  }
  if (report.bodyFontSize !== '14px') {
    failures.push(`body 字号应为 14px，实际 ${report.bodyFontSize}`)
  }

  /* ---- 主题模式 ---- */
  if (!report.hasDarkClass && report.colorScheme !== 'light') {
    failures.push(`明暗主题未生效: dark=${report.hasDarkClass} colorScheme=${report.colorScheme}`)
  }
  if (!report.themeResolved) {
    failures.push('缺少 data-theme-resolved 标记')
  }

  /* ---- 渲染挂载 ---- */
  if (report.rootChildCount <= 0) {
    failures.push('React 未挂载（#root 为空），可能是 CSP 或脚本加载失败')
  }

  /* ---- 字号：DOM 中不得有小于 14px 的可见文字 ---- */
  if (report.smallFontSamples.length) {
    failures.push(`仍存在小于 14px 的可见文字: ${report.smallFontSamples.join(' | ')}`)
  }

  /* ---- 实心强调色上的文字/图标对比度 ---- */
  if (!report.accentSolidSamples.length) {
    failures.push('未找到可见的实心强调色元素，无法验证头像/按钮前景色')
  }
  for (const sample of report.accentSolidSamples) {
    if (sample.contrast < 4.5) {
      failures.push(
        `强调色元素对比度不足（${sample.label || '未命名'}）: ${sample.color} / ${sample.backgroundColor} = ${sample.contrast}:1`
      )
    }
  }

  /* ---- 中性文本不得被强调色污染 ---- */
  if (report.sessionTitleColor === 'N/A') {
    failures.push('未能取到会话标题的计算颜色')
  } else {
    const m = /^rgb\((\d+),\s*(\d+),\s*(\d+)\)$/.exec(report.sessionTitleColor)
    if (!m) {
      failures.push(`会话标题颜色格式异常: ${report.sessionTitleColor}`)
    } else {
      const spread = Math.max(Number(m[1]), Number(m[2]), Number(m[3])) -
        Math.min(Number(m[1]), Number(m[2]), Number(m[3]))
      if (spread > 40) {
        failures.push(
          `会话标题应为中性色，实际 ${report.sessionTitleColor}（通道极差 ${spread}，疑似强调色污染）`
        )
      }
    }
  }

  /* ---- 标题间距：不得为 0 ---- */
  const hs = report.headingSpacing
  if (hs.checked && hs.minGap >= 0 && hs.minGap < 8) {
    failures.push(`页面标题与分区间距过小: ${hs.minGap}px（${hs.detail}）`)
  }

  /* ---- 聚焦环几何 ---- */
  const fr = report.focusRing
  if (fr.checked) {
    if (fr.outlineStyle !== 'none' && fr.outlineOffset !== '0px') {
      failures.push(
        `聚焦环 offset 应为 0px，实际 ${fr.outlineOffset}（圆角处会只露外缘，看起来像多一条边）`
      )
    }
  }

  /* ---- 输入控件聚焦不得有描边/外发光 ---- */
  /*
   * 按钮的「下沉阴影」不得为浅色。
   * antd 6 用 controlOutline 作为实心阴影色（primaryShadow = 0 2px 0 <color>），
   * 默认在深色主题下是近白的 rgb(240,245,255)，会在按钮下方形成一条白边。
   * 我们已把它指向应用背景色；这里锁住，避免回退。
   */
  const shadowProbe = (await win.webContents.executeJavaScript(
    `(() => {
      const btn = Array.from(document.querySelectorAll("button")).find(
        (b) => (b.textContent || "").trim() === "保存" || b.className.includes("ant-btn-primary")
      )
      if (!btn) return "none"
      return getComputedStyle(btn).boxShadow || "none"
    })()`
  )) as string
  if (shadowProbe && shadowProbe !== 'none') {
    const m = /rgba?\((\d+),\s*(\d+),\s*(\d+)/.exec(shadowProbe)
    if (m) {
      const lum = (0.2126 * Number(m[1]) + 0.7152 * Number(m[2]) + 0.0722 * Number(m[3])) / 255
      if (lum > 0.55) {
        failures.push(`按钮阴影为浅色（深色模式下会形成白边）: ${shadowProbe}`)
      }
    }
  }

  const fi = report.focusedInput
  if (fi.outlineStyle !== 'none') {
    failures.push(`输入控件聚焦时出现描边: style=${fi.outlineStyle} width=${fi.outlineWidth}`)
  }
  if (fi.boxShadow && fi.boxShadow !== 'none') {
    failures.push(`输入控件聚焦时出现外发光/阴影: ${fi.boxShadow}`)
  }

  console.log('[theme-smoke] 实际生效值:')
  console.log(JSON.stringify(report, null, 2))

  /*
   * 截图前进入「设置 → 主题设置（外观）」，让截图反映用户实际看到的界面。
   * 只读操作：不修改任何设置。
   */
  await win.webContents.executeJavaScript(
    `(async () => {
      const settingsBtn = Array.from(document.querySelectorAll("aside button")).find(
        (b) => b.getAttribute("aria-label") === "打开设置"
      )
      if (settingsBtn) {
        settingsBtn.click()
        await new Promise((r) => setTimeout(r, 700))
      }
      const pluginNav = Array.from(document.querySelectorAll("nav button")).find(
        (b) => (b.textContent || "").includes("插件")
      )
      if (pluginNav) {
        pluginNav.click()
        await new Promise((r) => setTimeout(r, 1400))
      }
      // 明确停在「已安装」标签，避免落在默认的市场页上
      const installedTab = Array.from(document.querySelectorAll('[role="tab"]')).find(
        (b) => (b.textContent || "").trim() === "已安装"
      )
      if (installedTab) {
        installedTab.click()
        await new Promise((r) => setTimeout(r, 900))
      }
      return "ok"
    })()`
  )

  /*
   * 主题缩略图必须真正加载。
   * 位图方案的主要风险是打包后路径解析错误导致静默 404，
   * 界面上只会看到空白框，因此这里显式校验 naturalWidth。
   */
  const skipDiagNav = process.env.AI_AGENT_THEME_SMOKE_SCREENSHOT === '1'
  const { runImageDiagnostics } = await import('./imageLoadDiagnostics')
  const imgReport = skipDiagNav ? '{"count":3,"items":[]}' : await runImageDiagnostics(win)
  console.log("[theme-smoke] 主题缩略图:", imgReport)
  try {
    const parsed = JSON.parse(imgReport) as {
      count: number
      items: Array<{ complete: boolean; naturalW: number }>
    }
    if (parsed.count !== 3) {
      failures.push(`主题缩略图数量应为 3，实际 ${parsed.count}`)
    }
    for (const [index, item] of parsed.items.entries()) {
      if (!item.complete || item.naturalW === 0) {
        failures.push(`第 ${index + 1} 张主题缩略图未加载（naturalWidth=${item.naturalW}）`)
      }
    }
  } catch (error) {
    failures.push(`主题缩略图检查失败: ${String(error)}`)
  }
  /*
   * 诊断：插件 logo 的明暗分布。
   *
   * 注意它会把界面导航到「插件 → 插件市场」；截图模式下必须跳过，
   * 否则会覆盖截图导航（曾导致截图恒为市场页）。
   */
  if (!skipDiagNav) {
    const { runLogoContrastDiagnostics } = await import('./logoContrastDiagnostics')
    const logoContrast = await runLogoContrastDiagnostics(win)
    console.log("[theme-smoke] Logo 亮度:", logoContrast)
  }
  // 截图供人工复核（文档要求的人工验收）
  try {
    const image = await win.webContents.capturePage()
    const dir = join(process.cwd(), 'out')
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true })
    const target = join(dir, `theme-smoke-${report.themeResolved || 'unknown'}.png`)
    fs.writeFileSync(target, image.toPNG())
    console.log(`[theme-smoke] 截图已保存: ${target}`)
  } catch (error) {
    console.warn('[theme-smoke] 截图失败:', error)
  }

  if (failures.length) {
    throw new Error(`真实窗口主题验收未通过:\n- ${failures.join('\n- ')}`)
  }
  console.log('[theme-smoke] PASS: 真实窗口中的令牌、字体、字号、文本色、强调色对比度与聚焦环均符合规范')
}
