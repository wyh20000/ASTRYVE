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
  WorkspaceFilesChanged,
  SkillListInput,
  SkillToggleInput,
  SkillCatalogInput,
  SkillInstallInput,
  SkillUninstallInput,
  PluginToggleInput,
  PluginImportInput,
  PluginRecoverInput,
  PluginMarketSourceInput,
  PluginMarketSourceIdInput,
  PluginMarketSourceToggleInput,
  PluginMarketInstallInput,
  PluginUninstallInput,
  PluginRollbackInput,
  PluginMcpConnectInput,
  PluginMcpTargetInput,
  PluginMcpDisconnectInput,
  UserInputRequest,
  UserInputResponse,
  ApprovalUiRequest,
  ApprovalUiResponse,
  BrowserPreferences
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
    stop: (sessionId: string) => ipcRenderer.invoke(IPC.message.stop, sessionId),
    respondInput: (input: UserInputResponse) => ipcRenderer.invoke(IPC.message.respondInput, input)
  },
  approval: {
    respond: (input: ApprovalUiResponse) => ipcRenderer.invoke(IPC.approval.respond, input)
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
  skills: {
    list: (input: SkillListInput) => ipcRenderer.invoke(IPC.skills.list, input),
    catalog: (input?: SkillCatalogInput) => ipcRenderer.invoke(IPC.skills.catalog, input),
    install: (input: SkillInstallInput) => ipcRenderer.invoke(IPC.skills.install, input),
    importLocal: (input: SkillListInput) => ipcRenderer.invoke(IPC.skills.importLocal, input),
    uninstall: (input: SkillUninstallInput) => ipcRenderer.invoke(IPC.skills.uninstall, input),
    setEnabled: (input: SkillToggleInput) => ipcRenderer.invoke(IPC.skills.setEnabled, input)
  },
  plugins: {
    list: () => ipcRenderer.invoke(IPC.plugins.list),
    readIcon: (input: { id: string }) => ipcRenderer.invoke(IPC.plugins.readIcon, input),
    readAsset: (input: { id: string; path: string }) => ipcRenderer.invoke(IPC.plugins.readAsset, input),
    openUi: (input: { id: string }) => ipcRenderer.invoke(IPC.plugins.openUi, input),
    listSkills: (input: PluginUninstallInput) => ipcRenderer.invoke(IPC.plugins.listSkills, input),
    importLocal: (input: PluginImportInput) => ipcRenderer.invoke(IPC.plugins.importLocal, input),
    setEnabled: (input: PluginToggleInput) => ipcRenderer.invoke(IPC.plugins.setEnabled, input),
    recover: (input: PluginRecoverInput) => ipcRenderer.invoke(IPC.plugins.recover, input),
    marketplace: () => ipcRenderer.invoke(IPC.plugins.marketplace),
    addSource: (input: PluginMarketSourceInput) => ipcRenderer.invoke(IPC.plugins.addSource, input),
    setSourceEnabled: (input: PluginMarketSourceToggleInput) => ipcRenderer.invoke(IPC.plugins.setSourceEnabled, input),
    removeSource: (input: PluginMarketSourceIdInput) => ipcRenderer.invoke(IPC.plugins.removeSource, input),
    syncSource: (input: PluginMarketSourceIdInput) => ipcRenderer.invoke(IPC.plugins.syncSource, input),
    installMarket: (input: PluginMarketInstallInput) => ipcRenderer.invoke(IPC.plugins.installMarket, input),
    uninstall: (input: PluginUninstallInput) => ipcRenderer.invoke(IPC.plugins.uninstall, input),
    backups: (input: PluginUninstallInput) => ipcRenderer.invoke(IPC.plugins.backups, input),
    rollback: (input: PluginRollbackInput) => ipcRenderer.invoke(IPC.plugins.rollback, input),
    getPreferences: () => ipcRenderer.invoke(IPC.plugins.getPreferences),
    setPreferences: (input) => ipcRenderer.invoke(IPC.plugins.setPreferences, input),
    listConnections: () => ipcRenderer.invoke(IPC.plugins.listConnections),
    connectMcp: (input: PluginMcpConnectInput) => ipcRenderer.invoke(IPC.plugins.connectMcp, input),
    reauthorizeMcp: (input: PluginMcpConnectInput) => ipcRenderer.invoke(IPC.plugins.reauthorizeMcp, input),
    retryMcp: (input: PluginMcpTargetInput) => ipcRenderer.invoke(IPC.plugins.retryMcp, input),
    disconnectMcp: (input: PluginMcpDisconnectInput) => ipcRenderer.invoke(IPC.plugins.disconnectMcp, input)
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
  onUserInputRequested: (cb: (request: UserInputRequest) => void) => {
    const listener = (_e: unknown, request: UserInputRequest): void => cb(request)
    ipcRenderer.on(EVENTS.userInputRequested, listener)
    return () => ipcRenderer.removeListener(EVENTS.userInputRequested, listener)
  },
  onUserInputResolved: (cb: (request: Pick<UserInputRequest, 'id' | 'sessionId'>) => void) => {
    const listener = (_e: unknown, request: Pick<UserInputRequest, 'id' | 'sessionId'>): void => cb(request)
    ipcRenderer.on(EVENTS.userInputResolved, listener)
    return () => ipcRenderer.removeListener(EVENTS.userInputResolved, listener)
  },
  onApprovalRequested: (cb: (request: ApprovalUiRequest) => void) => {
    const listener = (_e: unknown, request: ApprovalUiRequest): void => cb(request)
    ipcRenderer.on(EVENTS.approvalRequested, listener)
    return () => ipcRenderer.removeListener(EVENTS.approvalRequested, listener)
  },
  onApprovalResolved: (cb: (request: Pick<ApprovalUiRequest, 'id' | 'sessionId'>) => void) => {
    const listener = (_e: unknown, request: Pick<ApprovalUiRequest, 'id' | 'sessionId'>): void => cb(request)
    ipcRenderer.on(EVENTS.approvalResolved, listener)
    return () => ipcRenderer.removeListener(EVENTS.approvalResolved, listener)
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
  onPluginsChanged: (cb: () => void) => {
    const listener = (): void => cb()
    ipcRenderer.on(EVENTS.pluginsChanged, listener)
    return () => ipcRenderer.removeListener(EVENTS.pluginsChanged, listener)
  },
  settings: {
    getTheme: () => ipcRenderer.invoke(IPC.settings.getTheme),
    setTheme: (t: PersistedTheme) => ipcRenderer.invoke(IPC.settings.setTheme, t),
    getAgentProject: (workspaceId: string) =>
      ipcRenderer.invoke(IPC.settings.getAgentProject, workspaceId),
    setAgentProject: (preferences: AgentProjectPreferences) =>
      ipcRenderer.invoke(IPC.settings.setAgentProject, preferences),
    clearAudit: () => ipcRenderer.invoke(IPC.settings.clearAudit),
    getAudit: () => ipcRenderer.invoke(IPC.settings.getAudit),
    getBrowserPreferences: () => ipcRenderer.invoke(IPC.settings.getBrowserPreferences),
    setBrowserPreferences: (value: BrowserPreferences) => ipcRenderer.invoke(IPC.settings.setBrowserPreferences, value)
  },
  window: {
    setTitleBarOverlay: (opts) => ipcRenderer.invoke(IPC.window.setTitleBarOverlay, opts)
  }
}

contextBridge.exposeInMainWorld('agent', api)
