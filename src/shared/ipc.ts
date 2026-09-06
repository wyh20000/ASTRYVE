/**
 * IPC channel 常量（typed，避免魔法字符串）。
 * 命名约定：`域:动作`
 */
export const IPC = {
  app: {
    ping: 'app:ping'
  },
  session: {
    list: 'session:list',
    create: 'session:create',
    rename: 'session:rename',
    remove: 'session:remove',
    touch: 'session:touch'
  },
  message: {
    list: 'message:list',
    send: 'message:send',
    stop: 'message:stop'
  },
  workspace: {
    recent: 'workspace:recent',
    select: 'workspace:select',
    activate: 'workspace:activate',
    listFiles: 'workspace:list-files',
    findFiles: 'workspace:find-files',
    readFile: 'workspace:read-file',
    saveFile: 'workspace:save-file',
    readMany: 'workspace:read-many',
    searchText: 'workspace:search-text',
    rejectPatchFile: 'workspace:reject-patch-file'
  },
  terminal: {
    open: 'terminal:open',
    write: 'terminal:write',
    close: 'terminal:close'
  },
  model: {
    getConfig: 'model:get-config',
    setConfig: 'model:set-config',
    setActive: 'model:set-active',
    setReasoning: 'model:set-reasoning',
    test: 'model:test'
  },
  settings: {
    getTheme: 'settings:get-theme',
    setTheme: 'settings:set-theme',
    getAgentProject: 'settings:get-agent-project',
    setAgentProject: 'settings:set-agent-project'
  },
  window: {
    setTitleBarOverlay: 'window:set-title-bar-overlay'
  }
} as const

/** 主进程 → 渲染进程的事件推送 channel */
export const EVENTS = {
  messageStreamed: 'message:streamed',
  messageNotice: 'message:notice',
  terminalOutput: 'terminal:output',
  workspaceFilesChanged: 'workspace:files-changed'
} as const
