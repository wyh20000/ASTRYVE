import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { DockerExecutionBackend } from './dockerExecutionBackend'

export async function runDockerExecutionSmoke(): Promise<void> {
  const source = await mkdtemp(join(tmpdir(), 'ai-agent-docker-smoke-source-'))
  const runtime = await mkdtemp(join(tmpdir(), 'ai-agent-docker-smoke-runtime-'))
  try {
    await writeFile(join(source, 'safe.txt'), 'sandbox-visible')
    await writeFile(join(source, '.env'), 'SECRET=must-not-enter-container')
    const backend = new DockerExecutionBackend({
      verifyWorkspace: async () => undefined,
      appendOutput: () => undefined,
      runtimeRoot: runtime
    })
    const result = await backend.run({
      taskId: 'docker-smoke', callId: 'docker-smoke-run', captureOnly: true,
      workspace: { id: 'docker-smoke-workspace', rootPath: source, realRootPath: source, createdAt: Date.now() },
      executable: 'node', timeoutMs: 30_000,
      args: ['-e', "const f=require('fs'),o=require('os');if(!f.existsSync('safe.txt')||f.existsSync('.env')||Object.keys(o.networkInterfaces()).some(n=>n!=='lo'))process.exit(2);f.writeFileSync('artifact.txt','generated');console.log(f.readFileSync('safe.txt','utf8'))"]
    }, new AbortController().signal)
    if (result.exitCode !== 0 || !result.stdout.includes('sandbox-visible')) {
      throw new Error(`DOCKER_SMOKE_COMMAND_FAILED:${result.exitCode}:${result.stderr}`)
    }
    if (result.sandboxChanges?.files.find((file) => file.path === 'artifact.txt')?.status !== 'added') {
      throw new Error('DOCKER_SMOKE_CHANGE_MANIFEST_FAILED')
    }

    backend.grantNetwork('docker-smoke-network', 'once')
    const networkResult = await backend.run({
      taskId: 'docker-smoke-network', callId: 'docker-smoke-network-run', captureOnly: true,
      workspace: { id: 'docker-smoke-workspace', rootPath: source, realRootPath: source, createdAt: Date.now() },
      executable: 'node', timeoutMs: 30_000,
      args: ['-e', "const o=require('os');process.exit(Object.keys(o.networkInterfaces()).some(n=>n!=='lo')?0:3)"]
    }, new AbortController().signal)
    if (networkResult.exitCode !== 0) throw new Error('DOCKER_SMOKE_NETWORK_GRANT_FAILED')

    const pending = backend.run({
      taskId: 'docker-smoke-stop', callId: 'docker-smoke-stop-run', captureOnly: true,
      workspace: { id: 'docker-smoke-workspace', rootPath: source, realRootPath: source, createdAt: Date.now() },
      executable: 'node', timeoutMs: 30_000,
      args: ['-e', 'setInterval(()=>{},1000)']
    }, new AbortController().signal)
    const stopped = pending.then(
      () => { throw new Error('DOCKER_SMOKE_CANCEL_DID_NOT_STOP') },
      (error) => {
        if (!(error instanceof Error) || !error.message.includes('CANCEL')) throw error
      }
    )
    await new Promise((resolve) => setTimeout(resolve, 1_000))
    await backend.stopTask('docker-smoke-stop')
    await stopped
  } finally {
    await Promise.all([
      rm(source, { recursive: true, force: true }),
      rm(runtime, { recursive: true, force: true })
    ])
  }
}
