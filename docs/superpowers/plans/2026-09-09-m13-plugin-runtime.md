# M13 Plugin Runtime Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a local, sandboxed plugin runtime whose normalized tools enter the existing trusted Tool Registry and work through every model provider adapter.

**Architecture:** Plugin packages are parsed and normalized in the Electron main process, never in the renderer. Installed metadata is exposed through typed IPC; executable tools run in one isolated Utility Process per plugin and communicate through a bounded protocol. The existing provider adapters remain the only model-specific layer, so plugin tools follow the same structured tool-call loop as built-in tools.

**Tech Stack:** Electron 44 Utility Process, TypeScript 5.5, React 18, Zustand, Vitest, JSON Schema-compatible closed tool schemas.

**Spec:** `docs/superpowers/specs/2026-09-09-plugin-browser-platform-design.md`

## Global Constraints

- Do not load third-party plugin code into the Electron main process or renderer.
- Do not execute any file while discovering, importing, or validating a plugin.
- Every provider receives plugin tools through its documented structured tool-call interface; never parse tool calls from model text.
- DeepSeek and Kimi use the existing OpenAI-compatible `tools` / `tool_calls` / `role=tool` loop.
- Provider-specific reasoning payloads and call identifiers must survive tool rounds unchanged where required.
- Plugin permissions cannot expand the current task permission mode, workspace grant, or Tool Registry policy.
- Every worker call has a deadline, cancellation signal, result-size limit, heartbeat, and crash isolation.
- No code commits are created unless the user later asks for one.

---

### Task 1: Normalized plugin manifest contract

**Files:**
- Modify: `src/shared/types.ts`
- Create: `src/main/services/agent/pluginManifest.ts`
- Test: `src/main/services/agent/pluginManifest.test.ts`

**Interfaces:**
- Produces: `PluginManifest`, `PluginMetadata`, `PluginPermission`, `PluginComponent`, `parsePluginManifest(rootPath: string): Promise<NormalizedPluginPackage>`.
- Consumes: a package directory containing `plugin.json` or legacy `.codex-plugin/plugin.json`.

- [x] **Step 1: Write failing tests for standard and legacy manifests**

Test a standard package with stable ID, name, version, description and components, then a legacy Codex package normalized to the same internal shape.

- [x] **Step 2: Run the manifest test and verify the missing-module failure**

Run: `npm test -- --run src/main/services/agent/pluginManifest.test.ts`

- [x] **Step 3: Implement strict parsing and normalization**

Accept only plugin IDs matching `^[a-z0-9][a-z0-9._-]{1,63}$`, semantic versions with three numeric components, relative component paths, known permissions, a 256KB manifest limit, and objects with safe depth/node counts. Reject path traversal, URLs as local entry paths, duplicate tool names, unknown executable component types, and manifests that declare neither Skills, MCP, Hooks nor Worker tools.

- [x] **Step 4: Add failing malicious-input tests**

Cover traversal, absolute paths, links, oversized data, duplicate names, unsupported permissions and unknown keys that would alter execution.

- [x] **Step 5: Make the malicious-input tests pass and rerun the suite**

Run: `npm test -- --run src/main/services/agent/pluginManifest.test.ts`

### Task 2: Installed-plugin discovery and persisted enable state

**Files:**
- Create: `src/main/services/agent/pluginRegistry.ts`
- Test: `src/main/services/agent/pluginRegistry.test.ts`
- Modify: `src/main/services/settings.ts`
- Modify: `src/main/services/settings.test.ts`
- Modify: `src/main/index.ts`

**Interfaces:**
- Produces: `initPluginRegistry(userDataPath: string)`, `listPlugins(): Promise<PluginMetadata[]>`, `getInstalledPluginRoot(): string`, `setPluginEnabled(id: string, enabled: boolean)`.
- Consumes: normalized manifest parser and persisted `disabledPlugins: string[]`.

- [x] **Step 1: Write failing discovery tests**

Create valid, invalid and staging directories. Assert deterministic ordering, per-plugin error isolation, no script execution and omission of `.staging-*`, `.backup-*` and `.trash`.

- [x] **Step 2: Run tests and verify failure because the registry is absent**

Run: `npm test -- --run src/main/services/agent/pluginRegistry.test.ts src/main/services/settings.test.ts`

- [x] **Step 3: Implement discovery and enable-state persistence**

Initialize the registry at `<userData>/plugins`; expose defensive metadata copies; preserve invalid packages as disabled diagnostic rows when their directory can be identified; persist disabled IDs atomically with rollback on write failure.

- [x] **Step 4: Run focused tests until green**

