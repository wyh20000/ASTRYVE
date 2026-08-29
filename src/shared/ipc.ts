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
    send: 'message:send'
  },
  model: {
    getConfig: 'model:get-config',
    setConfig: 'model:set-config',
    setActive: 'model:set-active',
    setReasoning: 'model:set-reasoning',
    test: 'model:test'
  },
  window: {
    setTitleBarOverlay: 'window:set-title-bar-overlay'
  }
} as const

/** 主进程 → 渲染进程的事件推送 channel */
export const EVENTS = {
  messageStreamed: 'message:streamed'
} as const