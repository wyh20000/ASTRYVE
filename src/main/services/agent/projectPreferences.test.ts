import { describe, expect, it } from 'vitest'
import {
  defaultAgentProjectPreferences,
  validateAgentProjectPreferences
} from './projectPreferences'

const workspaceIds = new Set(['workspace-1'])

describe('project agent preferences', () => {
  it('defaults to ask-every-time and chooses Docker only when available', () => {
    expect(
      defaultAgentProjectPreferences('workspace-1', {
        dockerAvailable: false,
        localAvailable: true
      })
    ).toMatchObject({ permissionMode: 'ask-every-time', executionEnvironment: 'local' })
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
        workspaceIds
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

  it('rejects forged Docker selection while the backend is unavailable', () => {
    expect(() =>
      validateAgentProjectPreferences(
        {
          workspaceId: 'workspace-1',
          permissionMode: 'ask-every-time',
          executionEnvironment: 'docker'
        },
        workspaceIds,
        { dockerAvailable: false, dockerReason: '沙箱未启用', localAvailable: true }
      )
    ).toThrowError('沙箱未启用')
  })
})
