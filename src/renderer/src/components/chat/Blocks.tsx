import { useEffect, useMemo, useRef, useState } from 'react'
import hljs from 'highlight.js'
import { Sources, Think } from '@ant-design/x'
import type { MessageBlock, MessageStatus, PatchDiffBlock, PatchDiffFile, SourceCitation } from '@shared/types'
import MarkdownRenderer from './MarkdownRenderer'
import { Button, IconButton } from '../ui'
import { Icon } from '../ui/icons'
import { escapeHtml } from '../../lib/escape'

/** 将 markdown 文本切分成「普通段落」与「代码块」，代码块走自定义渲染（带语言 + 复制） */
const FENCE = /```([\w+-]*)\n?([\s\S]*?)(?:```|$)/g

export function RichText({ text }: { text: string }): JSX.Element {
  const parts = useMemo(() => {
    const out: { type: 'md' | 'code'; raw?: string; lang?: string; code?: string }[] = []
    let last = 0
    let m: RegExpExecArray | null
    FENCE.lastIndex = 0
    while ((m = FENCE.exec(text))) {
      if (m.index > last) out.push({ type: 'md', raw: text.slice(last, m.index) })
      out.push({ type: 'code', lang: m[1] || 'code', code: m[2].replace(/\n$/, '') })
      last = m.index + m[0].length
    }
    if (last < text.length) out.push({ type: 'md', raw: text.slice(last) })
    return out
  }, [text])

  return (
    <div className="space-y-3">
      {parts.map((p, i) =>
        p.type === 'code' ? (
          <CodeBlock key={i} language={p.lang!} code={p.code!} />
        ) : (
          <MarkdownRenderer key={i}>{p.raw!}</MarkdownRenderer>
        )
      )}
    </div>
  )
}

/**
 * 块列表。
 *
 * 两个刻意的设计：
 *
 * 1. **key 用「同类序号」而不是数组下标**。列表是流式重建的（主进程每来一个
 *    delta 就重拼一次 `blocks`，工具轮次/联网回退还可能整段换掉），
 *    下标做 key 会让「同一位置的组件」在块种类变化时被 React 复用/重建，
 *    用户的展开状态就随之中断。用 `thinking-0` / `plan-1` 这类稳定标识，
 *    追加与插入都不会影响已有块。
 * 2. **思考面板的展开状态放在这里（或更上层），而不是块组件内部**。块组件会随
 *    列表重建而重挂载（例如末尾的 activity 思考块在 `ev.content` 到达时被移除、
 *    下一轮工具调用再出现），状态放在块内部就会被重置成「收起」。
 *    调用方（`MessageItem`）传 `thinkingOpen` 时状态归调用方所有，
 *    这样连整条消息短暂没有块（重试/联网回退前的清空）也不会丢；
 *    不传则本组件自持，便于单独使用与测试。
 */
export function Blocks({
  blocks,
  status,
  thinkingOpen,
  onToggleThinking
}: {
  blocks: MessageBlock[]
  status: MessageStatus
  /** key 为 `${kind}-${同类序号}` */
  thinkingOpen?: Record<string, boolean>
  onToggleThinking?: (key: string, next: boolean) => void
}): JSX.Element {
  const [localOpen, setLocalOpen] = useState<Record<string, boolean>>({})
  const open = thinkingOpen ?? localOpen
  const toggle = (key: string, next: boolean): void => {
    if (onToggleThinking) onToggleThinking(key, next)
    else setLocalOpen((s) => ({ ...s, [key]: next }))
  }
  const counters = new Map<string, number>()
  return (
    <div className="space-y-3">
      {blocks.map((b) => {
        const ordinal = counters.get(b.kind) ?? 0
        counters.set(b.kind, ordinal + 1)
        const key = `${b.kind}-${ordinal}`
        return (
          <Block
            key={key}
            block={b}
            status={status}
            open={open[key] ?? false}
            onToggle={(next) => toggle(key, next)}
          />
        )
      })}
    </div>
  )
}

