# M14-D MCP 与外部账号连接设计

## 目标

让已安装并启用的插件通过宿主管理的 HTTPS MCP 连接向 Agent 提供真实工具，同时保证插件拿不到明文凭据、远端元数据不能绕过审批、单个连接故障不会影响其他插件或主对话。

本设计分成两个可独立验证和提交的批次：

1. MCP 后端与安全连接层。
2. Agent、审批、审计与连接界面闭环。

## 已确认的产品决策

- 首版只支持 HTTPS Streamable HTTP。
- 显式拒绝 stdio、本地命令、旧 HTTP+SSE 和非 HTTPS 地址。
- OAuth 使用系统默认浏览器、PKCE S256 和 `127.0.0.1` 随机端口的一次性回调。
- 连接归宿主所有；插件必须经用户确认后显式绑定连接。
- 多个插件可以绑定同一连接，但不会因为端点相同而自动共享账号权限。
- 卸载插件只移除绑定；共享连接和凭据默认保留，用户主动断开时才删除。
- 所有 MCP 工具调用进入现有 Tool Registry，并在首版逐次审批。
- 远端工具名、说明、schema、annotations 和结果全部视为不可信数据。

## 范围

### 包含

- 解析本地插件包中的 `mcp` 或 `mcpServers` 文件引用。
- 将支持的声明规范化为宿主内部 MCP server 模型。
- 连接状态、凭据状态、插件绑定和非敏感错误摘要的持久化。
- 无认证、API Key 和 OAuth 2.1 Authorization Code + PKCE。
- HTTPS Streamable HTTP 初始化、工具发现、调用、取消、超时和关闭。
- MCP 工具进入任务级 Tool Registry 快照。
- 连接、重新授权、断开和插件绑定界面。
- 权限、逐次审批、审计、错误隔离和卸载语义。

### 不包含

- stdio MCP、本地命令或环境变量注入。
- 旧 HTTP+SSE 回退。
- MCP Resources、Prompts、Sampling、Elicitation 和 MCP Apps UI。
- 永久允许、按账号永久允许或依据远端 annotations 自动放行。
- 插件可选 UI；它属于 M14-E。

不包含的 MCP 能力必须明确显示为不支持，不得静默忽略或降级。

## 清单与规范化模型

插件主清单中的 `mcp` 或 `mcpServers` 只能是插件目录内的相对 JSON 文件路径。MCP 文件允许直接 server map 或 `{ "mcpServers": { ... } }` 包装形式，并规范化为：

```ts
interface PluginMcpServerDeclaration {
  id: string
  url: string
  transport: 'streamable-http'
  auth: 'none' | 'api-key' | 'oauth2'
  apiKeyHeader?: 'Authorization' | 'X-API-Key'
  oauthClientId?: string
  oauthScopes?: string[]
}
```

约束：

- server ID 使用受限 ASCII 标识，插件内唯一。
- URL 必须是无用户名、无密码、无片段的公网或组织 HTTPS URL。
- 拒绝 loopback、私网、链路本地、保留地址和运行时 DNS 重绑定目标；OAuth 回调自身的 `127.0.0.1` 是唯一例外。
- 声明中禁止出现 Token、API Key、Cookie、任意 headers、环境变量、命令或参数。
- API Key header 只允许 `Authorization` 和 `X-API-Key`；值由宿主连接提供。
- OAuth 可声明非秘密 public client ID 和最多 20 个 scope；未声明 client ID 时要求授权服务器支持动态客户端注册。
- 限制 MCP 文件大小、server 数量、字符串长度、结构深度和节点数；拒绝符号链接。

市场条目只有在下载包内 MCP 声明通过上述校验后才能安装。仅含受支持 MCP 的插件不再标记“待支持”；声明包含未支持传输或能力时仍不可安装。

## 宿主连接与凭据

连接和插件绑定分离：

```ts
type McpConnectionState = 'pending' | 'connected' | 'failed' | 'restricted'

interface McpConnectionMetadata {
  id: string
  serverOrigin: string
  serverUrl: string
  auth: 'none' | 'api-key' | 'oauth2'
  state: McpConnectionState
  accountLabel?: string
  lastConnectedAt?: number
  errorCode?: string
}

interface PluginMcpBinding {
  pluginId: string
  serverId: string
  connectionId: string
}
```

- 元数据文件不含明文凭据、完整错误响应或 OAuth 授权参数。
- API Key、access token 和 refresh token 使用 Electron `safeStorage` 异步加密后写入独立原子文件。
- 系统加密不可用时拒绝保存连接；Linux `basic_text` 后端视为不可用。
- Renderer 只能得到 `hasCredential`、过期状态和脱敏账号标签，永远拿不到解密值。
- 解密只发生在主进程发起授权请求前，明文不进入插件 Worker、日志、审计或 IPC 返回值。
- 连接管理器向调用方返回不可猜测、短期、绑定插件与任务的内部租约；任务结束、取消、插件禁用或连接断开时租约失效。

## OAuth 流程

1. 主进程生成 PKCE verifier/challenge、随机 state 和随机回调路径。
2. 仅在 `127.0.0.1` 绑定系统分配端口，成功监听后才打开系统浏览器。
3. 通过 MCP/OAuth 元数据发现授权服务器，并要求 HTTPS、PKCE S256 与精确资源标识。
4. 回调只接受正确路径、state 和单次授权码；拒绝重复、超时和来源不符请求。
5. 主进程交换 Token，验证响应结构，使用系统加密保存，再关闭监听器。
6. 用户取消、窗口关闭、应用退出或五分钟超时都会关闭监听器并清理 verifier/state。
7. 刷新 Token 失败时连接进入 `pending` 或 `failed`，不得把失败响应原文送给模型。

