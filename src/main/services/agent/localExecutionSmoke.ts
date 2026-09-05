import { access } from 'node:fs/promises'
import type { ExecutionRequest, WorkspaceGrant } from '../../../shared/agent'
import { LocalExecutionBackend } from './localExecutionBackend'

export async function runLocalExecutionSmoke(): Promise<void> {
  const workspace: WorkspaceGrant = {
    id: 'smoke-workspace-1', rootPath: process.cwd(), realRootPath: process.cwd(), createdAt: Date.now()
  }
  let activeController: AbortController | undefined
  let descendantPid = 0
  let basicOutput = ''
  const backend = new LocalExecutionBackend({
    verifyWorkspace: async () => { await access(workspace.realRootPath) },
    appendOutput: (_taskId, stream, chunk) => {
      if (stream !== 'stdout') return
      if (!activeController) basicOutput += chunk
      else {
        descendantPid = Number(chunk.trim())
        if (Number.isSafeInteger(descendantPid) && descendantPid > 0) activeController.abort('smoke_cancel')
      }
    }
  })
  const base: Omit<ExecutionRequest, 'taskId' | 'callId' | 'args'> = {
    workspace, executable: 'node', timeoutMs: 10_000
  }

  await backend.run({ ...base, taskId: 'smoke-basic', callId: 'smoke-call-1',
    args: ['-e', 'process.stdout.write("utility-ok-中文")'] }, new AbortController().signal)
  if (basicOutput !== 'utility-ok-中文') throw new Error(`Unexpected utility output: ${basicOutput}`)

  const npm = await backend.run({ ...base, taskId: 'smoke-npm', callId: 'smoke-call-npm',
    executable: 'npm', args: ['--version'], captureOnly: true }, new AbortController().signal)
  if (npm.exitCode !== 0 || !/^\d+\.\d+/.test(npm.stdout.trim())) {
    throw new Error(`Trusted npm execution failed (${npm.exitCode}): ${npm.stderr || npm.stdout}`)
  }
  const git = await backend.run({ ...base, taskId: 'smoke-git', callId: 'smoke-call-git',
    executable: 'git', args: ['status', '--short', '--', '.'], captureOnly: true }, new AbortController().signal)
  if (git.exitCode !== 0) throw new Error(`Trusted Git execution failed: ${git.stderr}`)

  if (process.platform === 'win32') {
    activeController = new AbortController()
    const running = backend.run({ ...base, taskId: 'smoke-tree', callId: 'smoke-call-2', args: ['-e',
      'const c=require("child_process").spawn(process.execPath,["-e","setInterval(()=>{},1000)"],{detached:true,stdio:"ignore"});console.log(c.pid);setInterval(()=>{},1000)'
    ] }, activeController.signal)
    await running.then(
      () => { throw new Error('Cancellation smoke unexpectedly completed') },
      (error) => {
        if (!(error instanceof Error) || !error.message.includes('CANCEL')) throw error
      }
    )
    await new Promise((resolve) => setTimeout(resolve, 750))
    if (!descendantPid) throw new Error('Descendant PID was not received')
    try {
      process.kill(descendantPid, 0)
      throw new Error('Descendant survived task cancellation')
    } catch (error) {
      if (error instanceof Error && error.message === 'Descendant survived task cancellation') throw error
    }
  }
}
