import { useEffect, useMemo, useRef, useState } from 'react'
import type { MessageBlock, PatchDiffFile } from '@shared/types'
import type { WorkspaceFileContent, WorkspaceFileEntry } from '@shared/agent'
import { useSessionStore } from '../../stores/sessionStore'
import { useWorkspaceStore } from '../../stores/workspaceStore'
import { useChatStore } from '../../stores/chatStore'
import { Icon } from '../ui/icons'
import { useUiStore } from '../../stores/uiStore'
import WorkspaceResizeHandle from './WorkspaceResizeHandle'
import MonacoPreview from './MonacoPreview'
import MonacoDiffPreview from './MonacoDiffPreview'
import { hydrateLegacyDiff, visibleDiffContents } from './legacyDiff'

type View = 'files' | 'diff' | 'steps' | 'output' | 'terminal'

export default function WorkspacePanel(): JSX.Element | null {
  const activeId = useSessionStore((state) => state.activeId)
  const sessions = useSessionStore((state) => state.sessions)
  const recent = useWorkspaceStore((state) => state.recent)
  const messages = useChatStore((state) => activeId ? state.messages[activeId] ?? [] : [])
  const session = sessions.find((candidate) => candidate.id === activeId)
  const workspace = recent.find((candidate) => candidate.displayPath === session?.projectPath)
  const width = useUiStore((state) => state.workspaceWidth)
  const [view, setView] = useState<View>('files')
  const [explorerOpen, setExplorerOpen] = useState(true)
  const [directories, setDirectories] = useState<Record<string, WorkspaceFileEntry[]>>({})
  const [expanded, setExpanded] = useState<Set<string>>(new Set())
  const [openFiles, setOpenFiles] = useState<WorkspaceFileContent[]>([])
  const [activeFilePath, setActiveFilePath] = useState<string>()
  const [dirtyPaths, setDirtyPaths] = useState<Set<string>>(new Set())
  const [savingPath, setSavingPath] = useState<string>()
  const [saveError, setSaveError] = useState('')
  const [activeDiffPath, setActiveDiffPath] = useState<string>()
  const [closedDiffPaths, setClosedDiffPaths] = useState<Set<string>>(new Set())
  const [legacyDiffContents, setLegacyDiffContents] = useState<Record<string, { original: string; modified: string }>>({})
  const [loading, setLoading] = useState(false)
  const [fileLoadingPath, setFileLoadingPath] = useState<string>()
  const [fileLoadError, setFileLoadError] = useState('')
  const fileLoadSequence = useRef(0)
  const [terminalId, setTerminalId] = useState<string>()
  const [terminalOutput, setTerminalOutput] = useState('')
  const [terminalInput, setTerminalInput] = useState('')
  const blocks = useMemo(() => messages.flatMap((message) => message.blocks ?? []), [messages])
  const diffs = blocks.filter((block): block is Extract<MessageBlock, { kind: 'diff' }> => block.kind === 'diff')
  const commands = blocks.filter((block): block is Extract<MessageBlock, { kind: 'command' }> => block.kind === 'command')
  const plans = blocks.filter((block): block is Extract<MessageBlock, { kind: 'plan' }> => block.kind === 'plan')
  const latestDiff = diffs.at(-1)
  const diffFiles = (latestDiff?.files ?? []).filter((file) => !closedDiffPaths.has(file.path))
  const activeFile = openFiles.find((file) => file.path === activeFilePath)
  const activeDiff = diffFiles.find((file) => file.path === activeDiffPath) ?? diffFiles[0]
  const legacyDiff = activeDiff && latestDiff ? legacyDiffContents[`${latestDiff.patchHash}:${activeDiff.path}`] : undefined
  const editorPath = view === 'diff' ? activeDiff?.path : activeFile?.path
  const displayedDiff = activeDiff ? visibleDiffContents(activeDiff, {
    original: activeDiff.originalContent ?? legacyDiff?.original ?? fallbackDiffSide(activeDiff, 'original'),
    modified: activeDiff.modifiedContent ?? legacyDiff?.modified ?? fallbackDiffSide(activeDiff, 'modified')
  }) : undefined

  useEffect(() => {
    fileLoadSequence.current += 1
    setDirectories({}); setExpanded(new Set()); setOpenFiles([]); setActiveFilePath(undefined); setDirtyPaths(new Set())
    setFileLoadingPath(undefined); setFileLoadError('')
    if (!workspace) return
    void loadDirectory(workspace.id, '', setDirectories, setLoading)
  }, [workspace?.id])

  useEffect(() => {
    setClosedDiffPaths(new Set())
    setActiveDiffPath(latestDiff?.files[0]?.path)
  }, [latestDiff?.patchHash])

  useEffect(() => {
    if (!workspace || !latestDiff || !activeDiff ||
        (activeDiff.originalContent !== undefined && activeDiff.modifiedContent !== undefined)) return
    const key = `${latestDiff.patchHash}:${activeDiff.path}`
    if (legacyDiffContents[key]) return
    if (activeDiff.status === 'added') {
      setLegacyDiffContents((current) => ({ ...current, [key]: {
        original: '', modified: fallbackDiffSide(activeDiff, 'modified')
      } }))
      return
    }
    const sourcePath = activeDiff.previousPath ?? activeDiff.path
    let current = true
    void window.agent.workspace.readFile({ workspaceId: workspace.id, path: sourcePath }).then((result) => {
      if (!current || !result.ok) return
      setLegacyDiffContents((contents) => ({ ...contents, [key]: {
        ...hydrateLegacyDiff(result.data.content, activeDiff)
      } }))
    })
    return () => { current = false }
  }, [workspace?.id, latestDiff?.patchHash, activeDiff?.path])

  useEffect(() => window.agent.onTerminalOutput((output) => {
    if (output.terminalId !== terminalId) return
    setTerminalOutput((current) => (current + output.text).slice(-200_000))
  }), [terminalId])

  useEffect(() => window.agent.onWorkspaceFilesChanged((change) => {
    if (!workspace || change.workspaceId !== workspace.id) return
    const changed = new Set(change.paths)
    const refreshable = openFiles.filter((file) => changed.has(file.path) && !dirtyPaths.has(file.path))
    if (!refreshable.length) return
    void Promise.all(refreshable.map((file) =>
      window.agent.workspace.readFile({ workspaceId: workspace.id, path: file.path })
    )).then((results) => {
      const refreshed = new Map(results.filter((result) => result.ok).map((result) => [result.data.path, result.data]))
      if (!refreshed.size) return
      setOpenFiles((current) => current.map((file) => refreshed.get(file.path) ?? file))
    })
  }), [workspace?.id, openFiles, dirtyPaths])

  useEffect(() => () => { if (terminalId) void window.agent.terminal.close(terminalId) }, [terminalId])

  if (!workspace) return null

  const selectFile = async (path: string): Promise<void> => {
    setView('files')
    setFileLoadError('')
    if (openFiles.some((file) => file.path === path)) {
      setActiveFilePath(path)
      return
    }
    const sequence = ++fileLoadSequence.current
    setFileLoadingPath(path)
    try {
      const result = await withTimeout(
        window.agent.workspace.readFile({ workspaceId: workspace.id, path }), 10_000,
        '读取文件超时，请重试'
      )
      if (sequence !== fileLoadSequence.current) return
      if (result.ok) {
        setOpenFiles((current) => current.some((file) => file.path === path) ? current : [...current, result.data])
        setActiveFilePath(path)
      } else setFileLoadError(result.error.message)
    } catch (error) {
      if (sequence === fileLoadSequence.current) setFileLoadError(error instanceof Error ? error.message : '读取文件失败')
    } finally {
      if (sequence === fileLoadSequence.current) setFileLoadingPath(undefined)
    }
  }

  const closeFile = (path: string): void => {
    const index = openFiles.findIndex((file) => file.path === path)
    const next = openFiles.filter((file) => file.path !== path)
    setOpenFiles(next)
    if (activeFilePath === path) setActiveFilePath(next[Math.min(index, next.length - 1)]?.path)
  }

  const saveActiveFile = async (): Promise<void> => {
    if (!activeFile || !dirtyPaths.has(activeFile.path)) return
    setSavingPath(activeFile.path)
    setSaveError('')
    const result = await window.agent.workspace.saveFile({
      workspaceId: workspace.id,
      path: activeFile.path,
      content: activeFile.content,
      expectedHash: activeFile.hash
    })
    if (result.ok) {
      setOpenFiles((current) => current.map((file) => file.path === activeFile.path ? result.data : file))
      setDirtyPaths((current) => { const next = new Set(current); next.delete(activeFile.path); return next })
    } else setSaveError(result.error.message)
    setSavingPath(undefined)
  }

  const closeDiff = (path: string): void => {
    const index = diffFiles.findIndex((file) => file.path === path)
    const next = diffFiles.filter((file) => file.path !== path)
    setClosedDiffPaths((current) => new Set(current).add(path))
    if (activeDiffPath === path) setActiveDiffPath(next[Math.min(index, next.length - 1)]?.path)
  }

  const toggleDirectory = async (path: string): Promise<void> => {
    if (expanded.has(path)) {
      setExpanded((value) => { const next = new Set(value); next.delete(path); return next })
      return
    }
    if (!directories[path]) await loadDirectory(workspace.id, path, setDirectories, setLoading)
    setExpanded((value) => new Set(value).add(path))
  }

  return <><WorkspaceResizeHandle /><aside style={{ width }} className="flex shrink-0 flex-col border-l border-border bg-bg-panel">
    <div className="flex h-10 shrink-0 items-center border-b border-border bg-bg-panel px-2">
      {([['files', '文件'], ['diff', `Diff${diffs.length ? ` ${diffs.length}` : ''}`], ['steps', '步骤'],
        ['output', `输出${commands.length ? ` ${commands.length}` : ''}`], ['terminal', '终端']] as const)
        .map(([id, label]) => <button key={id} type="button" onClick={() => setView(id)}
          className={`relative h-10 px-2.5 text-[11px] transition-colors ${view === id
            ? 'text-txt-primary after:absolute after:inset-x-2 after:bottom-0 after:h-0.5 after:bg-accent'
            : 'text-txt-muted hover:text-txt-secondary'}`}>
          {label}
        </button>)}
      <button type="button" className={`btn-icon ml-auto ${explorerOpen ? 'bg-bg-active text-txt-primary' : ''}`}
        title={explorerOpen ? '收起文件列表' : '展开文件列表'} aria-pressed={explorerOpen}
        onClick={() => setExplorerOpen((value) => !value)}><Icon.FileDir size={15} /></button>
    </div>

    {(view === 'files' || view === 'diff') ? <div className="flex min-h-0 flex-1 flex-col bg-bg-app">
      <EditorTabs files={view === 'files' ? openFiles : diffFiles} activePath={view === 'files' ? activeFilePath : activeDiff?.path}
        dirtyPaths={view === 'files' ? dirtyPaths : new Set()}
        diff={view === 'diff'} onSelect={(path) => view === 'files' ? setActiveFilePath(path) : setActiveDiffPath(path)}
        onClose={(path) => view === 'files' ? closeFile(path) : closeDiff(path)} />
      <div className="flex min-h-0 flex-1">
        <section className="flex min-w-0 flex-1 flex-col">
          <Breadcrumb workspace={workspace.name} path={editorPath} dirty={Boolean(activeFile && dirtyPaths.has(activeFile.path))}
            saving={savingPath === activeFile?.path} error={saveError} onSave={view === 'files' ? saveActiveFile : undefined} />
          <div className="min-h-0 flex-1">
            {view === 'files' ? (activeFile
              ? <MonacoPreview path={activeFile.path} content={activeFile.content}
                onChange={(content) => {
                  setOpenFiles((current) => current.map((file) => file.path === activeFile.path ? { ...file, content } : file))
                  setDirtyPaths((current) => new Set(current).add(activeFile.path))
                  setSaveError('')
                }} onSave={() => void saveActiveFile()} />
              : <Empty text={fileLoadError || (fileLoadingPath ? `正在读取 ${basename(fileLoadingPath)}…` : '从文件列表选择一个文件')} />)
              : (activeDiff && displayedDiff ? <MonacoDiffPreview path={activeDiff.path}
                original={displayedDiff.original} modified={displayedDiff.modified} />
                : <Empty text="暂无可查看的文件变更" />)}
          </div>
        </section>
        {explorerOpen && <Explorer workspaceId={workspace.id} directories={directories} expanded={expanded}
          activePath={editorPath} loading={loading} onDirectory={toggleDirectory} onFile={selectFile} />}
      </div>
    </div> : <AuxiliaryView view={view} plans={plans} commands={commands} activeId={activeId ?? undefined}
      terminalId={terminalId} terminalOutput={terminalOutput} terminalInput={terminalInput}
      setTerminalId={setTerminalId} setTerminalOutput={setTerminalOutput} setTerminalInput={setTerminalInput} />}
  </aside></>
}

