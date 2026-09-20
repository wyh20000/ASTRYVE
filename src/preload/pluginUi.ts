import { contextBridge, ipcRenderer } from 'electron'

/** Deliberately separate from the application's privileged preload. */
contextBridge.exposeInMainWorld('pluginHost', Object.freeze({
  getInfo: () => ipcRenderer.invoke('plugin-ui:info') as Promise<{ id: string; name: string; version?: string }>,
  close: () => ipcRenderer.send('plugin-ui:close')
}))
