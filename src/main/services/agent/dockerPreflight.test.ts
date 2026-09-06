import { describe, expect, it, vi } from 'vitest'
import { BUILTIN_DOCKER_IMAGE } from './dockerCommand'
import { runDockerPreflight, type DockerCommandRunner } from './dockerPreflight'

function runner(responses: Record<string, { exitCode: number; stdout?: string; stderr?: string }>): DockerCommandRunner {
  return vi.fn(async (_executable, args) => {
    const response = responses[args.join(' ')] ?? { exitCode: -1, stderr: 'unexpected command' }
    return { exitCode: response.exitCode, stdout: response.stdout ?? '', stderr: response.stderr ?? '' }
  })
}

describe('Docker preflight', () => {
  it('reports a complete ready status without invoking a shell', async () => {
    const run = runner({
      '--version': { exitCode: 0, stdout: 'Docker version 27.5.1, build test' },
      'context show': { exitCode: 0, stdout: 'desktop-linux\n' },
      'context inspect desktop-linux --format {{json .Endpoints.docker.Host}}': { exitCode: 0, stdout: '"npipe:////./pipe/dockerDesktopLinuxEngine"' },
      'info --format {{json .}}': { exitCode: 0, stdout: JSON.stringify({ OSType: 'linux', ServerVersion: '27.5.1', OperatingSystem: 'Docker Desktop' }) },
      'system df --format {{json .}}': { exitCode: 0, stdout: '{"Type":"Images","Size":"1GB"}\n' },
      [`image inspect ${BUILTIN_DOCKER_IMAGE} --format {{json .}}`]: {
        exitCode: 0, stdout: JSON.stringify({ Id: 'sha256:id', RepoDigests: ['node@sha256:abc'] })
      },
      'image ls --no-trunc --format {{json .}}': { exitCode: 0, stdout: JSON.stringify({
        Repository: 'node', Tag: '22.14.0-bookworm-slim',
        ID: `sha256:${'a'.repeat(64)}`, Digest: `sha256:${'b'.repeat(64)}`
      }) }
    })
    const result = await runDockerPreflight({ findExecutable: async () => 'C:\\Docker\\docker.exe', run, now: () => 123 })
    expect(result).toMatchObject({
      checkedAt: 123, cliFound: true, clientVersion: '27.5.1', contextName: 'desktop-linux',
      localContext: true, daemonReachable: true,
      linuxContainers: true, diskChecked: true, imagePresent: true, imageDigest: 'sha256:abc', ready: true,
      images: [{ repository: 'node', tag: '22.14.0-bookworm-slim', imageId: `sha256:${'a'.repeat(64)}`, source: 'local' }]
    })
    expect(run).toHaveBeenCalledTimes(7)
  })

  it('distinguishes missing CLI, stopped daemon, Windows containers and missing image', async () => {
    await expect(runDockerPreflight({ findExecutable: async () => undefined })).resolves.toMatchObject({ cliFound: false, ready: false })
    await expect(runDockerPreflight({ findExecutable: async () => 'docker', run: runner({
      '--version': { exitCode: 0 }, 'context show': { exitCode: 0, stdout: 'default' },
      'context inspect default --format {{json .Endpoints.docker.Host}}': { exitCode: 0, stdout: '"unix:///var/run/docker.sock"' },
      'info --format {{json .}}': { exitCode: 1, stderr: 'not running' }
    }) })).resolves.toMatchObject({ daemonReachable: false, reason: expect.stringContaining('not running') })
    await expect(runDockerPreflight({ findExecutable: async () => 'docker', run: runner({
      '--version': { exitCode: 0 }, 'context show': { exitCode: 0, stdout: 'default' },
      'context inspect default --format {{json .Endpoints.docker.Host}}': { exitCode: 0, stdout: '"unix:///var/run/docker.sock"' },
      'info --format {{json .}}': { exitCode: 0, stdout: '{"OSType":"windows"}' }
    }) })).resolves.toMatchObject({ daemonReachable: true, linuxContainers: false, ready: false })
    await expect(runDockerPreflight({ findExecutable: async () => 'docker', run: runner({
      '--version': { exitCode: 0 }, 'context show': { exitCode: 0, stdout: 'default' },
      'context inspect default --format {{json .Endpoints.docker.Host}}': { exitCode: 0, stdout: '"unix:///var/run/docker.sock"' },
      'info --format {{json .}}': { exitCode: 0, stdout: '{"OSType":"linux"}' },
      'system df --format {{json .}}': { exitCode: 0 },
      [`image inspect ${BUILTIN_DOCKER_IMAGE} --format {{json .}}`]: { exitCode: 1 }
    }) })).resolves.toMatchObject({ imagePresent: false, ready: false, reason: expect.stringContaining('内置沙箱镜像未安装') })
  })

  it('rejects remote Docker contexts before contacting their daemon', async () => {
    const run = runner({
      '--version': { exitCode: 0 }, 'context show': { exitCode: 0, stdout: 'remote' },
      'context inspect remote --format {{json .Endpoints.docker.Host}}': { exitCode: 0, stdout: '"ssh://server"' }
    })
    await expect(runDockerPreflight({ findExecutable: async () => 'docker', run }))
      .resolves.toMatchObject({ localContext: false, daemonReachable: false, reason: expect.stringContaining('远程 daemon') })
    expect(run).toHaveBeenCalledTimes(3)
  })
})
