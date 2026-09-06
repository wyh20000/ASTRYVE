import { renderToStaticMarkup } from 'react-dom/server'
import { afterEach, describe, expect, it } from 'vitest'
import { useAgentSettingsStore } from '../../stores/agentSettingsStore'
import {
  AgentControls,
  dockerStatusText,
  executionEnvironmentLabel,
  permissionModeLabel,
  PERMISSION_OPTIONS
} from './AgentControls'

describe('AgentControls', () => {
  afterEach(() => {
    useAgentSettingsStore.setState({ projects: {}, loading: {}, errors: {} })
  })

  it('uses the recommended permission option first', () => {
    expect(PERMISSION_OPTIONS[0]).toMatchObject({
      value: 'ask-every-time',
      label: '请求批准'
    })
  })

  it('maps persisted values to their visible labels', () => {
    expect(permissionModeLabel('smart-approval')).toBe('帮我批准')
    expect(executionEnvironmentLabel('local')).toBe('本机执行')
  })

  it('disables both selectors until a workspace is selected', () => {
    const html = renderToStaticMarkup(<AgentControls />)
    expect(html.match(/disabled=""/g)).toHaveLength(2)
    expect(html).toContain('请先选择项目工作区')
  })

  it('describes the real Docker preflight state in the environment selector', () => {
    const text = dockerStatusText('内置沙箱镜像未安装：node:22.14.0-bookworm-slim', {
      checkedAt: 1, cliFound: true, clientVersion: '29.5.3', contextName: 'desktop-linux', localContext: true, daemonReachable: true,
      serverVersion: '29.5.3', operatingSystem: 'Docker Desktop', linuxContainers: true,
      diskChecked: true, imageReference: 'node:22.14.0-bookworm-slim', imagePresent: false,
      images: [],
      ready: false, reason: '内置沙箱镜像未安装：node:22.14.0-bookworm-slim'
    })
    expect(text).toContain('内置沙箱镜像未安装')
    expect(text).toContain('CLI 29.5.3')
    expect(text).toContain('Linux container')
  })
})