function EditorTabs({ files, activePath, dirtyPaths, diff, onSelect, onClose }: {
  files: Array<{ path: string }>; activePath?: string; dirtyPaths: Set<string>; diff: boolean
  onSelect: (path: string) => void; onClose: (path: string) => void
}): JSX.Element {
  return <div className="flex h-9 shrink-0 items-stretch overflow-x-auto border-b border-border bg-bg-panel">
    {files.length ? files.map((file) => <div key={file.path}
      className={`group/tab flex min-w-[120px] max-w-[210px] items-center border-r border-border text-[11px] ${
        activePath === file.path ? 'bg-bg-app text-txt-primary' : 'text-txt-muted hover:bg-bg-raised hover:text-txt-secondary'}`}>
      <button type="button" className="flex min-w-0 flex-1 items-center gap-1.5 py-2 pl-2" onClick={() => onSelect(file.path)}>
        <FileGlyph path={file.path} diff={diff} />
        <span className="min-w-0 flex-1 truncate text-left" title={file.path}>{basename(file.path)}</span>
      </button>
      <button type="button" aria-label={`关闭 ${basename(file.path)}`}
        className="mr-1 flex h-5 w-5 shrink-0 items-center justify-center rounded opacity-0 hover:bg-bg-active group-hover/tab:opacity-100 focus-visible:opacity-100"
        onClick={() => onClose(file.path)}>{dirtyPaths.has(file.path)
          ? <span className="h-2 w-2 rounded-full bg-accent" /> : <Icon.X size={11} />}</button>
    </div>) : <span className="flex items-center px-3 text-[10px] text-txt-muted">没有打开的文件</span>}
  </div>
}

