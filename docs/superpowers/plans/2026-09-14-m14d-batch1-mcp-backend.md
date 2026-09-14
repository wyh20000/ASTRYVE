# M14-D Batch 1 MCP Backend Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a tested host-owned MCP connection backend that safely parses HTTPS Streamable HTTP declarations, encrypts credentials, completes OAuth PKCE, and performs real tool discovery/invocation without exposing tools to the Agent yet.

**Architecture:** Plugin packages contribute only validated connection declarations. A host-owned store persists non-secret connection metadata and explicit plugin bindings, while a separate `safeStorage` vault persists ciphertext. An isolated connection manager owns one official MCP client per connection and issues task/plugin-bound leases for discovery and invocation.

**Tech Stack:** Electron 44 `safeStorage`, Node.js `http`/`dns`/`crypto`, TypeScript 5.5, Vitest 4, `@modelcontextprotocol/client@2.0.0`.

**Spec:** `docs/superpowers/specs/2026-09-14-m14d-mcp-connections-design.md`

## Global Constraints

- Support HTTPS Streamable HTTP only; reject stdio, commands, environment variables, literal headers, old SSE, HTTP, URL credentials and URL fragments.
- Bind OAuth callbacks only to `127.0.0.1` on an ephemeral port; require PKCE S256, one-time state, exact path and a five-minute deadline.
- Connections belong to the host. Plugins bind explicitly and never receive plaintext credentials or client objects.
- Reject persistence when Electron encryption is unavailable or Linux selected backend is `basic_text`.
- Treat MCP declarations, schemas, annotations, errors and results as untrusted input.
- Enforce 8 servers per plugin, a 128 KiB MCP declaration file, 64 discovered tools per server, and the existing 200 KiB plugin message limit.
- Batch 1 must not register MCP tools in the Agent Tool Registry and must not add renderer IPC or UI.

---

### Task 1: Parse and normalize plugin MCP declarations

**Files:**
- Modify: `src/shared/types.ts`
- Modify: `src/main/services/agent/pluginManifest.ts`
- Modify: `src/main/services/agent/pluginManifest.test.ts`
- Create: `src/main/services/agent/pluginMcpManifest.ts`
- Create: `src/main/services/agent/pluginMcpManifest.test.ts`

**Interfaces:**
- Produces: `PluginMcpServerDeclaration`, `PluginMcpAuthKind`, `ParsedPluginManifest.mcpPath`, and `readPluginMcpDeclarations(pluginRoot, mcpPath)`.
- Consumers: Tasks 2 and 4 use normalized `id`, `url`, `transport`, `auth`, and optional `apiKeyHeader`.

- [ ] **Step 1: Write failing manifest-path tests**

```ts
it('retains a validated MCP file path without loading it during discovery', async () => {
  const root = await fixture({ schemaVersion: 1, id: 'remote.tools', name: 'Remote', mcp: './mcp.json' })
  await expect(readPluginManifest(root)).resolves.toMatchObject({ components: ['mcp'], mcpPath: './mcp.json' })
})
```

- [ ] **Step 2: Run the manifest test and confirm it fails because `mcpPath` is absent**

Run: `npm test -- src/main/services/agent/pluginManifest.test.ts`

- [ ] **Step 3: Add the normalized declaration types and retain only relative MCP paths**

```ts
export type PluginMcpAuthKind = 'none' | 'api-key' | 'oauth2'
export interface PluginMcpServerDeclaration {
  id: string
  url: string
  transport: 'streamable-http'
  auth: PluginMcpAuthKind
  apiKeyHeader?: 'Authorization' | 'X-API-Key'
  oauthClientId?: string
  oauthScopes?: string[]
}
```

- [ ] **Step 4: Write failing parser tests for accepted wrapper/direct maps and every rejection boundary**

```ts
async function mcpFixture(document: unknown): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'plugin-mcp-'))
  await writeFile(join(root, 'mcp.json'), JSON.stringify(document))
  return root
}

it.each([
  [{ command: 'node', args: ['server.js'] }, 'stdio'],
  [{ url: 'http://api.example.com/mcp' }, 'HTTPS'],
  [{ url: 'https://user:secret@api.example.com/mcp' }, '凭据'],
  [{ url: 'https://api.example.com/mcp#fragment' }, '片段'],
  [{ url: 'https://127.0.0.1/mcp' }, '本地'],
  [{ url: 'https://api.example.com/mcp', headers: { Authorization: 'secret' } }, '凭据']
])('rejects unsafe MCP declarations', async (server, message) => {
  const root = await mcpFixture({ mcpServers: { unsafe: server } })
  await expect(readPluginMcpDeclarations(root, './mcp.json')).rejects.toThrow(message)
})
```

