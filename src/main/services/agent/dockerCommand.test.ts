import { describe, expect, it } from 'vitest'
import { BUILTIN_DOCKER_IMAGE, buildHardenedDockerRunArgs } from './dockerCommand'

describe('hardened Docker argv', () => {
  it('uses a fixed image, non-root user, no network and restrictive runtime flags', () => {
    const args = buildHardenedDockerRunArgs({
      containerName: 'ai-agent-task-1', workspacePath: 'C:\\safe-copy', executable: 'npm', args: ['test', '--', 'a;b']
    })
    expect(args).toContain(BUILTIN_DOCKER_IMAGE)
    expect(args).toEqual(expect.arrayContaining([
      '--network', 'none', '--read-only', '--cap-drop', 'ALL',
      '--security-opt', 'no-new-privileges', '--user', '10001:10001',
      '--env', 'HOME=/tmp/home', '--env', 'GIT_CONFIG_GLOBAL=/dev/null'
    ]))
    expect(args.at(-1)).toBe('a;b')
    expect(args).not.toContain('--privileged')
    expect(args).not.toContain('/var/run/docker.sock')
  })

  it('rejects arbitrary images, container names and executable-shaped shell input', () => {
    expect(() => buildHardenedDockerRunArgs({
      containerName: 'other', workspacePath: 'C:\\safe-copy', executable: 'npm', args: []
    })).toThrow('DOCKER_CONTAINER_NAME_INVALID')
    expect(() => buildHardenedDockerRunArgs({
      containerName: 'ai-agent-safe', workspacePath: 'C:\\safe-copy', imageReference: 'latest', executable: 'npm', args: []
    })).toThrow('DOCKER_IMAGE_NOT_APPROVED')
    expect(() => buildHardenedDockerRunArgs({
      containerName: 'ai-agent-safe', workspacePath: 'C:\\safe-copy', executable: 'npm && calc', args: []
    })).toThrow('DOCKER_EXECUTABLE_INVALID')
  })

  it('accepts only immutable local image ids and labels the cleanup deadline', () => {
    const imageId = `sha256:${'a'.repeat(64)}`
    const args = buildHardenedDockerRunArgs({
      containerName: 'ai-agent-safe', workspacePath: 'C:\\safe-copy', imageReference: imageId,
      executable: 'node', args: [], expiresAt: 12345
    })
    expect(args).toContain(imageId)
    expect(args).toEqual(expect.arrayContaining(['--label', 'com.ai-agent.expires-at=12345']))
  })
})
