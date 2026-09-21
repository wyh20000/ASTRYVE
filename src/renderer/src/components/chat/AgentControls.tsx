import { useEffect, useRef, useState } from 'react'
import type { ExecutionEnvironment, PermissionMode } from '@shared/agent'
import type { AgentExecutionCapabilities } from '@shared/types'
import { useAgentSettingsStore } from '../../stores/agentSettingsStore'
import { useSessionStore } from '../../stores/sessionStore'
import { useWorkspaceStore } from '../../stores/workspaceStore'
import { Icon } from '../ui/icons'
import { useDismissibleLayer } from '../../hooks/useDismissibleLayer'

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

  useDismissibleLayer(container, Boolean(open), () => setOpen(null))

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
        <span className="responsive-control-label">{loading ? '读取中' : permissionModeLabel(project?.preferences.permissionMode)}</span>
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
        <span className="responsive-control-label truncate">{selectedImage ? `${selectedImage.repository}:${selectedImage.tag}` : '选择镜像'}</span>
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
        <span className="responsive-control-label">{executionEnvironmentLabel(project?.preferences.executionEnvironment)}{unavailable && ' · 不可用'}</span>
        <Icon.ChevronDown size={11} />
      </button>
      {error && <div role="alert" className="absolute bottom-full left-0 z-50 mb-2 max-w-[360px] rounded-md border border-border bg-bg-raised px-3 py-2 text-[14px] text-warn shadow-xl">
        {error}
        <button type="button" disabled={loading} className="ml-2 underline" onClick={() => {
          if (workspaceId) void load(workspaceId)
        }}>重新读取设置</button>
      </div>}

      {open && project && (
        <div className="absolute bottom-full left-0 z-40 mb-2 w-[300px] overflow-hidden rounded-lg border border-border bg-bg-raised shadow-2xl">
          <div className="border-b border-border px-3 py-2 text-[14px] text-txt-muted">
            {open === 'permission' ? 'ASTRYVE 可以执行哪些操作？'
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
                  <span className="block truncate text-[14px] text-txt-primary">{image.repository}:{image.tag}</span>
                  <span className="block truncate text-[14px] leading-[20px] text-txt-muted">
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
                    <span className="block text-[14px] text-txt-primary">{option.label}</span>
                    <span className="block text-[14px] leading-[20px] text-txt-muted">
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
          {error && <div className="border-t border-border px-3 py-2 text-[14px] text-err">{error}</div>}
        </div>
      )}
    </div>
  )
}

/** 设置页中的项目级 Agent 配置。对话输入区只保留模型选择，避免频繁误触执行策略。 */
export function AgentSettingsSection(): JSX.Element {
  const activeId = useSessionStore((state) => state.activeId)
  const projectPath = useSessionStore((state) =>
    state.sessions.find((session) => session.id === activeId)?.projectPath
  )
  const workspace = useWorkspaceStore((state) =>
    state.recent.find((item) => item.displayPath === projectPath)
  )
  const workspaceId = workspace?.id
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
  const setExecutionEnvironment = useAgentSettingsStore((state) => state.setExecutionEnvironment)
  const setDockerImage = useAgentSettingsStore((state) => state.setDockerImage)

  useEffect(() => {
    if (workspaceId) void load(workspaceId)
  }, [load, workspaceId])

  const environment = project?.preferences.executionEnvironment
  const images = project?.capabilities.dockerImages ?? []

  return <div className="pb-12">
    <h1 className="selectable text-[22px] font-semibold tracking-tight text-txt-primary">Agent 设置</h1>
    <p className="mt-1 text-[14px] text-txt-muted">配置当前项目的执行位置、权限审批和 Docker 镜像</p>

    <div className="mt-6 rounded-xl border border-border bg-bg-panel">
      <div className="border-b border-border px-4 py-3">
        <div className="text-[14px] font-medium text-txt-primary">当前项目</div>
        <div className="mt-1 truncate text-[14px] text-txt-muted">
          {workspace ? `${workspace.name} · ${workspace.displayPath}` : '请先返回对话并选择一个项目'}
        </div>
      </div>

      {!workspaceId ? <div className="px-4 py-10 text-center text-[14px] text-txt-muted">选择项目后即可配置 Agent</div>
        : !project ? <div className="px-4 py-10 text-center text-[14px] text-txt-muted">{loading ? '正在读取项目设置…' : '项目设置尚未加载'}</div>
        : <div className="divide-y divide-border">
          <SettingsChoice
            title="权限审批"
            description="决定 Agent 在执行写入、命令和联网操作前是否需要批准。"
            options={PERMISSION_OPTIONS}
            value={project.preferences.permissionMode}
            disabled={loading}
            onChange={(value) => void setPermissionMode(workspaceId, value as PermissionMode)}
            icon="shield"
          />
          <SettingsChoice
            title="执行环境"
            description="项目任务可以在隔离的 Docker 沙箱或当前电脑上执行。"
            options={ENVIRONMENT_OPTIONS.map((option) => ({
              ...option,
              disabled: option.value === 'docker'
                ? !project.capabilities.dockerAvailable
                : !project.capabilities.localAvailable,
              /*
               * 卡片正文用人话说明状态；系统错误原文交给 title，
               * 避免把多行报错铺在设置页并撑高整行网格。
               */
              description: option.value === 'docker' && !project.capabilities.dockerAvailable
                ? dockerStatusBrief(project.capabilities.dockerReason, project.capabilities.dockerPreflight)
                : option.description,
              detail: option.value === 'docker' && !project.capabilities.dockerAvailable
                ? dockerStatusText(project.capabilities.dockerReason, project.capabilities.dockerPreflight)
                : undefined
            }))}
            value={environment}
            disabled={loading}
            onChange={(value) => void setExecutionEnvironment(workspaceId, value as ExecutionEnvironment)}
            icon="container"
          />
          {environment === 'docker' && <section className="px-4 py-4">
            <h2 className="text-[14px] font-medium text-txt-primary">Docker 镜像</h2>
            <p className="mt-1 text-[14px] text-txt-muted">选择本机已有镜像。Agent 启动命令会覆盖镜像 entrypoint。</p>
            <div className="mt-3 grid gap-2 sm:grid-cols-2">
              {images.map((image) => {
                const selected = image.imageId === project.preferences.dockerImageId
                return <button key={image.imageId} type="button" disabled={loading}
                  onClick={() => void setDockerImage(workspaceId, image.imageId)}
                  className={`flex min-w-0 items-start gap-2 rounded-lg border px-3 py-2.5 text-left transition-colors ${selected ? 'border-accent bg-accent-dim/10' : 'border-border bg-bg-app hover:border-border-strong'}`}>
                  <Icon.Container size={15} className={selected ? 'mt-0.5 text-accent' : 'mt-0.5 text-txt-muted'} />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-[14px] text-txt-primary">{image.repository}:{image.tag}</span>
                    <span className="mt-0.5 block truncate font-mono text-[14px] text-txt-muted">{image.digest ?? image.imageId}</span>
                  </span>
                  {selected && <Icon.Check size={14} className="mt-0.5 shrink-0 text-accent" />}
                </button>
              })}
              {!images.length && <div className="col-span-full rounded-lg border border-dashed border-border px-3 py-6 text-center text-[14px] text-txt-muted">本机没有可用的 Docker 镜像</div>}
            </div>
          </section>}
        </div>}
    </div>
    {error && <div role="alert" className="mt-3 rounded-lg border border-red-500/20 bg-red-500/5 px-3 py-2 text-[14px] text-err">{error}</div>}
    <p className="mt-4 text-[14px] leading-[22px] text-txt-muted">这些设置按项目保存。联网检索由模型能力自动提供，不需要在每次对话中手动开关。</p>
  </div>
}

