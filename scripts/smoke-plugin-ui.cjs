const { spawnSync } = require('node:child_process')
const { resolve } = require('node:path')
const electron = require('electron')

const root = resolve(__dirname, '..')
const result = spawnSync(electron, [root], {
  cwd: root, stdio: 'inherit',
  env: { ...process.env, AI_AGENT_PLUGIN_UI_SMOKE: '1' }
})
if (result.error) console.error('plugin UI smoke launch failed:', result.error)
process.exit(result.status ?? 1)
