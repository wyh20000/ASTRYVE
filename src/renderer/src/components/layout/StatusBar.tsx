import { useThemeStore } from '../../stores/themeStore'
import { useModelStore } from '../../stores/modelStore'
import { getTheme } from '../../theme/theme'

export default function StatusBar(): JSX.Element {
  const presetId = useThemeStore((s) => s.presetId)
  const overrides = useThemeStore((s) => s.overrides)
  const model = useModelStore((s) => s.config?.presets.find((p) => p.id === s.config?.activePresetId)?.model)
  const theme = getTheme(presetId)
  const custom = !!(overrides.bg || overrides.text || overrides.accent)

  return (
    <div className="flex h-6 shrink-0 items-center gap-3 border-t border-border bg-bg-panel px-3 text-[11px] text-txt-muted">
      <span className="selectable font-medium text-txt-secondary">AI Agent</span>
      <span className="selectable">模型：{model || '未配置'}</span>
      <span className="selectable">主题：{theme.name}{custom ? '（自定义）' : ''}</span>
      <span className="ml-auto selectable">就绪</span>
    </div>
  )
}