- [ ] **Step 5: Run parser tests and confirm failures are caused by the missing parser**

Run: `npm test -- src/main/services/agent/pluginMcpManifest.test.ts`

- [ ] **Step 6: Implement bounded regular-file reading and normalization**

Implement `readPluginMcpDeclarations` with `lstat`, exact root containment, non-symlink regular-file checks, byte/depth/node/string/server limits, ASCII server IDs, exact auth/header enums, URL canonicalization and deterministic ID ordering. Accept direct server maps and the `mcpServers` wrapper; reject unknown fields that could carry execution or credential material.

- [ ] **Step 7: Run Task 1 tests**

Run: `npm test -- src/main/services/agent/pluginManifest.test.ts src/main/services/agent/pluginMcpManifest.test.ts`

---

### Task 2: Persist host connections, bindings and encrypted credentials

**Files:**
- Create: `src/main/services/agent/pluginConnectionStore.ts`
- Create: `src/main/services/agent/pluginConnectionStore.test.ts`
- Replace: `src/main/services/agent/pluginCredentials.ts`
- Create: `src/main/services/agent/pluginCredentials.test.ts`
- Modify: `src/main/ipc/plugins.ts`

**Interfaces:**
- Produces: `PluginMcpConnection`, `PluginMcpBinding`, `PluginConnectionStore` methods `listConnections`, `saveConnection`, `bindPlugin`, `unbindPlugin`, `removeConnection`.
- Produces: `PluginCredentialVault` methods `set`, `get`, `delete`, `deleteConnection`, with injected async encryption adapter; `clearPluginCredentials(pluginId, dataRoot)` integrates the existing uninstall boundary.
- Consumers: Tasks 3 and 4 use the vault and connection records; existing uninstall cleanup calls the real plugin credential cleanup boundary.

- [ ] **Step 1: Write failing store tests for explicit binding and shared-uninstall semantics**

```ts
it('does not infer a binding from a matching endpoint and preserves shared connections on plugin removal', async () => {
  const store = new PluginConnectionStore(root)
  const connection = await store.saveConnection({
    serverOrigin: 'https://api.example.com', serverUrl: 'https://api.example.com/mcp',
    auth: 'oauth2', state: 'pending'
  })
  await store.bindPlugin({ pluginId: 'one.plugin', serverId: 'api', connectionId: connection.id })
  await store.bindPlugin({ pluginId: 'two.plugin', serverId: 'api', connectionId: connection.id })
  await store.unbindPlugin('one.plugin')
  expect(await store.listConnections()).toHaveLength(1)
  expect(await store.listBindings()).toEqual([{ pluginId: 'two.plugin', serverId: 'api', connectionId: connection.id }])
})
```

- [ ] **Step 2: Run store tests and confirm the store is missing**

Run: `npm test -- src/main/services/agent/pluginConnectionStore.test.ts`

- [ ] **Step 3: Implement schema-validated atomic metadata persistence**

Use a versioned `plugin-connections.json`, a per-root mutation queue, `mode: 0o600`, random temporary files and atomic rename. Persist only IDs, normalized endpoint/auth, state, timestamps, stable error codes, sanitized account labels and bindings. Reject malformed IDs, duplicate plugin/server bindings, dangling connection IDs, symlinks and oversized input.

- [ ] **Step 4: Write failing vault tests with a real in-memory encryption adapter**

```ts
const reversibleTestAdapter = () => ({
  available: async () => true,
  encrypt: async (value: string) => Buffer.from(`cipher:${value}`),
  decrypt: async (value: Buffer) => value.toString().slice('cipher:'.length)
})
const unavailableAdapter = () => ({
  available: async () => false,
  encrypt: async () => Buffer.alloc(0),
  decrypt: async () => ''
})

it('persists only ciphertext and refuses an unavailable or basic_text backend', async () => {
  const vault = new PluginCredentialVault(root, reversibleTestAdapter())
  await vault.set('connection-1', 'access-token', 'plain-secret')
  expect(await vault.get('connection-1', 'access-token')).toBe('plain-secret')
  expect(await readFile(vaultPath(root), 'utf8')).not.toContain('plain-secret')
  await expect(new PluginCredentialVault(root, unavailableAdapter()).set('c', 'api-key', 'x')).rejects.toThrow('系统加密')
})
```

