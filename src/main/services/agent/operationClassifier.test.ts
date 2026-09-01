import path from 'node:path'
import { describe, expect, it } from 'vitest'
import type { WorkspaceGrant } from '../../../shared/agent'
import { classifyOperation, OperationClassificationError } from './operationClassifier'

const workspace: WorkspaceGrant = {
  id: 'workspace-1',
  rootPath: path.resolve('C:/project'),
  realRootPath: path.resolve('C:/project'),
  createdAt: 1
}

describe('classifyOperation', () => {
  it('classifies file, command, network, git and host writeback targets', () => {
    expect(classifyOperation('fs.read', { path: 'src/index.ts' }, workspace)).toMatchObject({
      type: 'file',
      outsideWorkspace: false,
      sensitive: false
    })
    expect(
      classifyOperation('process.run', { executable: 'vitest', args: ['run'] }, workspace)
    ).toMatchObject({ type: 'command', signals: { deterministicCheck: true } })
    expect(classifyOperation('network.enable', { url: 'https://Example.com/a' }, workspace)).toEqual({
      type: 'network',
      protocol: 'https:',
      host: 'example.com'
    })
    expect(classifyOperation('git.write', { action: 'Commit' }, workspace)).toEqual({
      type: 'git',
      action: 'commit',
      write: true
    })
    expect(
      classifyOperation(
        'fs.apply-host',
        { paths: ['src/a.ts'], patchHash: 'a'.repeat(64) },
        workspace
      )
    ).toMatchObject({ type: 'host-patch', outsideWorkspace: false, patchHash: 'a'.repeat(64) })
  })

  it('marks escapes, sensitive paths and unsupported protocols for deny-first policy', () => {
    expect(classifyOperation('fs.read', { path: '../secret.txt' }, workspace)).toMatchObject({
      outsideWorkspace: true
    })
    expect(classifyOperation('fs.read', { path: '.env' }, workspace)).toMatchObject({
      sensitive: true
    })
    expect(classifyOperation('network.enable', { url: 'file:///etc/passwd' }, workspace)).toEqual({
      type: 'network',
      protocol: 'other',
      host: ''
    })
  })

  it('rejects malformed writeback hashes', () => {
    expect(() =>
      classifyOperation('fs.apply-host', { paths: ['a.ts'], patchHash: 'no' }, workspace)
    ).toThrowError(OperationClassificationError)
  })
})