function Breadcrumb({ workspace, path, dirty, saving, error, onSave }: {
  workspace: string; path?: string; dirty?: boolean; saving?: boolean; error?: string; onSave?: () => Promise<void>
}): JSX.Element {
  const parts = path?.split('/') ?? []
  return <div className="flex h-8 shrink-0 items-center gap-1 overflow-hidden border-b border-border bg-bg-app px-3 text-[10px] text-txt-muted">
    <span className="truncate">{workspace}</span>
    {parts.map((part, index) => <span key={`${part}-${index}`} className="flex min-w-0 items-center gap-1">
      <Icon.ChevronRight size={10} /><span className={index === parts.length - 1 ? 'truncate text-txt-secondary' : 'truncate'}>{part}</span>
    </span>)}
    {error && <span className="ml-auto max-w-[240px] truncate text-red-300" title={error}>{error}</span>}
    {dirty && <button type="button" className="ml-auto shrink-0 rounded px-2 py-0.5 text-[10px] text-accent hover:bg-bg-raised"
      disabled={saving} title="保存文件（Ctrl+S）" onClick={() => void onSave?.()}>{saving ? '保存中…' : '保存 Ctrl+S'}</button>}
  </div>
}

function Explorer({ workspaceId, directories, expanded, activePath, loading, onDirectory, onFile }: {
  workspaceId: string; directories: Record<string, WorkspaceFileEntry[]>; expanded: Set<string>; activePath?: string
  loading: boolean; onDirectory: (path: string) => Promise<void>; onFile: (path: string) => Promise<void>
}): JSX.Element {
  const [query, setQuery] = useState('')
  const [results, setResults] = useState<WorkspaceFileEntry[]>([])
  const [searching, setSearching] = useState(false)
  useEffect(() => {
    const needle = query.trim()
    if (!needle) { setResults([]); setSearching(false); return }
    let current = true
    setSearching(true)
    const timer = window.setTimeout(() => {
      void window.agent.workspace.findFiles({ workspaceId, query: needle }).then((result) => {
        if (!current) return
        setResults(result.ok ? result.data : [])
        setSearching(false)
      })
    }, 180)
    return () => { current = false; window.clearTimeout(timer) }
  }, [query, workspaceId])
  return <aside className="flex w-[230px] shrink-0 flex-col border-l border-border bg-bg-panel">
    <div className="border-b border-border p-2">
      <label className="flex h-7 items-center gap-1.5 rounded-md border border-border bg-bg-app px-2 focus-within:border-accent">
        <Icon.Search size={12} className="shrink-0 text-txt-muted" />
        <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="筛选文件…"
          className="min-w-0 flex-1 bg-transparent text-[11px] text-txt-primary outline-none placeholder:text-txt-muted" />
        {query && <button type="button" className="text-txt-muted hover:text-txt-primary" onClick={() => setQuery('')}><Icon.X size={11} /></button>}
      </label>
    </div>
    <div className="min-h-0 flex-1 overflow-auto py-1">
      {query.trim() ? (results.length ? results.map((entry) => <FileRow key={entry.path} entry={entry} depth={0}
        active={entry.path === activePath} onClick={() => void onFile(entry.path)} showPath />)
        : <Empty text={searching ? '正在搜索…' : '没有匹配文件'} />)
        : <FileTree path="" directories={directories} expanded={expanded} activePath={activePath}
          onDirectory={onDirectory} onFile={onFile} />}
      {loading && !query && <div className="px-3 py-2 text-[10px] text-txt-muted">读取中…</div>}
    </div>
  </aside>
}

