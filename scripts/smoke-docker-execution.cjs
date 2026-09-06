// Launch the real application main entry in a dedicated, windowless Docker smoke mode.
const { spawn } = require('node:child_process')
const electron = require('electron')

const child = spawn(electron, ['--no-sandbox', '--disable-gpu', '.'], {
  cwd: process.cwd(),
  env: { ...process.env, AI_AGENT_DOCKER_EXECUTION_SMOKE: '1' },
  stdio: 'inherit',
  windowsHide: true,
  shell: false
})
child.once('error', (error) => {
  console.error(error)
  process.exitCode = 1
})
child.once('exit', (code) => { process.exitCode = code ?? 1 })