- [ ] **Step 5: Run vault tests and confirm the vault is missing**

Run: `npm test -- src/main/services/agent/pluginCredentials.test.ts`

- [ ] **Step 6: Implement the safeStorage-backed vault and plugin cleanup**

The production adapter uses `isAsyncEncryptionAvailable`, `encryptStringAsync`, and `decryptStringAsync`; on Linux it rejects `basic_text`. Validate connection/secret kind identifiers, cap plaintext and ciphertext sizes, never expose list values, and atomically persist `{ schemaVersion: 1, secrets: { connectionId: { kind: base64Ciphertext } } }`. Implement `clearPluginCredentials(pluginId, dataRoot)` by removing only credentials for connections exclusively bound to that plugin; shared or unbound host connections remain until explicit disconnect. Pass `dataRoot` from the existing uninstall IPC dependency wrapper.

- [ ] **Step 7: Run Task 2 tests**

Run: `npm test -- src/main/services/agent/pluginConnectionStore.test.ts src/main/services/agent/pluginCredentials.test.ts src/main/services/agent/pluginUninstall.test.ts`

---

### Task 3: Complete OAuth metadata discovery and loopback PKCE

**Files:**
- Create: `src/main/services/agent/pluginOAuth.ts`
- Create: `src/main/services/agent/pluginOAuth.test.ts`

**Interfaces:**
- Produces: `createPkceRequest()`, `LoopbackOAuthReceiver`, and `authorizeMcpConnection(options)`.
- Consumes: Task 2 `PluginCredentialVault`; injected `fetch`, `openExternal`, clock and random functions keep tests local and deterministic.
- Produces encrypted `access-token` and optional `refresh-token` entries, never token strings in its public result.

- [ ] **Step 1: Write failing pure PKCE and metadata validation tests**

```ts
it('creates an S256 challenge and rejects authorization metadata without S256', async () => {
  const request = createPkceRequest(Buffer.alloc(32, 7))
  expect(request.challengeMethod).toBe('S256')
  expect(request.challenge).toMatch(/^[A-Za-z0-9_-]{43}$/)
  await expect(discoverOAuth(insecureMetadataFetcher, new URL('https://mcp.example.com/mcp')))
    .rejects.toThrow('PKCE S256')
})
```

- [ ] **Step 2: Run OAuth tests and confirm the implementation is missing**

Run: `npm test -- src/main/services/agent/pluginOAuth.test.ts`

- [ ] **Step 3: Implement PKCE and strict OAuth discovery**

Discover protected-resource and authorization-server metadata with HTTPS-only fetches, redirect rejection, response size/time limits, exact issuer/resource validation and required `code_challenge_methods_supported: ['S256']`. Support a declared public `clientId` or standards-compliant dynamic client registration; never accept a plugin-supplied client secret.

- [ ] **Step 4: Write failing loopback receiver tests**

```ts
it('accepts one exact state/path callback and then closes', async () => {
  const receiver = await LoopbackOAuthReceiver.open({ state: 'state-1', timeoutMs: 5_000 })
  await expect(fetch(`${receiver.redirectUri}?code=code-1&state=wrong`)).resolves.toMatchObject({ status: 400 })
  await expect(fetch(`${receiver.redirectUri}?code=code-1&state=state-1`)).resolves.toMatchObject({ status: 200 })
  await expect(receiver.result).resolves.toEqual({ code: 'code-1' })
  await expect(fetch(receiver.redirectUri)).rejects.toThrow()
})
```

- [ ] **Step 5: Implement the one-shot `127.0.0.1` receiver and authorization coordinator**

Bind before opening the browser, use an unpredictable callback path, accept GET only, cap the request URL, require exact state/path and one code, return a constant HTML response, close after success/cancel/timeout, exchange the code with the verifier, validate token response bounds, save tokens through the vault, and return only `{ connected: true, expiresAt?, accountLabel? }`.

- [ ] **Step 6: Run Task 3 tests**

Run: `npm test -- src/main/services/agent/pluginOAuth.test.ts src/main/services/agent/pluginCredentials.test.ts`

---

### Task 4: Add the official MCP client adapter and isolated connection manager

**Files:**
- Modify: `package.json`
- Modify: `package-lock.json`
- Create: `src/main/services/agent/pluginMcpClient.ts`
- Create: `src/main/services/agent/pluginMcpClient.test.ts`
- Create: `src/main/services/agent/pluginConnectionManager.ts`
- Create: `src/main/services/agent/pluginConnectionManager.test.ts`

