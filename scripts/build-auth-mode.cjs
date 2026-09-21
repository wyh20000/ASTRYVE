const { spawnSync } = require('node:child_process')
const path = require('node:path')

const mode = process.argv[2]
if (!['local', 'remote'].includes(mode)) {
  console.error('Usage: node scripts/build-auth-mode.cjs <local|remote>')
  process.exit(2)
}

const cli = path.resolve(__dirname, '../node_modules/electron-vite/bin/electron-vite.js')
const result = spawnSync(process.execPath, [cli, 'build'], {
  cwd: path.resolve(__dirname, '..'), stdio: 'inherit',
  env: { ...process.env, AI_AGENT_AUTH_MODE: mode }
})
if (result.error) throw result.error
process.exit(result.status ?? 1)
