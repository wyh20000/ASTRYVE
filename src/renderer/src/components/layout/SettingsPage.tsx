import { useEffect, useState, type ReactNode } from 'react'
import { useUiStore } from '../../stores/uiStore'
import { useThemeStore } from '../../stores/themeStore'
import { useModelStore } from '../../stores/modelStore'
import { THEMES, getTheme, normalizeHex, type ThemePreset } from '../../theme/theme'
import type { ModelProvider, ModelConfig, ModelPreset } from '@shared/types'
import { Icon } from '../ui/icons'

type Section = 'theme' | 'model'

const PROVIDER_PRESETS: Record<
  ModelProvider,
  { baseUrl: string; model: string; supportsVision: boolean; visionModel?: string }
> = {
  deepseek: {
    baseUrl: 'https://api.deepseek.com/v1',
    model: 'deepseek-v4-pro',
    supportsVision: true,
    visionModel: 'deepseek-v4-flash-vision-exp'
  },
  kimi: {
    baseUrl: 'https://api.moonshot.cn/v1',
    model: 'moonshot-v1-8k',
    supportsVision: true,
    visionModel: 'moonshot-v1-8k-vision-preview'
  },
  custom: { baseUrl: '', model: '', supportsVision: false }
}

/** 设置页（独立页面）：左侧导航列 + 右侧内容面板 */
export default function SettingsPage(): JSX.Element {
  const closeSettings = useUiStore((s) => s.closeSettings)
  const [section, setSection] = useState<Section>('theme')

  return (
    <div className="flex min-h-0 flex-1 bg-bg-app text-txt-primary">
      <div className="flex w-[200px] shrink-0 flex-col border-r border-border bg-bg-panel">
        <div className="flex h-12 items-center gap-2 px-3">
          <button className="btn-icon" title="返回" onClick={closeSettings}>
            <Icon.X size={15} />
          </button>
          <span className="text-[14px] font-semibold text-txt-primary">设置</span>
        </div>
        <div className="px-3 pb-2">
          <div className="relative">
            <Icon.Search size={13} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-txt-muted" />
            <input placeholder="搜索设置项..." className="input h-7 pl-7 text-[12px]" />
          </div>
        </div>
        <nav className="flex-1 space-y-1 px-2">
          <NavItem active={section === 'theme'} icon={<Icon.Settings size={14} />} label="主题设置" onClick={() => setSection('theme')} />
          <NavItem active={section === 'model'} icon={<Icon.Brain size={14} />} label="模型设置" onClick={() => setSection('model')} />
        </nav>
      </div>

      <div className="min-w-0 flex-1 overflow-y-auto">
        <div className="mx-auto max-w-[760px] px-6 py-6">
          {section === 'theme' ? <ThemeSection /> : <ModelSection />}
        </div>
      </div>
    </div>
  )
}

function NavItem({
  active,
  label,
  onClick,
  icon
}: {
  active: boolean
  label: string
  onClick: () => void
  icon: JSX.Element
}): JSX.Element {
  return (
    <button
      onClick={onClick}
      className={`flex w-full items-center gap-2 rounded-md px-3 py-2 text-[13px] ${
        active ? 'bg-bg-active text-txt-primary' : 'text-txt-secondary hover:bg-bg-raised'
      }`}
    >
      <span className={active ? 'text-accent' : 'text-txt-muted'}>{icon}</span>
      <span className="flex-1 text-left">{label}</span>
    </button>
  )
}

function Group({ title, children }: { title: string; children: ReactNode }): JSX.Element {
  return (
    <section className="mt-5 rounded-lg border border-border bg-bg-panel">
      <h2 className="border-b border-border px-4 py-3 text-[13px] font-semibold text-txt-primary">
        {title}
      </h2>
      <div className="px-4 py-4">{children}</div>
    </section>
  )
}

function Label({ children }: { children: ReactNode }): JSX.Element {
  return <div className="mb-2 text-[12px] text-txt-secondary">{children}</div>
}

function Field({ label, children }: { label: string; children: ReactNode }): JSX.Element {
  return (
    <div>
      <Label>{label}</Label>
      {children}
    </div>
  )
}

/* ---------------- 主题 ---------------- */

