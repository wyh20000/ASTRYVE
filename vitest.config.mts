import { defineConfig } from 'vitest/config'
import { resolve } from 'path'

export default defineConfig({
  define: { __AI_AGENT_AUTH_MODE__: JSON.stringify('remote') },
  resolve: {
    alias: {
      '@shared': resolve('src/shared'),
      '@renderer': resolve('src/renderer/src')
    }
  },
  test: {
    /*
     * 默认 node 环境，组件测试在文件顶部用 `@vitest-environment jsdom` 显式切换。
     *
     * 为什么不用全局 jsdom：
     * - 主进程测试（插件运行时等）依赖进程内执行，全局 jsdom 会让
     *   pluginMarketRuntime 以 PLUGIN_EXECUTION_FAILED 失败；
     * - Vitest 4 已移除 environmentMatchGlobs，逐文件 pragma 是官方推荐做法，
     *   也让「这个测试需要 DOM」写在测试文件里，更易读。
     */
    environment: 'node',
    setupFiles: ['src/test/setup.ts'],
    include: ['src/**/*.{test,spec}.{ts,tsx}'],

    /*
     * 串行执行测试文件。
     *
     * 原因（实测，非推测）：本仓库有若干「真实 I/O / 真实子进程」的测试，
     * 它们逐个 await 文件系统与进程操作，因此对并发极其敏感：
     *   - pluginInstaller：约 1000 次建删文件 + 27MB 落盘，
     *     空闲 0.5s，负载下 10~15s，曾直接超时失败；
     *   - localCommand：真实子进程 + 独立 stdio，空闲 0.4s，负载下失败。
     * 实测单纯限制到 4 个 worker 仍会让 localCommand 失败，
     * 因此这里改为串行，彻底移除文件系统延迟放大。
     *
     * 代价：全量耗时由约 20s 增至约 45s。这是有意用时间换确定性：
     * 这些测试套件本身不慢，慢的是并发争用。
     */
    maxWorkers: 1,
    fileParallelism: false,

    /*
     * 超时预算。
     *
     * 15s 而不是默认 5s：antd 的 CSS-in-JS 首次渲染较慢，组件测试需要余量。
     */
    testTimeout: 15000
  }
})