function Block({
  block,
  status,
  open,
  onToggle
}: {
  block: MessageBlock
  status: MessageStatus
  open: boolean
  onToggle: (next: boolean) => void
}): JSX.Element | null {
  switch (block.kind) {
    case 'thinking':
      return (
        <ThinkingBlock
          content={block.content}
          status={block.done ? 'done' : status}
          open={open}
          onToggle={onToggle}
        />
      )
    case 'text':
      return <RichText text={block.content} />
    case 'plan':
      return <PlanBlock items={block.items} />
    case 'files':
      return <FilesBlock files={block.files} />
    case 'code':
      return <CodeBlock language={block.language} code={block.code} filename={block.filename} />
    case 'sources':
      return <SourcesBlock sources={block.sources} />
    case 'skills':
      return null
    case 'plugins':
      return <PluginBlock block={block} />
    case 'diff':
      return <DiffBlock block={block} status={status} />
    case 'command':
      return <CommandBlock block={block} />
    case 'report':
      return <TaskReport block={block} />
    default:
      return null
  }
}

function PluginBlock({ block }: { block: Extract<MessageBlock, { kind: 'plugins' }> }): JSX.Element {
  return <div className="flex max-w-[720px] flex-wrap items-center gap-2 rounded-md border border-accent/30 bg-accent-dim/10 px-3 py-2 text-[14px]">
    <Icon.Brain size={13} className="text-accent" />
    <span className="text-txt-secondary">正在使用插件</span>
    {block.plugins.map((plugin) => <span key={plugin.id} className="rounded bg-bg-raised px-2 py-0.5 text-txt-primary">
      {plugin.id}{plugin.version ? ` · ${plugin.version}` : ''}
    </span>)}
    <span className="ml-auto max-w-[180px] truncate text-txt-muted" title={block.model}>{block.model}</span>
  </div>
}

function TaskReport({ block }: { block: Extract<MessageBlock, { kind: 'report' }> }): JSX.Element {
  const passed = block.tests.filter((test) => test.passed).length
  return <div className="max-w-[720px] rounded-md border border-border bg-bg-panel p-3 text-[14px]">
    <div className="mb-2 flex items-center gap-2 font-medium text-txt-primary"><Icon.Check size={14} className={block.unresolved.length ? 'text-warn' : 'text-ok'} />任务报告</div>
    <div className="grid grid-cols-2 gap-x-4 gap-y-1 text-txt-secondary">
      <span>修改文件</span><span>{block.files.length}</span>
      <span>执行命令</span><span>{block.commands.length}</span>
      <span>测试</span><span>{passed}/{block.tests.length} 通过</span>
      <span>用户批准</span><span>{block.approvals.length}</span>
    </div>
    {block.unresolved.length > 0 && <div className="mt-2 border-t border-border pt-2 text-warn">未解决：{block.unresolved.join('；')}</div>}
  </div>
}

function CommandBlock({ block }: { block: Extract<MessageBlock, { kind: 'command' }> }): JSX.Element {
  const [open, setOpen] = useState(block.exitCode !== 0)
  return (
    <div className="max-w-[720px] overflow-hidden rounded-md border border-border bg-bg-panel">
      <button type="button" className="flex w-full items-center gap-2 px-3 py-2 text-[14px] hover:bg-bg-raised" onClick={() => setOpen((v) => !v)}>
        <Icon.Terminal size={14} className={block.exitCode === 0 ? 'text-ok' : 'text-red-300'} />
        <span className="truncate font-mono text-txt-primary">{block.executable} {block.args.join(' ')}</span>
        <span className="ml-auto text-txt-muted">{block.durationMs}ms · exit {block.exitCode ?? '—'}</span>
        <Icon.ChevronDown size={13} className={open ? '' : '-rotate-90'} />
      </button>
      {open && <pre className="selectable max-h-72 overflow-auto border-t border-border bg-bg-app p-3 text-[14px] leading-[21px] text-txt-secondary">{[
        block.stdout, block.stderr && `stderr:\n${block.stderr}`, block.truncated && '[输出已截断]'
      ].filter(Boolean).join('\n')}</pre>}
    </div>
  )
}