function FileTree({ path, directories, expanded, activePath, onDirectory, onFile }: {
  path: string; directories: Record<string, WorkspaceFileEntry[]>; expanded: Set<string>; activePath?: string
  onDirectory: (path: string) => Promise<void>; onFile: (path: string) => Promise<void>
}): JSX.Element {
  return <>{(directories[path] ?? []).map((entry) => <div key={entry.path}>
    <FileRow entry={entry} depth={entry.path.split('/').length - 1} active={entry.path === activePath}
      expanded={expanded.has(entry.path)} onClick={() => void (entry.kind === 'directory' ? onDirectory(entry.path) : onFile(entry.path))} />
    {entry.kind === 'directory' && expanded.has(entry.path) && <FileTree path={entry.path} directories={directories}
      expanded={expanded} activePath={activePath} onDirectory={onDirectory} onFile={onFile} />}
  </div>)}</>
}

function FileRow({ entry, depth, active, expanded, showPath, onClick }: {
  entry: WorkspaceFileEntry; depth: number; active: boolean; expanded?: boolean; showPath?: boolean; onClick: () => void
}): JSX.Element {
  return <button type="button" className={`mx-1 flex w-[calc(100%-8px)] items-center gap-1.5 rounded px-2 py-1 text-left text-[11px] ${
    active ? 'bg-bg-active text-txt-primary shadow-sm ring-1 ring-inset ring-border-strong' : 'text-txt-secondary hover:bg-bg-raised'}`}
    style={{ paddingLeft: `${8 + depth * 11}px` }} onClick={onClick} title={entry.path}>
    {entry.kind === 'directory' ? <><Icon.ChevronRight size={11} className={expanded ? 'rotate-90' : ''} /><Icon.Folder size={13} className="text-amber-300/80" /></>
      : <><span className="w-[11px]" /><FileGlyph path={entry.path} /></>}
    <span className="min-w-0 flex-1 truncate">{showPath ? entry.path : entry.name}</span>
  </button>
}

