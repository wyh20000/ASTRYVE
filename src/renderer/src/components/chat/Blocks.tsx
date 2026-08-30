import { useEffect, useMemo, useState } from 'react'
import hljs from 'highlight.js'
import type { MessageBlock, MessageStatus, SourceCitation } from '@shared/types'
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
      return <ThinkingBlock content={block.content} seconds={block.seconds} status={status} />
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
    default:
      return null
  }
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
  const [open, setOpen] = useState(!finished)

  // 思考结束后自动收起，用户可点击展开
  useEffect(() => {
    if (finished) setOpen(false)
  }, [finished])

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
          <div className="max-h-72 overflow-y-auto px-3 py-2">
            <div className="selectable whitespace-pre-wrap break-words text-[12px] leading-6 text-txt-secondary">
              {content}
            </div>
          </div>
        </div>
      ) : (
        <button
          onClick={() => setOpen(true)}
          className="flex w-fit items-center gap-1.5 rounded-full bg-bg-raised px-2.5 py-1 text-[12px] text-txt-secondary hover:bg-bg-active"
        >
          <Icon.Brain size={13} className="text-accent" />
          思考过程
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
  const [open, setOpen] = useState(true)
  return (
    <div className="w-fit min-w-[260px] overflow-hidden rounded-md border border-border bg-bg-panel">
      <button
        className="flex w-full items-center gap-1.5 border-b border-border px-3 py-2 text-[13px] font-medium text-txt-primary hover:bg-bg-raised"
        onClick={() => setOpen((v) => !v)}
      >
        <Icon.Check size={14} className="text-ok" />
        执行计划
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
    <div className="w-fit min-w-[320px] overflow-hidden rounded-md border border-border bg-bg-panel">
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