function ThemeSection(): JSX.Element {
  const presetId = useThemeStore((s) => s.presetId)
  const overrides = useThemeStore((s) => s.overrides)
  const setPreset = useThemeStore((s) => s.setPreset)
  const setBg = useThemeStore((s) => s.setBg)
  const setText = useThemeStore((s) => s.setText)
  const setAccent = useThemeStore((s) => s.setAccent)
  const resetOverrides = useThemeStore((s) => s.resetOverrides)

  const base = getTheme(presetId)
  const hasOverride = !!(overrides.bg || overrides.text || overrides.accent)

  return (
    <>
      <h1 className="selectable text-[18px] font-semibold text-txt-primary">主题设置</h1>
      <Group title="主题外观">
        <Label>应用主题（整体：背景 + 文字 + 强调色）</Label>
        <div className="grid grid-cols-3 gap-3">
          {THEMES.map((t) => (
            <ThemeCard
              key={t.id}
              theme={t}
              active={!hasOverride && t.id === presetId}
              onClick={() => setPreset(t.id)}
            />
          ))}
        </div>
        {hasOverride && (
          <button onClick={resetOverrides} className="mt-3 text-[12px] text-accent hover:underline">
            恢复预设主题
          </button>
        )}
      </Group>
      <Group title="自定义颜色">
        <div className="space-y-3">
          <ColorField label="背景色" value={overrides.bg ?? base.bgApp} onApply={setBg} />
          <ColorField label="文字颜色" value={overrides.text ?? base.textPrimary} onApply={setText} />
          <ColorField label="强调色" value={overrides.accent ?? base.accent} onApply={setAccent} />
        </div>
        <p className="mt-3 text-[12px] text-txt-muted">
          背景色是整体系统色；文字色与强调色可分别自定义。输入合法 HEX 并回车/失焦生效，输入什么就是什么。
        </p>
      </Group>
    </>
  )
}

function ThemeCard({
  theme,
  active,
  onClick
}: {
  theme: ThemePreset
  active: boolean
  onClick: () => void
}): JSX.Element {
  return (
    <button
      onClick={onClick}
      className={`flex flex-col items-center gap-2.5 rounded-lg border p-3 transition-colors ${
        active ? 'border-accent bg-bg-raised' : 'border-border bg-bg-app hover:border-border-strong'
      }`}
    >
      <div className="h-12 w-24 overflow-hidden rounded-md border border-border" style={{ background: theme.bgApp }}>
        <div className="h-3 w-full" style={{ background: theme.bgPanel }} />
        <div className="space-y-1 p-2">
          <div className="h-1.5 w-12 rounded-sm" style={{ background: theme.textSecondary }} />
          <div className="h-1.5 w-16 rounded-sm" style={{ background: theme.accent }} />
        </div>
      </div>
      <div className="flex items-center gap-1.5 text-[12px] text-txt-primary">
        <span className="h-2.5 w-2.5 rounded-full" style={{ background: theme.accent }} />
        <span>{theme.name}</span>
        {active && <Icon.Check size={13} className="text-accent" />}
      </div>
    </button>
  )
}

