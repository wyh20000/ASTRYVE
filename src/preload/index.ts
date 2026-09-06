import { contextBridge, ipcRenderer } from 'electron'
import { IPC, EVENTS } from '@shared/ipc'
import type {
  AgentApi,
  CreateSessionInput,
  SendMessageInput,
  ModelConfig,
  ModelPreset,
  ReasoningEffort,
  PersistedTheme,
  Message,
  MessageNotice,
  AgentProjectPreferences,
  RejectPatchFileInput,
  TerminalOutput,
  WorkspaceFilesChanged
} from '@shared/types'
import type {
  ActivateWorkspaceInput,
  WorkspaceListInput,
  WorkspaceReadInput,
  WorkspaceSaveInput,
  WorkspaceReadManyInput,
  WorkspaceFileSearchInput,
  WorkspaceSearchInput
} from '@shared/agent'

const api: AgentApi = {
  platform: process.platform,
  ping: () => ipcRenderer.invoke(IPC.app.ping),
  session: {
    list: () => ipcRenderer.invoke(IPC.session.list),
    create: (input: CreateSessionInput) => ipcRenderer.invoke(IPC.session.create, input),
    rename: (id: string, title: string) => ipcRenderer.invoke(IPC.session.rename, id, title),
    remove: (id: string) => ipcRenderer.invoke(IPC.session.remove, id),
    touch: (id: string) => ipcRenderer.invoke(IPC.session.touch, id)
  },
  message: {
    list: (sessionId: string) => ipcRenderer.invoke(IPC.message.list, sessionId),
    send: (input: SendMessageInput) => ipcRenderer.invoke(IPC.message.send, input),
    stop: (sessionId: string) => ipcRenderer.invoke(IPC.message.stop, sessionId)
  },
  workspace: {
    listRecent: () => ipcRenderer.invoke(IPC.workspace.recent),
    select: () => ipcRenderer.invoke(IPC.workspace.select),
    activate: (input: ActivateWorkspaceInput) => ipcRenderer.invoke(IPC.workspace.activate, input),
    listFiles: (input: WorkspaceListInput) => ipcRenderer.invoke(IPC.workspace.listFiles, input),
    findFiles: (input: WorkspaceFileSearchInput) => ipcRenderer.invoke(IPC.workspace.findFiles, input),
    readFile: (input: WorkspaceReadInput) => ipcRenderer.invoke(IPC.workspace.readFile, input),
    saveFile: (input: WorkspaceSaveInput) => ipcRenderer.invoke(IPC.workspace.saveFile, input),
    readMany: (input: WorkspaceReadManyInput) => ipcRenderer.invoke(IPC.workspace.readMany, input),
    searchText: (input: WorkspaceSearchInput) => ipcRenderer.invoke(IPC.workspace.searchText, input),
    rejectPatchFile: (input: RejectPatchFileInput) => ipcRenderer.invoke(IPC.workspace.rejectPatchFile, input)
  },
  terminal: {
    open: (sessionId: string) => ipcRenderer.invoke(IPC.terminal.open, sessionId),
    write: (terminalId: string, text: string) => ipcRenderer.invoke(IPC.terminal.write, terminalId, text),
    close: (terminalId: string) => ipcRenderer.invoke(IPC.terminal.close, terminalId)
  },
  model: {
    getConfig: () => ipcRenderer.invoke(IPC.model.getConfig),
    setConfig: (cfg: Partial<ModelConfig>) => ipcRenderer.invoke(IPC.model.setConfig, cfg),
    setActive: (id: string) => ipcRenderer.invoke(IPC.model.setActive, id),
    setReasoning: (effort: ReasoningEffort) => ipcRenderer.invoke(IPC.model.setReasoning, effort),
    test: (preset?: ModelPreset) => ipcRenderer.invoke(IPC.model.test, preset)
  },
  onMessageStreamed: (cb: (m: Message) => void) => {
    const listener = (_e: unknown, m: Message): void => cb(m)
    ipcRenderer.on(EVENTS.messageStreamed, listener)
    return () => ipcRenderer.removeListener(EVENTS.messageStreamed, listener)
  },
  onMessageNotice: (cb: (notice: MessageNotice) => void) => {
    const listener = (_e: unknown, notice: MessageNotice): void => cb(notice)
    ipcRenderer.on(EVENTS.messageNotice, listener)
    return () => ipcRenderer.removeListener(EVENTS.messageNotice, listener)
  },
  onTerminalOutput: (cb: (output: TerminalOutput) => void) => {
    const listener = (_e: unknown, output: TerminalOutput): void => cb(output)
    ipcRenderer.on(EVENTS.terminalOutput, listener)
    return () => ipcRenderer.removeListener(EVENTS.terminalOutput, listener)
  },
  onWorkspaceFilesChanged: (cb: (change: WorkspaceFilesChanged) => void) => {
    const listener = (_e: unknown, change: WorkspaceFilesChanged): void => cb(change)
    ipcRenderer.on(EVENTS.workspaceFilesChanged, listener)
    return () => ipcRenderer.removeListener(EVENTS.workspaceFilesChanged, listener)
  },
  settings: {
    getTheme: () => ipcRenderer.invoke(IPC.settings.getTheme),
    setTheme: (t: PersistedTheme) => ipcRenderer.invoke(IPC.settings.setTheme, t),
    getAgentProject: (workspaceId: string) =>
      ipcRenderer.invoke(IPC.settings.getAgentProject, workspaceId),
    setAgentProject: (preferences: AgentProjectPreferences) =>
      ipcRenderer.invoke(IPC.settings.setAgentProject, preferences)
  },
  window: {
    setTitleBarOverlay: (opts) => ipcRenderer.invoke(IPC.window.setTitleBarOverlay, opts)
  }
}

contextBridge.exposeInMainWorld('agent', api)
