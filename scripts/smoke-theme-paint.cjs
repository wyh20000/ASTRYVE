/**
 * 真实窗口主题验收启动器。
 *
 * 为什么需要一层包装：`node scripts/*.cjs` 需要自己找到 electron 可执行文件，
 * 并设置 AI_AGENT_THEME_SMOKE 开关；直接写在 npm script 里无法跨平台设置环境变量。
 *
 * 用法：npm run smoke:theme
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

console.log('[smoke:theme] 启动真实 Electron 窗口进行主题验收…')

const result = spawnSync(electronBinary, [projectRoot], {
  cwd: projectRoot,
  stdio: 'inherit',
  env: {
    ...process.env,
    AI_AGENT_THEME_SMOKE: '1'
  }
})

if (result.error) {
  console.error('[smoke:theme] 启动失败:', result.error)
  process.exit(1)
}

// Electron 在 Windows 上偶发非零退出码但输出已 PASS，因此以标记为准
process.exit(result.status ?? 1)
