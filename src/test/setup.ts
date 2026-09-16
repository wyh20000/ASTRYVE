/**
 * 组件测试的全局准备。
 *
 * 职责：
 * 1. 注册 jest-dom 断言（toBeInTheDocument / toBeDisabled / toHaveFocus 等）；
 * 2. 补齐 jsdom 缺失、但 antd 与 Electron 渲染进程会用到的浏览器 API；
 * 3. 让每个用例结束后自动清理 DOM，避免相互污染。
 */
import '@testing-library/jest-dom/vitest'
import { cleanup } from '@testing-library/react'
import { afterEach, vi } from 'vitest'

afterEach(() => {
  cleanup()
})

/* ---------------- antd 需要的浏览器 API 补齐 ---------------- */

// antd 的响应式断点与浮层定位依赖 matchMedia
if (typeof window !== 'undefined' && typeof window.matchMedia !== 'function') {
  Object.defineProperty(window, 'matchMedia', {
    writable: true,
    value: (query: string) => ({
      matches: false,
      media: query,
      onchange: null,
      addListener: vi.fn(),
      removeListener: vi.fn(),
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      dispatchEvent: vi.fn()
    })
  })
}

// antd 的 ResizeObserver 用法（Table / Select 等）
if (typeof globalThis.ResizeObserver === 'undefined') {
  class ResizeObserverStub {
    observe(): void {}
    unobserve(): void {}
    disconnect(): void {}
  }
  Object.defineProperty(globalThis, 'ResizeObserver', {
    writable: true,
    value: ResizeObserverStub
  })
}

// antd 的 rc-virtual-list 会调用 getComputedStyle 读取滚动条宽度
if (typeof window !== 'undefined' && !window.getComputedStyle) {
  Object.defineProperty(window, 'getComputedStyle', {
    writable: true,
    value: () => ({ getPropertyValue: () => '' })
  })
}

// 渲染进程代码会访问 window.agent（IPC 桥）。组件测试不需要真实 IPC，
// 这里提供一个最小桩，避免未迁移组件在挂载时抛错。
if (typeof window !== 'undefined' && !('agent' in window)) {
  Object.defineProperty(window, 'agent', {
    writable: true,
    value: {
      platform: 'win32',
      window: {
        setTitleBarOverlay: async () => ({ ok: true })
      }
    }
  })
}
