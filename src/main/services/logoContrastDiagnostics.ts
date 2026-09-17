/**
 * 一次性诊断：在真实窗口里用 canvas 逐个测量插件 logo 的平均亮度，
 * 判断「去掉容器底色」后在不同主题下的可见性风险。
 */
import type { BrowserWindow } from 'electron'

function script(): string {
  return [
    '(async () => {',
    '  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));',
    "  if (!document.querySelector('nav')) {",
    "    const b = Array.from(document.querySelectorAll('button')).find(",
    "      (x) => (x.getAttribute('aria-label') || '').includes('设置'));",
    '    if (b) { b.click(); await sleep(900); }',
    '  }',
    "  const nav = Array.from(document.querySelectorAll('nav button')).find(",
    "    (x) => (x.textContent || '').includes('插件'));",
    '  if (nav) { nav.click(); await sleep(1200); }',
    "  const marketTab = Array.from(document.querySelectorAll('button')).find(",
    "    (x) => (x.textContent || '').trim() === '插件市场');",
    '  if (marketTab) { marketTab.click(); await sleep(2500); }',
    '',
    "  const imgs = Array.from(document.querySelectorAll('img')).filter(",
    '    (i) => (i.getAttribute("src") || "").includes("raw.githubusercontent") && i.naturalWidth > 0',
    '  );',
    '  const canvas = document.createElement("canvas");',
    '  const ctx = canvas.getContext("2d");',
    '  const results = [];',
    '  let light = 0, dark = 0;',
    '  for (const img of imgs.slice(0, 20)) {',
    '    try {',
    '      canvas.width = 32; canvas.height = 32;',
    '      ctx.clearRect(0, 0, 32, 32);',
    '      ctx.drawImage(img, 0, 0, 32, 32);',
    '      const data = ctx.getImageData(0, 0, 32, 32).data;',
    '      let sum = 0, n = 0;',
    '      for (let i = 0; i < data.length; i += 4) {',
    '        const a = data[i + 3];',
    '        if (a < 128) continue;',
    '        sum += 0.2126 * data[i] + 0.7152 * data[i + 1] + 0.0722 * data[i + 2];',
    '        n++;',
    '      }',
    '      const lum = n ? Math.round(sum / n) : -1;',
    '      const kind = lum < 0 ? "empty" : lum > 140 ? "light" : "dark";',
    '      if (kind === "light") light++; else if (kind === "dark") dark++;',
    '      results.push({ src: (img.getAttribute("src") || "").split("/").slice(-3)[0], lum, kind });',
    '    } catch (e) {',
    '      results.push({ src: "?", lum: -2, kind: "blocked" });',
    '    }',
    '  }',
    '  return JSON.stringify({ total: imgs.length, sampled: results.length, light, dark, results: results.slice(0, 12) });',
    '})()'
  ].join('\n')
}

export async function runLogoContrastDiagnostics(win: BrowserWindow): Promise<string> {
  return (await win.webContents.executeJavaScript(script(), true)) as string
}