Run: `npm test -- --run src/main/services/agent/pluginRegistry.test.ts src/main/services/settings.test.ts`

### Task 3: Typed IPC and real installed-plugin UI

**Files:**
- Modify: `src/shared/ipc.ts`
- Modify: `src/shared/types.ts`
- Create: `src/main/ipc/plugins.ts`
- Modify: `src/main/ipc/index.ts`
- Modify: `src/preload/index.ts`
- Create: `src/renderer/src/stores/pluginStore.ts`
- Create: `src/renderer/src/stores/pluginStore.test.ts`
- Modify: `src/renderer/src/components/layout/SettingsPage.tsx`
- Modify: `src/renderer/src/components/layout/SettingsPage.test.tsx`

**Interfaces:**
- Produces: `window.agent.plugins.list()`, `window.agent.plugins.setEnabled(input)`, Zustand `usePluginStore`, installed plugin rows.
- Consumes: `PluginMetadata[]` from the main-process registry.

- [x] **Step 1: Write failing store and page tests**

Assert that a real installed plugin replaces the empty state, search filters by name/description, disabled and invalid states are distinguishable, and renderer input never contains filesystem paths or executable entry contents.

- [x] **Step 2: Run focused renderer tests and verify expected failures**

Run: `npm test -- --run src/renderer/src/stores/pluginStore.test.ts src/renderer/src/components/layout/SettingsPage.test.tsx`

- [x] **Step 3: Add the minimal typed IPC surface**

Validate the sender and every input in the main process. Return only normalized metadata through `IpcResult`; never return installation roots, real paths or manifest source text.

- [x] **Step 4: Connect the plugin tab to real state**

Load installed plugins on mount, filter locally, show count/status/source/version, and keep the Add button disabled until the importer task is complete.

- [x] **Step 5: Run focused tests and type checking**

Run: `npm test -- --run src/main/services/agent/pluginRegistry.test.ts src/renderer/src/stores/pluginStore.test.ts src/renderer/src/components/layout/SettingsPage.test.tsx`

Run: `npm run typecheck`

### Task 4: Safe local folder and ZIP import

**Files:**
- Create: `src/main/services/agent/pluginInstaller.ts`
- Test: `src/main/services/agent/pluginInstaller.test.ts`
- Modify: `src/main/ipc/plugins.ts`
- Modify: `src/preload/index.ts`
- Modify: `src/renderer/src/stores/pluginStore.ts`
- Modify: `src/renderer/src/components/layout/SettingsPage.tsx`

**Interfaces:**
- Produces: `importPluginPackage(installedRoot: string, source: string): Promise<PluginMetadata>` and `window.agent.plugins.importLocal()`.
- Consumes: selected directory or ZIP supplied by Electron's trusted file picker.

- [x] **Step 1: Write failing import boundary tests**

Cover directory and ZIP import, traversal, symlink/junction, duplicate ID, file count, individual size, total size, compression ratio, forbidden executable locations and atomic rollback.

- [x] **Step 2: Verify the tests fail before implementation**

Run: `npm test -- --run src/main/services/agent/pluginInstaller.test.ts`

- [x] **Step 3: Implement staged validation and atomic installation**

Copy/extract into `<plugins>/.staging-<uuid>`, parse there, verify every entry, atomically replace the destination, and move an older version to a recoverable backup until the new package is committed.

- [x] **Step 4: Expose the picker and enable the Add action**

Accept no renderer-supplied source path. The main process opens the picker and returns refreshed metadata.

- [x] **Step 5: Run focused tests and type checking**

Run: `npm test -- --run src/main/services/agent/pluginInstaller.test.ts src/renderer/src/components/layout/SettingsPage.test.tsx`

Run: `npm run typecheck`

### Task 5: Isolated plugin worker protocol

**Files:**
- Create: `src/shared/pluginProtocol.ts`
- Create: `src/main/services/agent/pluginWorker.ts`
- Create: `src/main/services/agent/pluginWorkerProcess.ts`
- Test: `src/main/services/agent/pluginWorker.test.ts`
- Modify: `electron.vite.config.ts`

**Interfaces:**
- Produces: `PluginWorkerHost.start(manifest)`, `invoke(toolName, args, context, signal)`, `stop(reason)`.
- Consumes: a validated Worker component from an installed package.

- [x] **Step 1: Write failing protocol and lifecycle tests**

Assert startup handshake, heartbeat, one in-flight call per ID, timeout, cancellation, malformed message rejection, 200KB result limit, crash isolation and forced termination.

- [x] **Step 2: Verify lifecycle tests fail**