**Interfaces:**
- Consumes: `@modelcontextprotocol/client@2.0.0`, Task 1 declarations, Task 2 vault/store.
- Produces: `PluginMcpClient` methods `connect`, `listTools`, `callTool`, `close`.
- Produces: `PluginConnectionManager.acquireLease({ pluginId, serverId, connectionId, taskId })`; lease methods `listTools`, `callTool`, `release`.
- The manager does not expose SDK clients, transports or credential strings.

- [ ] **Step 1: Install the exact official client dependency**

Run: `npm install @modelcontextprotocol/client@2.0.0 --save-exact`

- [ ] **Step 2: Write failing client contract tests using a controlled fetch transport**

```ts
const closedSchema = {
  type: 'object', properties: { query: { type: 'string' } },
  required: ['query'], additionalProperties: false
}
const expectedResult = { content: [{ type: 'text', text: 'found' }], isError: false }
const controlledMcpFetch = (): typeof fetch => vi.fn(async (_input, init) => {
  const request = JSON.parse(String(init?.body)) as { id?: number; method: string; params?: { name?: string } }
  if (request.method === 'notifications/initialized') return new Response(null, { status: 202 })
  const result = request.method === 'initialize'
    ? { protocolVersion: '2025-06-18', capabilities: { tools: {} }, serverInfo: { name: 'fixture', version: '1.0.0' } }
    : request.method === 'tools/list'
      ? { tools: [{ name: 'search', description: 'Search', inputSchema: closedSchema }] }
      : request.method === 'tools/call' && request.params?.name === 'search'
        ? expectedResult
        : undefined
  return new Response(JSON.stringify({ jsonrpc: '2.0', id: request.id, result }), {
    status: 200, headers: { 'content-type': 'application/json' }
  })
}) as typeof fetch

it('initializes, lists bounded tools, invokes a tool and closes through Streamable HTTP', async () => {
  const declaration = {
    id: 'api', url: 'https://mcp.example.com/mcp',
    transport: 'streamable-http' as const, auth: 'none' as const
  }
  const client = createPluginMcpClient(declaration, { fetch: controlledMcpFetch() })
  await client.connect(signal)
  expect(await client.listTools(signal)).toEqual([{ name: 'search', description: 'Search', inputSchema: closedSchema }])
  expect(await client.callTool('search', { query: 'x' }, signal)).toEqual(expectedResult)
  await client.close()
})
```

Also test 64-tool limit, invalid/open schemas, duplicate names, 200 KiB results, 401/403, redirect attempts, timeout and abort.

- [ ] **Step 3: Run client tests and confirm the adapter is missing**

Run: `npm test -- src/main/services/agent/pluginMcpClient.test.ts`

- [ ] **Step 4: Implement the SDK adapter**

Use `Client` and `StreamableHTTPClientTransport`; inject auth so the transport requests a token for each request without retaining it in declarations. Validate DNS immediately before each connection/request, pin the accepted origin across redirects, normalize tool schemas into closed object schemas, discard untrusted annotations, bound every serialized result, and convert failures to stable host error codes.

- [ ] **Step 5: Write failing manager tests for explicit binding, leases and failure isolation**

```ts
it('invalidates only the failed connection and keeps another lease usable', async () => {
  const bindingOne = { pluginId: 'one.plugin', serverId: 'api', connectionId: 'connection-1', taskId: 'task-1' }
  const bindingTwo = { pluginId: 'two.plugin', serverId: 'api', connectionId: 'connection-2', taskId: 'task-1' }
  const failed = await manager.acquireLease(bindingOne)
  const healthy = await manager.acquireLease(bindingTwo)
  await expect(failed.callTool('broken', {}, signal)).rejects.toMatchObject({ code: 'MCP_CALL_FAILED' })
  await expect(healthy.callTool('ping', {}, signal)).resolves.toBeDefined()
})
```

Test unbound access, plugin/task mismatch, lease expiry, cancellation, disconnect and task release.

- [ ] **Step 6: Implement the manager and connection state transitions**

Require an exact persisted binding before lease creation; transition `pending -> connected`, `401 -> pending`, `403 -> restricted`, other stable failures to `failed`; keep clients isolated by connection ID. Revoke leases on release/disconnect and never return client or credential references.

- [ ] **Step 7: Run Task 4 tests**

Run: `npm test -- src/main/services/agent/pluginMcpClient.test.ts src/main/services/agent/pluginConnectionManager.test.ts`