function FileGlyph({ path, diff = false }: { path: string; diff?: boolean }): JSX.Element {
  const ext = path.split('.').pop()?.toLowerCase()
  const color = diff ? 'text-accent' : ['ts', 'tsx'].includes(ext ?? '') ? 'text-sky-300'
    : ['js', 'jsx'].includes(ext ?? '') ? 'text-yellow-300' : ext === 'json' ? 'text-amber-300'
      : ['md', 'txt'].includes(ext ?? '') ? 'text-violet-300' : 'text-txt-muted'
  return <Icon.File size={13} className={`shrink-0 ${color}`} />
}

function AuxiliaryView({ view, plans, commands, activeId, terminalId, terminalOutput, terminalInput,
  setTerminalId, setTerminalOutput, setTerminalInput }: {
  view: View
  plans: Array<Extract<MessageBlock, { kind: 'plan' }>>
  commands: Array<Extract<MessageBlock, { kind: 'command' }>>
  activeId?: string; terminalId?: string; terminalOutput: string; terminalInput: string
  setTerminalId: (value: string) => void; setTerminalOutput: (value: string) => void; setTerminalInput: (value: string) => void
}): JSX.Element {
  return <div className="min-h-0 flex-1 overflow-auto">
    {view === 'steps' && (plans.length ? <ol className="p-2">{plans.flatMap((plan) => plan.items).map((item, index) =>
      <li key={`${item.order}-${index}`} className="flex gap-2 border-b border-border px-2 py-2 text-[11px] text-txt-secondary">
        <span className={item.done ? 'text-ok' : 'text-txt-muted'}>{item.done ? '✓' : '○'}</span><span>{item.title}</span>
      </li>)}</ol> : <Empty text="暂无任务步骤" />)}
    {view === 'output' && (commands.length ? commands.map((command) => <details key={command.callId} open={command.exitCode !== 0} className="border-b border-border">
      <summary className="cursor-pointer px-3 py-2 font-mono text-[11px] text-txt-primary">{command.executable} {command.args.join(' ')} · exit {command.exitCode ?? '—'}</summary>
      <pre className="selectable max-h-80 overflow-auto bg-bg-app p-3 text-[10px] leading-4 text-txt-secondary">{[
        command.stdout, command.stderr && `stderr:\n${command.stderr}`, command.truncated && '[输出已截断]'
      ].filter(Boolean).join('\n')}</pre>
    </details>) : <Empty text="暂无命令输出" />)}
    {view === 'terminal' && <Terminal terminalId={terminalId} terminalOutput={terminalOutput} terminalInput={terminalInput}
      activeId={activeId} setTerminalId={setTerminalId} setTerminalOutput={setTerminalOutput} setTerminalInput={setTerminalInput} />}
  </div>
}

