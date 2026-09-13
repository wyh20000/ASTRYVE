# M14/M15 Runnable-First Implementation Plan

> **归档说明（2026-09-13）：** 本计划的 M14 插件内容仍可作为历史实施依据；所有 M15 managed Chrome 任务均已取消且不得继续执行。当前仓库仅保留适配器中立的 Browser Gateway、安全策略和协议，Chrome 扩展由独立项目承接。

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task with review checkpoints.

**Historical goal:** This document originally covered market-installed executable plugins (M14) and managed Chrome tools (M15). The managed-Chrome half is superseded by the archive decision above.

**Architecture:** Keep the existing Plugin Marketplace → installer → registry → task tool snapshot → isolated worker path and Browser Manager → Gateway → task tool registry path. Add integration seams and tests only where the current layers are not proven together. Treat the milestone checklist as evidence-driven: check an item only after automated or recorded manual verification.

**Tech Stack:** Electron 44, TypeScript, React 18, Vitest, JSZip, Chrome DevTools Protocol.

**Spec:** `docs/superpowers/specs/2026-09-09-plugin-browser-platform-design.md`

**Global Constraints:** Preserve unrelated user changes; use TDD for behavior changes; do not add M16 current-Chrome-extension scope; keep external/network tests optional; prefer deterministic local fixtures; do not claim manual UI/model acceptance without evidence.

---

### Task 1: Prove the M14 market-to-tool vertical slice

**Files:**
- Create: `src/main/services/agent/pluginMarketRuntime.test.ts`
- Modify only if the failing test exposes a real gap: `src/main/services/agent/pluginLifecycle.ts`, `pluginManager.ts`, `pluginTools.ts`

1. Build an in-memory ZIP containing a valid executable plugin and matching market metadata.
2. Write a test that downloads and installs it, parses the installed manifest, exposes its tool, invokes it through a worker-compatible boundary, and verifies cleanup.
3. Run the test and confirm it fails for a missing integration seam or behavior.
4. Add the smallest production change necessary, then rerun the focused plugin suite.

### Task 2: Close the M14 user-visible runnable path

**Files:**
- Modify as required: `src/main/ipc/plugins.ts`, `src/renderer/src/stores/pluginStore.ts`, `src/renderer/src/components/layout/SettingsPage.tsx`
- Test: matching IPC/store/component tests

1. Verify market install/update, enable, rollback, and uninstall state transitions are surfaced to the UI.
2. Add a failing test for the first broken transition found.
3. Implement only the missing transition and ensure new market installs remain disabled until user enablement.
4. Add/update `docs/verification/M14-插件市场页面验证测试单.md` with runnable steps and clearly marked manual evidence gaps.

### Task 3: Prove the M15 task-to-Chrome vertical slice

**Files:**
- Test: `src/main/services/agent/taskRuntimeManager.test.ts`, `src/main/services/browser/*.test.ts`
- Modify only if required: `src/main/services/agent/taskRuntimeManager.ts`, `src/main/services/browser/browserManager.ts`, `browserGateway.ts`, `browserTools.ts`

1. Verify Browser Gateway tools enter a task registry when managed Chrome is available and are absent with an explicit status when unavailable.
2. Verify app shutdown stops the managed browser and task disposal does not replay writes.
3. Add failing tests for missing context/cleanup behavior, then implement the minimum fixes.
4. Run the browser and task runtime suites.

### Task 4: Close the highest-risk M15 safety gaps

**Files:**
- Modify: `src/main/services/browser/browserGateway.ts`, `browserTools.ts`, related shared types and tests as needed

1. Propagate call ID, source, deadline, and cancellation through read and write calls.
2. Prevent sensitive input values from being returned to the model and classify submit/upload/download/history operations for approval.
3. Bound large semantic results through explicit truncation or pagination metadata.
4. Keep all new behavior under focused tests before implementation.

### Task 5: Verification and honest milestone status

**Files:**
- Create/update: `docs/verification/M14-插件市场页面验证测试单.md`
- Create/update: `docs/verification/M15-独立Chrome页面验证测试单.md`
- Modify: `docs/08-第四阶段计划.md` only for items supported by evidence

1. Run focused plugin/browser tests, full tests, Node/Web type checks, production build, and `git diff --check`.
2. If a visible Chrome run is possible locally, execute a smoke flow: start → open tab → inspect/find → interact → screenshot → stop.
3. Record exact results and remaining manual DeepSeek/other-model/UI evidence; do not mark those complete without execution.
