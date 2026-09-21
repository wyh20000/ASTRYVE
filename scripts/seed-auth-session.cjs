const { app, safeStorage } = require('electron')
const { mkdirSync, readFileSync, writeFileSync } = require('node:fs')
const { join, resolve } = require('node:path')

const fixtureRoot = process.env.AI_AGENT_AUTH_SMOKE_USER_DATA
if (fixtureRoot) {
  app.setName('ai-agent')
  app.setPath('userData', resolve(fixtureRoot))
}

app.whenReady().then(() => {
  const root = process.env.AI_AGENT_AUTH_SMOKE_USER_DATA
  const token = process.env.AI_AGENT_AUTH_SMOKE_TOKEN
  const userId = process.env.AI_AGENT_AUTH_SMOKE_USER_ID
  if (!root || !/^[A-Za-z0-9_-]{43}$/.test(token || '') ||
      !/^[0-9a-f-]{36}$/i.test(userId || '') || !safeStorage.isEncryptionAvailable()) {
    throw new Error('Auth session smoke fixture is unavailable')
  }
  const file = join(resolve(root), 'auth-session.enc')
  mkdirSync(resolve(root), { recursive: true })
  if (process.env.AI_AGENT_AUTH_SMOKE_CHECK === '1') {
    const restored = JSON.parse(safeStorage.decryptString(readFileSync(file)))
    if (restored.token !== token || restored.userId !== userId) throw new Error('Session fixture round trip failed')
    console.log('[auth-seed] CHECK PASS')
    app.quit()
    return
  }
  writeFileSync(file, safeStorage.encryptString(JSON.stringify({
    token, userId, expiresAt: Date.now() + 60_000
  })), { mode: 0o600 })
  console.log('[auth-seed] PASS')
  app.quit()
}).catch((error) => { console.error('[auth-seed] FAIL:', error.message); app.exit(1) })
