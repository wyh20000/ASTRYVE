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
    expect(
      classifyOperation('process.start', {
        executable: 'node', args: ['server.js'], expectedPorts: [3000]
      }, workspace)
    ).toMatchObject({
      type: 'command', command: { expectedPorts: [3000] }, signals: { longRunning: true }
    })
    expect(classifyOperation('process.stop', { serviceId: 'service-1' }, workspace)).toEqual({
      type: 'service-stop', serviceId: 'service-1'
    })
    expect(classifyOperation('network.enable', { url: 'https://Example.com/a', scope: 'once' }, workspace)).toEqual({
      type: 'network',
      protocol: 'https:',
      host: 'example.com',
      scope: 'once'
    })
    expect(classifyOperation('git.write', { action: 'Commit' }, workspace)).toEqual({
      type: 'git',
      action: 'commit',
      write: true
    })
    expect(classifyOperation('git.read', {}, workspace, 'git.status')).toEqual({
      type: 'git',
      action: 'status',
      write: false
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
    expect(classifyOperation('network.enable', { url: 'file:///etc/passwd', scope: 'task' }, workspace)).toEqual({
      type: 'network',
      protocol: 'other',
      host: '',
      scope: 'task'
    })
  })

  it('rejects malformed writeback hashes', () => {
    expect(() =>
      classifyOperation('fs.apply-host', { paths: ['a.ts'], patchHash: 'no' }, workspace)
    ).toThrowError(OperationClassificationError)
  })

  it('derives browser actions from the trusted tool name instead of model arguments', () => {
    expect(classifyOperation('browser.interact', {
      url: 'https://example.com/checkout', action: 'harmless-read', tabId: 'tab-1'
    }, workspace, 'browser.click')).toMatchObject({
      type: 'browser', action: 'click', origin: 'https://example.com', write: true
    })
    expect(classifyOperation('browser.interact', {
      url: 'https://example.com/delete', tabId: 'tab-1'
    }, workspace, 'browser.confirmClick')).toMatchObject({
      type: 'browser', action: 'confirmclick', write: true, sensitive: true
    })
  })
})
