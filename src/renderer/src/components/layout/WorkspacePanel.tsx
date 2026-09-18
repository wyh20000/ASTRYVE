import { useEffect, useMemo, useRef, useState } from 'react'
import type { MessageBlock, PatchDiffFile } from '@shared/types'
import type { WorkspaceFileContent, WorkspaceFileEntry } from '@shared/agent'
import { useSessionStore } from '../../stores/sessionStore'
import { useWorkspaceStore } from '../../stores/workspaceStore'
import { useChatStore } from '../../stores/chatStore'
import { Icon } from '../ui/icons'
import { IconButton } from '../ui'
import { useUiStore } from '../../stores/uiStore'
import WorkspaceResizeHandle from './WorkspaceResizeHandle'
import MonacoPreview from './MonacoPreview'
import MonacoDiffPreview from './MonacoDiffPreview'
import MarkdownRenderer from '../chat/MarkdownRenderer'
import { hydrateLegacyDiff, visibleDiffContents } from './legacyDiff'
import { directoriesToRefresh } from './workspaceRefresh'
import { isMarkdownPath, workspaceFileKind, workspaceFolderIcon } from './workspaceFileKind'
import { fileIconSources } from './fileIconSources'
import { folderIconSource } from './folderIconSources'

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
  const [markdownModeByPath, setMarkdownModeByPath] = useState<Record<string, 'code' | 'preview'>>({})
  const [directories, setDirectories] = useState<Record<string, WorkspaceFileEntry[]>>({})
  const [fileTreeRevision, setFileTreeRevision] = useState(0)
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
  const markdownMode = activeFile && isMarkdownPath(activeFile.path)
    ? markdownModeByPath[activeFile.path] ?? 'preview'
    : undefined
  const compactWorkspace = width < 720
  const displayedDiff = activeDiff ? visibleDiffContents(activeDiff, {
    original: activeDiff.originalContent ?? legacyDiff?.original ?? fallbackDiffSide(activeDiff, 'original'),
    modified: activeDiff.modifiedContent ?? legacyDiff?.modified ?? fallbackDiffSide(activeDiff, 'modified')
  }) : undefined

  useEffect(() => {
    fileLoadSequence.current += 1
    setDirectories({}); setExpanded(new Set()); setOpenFiles([]); setActiveFilePath(undefined); setDirtyPaths(new Set())
    setMarkdownModeByPath({})
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
    setFileTreeRevision((revision) => revision + 1)
    const directoryPaths = directoriesToRefresh(change.paths, Object.keys(directories))
    void Promise.all(directoryPaths.map(async (path) => ({
      path,
      result: await window.agent.workspace.listFiles({ workspaceId: workspace.id, path })
    }))).then((updates) => {
      setDirectories((current) => {
        const next = { ...current }
        for (const update of updates) if (update.result.ok) next[update.path] = update.result.data
        return next
      })
    })
    const changed = new Set(change.paths)
    const refreshable = openFiles.filter((file) =>
      (change.paths.length === 0 || changed.has(file.path)) && !dirtyPaths.has(file.path))
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

  return <><WorkspaceResizeHandle /><aside style={{ width, minWidth: 380, maxWidth: '55vw' }}
    className="flex shrink flex-col border-l border-border bg-bg-panel">
    <div className="flex h-10 shrink-0 items-center border-b border-border bg-bg-panel px-2">
      {([['files', '文件'], ['diff', `变更${diffFiles.length ? ` ${diffFiles.length}` : ''}`], ['steps', '步骤'],
        ['output', `输出${commands.length ? ` ${commands.length}` : ''}`], ['terminal', '终端']] as const)
        .map(([id, label]) => <button key={id} type="button" onClick={() => setView(id)}
          className={`relative h-10 px-2.5 text-[14px] transition-colors ${view === id
            ? 'text-txt-primary after:absolute after:inset-x-2 after:bottom-0 after:h-0.5 after:bg-accent'
            : 'text-txt-muted hover:text-txt-secondary'}`}>
          {label}
        </button>)}
      <IconButton className="ml-auto" active={explorerOpen} icon={<Icon.FileDir size={15} />}
        label={explorerOpen ? '收起文件列表' : '展开文件列表'}
        onClick={() => setExplorerOpen((value) => !value)} />
    </div>

    {(view === 'files' || view === 'diff') ? <div className="flex min-h-0 flex-1 flex-col bg-bg-app">
      {view === 'files' && <EditorTabs files={openFiles} activePath={activeFilePath}
        dirtyPaths={dirtyPaths} diff={false} onSelect={setActiveFilePath} onClose={closeFile} />}
      <div className="relative flex min-h-0 flex-1">
        {view === 'diff' && <DiffFileList files={diffFiles} activePath={activeDiff?.path} onSelect={setActiveDiffPath} onClose={closeDiff} />}
        <section className="flex min-w-0 flex-1 flex-col">
          <Breadcrumb workspace={workspace.name} path={editorPath} dirty={Boolean(activeFile && dirtyPaths.has(activeFile.path))}
            saving={savingPath === activeFile?.path} error={saveError} onSave={view === 'files' ? saveActiveFile : undefined}
            markdownMode={view === 'files' ? markdownMode : undefined} onMarkdownModeChange={view === 'files' && activeFile && isMarkdownPath(activeFile.path)
              ? (mode) => setMarkdownModeByPath((current) => ({ ...current, [activeFile.path]: mode })) : undefined} />
          <div className="min-h-0 flex-1">
            {view === 'files' ? (activeFile
              ? markdownMode === 'preview' ? <MarkdownFilePreview path={activeFile.path} content={activeFile.content} />
                : <MonacoPreview path={activeFile.path} content={activeFile.content}
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
        {view === 'files' && explorerOpen && <Explorer workspaceId={workspace.id} directories={directories} expanded={expanded}
          activePath={editorPath} loading={loading} revision={fileTreeRevision} overlay={compactWorkspace}
          onDirectory={toggleDirectory} onFile={selectFile} onClose={() => setExplorerOpen(false)} />}
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
      className={`group/tab flex min-w-[120px] max-w-[210px] items-center border-r border-border text-[14px] ${
        activePath === file.path ? 'bg-bg-app text-txt-primary' : 'text-txt-muted hover:bg-bg-raised hover:text-txt-secondary'}`}>
      <button type="button" className="flex min-w-0 flex-1 items-center gap-1.5 py-2 pl-2" onClick={() => onSelect(file.path)}>
        <FileGlyph path={file.path} diff={diff} />
        <span className="min-w-0 flex-1 truncate text-left" title={file.path}>{basename(file.path)}</span>
      </button>
      <button type="button" aria-label={`关闭 ${basename(file.path)}`}
        className="mr-1 flex h-5 w-5 shrink-0 items-center justify-center rounded opacity-0 hover:bg-bg-active group-hover/tab:opacity-100 focus-visible:opacity-100"
        onClick={() => onClose(file.path)}>{dirtyPaths.has(file.path)
          ? <span className="h-2 w-2 rounded-full bg-accent" /> : <Icon.X size={11} />}</button>
    </div>) : <span className="flex items-center px-3 text-[14px] text-txt-muted">没有打开的文件</span>}
  </div>
}

function Breadcrumb({ workspace, path, dirty, saving, error, onSave, markdownMode, onMarkdownModeChange }: {
  workspace: string; path?: string; dirty?: boolean; saving?: boolean; error?: string; onSave?: () => Promise<void>
  markdownMode?: 'code' | 'preview'; onMarkdownModeChange?: (mode: 'code' | 'preview') => void
}): JSX.Element {
  const parts = path?.split('/') ?? []
  return <div className="flex h-8 shrink-0 items-center gap-1 overflow-hidden border-b border-border bg-bg-app px-3 text-[14px] text-txt-muted">
    <span className="truncate">{workspace}</span>
    {parts.map((part, index) => <span key={`${part}-${index}`} className="flex min-w-0 items-center gap-1">
      <Icon.ChevronRight size={10} /><span className={index === parts.length - 1 ? 'truncate text-txt-secondary' : 'truncate'}>{part}</span>
    </span>)}
    {error && <span className="ml-auto max-w-[240px] truncate text-red-300" title={error}>{error}</span>}
    {markdownMode && onMarkdownModeChange && <div className="ml-auto flex shrink-0 items-center rounded-md border border-border bg-bg-panel p-0.5" role="group" aria-label="Markdown 查看模式">
      {(['code', 'preview'] as const).map((mode) => <button key={mode} type="button"
        aria-pressed={markdownMode === mode} onClick={() => onMarkdownModeChange(mode)}
        className={`rounded px-1.5 py-0.5 text-[14px] transition-colors ${markdownMode === mode
          ? 'bg-bg-active text-txt-primary' : 'text-txt-muted hover:text-txt-secondary'}`}>
        {mode === 'code' ? '代码' : 'Preview'}
      </button>)}
    </div>}
    {dirty && <IconButton className="ml-1 shrink-0" size="sm" icon={<Icon.Save size={13} />} label={saving ? '保存中' : '保存文件（Ctrl+S）'}
      disabled={saving} onClick={() => void onSave?.()} />}
  </div>
}

function DiffFileList({ files, activePath, onSelect, onClose }: {
  files: PatchDiffFile[]; activePath?: string; onSelect: (path: string) => void; onClose: (path: string) => void
}): JSX.Element {
  const added = files.reduce((total, file) => total + file.linesAdded, 0)
  const removed = files.reduce((total, file) => total + file.linesDeleted, 0)
  return <aside className="flex w-[min(280px,32%)] min-w-[190px] shrink-0 flex-col border-r border-border bg-bg-panel">
    <div className="flex h-10 shrink-0 items-center justify-between border-b border-border px-3">
      <span className="text-[14px] font-medium text-txt-secondary">变更文件</span>
      <span className="font-mono text-[14px] text-txt-muted">{files.length} 个</span>
    </div>
    <div className="flex shrink-0 items-center gap-2 border-b border-border px-3 py-2 font-mono text-[14px]">
      <span className="text-ok">+{added}</span><span className="text-err">-{removed}</span>
    </div>
    <div className="min-h-0 flex-1 overflow-auto py-1">
      {files.length ? files.map((file) => <div key={file.path} className={`group flex items-center gap-1 px-2 ${
        activePath === file.path ? 'bg-bg-active text-txt-primary' : 'text-txt-secondary hover:bg-bg-raised'}`}>
        <button type="button" onClick={() => onSelect(file.path)} title={file.path}
          className="flex min-w-0 flex-1 items-center gap-2 py-2 text-left">
          <span className={`w-4 shrink-0 text-center font-mono text-[14px] font-semibold ${file.status === 'added' ? 'text-ok' : file.status === 'deleted' ? 'text-err' : 'text-accent'}`}>
            {file.status === 'added' ? 'A' : file.status === 'deleted' ? 'D' : file.status === 'renamed' ? 'R' : 'M'}
          </span>
          <FileGlyph path={file.path} diff />
          <span className="min-w-0 flex-1">
            <span className="block truncate text-[14px]">{basename(file.path)}</span>
            <span className="block truncate text-[14px] text-txt-muted">{file.path.includes('/') ? file.path.slice(0, file.path.lastIndexOf('/')) : '根目录'}</span>
          </span>
          <span className="shrink-0 font-mono text-[14px]"><span className="text-ok">+{file.linesAdded}</span> <span className="text-err">-{file.linesDeleted}</span></span>
        </button>
        <IconButton size="sm" icon={<Icon.X size={11} />} label={`关闭 ${basename(file.path)} 变更`} className="opacity-0 group-hover:opacity-100 focus-visible:opacity-100"
          onClick={() => onClose(file.path)} />
      </div>) : <Empty text="暂无文件变更" />}
    </div>
  </aside>
}

function MarkdownFilePreview({ path, content }: { path: string; content: string }): JSX.Element {
  return <div className="h-full overflow-auto bg-bg-app px-5 py-5" aria-label={`Markdown Preview ${path}`}>
    <div className="mx-auto max-w-[820px]">
      <MarkdownRenderer>{content}</MarkdownRenderer>
    </div>
  </div>
}

function Explorer({ workspaceId, directories, expanded, activePath, loading, revision, overlay, onDirectory, onFile, onClose }: {
  workspaceId: string; directories: Record<string, WorkspaceFileEntry[]>; expanded: Set<string>; activePath?: string
  loading: boolean; revision: number; overlay: boolean; onDirectory: (path: string) => Promise<void>; onFile: (path: string) => Promise<void>; onClose: () => void
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
  }, [query, workspaceId, revision])
  return <aside className={`${overlay ? 'absolute inset-y-0 right-0 z-30 shadow-modal' : 'relative'} flex shrink-0 flex-col border-l border-border bg-bg-panel`}
    style={{ width: overlay ? 'min(280px, 82%)' : 'clamp(220px, 30%, 280px)' }}>
    <div className="flex items-center gap-2 border-b border-border p-2">
      <span className="min-w-0 flex-1 text-[14px] font-medium text-txt-secondary">文件</span>
      {overlay && <IconButton size="sm" icon={<Icon.X size={13} />} label="关闭文件列表" onClick={onClose} />}
      <label className="flex h-7 min-w-0 flex-1 items-center gap-1.5 rounded-md border border-border bg-bg-app px-2 focus-within:border-accent">
        <Icon.Search size={12} className="shrink-0 text-txt-muted" />
        <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="筛选文件…"
          className="min-w-0 flex-1 bg-transparent text-[14px] text-txt-primary outline-none placeholder:text-txt-muted" />
        {query && <button type="button" className="text-txt-muted hover:text-txt-primary" onClick={() => setQuery('')}><Icon.X size={11} /></button>}
      </label>
    </div>
    <div className="min-h-0 flex-1 overflow-auto py-1">
      {query.trim() ? (results.length ? results.map((entry) => <FileRow key={entry.path} entry={entry} depth={0}
        active={entry.path === activePath} onClick={() => void onFile(entry.path)} showPath />)
        : <Empty text={searching ? '正在搜索…' : '没有匹配文件'} />)
        : <FileTree path="" directories={directories} expanded={expanded} activePath={activePath}
          onDirectory={onDirectory} onFile={onFile} />}
      {loading && !query && <div className="px-3 py-2 text-[14px] text-txt-muted">读取中…</div>}
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
  const folderSource = entry.kind === 'directory'
    ? folderIconSource(workspaceFolderIcon(entry.path), Boolean(expanded))
    : undefined
  return <button type="button" className={`mx-1 flex w-[calc(100%-8px)] items-center gap-1.5 rounded px-2 py-1 text-left text-[14px] ${
    active ? 'bg-bg-active text-txt-primary shadow-sm ring-1 ring-inset ring-border-strong' : 'text-txt-secondary hover:bg-bg-raised'}`}
    style={{ paddingLeft: `${8 + depth * 11}px` }} onClick={onClick} title={entry.path}>
    {entry.kind === 'directory' ? <><Icon.ChevronRight size={11} className={expanded ? 'rotate-90' : ''} />
      <img aria-hidden="true" src={folderSource} alt="" className="h-[18px] w-[18px] shrink-0 object-contain" /></>
      : <><span className="w-[11px]" /><FileGlyph path={entry.path} /></>}
    <span className="min-w-0 flex-1 truncate">{showPath ? entry.path : entry.name}</span>
  </button>
}

function FileGlyph({ path, diff = false }: { path: string; diff?: boolean }): JSX.Element {
  const kind = workspaceFileKind(path)
  const source = fileIconSources[kind.icon] ?? fileIconSources.file
  return <span aria-hidden="true" className={`inline-flex h-[18px] w-[18px] shrink-0 items-center justify-center ${diff ? 'rounded-[3px] ring-1 ring-inset ring-accent/70' : ''}`}>
    <img src={source} alt="" className="h-full w-full object-contain" onError={(event) => {
      if (event.currentTarget.src !== fileIconSources.file) event.currentTarget.src = fileIconSources.file
    }} />
  </span>
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
      <li key={`${item.order}-${index}`} className="flex gap-2 border-b border-border px-2 py-2 text-[14px] text-txt-secondary">
        <span className={item.done ? 'text-ok' : 'text-txt-muted'}>{item.done ? '✓' : '○'}</span><span>{item.title}</span>
      </li>)}</ol> : <Empty text="暂无任务步骤" />)}
    {view === 'output' && (commands.length ? commands.map((command) => <details key={command.callId} open={command.exitCode !== 0} className="border-b border-border">
      <summary className="cursor-pointer px-3 py-2 font-mono text-[14px] text-txt-primary">{command.executable} {command.args.join(' ')} · exit {command.exitCode ?? '—'}</summary>
      <pre className="selectable max-h-80 overflow-auto bg-bg-app p-3 text-[14px] leading-[21px] text-txt-secondary">{[
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
    <div className="border-b border-border px-3 py-2 text-[14px] text-txt-muted">仅接收你的键盘输入；Agent 工具无法读取、写入或控制此终端。</div>
    {!terminalId ? <button type="button" className="m-3 rounded border border-border bg-bg-raised px-3 py-2 text-[14px] text-txt-primary hover:bg-bg-active"
      onClick={async () => {
        if (!activeId) return
        const result = await window.agent.terminal.open(activeId)
        if (result.ok) { setTerminalId(result.data.id); setTerminalOutput(`已启动 ${result.data.shell}\n`) }
        else setTerminalOutput(result.error.message)
      }}>启动用户终端</button> : <>
      <pre className="selectable min-h-0 flex-1 overflow-auto whitespace-pre-wrap p-3 font-mono text-[14px] leading-[21px] text-txt-secondary">{terminalOutput}</pre>
      <form className="flex border-t border-border" onSubmit={(event) => {
        event.preventDefault()
        if (!terminalInput || !terminalId) return
        void window.agent.terminal.write(terminalId, `${terminalInput}\r\n`)
        setTerminalInput('')
      }}>
        <span className="px-2 py-2 font-mono text-[14px] text-accent">›</span>
        <input value={terminalInput} onChange={(event) => setTerminalInput(event.target.value)} autoComplete="off"
          className="min-w-0 flex-1 bg-transparent py-2 pr-2 font-mono text-[14px] text-txt-primary outline-none" placeholder="输入命令并回车" />
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
  return <div className="flex h-full min-h-32 items-center justify-center px-4 text-center text-[14px] text-txt-muted">{text}</div>
}
