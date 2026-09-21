const { spawnSync } = require('node:child_process')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const electron = require('electron')

const projectRoot = path.resolve(__dirname, '..')
const tempRoot = path.resolve(os.tmpdir())
const userData = fs.mkdtempSync(path.join(tempRoot, 'aiagent-auth-smoke-'))
try {
  const result = spawnSync(electron, [projectRoot, `--user-data-dir=${userData}`], {
    cwd: projectRoot, encoding: 'utf8', timeout: 60_000,
    env: { ...process.env, AI_AGENT_AUTH_SMOKE: '1', AI_AGENT_AUTH_URL: 'http://127.0.0.1:8787',
      AI_AGENT_AUTH_SMOKE_USER_DATA: userData }
  })
  const output = `${result.stdout || ''}${result.stderr || ''}`
  process.stdout.write(output)
  if (result.error || !output.includes('[auth-smoke] PASS:')) {
    console.error('[auth-smoke] real Electron lock check failed', result.error || result.status)
    process.exitCode = 1
  }
} finally {
  const resolved = path.resolve(userData)
  if (path.dirname(resolved) !== tempRoot || !path.basename(resolved).startsWith('aiagent-auth-smoke-')) {
    throw new Error('Refusing to remove a directory outside the auth smoke workspace')
  }
  fs.rmSync(resolved, { recursive: true, force: true })
}