function DiffBlock({ block, status }: { block: PatchDiffBlock; status: MessageStatus }): JSX.Element {
  const [current, setCurrent] = useState(block)
  const [openFiles, setOpenFiles] = useState(() => new Set(block.files.map((file) => file.path)))
  const [rejecting, setRejecting] = useState<string>()
  const [error, setError] = useState('')
  useEffect(() => { setCurrent(block) }, [block.patchHash])
  const reject = async (file: PatchDiffFile): Promise<void> => {
    setRejecting(file.path)
    setError('')
    const result = await window.agent.workspace.rejectPatchFile({
      taskId: current.taskId, patchHash: current.patchHash, path: file.path
    })
    if (result.ok) {
      setCurrent(result.data)
      setOpenFiles((previous) => {
        const next = new Set(previous)
        next.delete(file.path)
        return next
      })
    } else setError(result.error.message)
    setRejecting(undefined)
  }
  return (
    <section className="max-w-[820px] overflow-hidden rounded-md border border-border bg-bg-panel">
      <header className="flex items-center gap-2 border-b border-border px-3 py-2 text-[14px]">
        <Icon.Edit size={14} className="text-accent" />
        <span className="font-medium text-txt-primary">待写回变更</span>
        <span className="text-txt-muted">{current.files.length} 个文件</span>
        <span className="ml-auto font-mono text-ok">+{current.linesAdded}</span>
        <span className="font-mono text-red-400">-{current.linesDeleted}</span>
      </header>
      {current.files.length === 0 ? (
        <div className="px-3 py-3 text-[14px] text-txt-muted">所有文件均已拒绝，不会写回宿主项目。</div>
      ) : current.files.map((file) => {
        const open = openFiles.has(file.path)
        return (
          <div key={file.path} className="border-b border-border last:border-b-0">
            <div className="flex items-center gap-2 px-3 py-2 text-[14px]">
              <button
                type="button"
                className="flex min-w-0 flex-1 items-center gap-2 text-left hover:text-txt-primary"
                onClick={() => setOpenFiles((previous) => {
                  const next = new Set(previous)
                  if (next.has(file.path)) next.delete(file.path); else next.add(file.path)
                  return next
                })}
                aria-expanded={open}
              >
                <Icon.ChevronRight size={13} className={`shrink-0 transition-transform ${open ? 'rotate-90' : ''}`} />
                <span className="truncate font-mono text-txt-primary" title={file.path}>{file.path}</span>
                {file.previousPath && <span className="truncate text-txt-muted">← {file.previousPath}</span>}
              </button>
              <span className="font-mono text-ok">+{file.linesAdded}</span>
              <span className="font-mono text-red-400">-{file.linesDeleted}</span>
              {status === 'streaming' && (
                <Button
                  variant="danger"
                  size="sm"
                  disabled={Boolean(rejecting)}
                  onClick={() => void reject(file)}
                >
                  {rejecting === file.path ? '拒绝中…' : '拒绝此文件'}
                </Button>
              )}
            </div>
            {open && <DiffCode diff={file.diff} />}
          </div>
        )
      })}
      <footer className="border-t border-border px-3 py-1.5 font-mono text-[14px] text-txt-muted">
        SHA-256 {current.patchHash}
      </footer>
      {error && <div className="border-t border-red-500/20 bg-red-500/5 px-3 py-2 text-[14px] text-red-300">{error}</div>}
    </section>
  )
}