---

### Task 5: Validate installation-time MCP packages and finish Batch 1

**Files:**
- Modify: `src/main/services/agent/pluginInstaller.ts`
- Modify: `src/main/services/agent/pluginInstaller.test.ts`
- Modify: `src/main/services/agent/pluginLifecycle.ts`
- Modify: `src/main/services/agent/pluginLifecycle.test.ts`
- Create: `scripts/smoke-plugin-mcp.cjs`
- Modify: `package.json`
- Modify: `docs/08-第四阶段计划.md`

**Interfaces:**
- Installation consumes Task 1 parsing and rejects packages before atomic replacement if MCP declarations are unsafe.
- Smoke test consumes the built Task 4 adapter against a local controlled HTTPS fixture and leaves no credentials or listeners behind.

- [ ] **Step 1: Write failing installation tests**

```ts
async function pluginWithMcp(document: unknown): Promise<{ source: string; installed: string }> {
  const root = await mkdtemp(join(tmpdir(), 'plugin-mcp-install-'))
  const source = join(root, 'source')
  const installed = join(root, 'installed')
  await mkdir(source, { recursive: true })
  await mkdir(join(installed, 'existing', 'skills'), { recursive: true })
  await writeFile(join(source, 'plugin.json'), JSON.stringify({
    schemaVersion: 1, id: 'existing', name: 'Existing', version: '2.0.0', description: 'MCP', mcp: './mcp.json'
  }))
  await writeFile(join(source, 'mcp.json'), JSON.stringify({ mcpServers: document }))
  return { source, installed }
}

it('validates MCP declarations before replacing an installed plugin', async () => {
  const fixture = await pluginWithMcp({ unsafe: { command: 'node', args: ['server.js'] } })
  const originalManifest = JSON.stringify({
    schemaVersion: 1, id: 'existing', name: 'Existing', version: '1.0.0', description: 'Old', skills: './skills'
  })
  await writeFile(join(fixture.installed, 'existing', 'plugin.json'), originalManifest)
  await writeFile(join(fixture.installed, 'existing', 'skills', 'SKILL.md'), '# Old')
  await expect(importPluginPackage(fixture.installed, fixture.source)).rejects.toThrow('stdio')
  expect(await readFile(join(fixture.installed, 'existing', 'plugin.json'), 'utf8')).toBe(originalManifest)
})
```

- [ ] **Step 2: Run installer/lifecycle tests and confirm unsafe MCP currently passes discovery or fails too late**

Run: `npm test -- src/main/services/agent/pluginInstaller.test.ts src/main/services/agent/pluginLifecycle.test.ts`

- [ ] **Step 3: Validate MCP files before `beforeReplace` and atomic directory replacement**

Call `readPluginMcpDeclarations(packageRoot, parsed.mcpPath)` after the main manifest is parsed and before provenance, activation, backup or destination mutation. Return normalized declarations only to trusted main-process callers; do not persist declaration bodies outside the installed plugin.

- [ ] **Step 4: Add and run a Batch 1 MCP smoke test**

Add `smoke:plugin-mcp` that builds the app, starts a loopback-only controlled HTTPS MCP fixture with a test certificate trusted only by the injected smoke fetch, performs initialize/list/call/close through the production adapter, verifies listener cleanup, and never opens a browser or writes a real secret.

Run: `npm run build && npm run smoke:plugin-mcp`

- [ ] **Step 5: Update the phase record without marking M14-D complete**

Record Batch 1 completion under M14-D. Leave all seven M14-D checklist boxes unchecked because Tool Registry and UI integration belong to Batch 2.

- [ ] **Step 6: Run complete verification**

Run: `npm test`

Expected: all test files and tests pass with zero failures.

Run: `npm run typecheck`

Expected: Node and Web TypeScript checks exit 0.

Run: `npm run build`

Expected: Electron main, preload and renderer builds exit 0.

Run: `npm run smoke:plugin`

Expected: existing plugin market/runtime smoke prints `PASS`.

Run: `npm run smoke:plugin-mcp`

Expected: MCP initialize/list/call/close smoke prints `PASS`.

Run: `git diff --check`

Expected: no whitespace errors.

- [ ] **Step 7: Review and commit the complete Batch 1**

```bash
git add package.json package-lock.json src/shared/types.ts src/main/services/agent scripts/smoke-plugin-mcp.cjs docs/08-第四阶段计划.md
git commit -m "feat(plugins): add secure MCP connection backend"
```
