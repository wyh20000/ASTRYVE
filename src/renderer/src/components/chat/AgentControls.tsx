import { useEffect, useRef, useState } from 'react'
import type { ExecutionEnvironment, PermissionMode } from '@shared/agent'
import type { AgentExecutionCapabilities } from '@shared/types'
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
  const [open, setOpen] = useState<'permission' | 'environment' | 'image' | null>(null)
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
  const setDockerImage = useAgentSettingsStore((state) => state.setDockerImage)

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
  const docker = project?.capabilities.dockerPreflight
  const images = project?.capabilities.dockerImages ?? []
  const selectedImage = images.find((image) => image.imageId === project?.preferences.dockerImageId)

  return (
    <div ref={container} className="relative flex min-w-0 items-center gap-1" onKeyDown={(event) => {
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
      {project?.preferences.executionEnvironment === 'docker' && <button
        type="button"
        disabled={disabled || images.length === 0}
        aria-expanded={open === 'image'}
        onClick={() => setOpen((value) => (value === 'image' ? null : 'image'))}
        className="chip flex min-w-0 max-w-[150px] items-center gap-1 border border-border text-txt-muted hover:border-accent hover:text-txt-secondary disabled:cursor-not-allowed disabled:opacity-50"
        title={selectedImage ? `${selectedImage.repository}:${selectedImage.tag} · ${selectedImage.imageId}` : '本机没有可选择的 Docker 镜像'}
      >
        <Icon.Container size={12} />
        <span className="truncate">{selectedImage ? `${selectedImage.repository}:${selectedImage.tag}` : '选择镜像'}</span>
        <Icon.ChevronDown size={11} />
      </button>}
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
      {error && <div role="alert" className="absolute bottom-full left-0 z-50 mb-2 max-w-[360px] rounded-md border border-border bg-bg-raised px-3 py-2 text-[11px] text-warn shadow-xl">
        {error}
        <button type="button" disabled={loading} className="ml-2 underline" onClick={() => {
          if (workspaceId) void load(workspaceId)
        }}>重新读取设置</button>
      </div>}

      {open && project && (
        <div className="absolute bottom-full left-0 z-40 mb-2 w-[300px] overflow-hidden rounded-lg border border-border bg-bg-raised shadow-2xl">
          <div className="border-b border-border px-3 py-2 text-[11px] text-txt-muted">
            {open === 'permission' ? 'AI Agent 可以执行哪些操作？'
              : open === 'environment' ? '代码在哪个环境中执行？' : '使用哪个本机已有镜像？'}
          </div>
          <div className="py-1">
            {open === 'image' ? images.map((image) => {
              const selected = image.imageId === project.preferences.dockerImageId
              return <button
                key={image.imageId}
                type="button"
                disabled={loading}
                onClick={() => { void setDockerImage(workspaceId!, image.imageId); setOpen(null) }}
                className="flex w-full items-start gap-2 px-3 py-2 text-left hover:bg-bg-active disabled:opacity-50"
              >
                <Icon.Container size={14} className="mt-0.5 shrink-0 text-txt-muted" />
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-[12px] text-txt-primary">{image.repository}:{image.tag}</span>
                  <span className="block truncate text-[10px] leading-4 text-txt-muted">
                    本机镜像 · {(image.digest ?? image.imageId).slice(0, 19)}… · 启动命令将覆盖 entrypoint
                  </span>
                </span>
                {selected && <Icon.Check size={13} className="mt-1 shrink-0 text-accent" />}
              </button>
            }) : (open === 'permission' ? PERMISSION_OPTIONS : ENVIRONMENT_OPTIONS).map((option) => {
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
                        ? (option.value === 'docker'
                            ? dockerStatusText(project.capabilities.dockerReason, docker)
                            : '本机执行后端尚未启用')
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

export function dockerStatusText(
  reason: string | undefined,
  status: AgentExecutionCapabilities['dockerPreflight']
): string {
  if (!status) return reason ?? 'Docker 状态未知'
  const facts = [
    status.clientVersion ? `CLI ${status.clientVersion}` : undefined,
    status.serverVersion ? `daemon ${status.serverVersion}` : undefined,
    status.linuxContainers ? 'Linux container' : undefined,
    status.imagePresent ? '内置镜像已安装' : undefined
  ].filter(Boolean)
  return `${reason ?? status.reason}${facts.length ? ` · ${facts.join(' · ')}` : ''}`
}
