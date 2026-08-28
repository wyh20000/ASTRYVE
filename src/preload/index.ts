import { contextBridge, ipcRenderer } from 'electron'
import { IPC, EVENTS } from '@shared/ipc'
import type {
  AgentApi,
  CreateSessionInput,
  SendMessageInput,
  ModelConfig,
  Message
} from '@shared/types'

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
    send: (input: SendMessageInput) => ipcRenderer.invoke(IPC.message.send, input)
  },
  model: {
    getConfig: () => ipcRenderer.invoke(IPC.model.getConfig),
    setConfig: (cfg: Partial<ModelConfig>) => ipcRenderer.invoke(IPC.model.setConfig, cfg),
    test: () => ipcRenderer.invoke(IPC.model.test)
  },
  onMessageStreamed: (cb: (m: Message) => void) => {
    const listener = (_e: unknown, m: Message): void => cb(m)
    ipcRenderer.on(EVENTS.messageStreamed, listener)
    return () => ipcRenderer.removeListener(EVENTS.messageStreamed, listener)
  },
  window: {
    setTitleBarOverlay: (opts) => ipcRenderer.invoke(IPC.window.setTitleBarOverlay, opts)
  }
}

contextBridge.exposeInMainWorld('agent', api)