function DiffCode({ diff }: { diff: string }): JSX.Element {
  return (
    <pre className="selectable max-h-96 overflow-auto border-t border-border bg-bg-app p-2 text-[14px] leading-[21px]">
      {diff.split('\n').map((line, index) => {
        const style = line.startsWith('+') && !line.startsWith('+++')
          ? 'bg-emerald-500/10 text-emerald-300'
          : line.startsWith('-') && !line.startsWith('---')
            ? 'bg-red-500/10 text-red-300'
            : line.startsWith('@@') ? 'text-sky-300' : 'text-txt-secondary'
        return <code key={index} className={`block min-w-max px-1 ${style}`}>{line || ' '}</code>
      })}
    </pre>
  )
}

function prettyLang(lang: string): string {
  const map: Record<string, string> = {
    ts: 'TypeScript',
    typescript: 'TypeScript',
    js: 'JavaScript',
    javascript: 'JavaScript',
    py: 'Python',
    python: 'Python',
    json: 'JSON',
    html: 'HTML',
    css: 'CSS',
    bash: 'Bash',
    sh: 'Bash',
    shell: 'Shell',
    yml: 'YAML',
    yaml: 'YAML',
    java: 'Java',
    cpp: 'C++',
    c: 'C',
    go: 'Go',
    rs: 'Rust'
  }
  const mapped = map[lang.toLowerCase()]
  return mapped ?? (lang || 'code')
}

type CopyFn = (text: string) => Promise<void>
const copyText: CopyFn = async (text) => {
  try {
    await navigator.clipboard.writeText(text)
  } catch {
    const ta = document.createElement('textarea')
    ta.value = text
    ta.style.position = 'fixed'
    ta.style.opacity = '0'
    document.body.appendChild(ta)
    ta.select()
    document.execCommand('copy')
    document.body.removeChild(ta)
  }
}

/**
 * 思考过程（阶段 C · 设计文档 7.5）。
 *
 * 外壳迁移到 Ant Design X 的 `Think`：状态图标、展开/收起动画由组件提供。
 * 展开状态是**受控**的：`Think` 只负责渲染与回调，状态由 `Blocks` 持有
 * （与官方 `expanded` + `onExpand` 示例一致），这样块列表在流式期间重建时
 * 不会把用户刚点开的面板重置掉。
 *
 * 用户实测反馈后的三条约定：
 *
 * 1. **不做「思考结束自动收起」**。原来 `finished` 一变就 `setOpen(false)`，
 *    而思考段落随时可能被工具调用结束掉（`finishThinking`），
 *    结果就是「流式期间点开，有时看得到、有时立刻就没了」。
 *    面板初始是收起的，任何展开都是用户主动点的，不该被抢走。
 * 2. **展开/收起的可见性只由 `open` 决定，不依赖 `Think` 的折叠动画**。
 *    `Think` 的折叠走 rc-motion 的高度动画：点开后先写内联
 *    `height: 0; opacity: 0`（`.ant-motion-collapse-enter`），再等**两帧 rAF**
 *    才切到内容高度；流式期间渲染密集、rAF 被推迟（真实窗口实测 300ms 才
 *    跑到 1 帧），这期间就是「箭头转了、内容被裁成 0 高度且全透明」，
 *    即用户反馈的「展开了但里面空的」；更糟的是这条链没跑完时
 *    `motionDeadline` 也不会挂上（它只在 STEP_ACTIVE 才挂），所以不是
 *    「慢一点」，而会一直空着。因此正文只在 `open` 时挂载，
 *    `global.css` 再把展开态定成内容高度、收起态包装层直接 `display: none`。
 * 3. **思考中只保留前置图标 360° 旋转**。原来 `loading`（转圈）+ 标题里的
 *    点点点同时动，两个指示器重复且嘈杂；现在由 `.thinking-streaming`
 *    驱动 Think 自己的图标旋转，文字不再闪烁。
 *
 * 一个刻意保留的细节：`Think` 的标题行是 `<div onClick>`，本身不可聚焦，
 * 若直接使用会导致键盘用户无法展开思考过程（迁移前是 `<button>`）。
 * 因此标题内容仍是一个真正的 `<button>`：点击冒泡到 `Think` 的标题行触发
 * 切换，键盘 Enter/Space 同样有效，并用 `aria-expanded` 暴露当前状态。
 *
 * 其余能力保持原样：流式「回到底部」、展开后的滚动容器、14px 正文。
 */
