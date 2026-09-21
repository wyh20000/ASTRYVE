const { spawn } = require('node:child_process')
const { createServer } = require('node:http')
const { randomBytes, randomUUID } = require('node:crypto')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const electron = require('electron')

const projectRoot = path.resolve(__dirname, '..')
const tempRoot = path.resolve(os.tmpdir())
const userData = fs.mkdtempSync(path.join(tempRoot, 'aiagent-auth-session-smoke-'))
const token = randomBytes(32).toString('base64url')
const userId = randomUUID()
let revoked = false

const authServer = createServer((req, res) => {
  res.setHeader('content-type', 'application/json')
  res.setHeader('cache-control', 'no-store')
  if (req.url !== '/v1/auth/session' || req.method !== 'GET' ||
      req.headers.authorization !== `Bearer ${token}` || revoked) {
    res.writeHead(401)
    res.end(JSON.stringify({ error: '登录已失效' }))
    return
  }
  res.writeHead(200)
  res.end(JSON.stringify({ user: { id: userId } }))
})

function runElectron(args, env, expected) {
  return new Promise((resolve, reject) => {
    const child = spawn(electron, args, { cwd: projectRoot, env, windowsHide: true })
    let output = ''
    child.stdout.on('data', (chunk) => { output += chunk.toString() })
    child.stderr.on('data', (chunk) => { output += chunk.toString() })
    const timer = setTimeout(() => child.kill(), 90_000)
    child.once('error', reject)
    child.once('close', (code) => {
      clearTimeout(timer)
      if (code !== 0 || !output.includes(expected)) reject(new Error(output || `Electron exited ${code}`))
      else resolve()
    })
  })
}

async function main() {
  if (process.platform !== 'win32') {
    console.log('[auth-session-smoke] SKIP: native Windows credential storage check')
    return
  }
  await new Promise((resolve) => authServer.listen(0, '127.0.0.1', resolve))
  const origin = `http://127.0.0.1:${authServer.address().port}`
  const sharedEnv = { ...process.env, AI_AGENT_AUTH_SMOKE_USER_DATA: userData,
    AI_AGENT_AUTH_URL: origin }
  await runElectron([path.join(projectRoot, 'scripts', 'seed-auth-session.cjs'), `--user-data-dir=${userData}`],
    { ...sharedEnv, AI_AGENT_AUTH_SMOKE_TOKEN: token, AI_AGENT_AUTH_SMOKE_USER_ID: userId },
    '[auth-seed] PASS')
  await runElectron([path.join(projectRoot, 'scripts', 'seed-auth-session.cjs'), `--user-data-dir=${userData}`],
    { ...sharedEnv, AI_AGENT_AUTH_SMOKE_TOKEN: token, AI_AGENT_AUTH_SMOKE_USER_ID: userId,
      AI_AGENT_AUTH_SMOKE_CHECK: '1' }, '[auth-seed] CHECK PASS')
  if (!fs.existsSync(path.join(userData, 'auth-session.enc'))) {
    throw new Error('Protected session fixture was not written')
  }
  await runElectron([projectRoot, `--user-data-dir=${userData}`], { ...sharedEnv, AI_AGENT_AUTH_SMOKE: 'unlocked' },
    '[auth-smoke] PASS: verified session unlocked renderer and business IPC')
  revoked = true
  await runElectron([projectRoot, `--user-data-dir=${userData}`], { ...sharedEnv, AI_AGENT_AUTH_SMOKE: 'locked' },
    '[auth-smoke] PASS: locked renderer and rejected business IPC')
  if (fs.existsSync(path.join(userData, 'auth-session.enc'))) {
    throw new Error('Revoked encrypted session was not removed')
  }
  console.log('[auth-session-smoke] PASS: native protected session, unlock and revocation lock')
}

main().catch((error) => { console.error('[auth-session-smoke] FAIL:', error.message); process.exitCode = 1 })
  .finally(async () => {
    if (authServer.listening) {
      authServer.closeAllConnections()
      await new Promise((resolve) => authServer.close(resolve))
    }
    const resolved = path.resolve(userData)
    if (path.dirname(resolved) !== tempRoot || !path.basename(resolved).startsWith('aiagent-auth-session-smoke-')) {
      throw new Error('Refusing to remove a directory outside the auth smoke workspace')
    }
    fs.rmSync(resolved, { recursive: true, force: true })
  })
