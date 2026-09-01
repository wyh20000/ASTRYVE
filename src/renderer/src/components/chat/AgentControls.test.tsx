import { renderToStaticMarkup } from 'react-dom/server'
import { afterEach, describe, expect, it } from 'vitest'
import { useAgentSettingsStore } from '../../stores/agentSettingsStore'
import {
  AgentControls,
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
})