function ThinkingBlock({
  content,
  status,
  open,
  onToggle
}: {
  content: string
  status: MessageStatus
  open: boolean
  onToggle: (next: boolean) => void
}): JSX.Element {
  const streaming = status === 'streaming'
  const [stick, setStick] = useState(true)
  const scrollRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open || !streaming || !stick) return
    const element = scrollRef.current
    if (element) requestAnimationFrame(() => { element.scrollTop = element.scrollHeight })
  }, [content, open, stick, streaming])

  return (
    <Think
      expanded={open}
      onExpand={onToggle}
      /* 不再传 loading：避免与图标旋转重复；图标动画见 global.css 的 .thinking-streaming */
      classNames={{
        root: streaming ? 'thinking-panel max-w-[720px] thinking-streaming' : 'thinking-panel max-w-[720px]',
        content: 'rounded-md bg-bg-app py-2 pr-3'
      }}
      title={
        <button
          type="button"
          aria-expanded={open}
          /* 不自己调用 onToggle：点击冒泡到 Think 的标题行，由它统一处理 */
          className="flex items-center gap-1.5 border-0 bg-transparent p-0 text-left text-[14px] font-medium text-txt-secondary"
        >
          {streaming ? '思考中' : '思考过程'}
        </button>
      }
    >
      {/*
       * 正文只在展开时挂载：展开/收起的可见性完全由这个状态决定，
       * 不再依赖 `Think` 的折叠动画（原因见下面 `open` 的注释与
       * global.css 里的 .thinking-panel 规则）。
       */}
      {open && (
        <div
          ref={scrollRef}
          className="relative max-h-72 overflow-y-auto px-3 pb-1 pt-2"
          onScroll={(event) => {
            const element = event.currentTarget
            setStick(element.scrollHeight - element.scrollTop - element.clientHeight < 48)
          }}
        >
          <div className="selectable whitespace-pre-wrap break-words text-[14px] leading-[22px] text-txt-secondary">
            {content}
          </div>
          {!stick && streaming && <button
            type="button"
            onClick={() => {
              setStick(true)
              const element = scrollRef.current
              if (element) element.scrollTop = element.scrollHeight
            }}
            className="sticky bottom-1 left-1/2 mt-2 -translate-x-1/2 rounded-full border border-border bg-bg-raised px-2.5 py-1 text-[14px] text-txt-secondary shadow-lg hover:text-txt-primary"
          >
            回到底部
          </button>}
        </div>
      )}
    </Think>
  )
}

/**
 * 引用来源（阶段 C · 设计文档 7.5）。
 *
 * 迁移到 Ant Design X 的 `Sources`：条目结构（`items` + `<a target="_blank">`）
 * 与折叠动画由组件提供，调用方只做数据映射。
 *
 * 与思考过程同样的处理：`Sources` 的标题行是 `<div onClick>`，
 * 因此标题内容仍用真正的 `<button>`（`aria-expanded` 暴露展开状态），
 * 保证键盘可操作；`expanded` / `onExpand` 仍由本组件受控，行为与迁移前一致。
 */
function SourcesBlock({ sources }: { sources: SourceCitation[] }): JSX.Element | null {
  const [open, setOpen] = useState(true)
  if (sources.length === 0) return null
  return (
    <Sources
      className="max-w-[680px]"
      expanded={open}
      onExpand={setOpen}
      items={sources.map((source) => ({
        key: source.url,
        title: source.title,
        url: source.url
      }))}
      title={
        <button
          type="button"
          aria-expanded={open}
          /* 同上：点击冒泡到 Sources 的标题行，由 onExpand 统一处理 */
          className="flex items-center gap-1.5 border-0 bg-transparent p-0 text-left text-[14px] font-medium text-txt-primary"
        >
          <Icon.Link size={14} className="text-accent" />
          引用来源
          <span className="text-[14px] font-normal text-txt-muted">{sources.length}</span>
        </button>
      }
    />
  )
}

