import { resolve } from 'path'
import { defineConfig, externalizeDepsPlugin } from 'electron-vite'
import react from '@vitejs/plugin-react'

const sharedAlias = {
  '@shared': resolve('src/shared'),
  '@renderer': resolve('src/renderer/src')
}

const authMode = process.env.AI_AGENT_AUTH_MODE || 'local'
if (!['local', 'remote'].includes(authMode)) {
  throw new Error('AI_AGENT_AUTH_MODE must be local or remote')
}

export default defineConfig({
  main: {
    define: { __AI_AGENT_AUTH_MODE__: JSON.stringify(authMode) },
    build: {
      rollupOptions: {
        input: {
          bootstrap: resolve('src/main/bootstrap.ts'),
          index: resolve('src/main/index.ts'),
          localExecutionWorker: resolve('src/main/services/agent/localExecutionWorker.ts'),
          pluginWorkerProcess: resolve('src/main/services/agent/pluginWorkerProcess.ts')
        }
      }
    },
    plugins: [externalizeDepsPlugin()],
    resolve: {
      alias: { '@shared': resolve('src/shared') }
    }
  },
  preload: {
    build: {
      rollupOptions: {
        input: {
          index: resolve('src/preload/index.ts'),
          pluginUi: resolve('src/preload/pluginUi.ts')
        }
      }
    },
    plugins: [externalizeDepsPlugin()],
    resolve: {
      alias: { '@shared': resolve('src/shared') }
    }
  },
  renderer: {
    resolve: {
      alias: sharedAlias
    },
    plugins: [react()]
  }
})