function SettingsChoice({ title, description, options, value, disabled, onChange, icon }: {
  title: string
  description: string
  options: Array<{ value: string; label: string; description: string; detail?: string; disabled?: boolean }>
  value?: string
  disabled: boolean
  onChange: (value: string) => void
  icon: 'shield' | 'container'
}): JSX.Element {
  return <section className="px-4 py-4">
    <h2 className="text-[14px] font-medium text-txt-primary">{title}</h2>
    <p className="mt-1 text-[14px] text-txt-muted">{description}</p>
    <div className="mt-3 grid gap-2 sm:grid-cols-3">
      {options.map((option) => {
        const selected = option.value === value
        return <button key={option.value} type="button" disabled={disabled || option.disabled}
          onClick={() => onChange(option.value)}
          /*
           * 完整描述放 title：Docker 不可用时这里会是一整段系统错误原文，
           * 直接平铺会把卡片撑高并连带拉高整行网格（另一张卡出现大片空白）。
           */
          title={option.detail ?? option.description}
          className={`flex min-h-[78px] items-start gap-2 rounded-lg border px-3 py-2.5 text-left transition-colors disabled:cursor-not-allowed disabled:opacity-45 ${selected ? 'border-accent bg-accent-dim/10' : 'border-border bg-bg-app hover:border-border-strong'}`}>
          <span className={selected ? 'mt-0.5 text-accent' : 'mt-0.5 text-txt-muted'}>
            {icon === 'shield' ? <Icon.Shield size={15} /> : <Icon.Container size={15} />}
          </span>
          <span className="min-w-0 flex-1">
            <span className="flex items-center gap-1 text-[14px] text-txt-primary">{option.label}{selected && <Icon.Check size={12} className="text-accent" />}</span>
            <span className="mt-1 block text-[14px] leading-[20px] text-txt-muted">{option.description}</span>
          </span>
        </button>
      })}
    </div>
  </section>
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
/**
 * 卡片用的简短 Docker 状态说明。
 *
 * 为什么不直接用 dockerStatusText：那个函数会拼出完整的系统错误原文
 * （例如 npipe 连接失败的多行提示），把它铺在设置卡片里既不可读、
 * 又会把卡片撑高并连带拉高整行网格。
 *
 * 这里只回答用户真正关心的两件事：能不能用、为什么不能。
 * 完整原文仍通过 dockerStatusText 提供给 title，便于排查。
 */
export function dockerStatusBrief(
  reason: string | undefined,
  status: AgentExecutionCapabilities['dockerPreflight']
): string {
  if (!status) return '暂时无法确认 Docker 是否可用'
  if (!status.cliFound) return '未检测到 Docker CLI，需要先安装 Docker Desktop'
  if (!status.daemonReachable) return 'Docker 已安装但未运行，请先启动 Docker Desktop'
  if (!status.linuxContainers) return '当前 Docker 未启用 Linux 容器，无法运行沙箱'
  if (!status.imagePresent) return '缺少内置沙箱镜像，需要先拉取后才能使用'
  return reason?.trim() ? '当前环境暂不可用' : 'Docker 沙箱暂不可用'
}