function PlanBlock({ items }: { items: { order: number; title: string; done: boolean }[] }): JSX.Element {
  const finished = items.length > 0 && items.every((item) => item.done)
  const [open, setOpen] = useState(!finished)
  useEffect(() => {
    setOpen(!finished)
  }, [finished])
  return (
    <div className="w-fit min-w-[260px] overflow-hidden rounded-md border border-border bg-bg-panel">
      <button
        className="flex w-full items-center gap-1.5 border-b border-border px-3 py-2 text-[14px] font-medium text-txt-primary hover:bg-bg-raised"
        onClick={() => setOpen((v) => !v)}
      >
        <Icon.Check size={14} className="text-ok" />
        {finished ? `已完成 ${items.length} 项操作` : '执行计划'}
        <Icon.ChevronDown size={13} className={`ml-auto text-txt-muted transition-transform ${open ? '' : '-rotate-90'}`} />
      </button>
      {open && (
        <ol className="py-1">
          {items.map((it) => (
            <li key={it.order} className="flex items-center gap-2 px-3 py-1 text-[14px] text-txt-secondary">
              <span className="text-txt-muted">{it.order}.</span>
              <span className="selectable flex-1">{it.title}</span>
              {it.done && <Icon.Check size={13} className="text-ok" />}
            </li>
          ))}
        </ol>
      )}
    </div>
  )
}

function FilesBlock({ files }: { files: { path: string; addedLines: number }[] }): JSX.Element {
  const [open, setOpen] = useState(true)
  return (
    <div className="w-fit min-w-[240px] max-w-full overflow-hidden rounded-md border border-border bg-bg-panel">
      <button
        className="flex w-full items-center gap-1.5 border-b border-border px-3 py-2 text-[14px] font-medium text-txt-primary hover:bg-bg-raised"
        onClick={() => setOpen((v) => !v)}
      >
        <Icon.Check size={14} className="text-ok" />
        创建文件
        <Icon.ChevronDown size={13} className={`ml-auto text-txt-muted transition-transform ${open ? '' : '-rotate-90'}`} />
      </button>
      {open && (
        <div className="py-1">
          {files.map((f) => (
            <div key={f.path} className="flex items-center gap-2 px-3 py-1 text-[14px]">
              <span className="text-accent">
                <Icon.File size={14} />
              </span>
              <span className="selectable flex-1 truncate font-mono text-txt-primary">{f.path}</span>
              <span className="text-ok">+{f.addedLines}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

function CodeBlock({
  language,
  code,
  filename
}: {
  language: string
  code: string
  filename?: string
}): JSX.Element {
  const html = useMemo(() => {
    try {
      return hljs.highlight(code, { language }).value
    } catch {
      return escapeHtml(code)
    }
  }, [code, language])
  const [copied, setCopied] = useState(false)

  const onCopy = async (): Promise<void> => {
    await copyText(code)
    setCopied(true)
    setTimeout(() => setCopied(false), 1500)
  }

  return (
    <div className="overflow-hidden rounded-md border border-border bg-bg-app">
      <div className="flex items-center gap-2 border-b border-border px-3 py-1.5">
        <span className="text-[14px] font-medium text-txt-secondary">
          <span className="mr-1" style={{ fontFamily: 'monospace' }}>
            &lt;&gt;
          </span>
          {prettyLang(language)}
        </span>
        <span className="ml-auto">
          <IconButton
            label={copied ? '已复制' : '复制代码'}
            onClick={() => void onCopy()}
            icon={copied ? <Icon.Check size={14} className="text-ok" /> : <Icon.Copy size={14} />}
          />
        </span>
      </div>
      <div className="selectable overflow-x-auto p-3 text-[14px] leading-[21px]">
        <pre>
          <code dangerouslySetInnerHTML={{ __html: html }} />
        </pre>
      </div>
    </div>
  )
}
