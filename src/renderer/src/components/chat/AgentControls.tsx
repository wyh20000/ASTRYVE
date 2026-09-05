import { useEffect, useRef, useState } from 'react'
import type { ExecutionEnvironment, PermissionMode } from '@shared/agent'
import { useAgentSettingsStore } from '../../stores/agentSettingsStore'
import { Icon } from '../ui/icons'

export const PERMISSION_OPTIONS: Array<{
  value: PermissionMode
  label: string
  description: string
}> = [
  { value: 'ask-every-time', label: '请求批准', description: '写文件、运行命令或联网前始终询问' },
  { value: 'smart-approval', label: '帮我批准', description: '仅自动放行沙箱内确定性的低风险操作' },
  { value: 'read-only', label: '只读', description: '只允许读取、搜索和查看 Git 信息' }
]

const ENVIRONMENT_OPTIONS: Array<{
  value: ExecutionEnvironment
  label: string
  description: string
}> = [
  { value: 'docker', label: 'Docker 沙箱', description: '在隔离的纯净容器中执行，默认断网' },
  { value: 'local', label: '本机执行', description: '直接使用项目环境，风险操作仍需批准' }
]

export function permissionModeLabel(value?: PermissionMode): string {
  return PERMISSION_OPTIONS.find((option) => option.value === value)?.label ?? '权限'
}

export function executionEnvironmentLabel(value?: ExecutionEnvironment): string {
  return ENVIRONMENT_OPTIONS.find((option) => option.value === value)?.label ?? '执行环境'
}

export function AgentControls({ workspaceId }: { workspaceId?: string }): JSX.Element {
  const [open, setOpen] = useState<'permission' | 'environment' | null>(null)
  const container = useRef<HTMLDivElement>(null)
  const project = useAgentSettingsStore((state) =>
    workspaceId ? state.projects[workspaceId] : undefined
  )
  const loading = useAgentSettingsStore((state) =>
    workspaceId ? state.loading[workspaceId] : false
  )
  const error = useAgentSettingsStore((state) =>
    workspaceId ? state.errors[workspaceId] : undefined
  )
  const load = useAgentSettingsStore((state) => state.load)
  const setPermissionMode = useAgentSettingsStore((state) => state.setPermissionMode)
  const setExecutionEnvironment = useAgentSettingsStore(
    (state) => state.setExecutionEnvironment
  )

  useEffect(() => {
    setOpen(null)
    if (workspaceId) void load(workspaceId)
  }, [load, workspaceId])

  useEffect(() => {
    if (!open) return
    const close = (event: MouseEvent): void => {
      if (!container.current?.contains(event.target as Node)) setOpen(null)
    }
    window.addEventListener('mousedown', close)
    return () => window.removeEventListener('mousedown', close)
  }, [open])

  const permission = PERMISSION_OPTIONS.find(
    (option) => option.value === project?.preferences.permissionMode
  )
  const environment = ENVIRONMENT_OPTIONS.find(
    (option) => option.value === project?.preferences.executionEnvironment
  )
  const disabled = !workspaceId || !project || loading
  const unavailable = project && (project.preferences.executionEnvironment === 'docker'
    ? !project.capabilities.dockerAvailable : !project.capabilities.localAvailable)

  return (
    <div ref={container} className="relative flex flex-wrap items-center gap-1" onKeyDown={(event) => {
      if (event.key === 'Escape') setOpen(null)
    }}>
      <button
        type="button"
        disabled={disabled}
        aria-expanded={open === 'permission'}
        onClick={() => setOpen((value) => (value === 'permission' ? null : 'permission'))}
        className="chip flex items-center gap-1 border border-border text-txt-muted hover:border-accent hover:text-txt-secondary disabled:cursor-not-allowed disabled:opacity-50"
        title={workspaceId ? permission?.description : '请先选择项目工作区'}
      >
        <Icon.Shield size={12} />
        {loading ? '读取中' : permissionModeLabel(project?.preferences.permissionMode)}
        <Icon.ChevronDown size={11} />
      </button>
      <button
        type="button"
        disabled={disabled}
        aria-expanded={open === 'environment'}
        onClick={() => setOpen((value) => (value === 'environment' ? null : 'environment'))}
        className="chip flex items-center gap-1 border border-border text-txt-muted hover:border-accent hover:text-txt-secondary disabled:cursor-not-allowed disabled:opacity-50"
        title={workspaceId ? environment?.description : '请先选择项目工作区'}
      >
        <Icon.Container size={12} />
        {executionEnvironmentLabel(project?.preferences.executionEnvironment)}
        {unavailable && ' · 不可用'}
        <Icon.ChevronDown size={11} />
      </button>
      {workspaceId && project && <span className="text-[10px] text-txt-muted">
        {project.preferences.executionEnvironment === 'local' && project.capabilities.localAvailable
          ? 'Coding 已启用 · 命令在本机项目根目录执行'
          : project.preferences.executionEnvironment === 'docker'
            ? 'Coding 待启用 · Docker 沙箱后端尚未完成'
            : 'Coding 执行环境不可用'}
      </span>}
      {error && <div role="alert" className="w-full text-[11px] text-warn">
        {error}
        <button type="button" disabled={loading} className="ml-2 underline" onClick={() => {
          if (workspaceId) void load(workspaceId)
        }}>重新读取设置</button>
      </div>}

      {open && project && (
        <div className="absolute bottom-full left-0 z-40 mb-2 w-[300px] overflow-hidden rounded-lg border border-border bg-bg-raised shadow-2xl">
          <div className="border-b border-border px-3 py-2 text-[11px] text-txt-muted">
            {open === 'permission' ? 'AI Agent 可以执行哪些操作？' : '代码在哪个环境中执行？'}
          </div>
          <div className="py-1">
            {(open === 'permission' ? PERMISSION_OPTIONS : ENVIRONMENT_OPTIONS).map((option) => {
              const environmentDisabled =
                (option.value === 'docker' && !project.capabilities.dockerAvailable) ||
                (option.value === 'local' && !project.capabilities.localAvailable)
              const selected =
                open === 'permission'
                  ? option.value === project.preferences.permissionMode
                  : option.value === project.preferences.executionEnvironment
              return (
                <button
                  key={option.value}
                  type="button"
                  disabled={environmentDisabled || loading}
                  onClick={() => {
                    if (open === 'permission') {
                      void setPermissionMode(workspaceId!, option.value as PermissionMode)
                    } else {
                      void setExecutionEnvironment(
                        workspaceId!,
                        option.value as ExecutionEnvironment
                      )
                    }
                    setOpen(null)
                  }}
                  className="flex w-full items-start gap-2 px-3 py-2 text-left hover:bg-bg-active disabled:cursor-not-allowed disabled:opacity-50"
                >
                  <span className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center text-txt-muted">
                    {open === 'permission' ? <Icon.Shield size={14} /> : <Icon.Container size={14} />}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block text-[12px] text-txt-primary">{option.label}</span>
                    <span className="block text-[10px] leading-4 text-txt-muted">
                      {environmentDisabled
                        ? (option.value === 'docker' ? project.capabilities.dockerReason : '本机执行后端尚未启用')
                        : option.description}
                    </span>
                  </span>
                  {selected && <Icon.Check size={13} className="mt-1 shrink-0 text-accent" />}
                </button>
              )
            })}
          </div>
          {error && <div className="border-t border-border px-3 py-2 text-[10px] text-red-400">{error}</div>}
        </div>
      )}
    </div>
  )
}