不使用内嵌 WebView，不读取浏览器 Cookie，也不把 OAuth 页面内容加入对话。

## MCP 客户端与故障隔离

- 每个宿主连接由独立客户端对象管理；连接失败只改变该连接状态。
- 初始化、工具列表、工具调用分别设置截止时间，并接受任务 AbortSignal。
- 工具列表设置数量、名称、说明、schema 深度、节点和序列化大小上限。
- 工具结果遵守现有 200KB 插件消息上限；超限时返回受控错误，不截取敏感原文写日志。
- 断开时取消在途请求并关闭客户端；失败不传播到其他连接。
- 工具目录以任务开始时的已连接插件快照为准；远端列表变化只提示下一任务刷新，不在当前任务中静默改变 schema。

## Tool Registry、权限与审批

- 新增 `external.call` 操作类型和规范化 external target。
- MCP 工具在宿主侧使用确定性命名空间，例如 `mcp__<plugin-id>__<server-id>__<tool-name>`，避免跨服务重名。
- 注册前把远端 input schema 收紧为项目 Tool Registry 能接受的封闭对象 schema；无法安全规范化的工具不注册。
- 插件必须声明 `network` 权限，且连接必须显式绑定、状态为 connected，工具才进入任务快照。
- `read-only` 权限模式拒绝 `external.call`。
- `ask-every-time` 和 `smart-approval` 均逐次弹出审批，不提供任务级或永久复用。
- 审批主摘要由宿主生成，包含插件、服务域名、账号标签、工具和影响范围；远端说明及参数仅作为不可信详情展示并复用现有脱敏、截断和滚动。
- 审计只记录插件 ID/版本、connectionId 的不可逆摘要、服务 origin、工具名、结果分类和审批范围；不记录参数、Token、响应正文或账号标识明文。

## UI 与生命周期

已安装插件行和详情展示 `pending / connected / failed / restricted`：

- 待连接：显示“连接账号”。
- 已连接：显示脱敏账号标签、“重新授权”和“断开”。
- 连接失败：显示稳定错误摘要和“重试”。
- 权限受限：说明缺少插件权限、任务权限或账号授权范围。

连接弹窗支持创建新连接或显式绑定已有连接。API Key 输入框只保存在组件内存中，提交或取消后清空。OAuth 页面始终在系统浏览器打开。

插件禁用时不删除连接，只阻止新租约和新任务注册工具。卸载时删除插件绑定；若连接仍被其他插件使用则保留。即使没有其他绑定，也默认保留并在界面提示用户可单独断开。用户主动断开连接时，取消所有租约、关闭客户端、删除加密凭据并让全部相关插件进入待连接。

## 两个实施批次

### 批次一：MCP 后端与安全连接层

交付一个可单独验证的宿主连接内核：

- MCP 声明解析和安全校验。
- 连接/绑定持久化模型。
- `safeStorage` 异步凭据库和失败关闭策略。
- OAuth PKCE 回环回调组件。
- Streamable HTTP 客户端抽象、工具发现、调用、取消、超时和故障隔离。
- 使用内存传输或受控 fetch 的集成测试证明连接、认证、失败隔离和凭据不外泄。

批次一不向模型注册 MCP 工具，也不加入连接 UI；现有插件行为保持不变。它不是空接口：服务层测试必须完成真实初始化、列举工具和调用闭环。

### 批次二：Agent 与界面闭环

- 把已绑定连接的工具加入任务级 Tool Registry。
- 实现 `external.call` 分类、权限、逐次审批和审计。
- 加入连接、绑定、重授权、重试和断开 IPC/preload/store/UI。
- 更新市场可安装性和卸载共享连接说明。
- 完成外部服务失败不阻塞其他插件或主对话的集成测试。
- 更新 M14-D 计划状态和 M14 验收测试单。

## 验证标准

自动验证至少覆盖：

- 合法 HTTPS 声明和所有禁止传输、地址、凭据字段、符号链接及超限输入。
- schema 规范化、工具重名、动态列表冻结和 200KB 结果限制。
- API Key/OAuth Token 只以系统加密密文落盘，Renderer/插件/审计无明文。
- PKCE、state、一次性回调、超时、取消和监听器清理。
- 连接、刷新、断开、凭据删除、显式绑定和共享连接卸载。
- Tool Registry、read-only 拒绝、逐次审批、取消及审计脱敏。
- 一个 MCP 服务超时、401、403、无效 schema、超大响应或断开时，其他插件和主对话继续工作。
- 全量测试、Node/Web 类型检查、生产构建和 MCP 专项冒烟测试。

人工验收在批次二完成后进行，覆盖常规与窄窗口、API Key 连接、OAuth 系统浏览器回调、重新授权、共享连接和断开。

## 规范依据

- MCP Streamable HTTP 与客户端生命周期：https://github.com/modelcontextprotocol/typescript-sdk/blob/main/docs/client.md
- MCP HTTP Authorization：https://modelcontextprotocol.io/specification/2025-06-18/basic/authorization
- OAuth 原生应用最佳实践与 PKCE：https://www.rfc-editor.org/info/rfc8252/
- Electron `safeStorage`：https://www.electronjs.org/docs/latest/api/safe-storage
- MCP 工具与不可信 annotations：https://github.com/modelcontextprotocol/modelcontextprotocol/blob/main/docs/specification/2026-07-28/server/tools.mdx
