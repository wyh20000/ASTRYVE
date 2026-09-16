import { useModelStore } from '../../stores/modelStore'
import { useResolvedTheme, useThemeStore } from '../../stores/themeStore'

const MODE_LABEL = { system: '跟随系统', light: '浅色', dark: '深色' } as const

export default function StatusBar(): JSX.Element {
  const mode = useThemeStore((s) => s.mode)
  const overrides = useThemeStore((s) => s.overrides)
  const theme = useResolvedTheme()
  const model = useModelStore((s) => s.config?.presets.find((p) => p.id === s.config?.activePresetId)?.model)
  const custom = !!(overrides.bg || overrides.text || overrides.accent)
  // 跟随系统时同时展示实际生效的明暗，避免用户不知道当前是哪一套
  const label = mode === 'system' ? `${MODE_LABEL[mode]}（${theme.light ? '浅色' : '深色'}）` : MODE_LABEL[mode]

  return (
    <div className="flex h-6 shrink-0 items-center gap-3 border-t border-border bg-bg-panel px-3 text-[14px] text-txt-muted">
      <span className="selectable font-medium text-txt-secondary">AI Agent</span>
      <span className="selectable">模型：{model || '未配置'}</span>
      <span className="selectable">主题：{label}{custom ? '（自定义）' : ''}</span>
      <span className="ml-auto selectable">就绪</span>
    </div>
  )
}
