import { describe, expect, it } from 'vitest'
import {
  defaultAgentProjectPreferences,
  validateAgentProjectPreferences
} from './projectPreferences'

const workspaceIds = new Set(['workspace-1'])

describe('project agent preferences', () => {
  it('defaults to Docker without silently falling back to local execution', () => {
    expect(
      defaultAgentProjectPreferences('workspace-1', {
        dockerAvailable: false,
        localAvailable: true
      })
    ).toMatchObject({ permissionMode: 'ask-every-time', executionEnvironment: 'docker' })
    expect(
      defaultAgentProjectPreferences('workspace-1', {
        dockerAvailable: true,
        localAvailable: true
      })
    ).toMatchObject({ permissionMode: 'ask-every-time', executionEnvironment: 'docker' })
  })

  it('accepts only authorized workspaces and known enum values', () => {
    expect(
      validateAgentProjectPreferences(
        {
          workspaceId: 'workspace-1',
          permissionMode: 'smart-approval',
          executionEnvironment: 'local'
        },
        workspaceIds,
        { dockerAvailable: false, localAvailable: true }
      )
    ).toEqual({
      workspaceId: 'workspace-1',
      permissionMode: 'smart-approval',
      executionEnvironment: 'local'
    })
    expect(() =>
      validateAgentProjectPreferences(
        {
          workspaceId: 'workspace-2',
          permissionMode: 'smart-approval',
          executionEnvironment: 'local'
        },
        workspaceIds
      )
    ).toThrowError(/未授权/)
    expect(() =>
      validateAgentProjectPreferences(
        {
          workspaceId: 'workspace-1',
          permissionMode: 'unrestricted',
          executionEnvironment: 'local'
        },
        workspaceIds
      )
    ).toThrowError(/权限档位/)
  })

  it('can save permissions while retaining an unavailable Docker preference', () => {
    expect(
      validateAgentProjectPreferences(
        {
          workspaceId: 'workspace-1',
          permissionMode: 'ask-every-time',
          executionEnvironment: 'docker'
        },
        workspaceIds,
        { dockerAvailable: false, dockerReason: '沙箱未启用', localAvailable: true }
      )
    ).toMatchObject({ executionEnvironment: 'docker' })
  })
  it('rejects switching to the unavailable local backend', () => {
    expect(() => validateAgentProjectPreferences({
      workspaceId: 'workspace-1', permissionMode: 'read-only', executionEnvironment: 'local'
    }, workspaceIds, { dockerAvailable: false, localAvailable: false })).toThrowError('本机执行当前不可用')
  })
})
