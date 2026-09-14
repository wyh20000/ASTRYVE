import { useEffect, useMemo, useRef, useState } from 'react'
import hljs from 'highlight.js'
import type { MessageBlock, MessageStatus, PatchDiffBlock, PatchDiffFile, SourceCitation } from '@shared/types'
import MarkdownRenderer from './MarkdownRenderer'
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

export function Blocks({ blocks, status }: { blocks: MessageBlock[]; status: MessageStatus }): JSX.Element {
  return (
    <div className="space-y-3">
      {blocks.map((b, i) => (
        <Block key={i} block={b} status={status} />
      ))}
    </div>
  )
}

function Block({ block, status }: { block: MessageBlock; status: MessageStatus }): JSX.Element | null {
  switch (block.kind) {
    case 'thinking':
      return <ThinkingBlock content={block.content} seconds={block.seconds} status={block.done ? 'done' : status} />
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
  return <div className="flex max-w-[720px] flex-wrap items-center gap-2 rounded-md border border-accent/30 bg-accent-dim/10 px-3 py-2 text-[11px]">
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
  return <div className="max-w-[720px] rounded-md border border-border bg-bg-panel p-3 text-[12px]">
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
      <button type="button" className="flex w-full items-center gap-2 px-3 py-2 text-[12px] hover:bg-bg-raised" onClick={() => setOpen((v) => !v)}>
        <Icon.Terminal size={14} className={block.exitCode === 0 ? 'text-ok' : 'text-red-300'} />
        <span className="truncate font-mono text-txt-primary">{block.executable} {block.args.join(' ')}</span>
        <span className="ml-auto text-txt-muted">{block.durationMs}ms · exit {block.exitCode ?? '—'}</span>
        <Icon.ChevronDown size={13} className={open ? '' : '-rotate-90'} />
      </button>
      {open && <pre className="selectable max-h-72 overflow-auto border-t border-border bg-bg-app p-3 text-[11px] leading-5 text-txt-secondary">{[
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
      <header className="flex items-center gap-2 border-b border-border px-3 py-2 text-[12px]">
        <Icon.Edit size={14} className="text-accent" />
        <span className="font-medium text-txt-primary">待写回变更</span>
        <span className="text-txt-muted">{current.files.length} 个文件</span>
        <span className="ml-auto font-mono text-ok">+{current.linesAdded}</span>
        <span className="font-mono text-red-400">-{current.linesDeleted}</span>
      </header>
      {current.files.length === 0 ? (
        <div className="px-3 py-3 text-[12px] text-txt-muted">所有文件均已拒绝，不会写回宿主项目。</div>
      ) : current.files.map((file) => {
        const open = openFiles.has(file.path)
        return (
          <div key={file.path} className="border-b border-border last:border-b-0">
            <div className="flex items-center gap-2 px-3 py-2 text-[12px]">
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
              {status === 'streaming' && <button
                type="button"
                className="rounded border border-red-400/30 px-2 py-0.5 text-[11px] text-red-300 hover:bg-red-500/10 disabled:opacity-50"
                disabled={Boolean(rejecting)}
                onClick={() => void reject(file)}
              >{rejecting === file.path ? '拒绝中…' : '拒绝此文件'}</button>}
            </div>
            {open && <DiffCode diff={file.diff} />}
          </div>
        )
      })}
      <footer className="border-t border-border px-3 py-1.5 font-mono text-[10px] text-txt-muted">
        SHA-256 {current.patchHash}
      </footer>
      {error && <div className="border-t border-red-500/20 bg-red-500/5 px-3 py-2 text-[11px] text-red-300">{error}</div>}
    </section>
  )
}

function DiffCode({ diff }: { diff: string }): JSX.Element {
  return (
    <pre className="selectable max-h-96 overflow-auto border-t border-border bg-bg-app p-2 text-[11px] leading-5">
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

function ThinkingBlock({
  content,
  seconds,
  status
}: {
  content: string
  seconds?: number
  status: MessageStatus
}): JSX.Element {
  const finished = status === 'done' || status === 'error'
  const streaming = status === 'streaming'
  const [open, setOpen] = useState(false)
  const [stick, setStick] = useState(true)
  const scrollRef = useRef<HTMLDivElement>(null)

  // 思考结束后自动收起，用户可点击展开
  useEffect(() => {
    if (finished) setOpen(false)
  }, [finished])

  useEffect(() => {
    if (!open || !streaming || !stick) return
    const element = scrollRef.current
    if (element) requestAnimationFrame(() => { element.scrollTop = element.scrollHeight })
  }, [content, open, stick, streaming])

  return (
    <div>
      {open ? (
        <div className="overflow-hidden rounded-md border border-border bg-bg-app">
          <div className="flex items-center gap-2 border-b border-border px-3 py-1.5">
            <Icon.Brain size={14} className={streaming ? 'animate-pulse text-accent' : 'text-accent'} />
            <span className="text-[12px] font-medium text-txt-secondary">
              {streaming ? '思考中' : '思考过程'}
            </span>
            {streaming && <span className="thinking-dots" aria-label="思考中"><i /><i /><i /></span>}
            {finished && seconds != null && <span className="text-[11px] text-txt-muted">{seconds}s</span>}
            <button className="ml-auto btn-icon" title="收起" onClick={() => setOpen(false)}>
              <Icon.ChevronDown size={14} className="rotate-180" />
            </button>
          </div>
          <div
            ref={scrollRef}
            className="relative max-h-72 overflow-y-auto px-3 py-2"
            onScroll={(event) => {
              const element = event.currentTarget
              setStick(element.scrollHeight - element.scrollTop - element.clientHeight < 48)
            }}
          >
            <div className="selectable whitespace-pre-wrap break-words text-[12px] leading-6 text-txt-secondary">
              {content}
            </div>
            {!stick && streaming && <button
              type="button"
              onClick={() => {
                setStick(true)
                const element = scrollRef.current
                if (element) element.scrollTop = element.scrollHeight
              }}
              className="sticky bottom-1 left-1/2 mt-2 -translate-x-1/2 rounded-full border border-border bg-bg-raised px-2.5 py-1 text-[10px] text-txt-secondary shadow-lg hover:text-txt-primary"
            >
              回到底部
            </button>}
          </div>
        </div>
      ) : (
        <button
          onClick={() => setOpen(true)}
          className="flex w-fit items-center gap-1.5 rounded-full bg-bg-raised px-2.5 py-1 text-[12px] text-txt-secondary hover:bg-bg-active"
        >
          <Icon.Brain size={13} className="text-accent" />
          {streaming ? '思考中' : '思考过程'}
          {streaming && <span className="thinking-dots" aria-label="思考中"><i /><i /><i /></span>}
          {finished && seconds != null && <span className="text-txt-muted">{seconds}s</span>}
          <Icon.ChevronDown size={13} />
        </button>
      )}
    </div>
  )
}

function SourcesBlock({ sources }: { sources: SourceCitation[] }): JSX.Element | null {
  const [open, setOpen] = useState(true)
  if (sources.length === 0) return null
  return (
    <div className="max-w-[680px] overflow-hidden rounded-md border border-border bg-bg-panel">
      <button
        className="flex w-full items-center gap-1.5 border-b border-border px-3 py-2 text-[13px] font-medium text-txt-primary hover:bg-bg-raised"
        onClick={() => setOpen((value) => !value)}
        aria-expanded={open}
      >
        <Icon.Link size={14} className="text-accent" />
        引用来源
        <span className="text-[11px] font-normal text-txt-muted">{sources.length}</span>
        <Icon.ChevronDown size={13} className={`ml-auto text-txt-muted transition-transform ${open ? '' : '-rotate-90'}`} />
      </button>
      {open && (
        <ol className="space-y-1 px-3 py-2">
          {sources.map((source, index) => (
            <li key={source.url} className="flex min-w-0 items-start gap-2 text-[12px]">
              <span className="shrink-0 text-txt-muted">{index + 1}.</span>
              <a
                href={source.url}
                target="_blank"
                rel="noreferrer"
                className="min-w-0 truncate text-accent underline decoration-accent/40 underline-offset-2 hover:decoration-accent"
                title={source.url}
              >
                {source.title}
              </a>
            </li>
          ))}
        </ol>
      )}
    </div>
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
        className="flex w-full items-center gap-1.5 border-b border-border px-3 py-2 text-[13px] font-medium text-txt-primary hover:bg-bg-raised"
        onClick={() => setOpen((v) => !v)}
      >
        <Icon.Check size={14} className="text-ok" />
        {finished ? `已完成 ${items.length} 项操作` : '执行计划'}
        <Icon.ChevronDown size={13} className={`ml-auto text-txt-muted transition-transform ${open ? '' : '-rotate-90'}`} />
      </button>
      {open && (
        <ol className="py-1">
          {items.map((it) => (
            <li key={it.order} className="flex items-center gap-2 px-3 py-1 text-[13px] text-txt-secondary">
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
        className="flex w-full items-center gap-1.5 border-b border-border px-3 py-2 text-[13px] font-medium text-txt-primary hover:bg-bg-raised"
        onClick={() => setOpen((v) => !v)}
      >
        <Icon.Check size={14} className="text-ok" />
        创建文件
        <Icon.ChevronDown size={13} className={`ml-auto text-txt-muted transition-transform ${open ? '' : '-rotate-90'}`} />
      </button>
      {open && (
        <div className="py-1">
          {files.map((f) => (
            <div key={f.path} className="flex items-center gap-2 px-3 py-1 text-[12px]">
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
        <span className="text-[12px] font-medium text-txt-secondary">
          <span className="mr-1" style={{ fontFamily: 'monospace' }}>
            &lt;&gt;
          </span>
          {prettyLang(language)}
        </span>
        <button className="ml-auto btn-icon" title="复制代码" onClick={() => void onCopy()}>
          {copied ? <Icon.Check size={14} className="text-ok" /> : <Icon.Copy size={14} />}
        </button>
      </div>
      <div className="selectable overflow-x-auto p-3 text-[12px] leading-relaxed">
        <pre>
          <code dangerouslySetInnerHTML={{ __html: html }} />
        </pre>
      </div>
    </div>
  )
}