function Terminal({ terminalId, terminalOutput, terminalInput, activeId, setTerminalId, setTerminalOutput, setTerminalInput }: {
  terminalId?: string; terminalOutput: string; terminalInput: string; activeId?: string
  setTerminalId: (value: string) => void; setTerminalOutput: (value: string) => void; setTerminalInput: (value: string) => void
}): JSX.Element {
  return <div className="flex h-full min-h-[240px] flex-col bg-bg-app">
    <div className="border-b border-border px-3 py-2 text-[10px] text-txt-muted">仅接收你的键盘输入；Agent 工具无法读取、写入或控制此终端。</div>
    {!terminalId ? <button type="button" className="m-3 rounded border border-border bg-bg-raised px-3 py-2 text-[11px] text-txt-primary hover:bg-bg-active"
      onClick={async () => {
        if (!activeId) return
        const result = await window.agent.terminal.open(activeId)
        if (result.ok) { setTerminalId(result.data.id); setTerminalOutput(`已启动 ${result.data.shell}\n`) }
        else setTerminalOutput(result.error.message)
      }}>启动用户终端</button> : <>
      <pre className="selectable min-h-0 flex-1 overflow-auto whitespace-pre-wrap p-3 font-mono text-[11px] leading-5 text-txt-secondary">{terminalOutput}</pre>
      <form className="flex border-t border-border" onSubmit={(event) => {
        event.preventDefault()
        if (!terminalInput || !terminalId) return
        void window.agent.terminal.write(terminalId, `${terminalInput}\r\n`)
        setTerminalInput('')
      }}>
        <span className="px-2 py-2 font-mono text-[11px] text-accent">›</span>
        <input value={terminalInput} onChange={(event) => setTerminalInput(event.target.value)} autoComplete="off"
          className="min-w-0 flex-1 bg-transparent py-2 pr-2 font-mono text-[11px] text-txt-primary outline-none" placeholder="输入命令并回车" />
      </form>
    </>}
  </div>
}

async function loadDirectory(workspaceId: string, path: string,
  setDirectories: React.Dispatch<React.SetStateAction<Record<string, WorkspaceFileEntry[]>>>,
  setLoading: React.Dispatch<React.SetStateAction<boolean>>): Promise<void> {
  setLoading(true)
  const result = await window.agent.workspace.listFiles({ workspaceId, path })
  if (result.ok) setDirectories((current) => ({ ...current, [path]: result.data }))
  setLoading(false)
}

function fallbackDiffSide(file: PatchDiffFile, side: 'original' | 'modified'): string {
  return file.diff.split('\n')
    .filter((line) => side === 'original' ? line.startsWith('-') && !line.startsWith('---') : line.startsWith('+') && !line.startsWith('+++'))
    .map((line) => line.slice(1)).join('\n')
}

function basename(path: string): string { return path.split('/').at(-1) ?? path }

async function withTimeout<T>(promise: Promise<T>, milliseconds: number, message: string): Promise<T> {
  let timer: number | undefined
  try {
    return await Promise.race([
      promise,
      new Promise<T>((_resolve, reject) => {
        timer = window.setTimeout(() => reject(new Error(message)), milliseconds)
      })
    ])
  } finally {
    if (timer !== undefined) window.clearTimeout(timer)
  }
}

function Empty({ text }: { text: string }): JSX.Element {
  return <div className="flex h-full min-h-32 items-center justify-center px-4 text-center text-[11px] text-txt-muted">{text}</div>
}
