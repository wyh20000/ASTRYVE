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

const electronArgs = [projectRoot]
if (process.env.AI_AGENT_THEME_SMOKE_USER_DATA) {
  electronArgs.push(`--user-data-dir=${path.resolve(process.env.AI_AGENT_THEME_SMOKE_USER_DATA)}`)
}

const result = spawnSync(electronBinary, electronArgs, {
  cwd: projectRoot,
  encoding: 'utf8',
  maxBuffer: 10 * 1024 * 1024,
  env: {
    ...process.env,
    AI_AGENT_THEME_SMOKE: '1'
  }
})

if (result.error) {
  console.error('[smoke:theme] 启动失败:', result.error)
  process.exit(1)
}

const output = `${result.stdout ?? ''}${result.stderr ?? ''}`
if (result.stdout) process.stdout.write(result.stdout)
if (result.stderr) process.stderr.write(result.stderr)

// Electron 在 Windows 上偶发非零退出码但输出已 PASS，因此只把明确的 PASS
// 标记视为成功；反过来，即使 Electron 异常地返回 0，没有 PASS 也必须失败。
const passed = output.includes('[theme-smoke] PASS:')
if (!passed) {
  console.error('[smoke:theme] 未检测到 PASS 标记，真实窗口验收失败。')
}
process.exit(passed ? 0 : (result.status && result.status !== 0 ? result.status : 1))
