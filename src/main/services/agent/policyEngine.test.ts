import path from 'node:path'
import { describe, expect, it } from 'vitest'
import type {
  AuditEvent,
  ExecutionEnvironment,
  NormalizedOperationTarget,
  OperationKind,
  PermissionMode,
  PolicyContext,
  WorkspaceGrant
} from '../../../shared/agent'
import { classifyOperation } from './operationClassifier'
import { DenyFirstPolicyEngine } from './policyEngine'

const workspace: WorkspaceGrant = {
  id: 'workspace-1',
  rootPath: path.resolve('C:/project'),
  realRootPath: path.resolve('C:/project'),
  createdAt: 1
}

const cases: Array<{
  operation: OperationKind
  input: Record<string, unknown>
  expected: Record<PermissionMode, 'allow' | 'ask' | 'deny'>
}> = [
  { operation: 'fs.read', input: { path: 'a.ts' }, expected: all('allow') },
  { operation: 'fs.search', input: { path: 'src' }, expected: all('allow') },
  { operation: 'git.read', input: { action: 'status' }, expected: all('allow') },
  { operation: 'fs.patch', input: { path: 'a.ts' }, expected: effects('allow') },
  {
    operation: 'fs.apply-host',
    input: { paths: ['a.ts'], patchHash: 'a'.repeat(64) },
    expected: effects('ask')
  },
  {
    operation: 'process.run',
    input: { executable: 'vitest', args: ['run'] },
    expected: effects('allow')
  },
  { operation: 'network.enable', input: { url: 'https://example.com' }, expected: effects('ask') },
  { operation: 'git.write', input: { action: 'commit' }, expected: effects('ask') }
]

describe('DenyFirstPolicyEngine', () => {
  for (const testCase of cases) {
    it.each(['read-only', 'ask-every-time', 'smart-approval'] as const)(
      `covers ${testCase.operation} in %s mode`,
      (permissionMode) => {
        const decision = evaluate(
          permissionMode,
          testCase.operation,
          classifyOperation(testCase.operation, testCase.input, workspace)
        )
        expect(decision.outcome).toBe(testCase.expected[permissionMode])
      }
    )
  }

  it('asks before local checks and project scripts even in smart mode', () => {
    expect(
      evaluate(
        'smart-approval',
        'process.run',
        classifyOperation('process.run', { executable: 'vitest', args: ['run'] }, workspace),
        'local'
      ).outcome
    ).toBe('ask')
    expect(
      evaluate(
        'smart-approval',
        'process.run',
        classifyOperation('process.run', { executable: 'npm', args: ['run', 'test'] }, workspace)
      ).reasonCode
    ).toBe('PROJECT_SCRIPT_REQUIRES_APPROVAL')
  })

  it.each([
    ['path escape', 'fs.read', classifyOperation('fs.read', { path: '..' }, workspace)],
    ['sensitive path', 'fs.read', classifyOperation('fs.read', { path: '.env' }, workspace)],
    [
      'unsupported protocol',
      'network.enable',
      classifyOperation('network.enable', { url: 'file:///tmp/a' }, workspace)
    ],
    [
      'shell interpreter',
      'process.run',
      classifyOperation(
        'process.run',
        { executable: 'powershell.exe', args: ['-Command', 'dir'] },
        workspace
      )
    ]
  ] as Array<[string, OperationKind, NormalizedOperationTarget]>)('hard denies %s in every mode', (_, operation, target) => {
    for (const mode of ['read-only', 'ask-every-time', 'smart-approval'] as const) {
      expect(evaluate(mode, operation, target).outcome).toBe('deny')
    }
  })

  it('writes every decision to the audit sink', () => {
    const events: AuditEvent[] = []
    const engine = new DenyFirstPolicyEngine((event) => events.push(event), () => 100)
    engine.evaluate(context('smart-approval', 'fs.read', classifyOperation('fs.read', {}, workspace)))
    expect(events).toHaveLength(1)
    expect(events[0]).toMatchObject({
      timestamp: 100,
      actor: 'policy',
      action: 'fs.read',
      outcome: 'allow'
    })
  })
})

function all(outcome: 'allow'): Record<PermissionMode, 'allow' | 'ask' | 'deny'> {
  return { 'read-only': outcome, 'ask-every-time': outcome, 'smart-approval': outcome }
}

function effects(smart: 'allow' | 'ask'): Record<PermissionMode, 'allow' | 'ask' | 'deny'> {
  return { 'read-only': 'deny', 'ask-every-time': 'ask', 'smart-approval': smart }
}

function context(
  permissionMode: PermissionMode,
  operation: OperationKind,
  target: NormalizedOperationTarget,
  environment: ExecutionEnvironment = 'docker'
): PolicyContext {
  return {
    permissionMode,
    workspace,
    operation,
    target,
    invocation: {
      taskId: 'task-1',
      callId: 'call-1',
      toolName: 'workspace.readFile',
      args: {},
      workspaceId: workspace.id,
      environment,
      permissionMode
    }
  }
}

function evaluate(
  permissionMode: PermissionMode,
  operation: OperationKind,
  target: NormalizedOperationTarget,
  environment: ExecutionEnvironment = 'docker'
) {
  return new DenyFirstPolicyEngine().evaluate(context(permissionMode, operation, target, environment))
}
