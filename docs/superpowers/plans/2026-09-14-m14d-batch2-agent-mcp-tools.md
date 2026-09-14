# M14-D Batch 2 Agent MCP Tools Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Expose explicitly bound, connected MCP tools to one immutable Agent task snapshot and execute every call through the existing `external.call` approval boundary and a task-bound connection lease.

**Architecture:** Extend the host connection manager with a read-only discovery snapshot that validates persisted bindings and connected state. A focused MCP tool factory converts that snapshot into trusted `ToolDefinition` objects whose schemas are frozen at task creation and whose execution lazily acquires task-bound leases. The existing plugin capture and task disposal paths own the definitions and release every lease when the task terminates.

**Tech Stack:** TypeScript 5.5, Vitest 4, existing `ToolRegistry`, `TaskRuntime`, `PluginConnectionManager`, official MCP client adapter.

**Spec:** `docs/superpowers/specs/2026-09-14-m14d-mcp-connections-design.md`

## Global Constraints

- Only enabled, valid, explicitly requested plugins with a persisted exact binding and `connected` connection may contribute MCP tools.
- Discovery freezes names, descriptions and closed input schemas before `TaskRuntime.createTask`; later remote changes affect only later tasks.
- Every definition uses `external.call`, trusted host metadata and one-shot approval; model arguments never supply connection identity.
- Execution acquires a lease bound to plugin, server, connection and task; task disposal releases all leases.
- One unavailable MCP connection is skipped without removing healthy plugin tools or blocking ordinary chat.
- No Renderer IPC or connection UI is added in this batch.

---

### Task 1: Add bounded bound-tool discovery to the connection manager

**Files:**
- Modify: `src/main/services/agent/pluginConnectionManager.ts`
- Modify: `src/main/services/agent/pluginConnectionManager.test.ts`

**Interfaces:**
- Produces: `snapshotPluginTools(pluginId)` returning sanitized `{ serverId, connectionId, serverOrigin, accountLabel?, tools }[]` for exact connected bindings.
- Consumes: the existing connection store, declaration resolver, client isolation and normalized MCP tool list.

- [ ] Write failing tests proving disconnected/unbound connections are excluded, healthy connected connections are discovered, and one failed connection does not suppress another.
- [ ] Run `npm test -- src/main/services/agent/pluginConnectionManager.test.ts` and confirm the method is missing.
- [ ] Implement deterministic binding iteration, declaration/connection identity checks, per-connection failure isolation and defensive snapshot copies.
- [ ] Re-run the manager tests and confirm they pass.

### Task 2: Convert discovery snapshots into task-scoped ToolDefinitions

**Files:**
- Create: `src/main/services/agent/pluginMcpTools.ts`
- Create: `src/main/services/agent/pluginMcpTools.test.ts`

**Interfaces:**
- Produces: `capturePluginMcpTaskTools(plugins, manager)` returning `{ tools, dispose }`.
- Each produced definition has deterministic name `mcp__<pluginId>__<serverId>__<toolName>`, `operation: 'external.call'`, a trusted `externalTarget`, defensive schema copies and schema-based argument validation.
- Execution consumes `manager.acquireLease(...)`; successful MCP results become `{ ok: true, value }`, stable MCP failures become bounded `{ ok: false, error }`.

- [ ] Write failing tests for deterministic names, frozen schemas, spoof-resistant identity, real lease invocation, cancellation, stable error mapping and disposal.
- [ ] Run `npm test -- src/main/services/agent/pluginMcpTools.test.ts` and confirm the module is missing.
- [ ] Implement the factory with one cached lease promise per task/connection and no credential/client exposure.
- [ ] Re-run the factory, registry and authorization tests.

### Task 3: Integrate MCP definitions into plugin and task snapshots

**Files:**
- Modify: `src/main/services/agent/pluginManager.ts`
- Modify: `src/main/services/agent/pluginManager.test.ts`
- Modify: `src/main/services/agent/taskRuntimeManager.ts`
- Modify: `src/main/services/agent/taskRuntimeManager.test.ts`

**Interfaces:**
- Plugin capture treats MCP-only packages as valid selected plugins without starting a Worker.
- Task runtime persistence initializes one host connection manager from `userDataPath` and installed plugin declarations.
- `createProjectTask` combines local plugin tools and MCP task tools, and composes both disposal functions.

- [ ] Write failing tests for MCP-only plugin selection and combined immutable task definitions/disposal.
- [ ] Run the two manager test files and verify failures are caused by missing integration.
- [ ] Implement declaration resolution from the installed package, host manager initialization, combined capture and terminal cleanup.
- [ ] Re-run integration tests plus existing tool-calling-loop tests.

### Task 4: Record progress, verify and commit

**Files:**
- Modify: `docs/08-第四阶段计划.md`

- [ ] Record that Agent registration and lease execution are complete while leaving UI-dependent M14-D checklist items unchecked.
- [ ] Run `npm test`, `npm run typecheck`, `npm run build`, `npm run smoke:plugin`, `npm run smoke:plugin-mcp`, and `git diff --check`.
- [ ] Review the complete diff for plaintext credentials, untrusted identity propagation, open schemas, leaked leases and unrelated changes.
- [ ] Commit as `feat(agent): connect MCP tools to task runtime`.