function ColorField({
  label,
  value,
  onApply
}: {
  label: string
  value: string
  onApply: (hex: string) => void
}): JSX.Element {
  const [text, setText] = useState(value)
  // 仅外部变化（预设/已提交）时同步，避免输入过程跳动
  useEffect(() => setText(value), [value])
  const valid = normalizeHex(text) != null
  const commit = (): void => {
    const n = normalizeHex(text)
    if (n) onApply(n)
    else setText(value)
  }
  return (
    <div className="flex items-center gap-2">
      <span className="w-20 shrink-0 text-[12px] text-txt-secondary">{label}</span>
      <input
        type="color"
        value={value}
        onChange={(e) => onApply(e.target.value)}
        className="h-9 w-12 cursor-pointer rounded-md border border-border bg-transparent"
        title="选择颜色"
      />
      <input
        value={text}
        onChange={(e) => setText(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => e.key === 'Enter' && commit()}
        placeholder="#xxxxxx"
        className={`input w-44 font-mono ${valid ? '' : 'border-warn'}`}
        spellCheck={false}
      />
    </div>
  )
}
/* ---------------- 模型 ---------------- */

function ModelSection(): JSX.Element {
  const config = useModelStore((s) => s.config)
  const load = useModelStore((s) => s.load)
  const save = useModelStore((s) => s.save)
  const activate = useModelStore((s) => s.activate)
  const test = useModelStore((s) => s.test)
  const [editing, setEditing] = useState<ModelPreset | null>(null)
  const [isNew, setIsNew] = useState(false)
  const [msg, setMsg] = useState('')

  useEffect(() => {
    void load()
  }, [load])

  const startNew = (): void => {
    setEditing({
      id: '',
      name: '',
      provider: 'deepseek',
      baseUrl: PROVIDER_PRESETS.deepseek.baseUrl,
      apiKey: '',
      model: PROVIDER_PRESETS.deepseek.model,
      contextMessages: 20,
      supportsVision: false,
      visionModel: undefined
    })
    setIsNew(true)
  }
  const startEdit = (p: ModelPreset): void => {
    setEditing({ ...p })
    setIsNew(false)
  }

  const commit = async (): Promise<void> => {
    if (!config || !editing) return
    const draft: ModelPreset = {
      ...editing,
      id: editing.id || crypto.randomUUID(),
      name: editing.name || editing.model
    }
    const presets = isNew
      ? [...config.presets, draft]
      : config.presets.map((x) => (x.id === draft.id ? draft : x))
    const r = await save({ presets, activePresetId: config.activePresetId })
    if (r) {
      setMsg('已保存')
      setEditing(null)
    } else setMsg('保存失败')
  }

  const remove = async (id: string): Promise<void> => {
    if (!config) return
    const presets = config.presets.filter((x) => x.id !== id)
    const activePresetId = config.activePresetId === id ? (presets[0]?.id ?? '') : config.activePresetId
    await save({ presets, activePresetId })
  }

  const doTest = async (p: ModelPreset): Promise<void> => {
    setMsg('测试中...')
    const t = await test(p)
    setMsg(t ? (t.success ? `✅ ${t.message}` : `❌ ${t.message}`) : '测试失败')
  }

  if (editing) {
    const set = (patch: Partial<ModelPreset>): void => setEditing((e) => (e ? { ...e, ...patch } : e))
    return (
      <>
        <h1 className="selectable text-[18px] font-semibold text-txt-primary">模型设置</h1>
        <Group title={isNew ? '新增模型' : '编辑模型'}>
          <div className="space-y-3">
            <Field label="名称">
              <input className="input" value={editing.name} onChange={(e) => set({ name: e.target.value })} placeholder="如 DeepSeek / Kimi / 我的模型" />
            </Field>
            <Label>提供方</Label>
            <div className="mb-3 flex gap-2">
              {(['deepseek', 'kimi', 'custom'] as ModelProvider[]).map((p) => (
                <button
                  key={p}
                  onClick={() => {
                    set({ provider: p })
                    if (p !== 'custom') {
                      set({
                        baseUrl: PROVIDER_PRESETS[p].baseUrl,
                        model: PROVIDER_PRESETS[p].model,
                        supportsVision: PROVIDER_PRESETS[p].supportsVision,
                        visionModel: PROVIDER_PRESETS[p].visionModel
                      })
                    } else {
                      set({ supportsVision: false, visionModel: undefined })
                    }
                  }}
                  className={`rounded-md border px-3 py-1.5 text-[13px] ${
                    editing.provider === p ? 'border-accent text-txt-primary' : 'border-border text-txt-secondary hover:border-border-strong'
                  }`}
                >
                  {p === 'deepseek' ? 'DeepSeek' : p === 'kimi' ? 'Kimi' : '自定义'}
                </button>
              ))}
            </div>
            <Field label="Base URL">
              <input className="input font-mono" value={editing.baseUrl} onChange={(e) => set({ baseUrl: e.target.value })} placeholder="https://.../v1" />
            </Field>
            <Field label="API Key">
              <input className="input font-mono" type="password" value={editing.apiKey} onChange={(e) => set({ apiKey: e.target.value })} placeholder="sk-..." />
            </Field>
            <Field label="模型">
              <input className="input font-mono" value={editing.model} onChange={(e) => set({ model: e.target.value })} placeholder="deepseek-chat / moonshot-v1-8k" />
            </Field>
            <Field label="上下文消息数（多轮记忆）">
              <input className="input font-mono" type="number" min={1} max={50} value={editing.contextMessages} onChange={(e) => set({ contextMessages: Number(e.target.value) || 20 })} />
            </Field>
            <Field label="视觉能力">
              <label className="flex cursor-pointer items-center gap-2 text-[13px] text-txt-secondary">
                <input
                  type="checkbox"
                  checked={editing.supportsVision}
                  onChange={(e) => set({ supportsVision: e.target.checked })}
                />
                支持图片（多模态视觉）
              </label>
            </Field>
            {editing.supportsVision && (
              <Field label="视觉模型名">
                <input
                  className="input font-mono"
                  value={editing.visionModel ?? ''}
                  onChange={(e) => set({ visionModel: e.target.value })}
                  placeholder="moonshot-v1-8k-vision-preview / qwen-vl-plus 等"
                />
              </Field>
            )}
          </div>
          <div className="mt-4 flex items-center gap-3">
            <button onClick={() => void commit()} className="btn border border-border bg-bg-raised px-3 py-1.5 text-txt-primary hover:border-accent">保存</button>
            <button onClick={() => void doTest(editing)} className="btn border border-border bg-bg-raised px-3 py-1.5 text-txt-primary hover:border-accent">测试连接</button>
            <button onClick={() => setEditing(null)} className="btn border border-border bg-bg-raised px-3 py-1.5 text-txt-secondary">取消</button>
            {msg && <span className="text-[12px] text-txt-secondary">{msg}</span>}
          </div>
        </Group>
      </>
    )
  }

  return (
    <>
      <h1 className="selectable text-[18px] font-semibold text-txt-primary">模型设置</h1>
      <Group title="已配置的模型">
        <div className="flex flex-col gap-2">
          {(config?.presets ?? []).map((p) => (
            <div key={p.id} className="flex items-center gap-3 rounded-md border border-border bg-bg-app px-3 py-2">
              <span className="flex h-7 w-7 items-center justify-center rounded-full bg-accent text-[12px] font-semibold text-white">{p.name.slice(0, 1).toUpperCase()}</span>
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2 text-[13px] text-txt-primary">
                  {p.name}
                  <span className="rounded bg-bg-active px-1.5 text-[10px] text-txt-muted">{p.provider}</span>
                  {p.supportsVision && <span className="rounded bg-accent-dim/30 px-1.5 text-[10px] text-accent">视觉</span>}
                </div>
                <div className="truncate text-[11px] text-txt-muted">{p.model}</div>
              </div>
              {p.id === config?.activePresetId && <span className="chip border border-accent bg-accent-dim/20 text-accent">当前</span>}
              <button className="btn-icon" title="设为当前" disabled={p.id === config?.activePresetId} onClick={() => void activate(p.id)}><Icon.Check size={14} /></button>
              <button className="btn-icon" title="编辑" onClick={() => startEdit(p)}><Icon.Edit size={14} /></button>
              <button className="btn-icon" title="测试" onClick={() => void doTest(p)}><Icon.Play size={14} /></button>
              <button className="btn-icon" title="删除" onClick={() => void remove(p.id)}><Icon.Trash size={14} /></button>
            </div>
          ))}
          <button onClick={startNew} className="btn justify-center gap-1.5 border border-dashed border-border bg-bg-app px-3 py-2 text-txt-secondary hover:border-accent hover:text-txt-primary">
            <Icon.Plus size={14} /> 新增模型
          </button>
        </div>
        {msg && <div className="mt-3 text-[12px] text-txt-secondary">{msg}</div>}
      </Group>
      <Group title="说明">
        <p className="text-[12px] leading-relaxed text-txt-secondary">
          可配置多个模型端点，对话输入框下方可通过下拉快速切换，并选择「低 / 中 / 高」推理等级（发送时作为 reasoning_effort 传给模型）。未配置时回退本地演示（Mock）。
        </p>
      </Group>
    </>
  )
}