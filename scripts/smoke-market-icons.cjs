/**
 * 官方插件市场同步冒烟检查。
 *
 * 用途：验证「官方市场能否真正同步成功，并解析出图标与品牌色」。
 *
 * 为什么需要它：这条链路曾经长期静默失败 —— 界面显示的是旧缓存，
 * 单测用的是 mock，都发现不了。这里用真实网络真实同步一次。
 *
 * 用法：npm run smoke:market
 */
const { spawnSync } = require('child_process')
const fs = require('fs')
const path = require('path')

const electronBinary = require('electron')

if (!fs.existsSync(electronBinary)) {
  console.error(`找不到 Electron 可执行文件: ${electronBinary}`)
  process.exit(1)
}

const projectRoot = path.resolve(__dirname, '..')

console.log('[smoke:market] 真实同步 Codex 官方插件市场…')

const result = spawnSync(electronBinary, [projectRoot], {
  cwd: projectRoot,
  stdio: 'inherit',
  env: {
    ...process.env,
    AI_AGENT_MARKET_ICON_SMOKE: '1'
  }
})

if (result.error) {
  console.error('[smoke:market] 启动失败:', result.error)
  process.exit(1)
}

process.exit(result.status ?? 1)