Run: `npm test -- --run src/main/services/agent/pluginWorker.test.ts`

- [x] **Step 3: Implement the host and worker entry**

Fork one Utility Process per enabled executable plugin. Pass only an allowlisted environment, validated manifest snapshot and bounded messages. Never pass Electron main-process handles, credentials, raw workspace paths or a generic IPC bridge.

- [x] **Step 4: Run focused tests until green**

Run: `npm test -- --run src/main/services/agent/pluginWorker.test.ts`

### Task 6: Tool Registry integration and provider-neutral execution

**Files:**
- Create: `src/main/services/agent/pluginTools.ts`
- Test: `src/main/services/agent/pluginTools.test.ts`
- Modify: `src/main/services/agent/taskRuntimeManager.ts`
- Modify: `src/main/services/agent/taskRuntimeManager.test.ts`
- Modify: `src/main/services/providerAdapters.test.ts`

**Interfaces:**
- Produces: `createPluginTools(plugin, worker): ToolDefinition[]`, canonical names `plugin.<pluginId>.<toolName>`.
- Consumes: normalized closed schemas, Plugin Worker host and existing Tool Registry authorization.

- [x] **Step 1: Write failing registration and provider bridge tests**

Assert unique canonical names, schema cloning, provider-safe wire names, DeepSeek/Kimi tool-call ID round trips, collision rejection, disabled plugin exclusion and ordinary policy authorization.

- [x] **Step 2: Verify focused tests fail**

Run: `npm test -- --run src/main/services/agent/pluginTools.test.ts src/main/services/providerAdapters.test.ts`

- [x] **Step 3: Register enabled plugin tools through the existing registry**

Map manifest operations to the narrowest existing `OperationKind`; reject undeclared or unsupported operations. Execute only through the worker host after normal authorization.

- [x] **Step 4: Run focused and runtime tests**

Run: `npm test -- --run src/main/services/agent/pluginTools.test.ts src/main/services/agent/taskRuntimeManager.test.ts src/main/services/providerAdapters.test.ts`

### Task 7: Explicit `@plugin` selection and audit evidence

**Files:**
- Modify: `src/shared/types.ts`
- Modify: `src/renderer/src/components/chat/ChatInput.tsx`
- Modify: `src/renderer/src/components/chat/ChatInput.test.tsx`
- Modify: `src/main/ipc/message.ts`
- Create: `src/main/services/agent/pluginConversation.ts`
- Test: `src/main/services/agent/pluginConversation.test.ts`

**Interfaces:**
- Produces: `pluginIds?: string[]` in `SendMessageInput`, deterministic `@name` resolution, plugin audit blocks.
- Consumes: current task plugin snapshot and enabled Plugin Registry entries.

- [x] **Step 1: Write failing input and resolution tests**

Assert ArrowUp/ArrowDown, Enter, Escape, outside click, explicit selection precedence, missing/disabled/ambiguous errors and removal of only the mention token from user text.

- [x] **Step 2: Verify the tests fail**

Run: `npm test -- --run src/renderer/src/components/chat/ChatInput.test.tsx src/main/services/agent/pluginConversation.test.ts`

- [x] **Step 3: Implement selection and task snapshot binding**

Only expose explicitly selected or model-relevant enabled plugin tools. Existing tasks keep their captured set until the user reloads tools.

- [x] **Step 4: Add concise timeline and audit evidence**

Persist plugin ID, version, source and called tool name, but never raw credentials, manifest bodies or full sensitive results.

- [x] **Step 5: Run focused tests**

Run: `npm test -- --run src/renderer/src/components/chat/ChatInput.test.tsx src/main/services/agent/pluginConversation.test.ts`

### Task 8: M13 verification and documentation

**Files:**
- Modify: `docs/08-第四阶段计划.md`
- Modify: `README.md`
- Create: `docs/verification/M13-插件运行时页面验证测试单.md`

**Interfaces:**
- Produces: repeatable automated and manual evidence for M13.
- Consumes: all previous tasks.

- [x] **Step 1: Run the complete verification baseline**

Run: `npm test`

Run: `npm run typecheck`

Run: `npm run build`

Run: `npm audit --audit-level=high`

- [x] **Step 2: Write the M13 page verification sheet**

Cover installed plugin discovery, local import, status transitions, invalid manifest diagnostics, worker crash/timeout recovery, `@plugin`, actual model name, DeepSeek/Kimi tool loops, narrow-window layout, approval, cancellation and audit evidence.

- [x] **Step 3: Record results without committing**

Update the phase plan with exact test counts, build result, known limitations and the user-owned manual verification checklist.
