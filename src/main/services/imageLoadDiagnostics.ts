/**
 * 一次性诊断：确认主题缩略图在真实窗口（file:// 协议）下确实加载成功。
 *
 * 这是位图方案的主要风险点：Vite 打包后的资源路径若解析错误，
 * 图片会静默 404，界面上只剩空白框。
 */
import type { BrowserWindow } from 'electron'

function imageCheckScript(): string {
  return [
    '(async () => {',
    '  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));',
    "  if (!document.querySelector('nav')) {",
    "    const openBtn = Array.from(document.querySelectorAll('button')).find(",
    "      (b) => (b.getAttribute('aria-label') || '').includes('设置'));",
    '    if (openBtn) { openBtn.click(); await sleep(800); }',
    '  }',
    "  const themeNav = Array.from(document.querySelectorAll('nav button')).find(",
    "    (b) => (b.textContent || '').includes('主题设置'));",
    '  if (themeNav) { themeNav.click(); await sleep(900); }',
    "  const imgs = Array.from(document.querySelectorAll('[role=\"radio\"] img'));",
    '  await sleep(600);',
    '  return JSON.stringify({',
    '    count: imgs.length,',
    '    items: imgs.map((i) => ({',
    '      src: (i.getAttribute("src") || "").slice(-28),',
    '      complete: i.complete,',
    '      naturalW: i.naturalWidth,',
    '      naturalH: i.naturalHeight,',
    '      w: Math.round(i.getBoundingClientRect().width),',
    '      h: Math.round(i.getBoundingClientRect().height)',
    '    }))',
    '  });',
    '})()'
  ].join('\n')
}

export async function runImageDiagnostics(win: BrowserWindow): Promise<string> {
  return (await win.webContents.executeJavaScript(imageCheckScript(), true)) as string
}
