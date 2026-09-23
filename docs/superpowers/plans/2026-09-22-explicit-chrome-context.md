# ASTRYVE 模型驱动 Chrome DevTools MCP 实施计划

> 对应设计：`docs/superpowers/specs/2026-09-22-explicit-chrome-context-design.md`
>
> 原则：模型选择能力，宿主执行策略，Google 官方 MCP 完成浏览器操作。
>
> 本计划替代原“发送前显式绑定 Chrome”和基于关键词自动路由的实施方案。

> 执行状态说明（2026-09-23）：总顺序以 `docs/08-第四阶段计划.md` 为准。Task 1 的固定版本契约和 Task 2 的历史修复已按代码与自动化复核；这不代表真实 Chrome 或真实模型验收通过。Task 3 的普通对话可选工具循环已部分落地；Task 5 的逐轮刷新底层已在 `d4b5edb` 提前实现，但未接入能力状态。新增「工作 / 对话」批次 3A 是 Task 3 剩余权限边界与 Task 4 激活前的前置项；其产品定义见 `docs/superpowers/specs/2026-09-23-work-chat-information-architecture.md`。后续顺序为批次 3A → Task 3 剩余项/Task 4 → Task 5 → Task 6～14。

## 1. 交付边界

本轮只交付：

- 修复现有消息历史、工具证据和发送终态缺陷；
- 让所有支持 function calling 的对话进入可选工具循环；
- 增加始终可发现、懒连接的 `browser.activate`；
- 支持工具循环逐轮动态刷新工具目录；
- 建立可信页面绑定、重连和页面消歧；
- 修复连续调用、截图时机、图片顺序、预览和持久化；
- 建立 Google MCP 1.7.0 的版本化工具映射和真实 Chrome 验收。

本轮不交付：

- Chrome 扩展或 Google 插件；
- 自研 CDP/窗口前台检测；
- 强制使用 Chrome 的 Composer 开关；
- 全量 `+` 菜单、Skill 语法、插件市场和 Hook UI 重构。

会话空间边界：`chat` 无项目、无 Coding，但保留经模型选择和宿主授权的 Chrome；`work` 绑定项目，Coding 仍受项目授权和 Policy Engine 限制。此边界须先由批次 3A 在主进程落实，Chrome 工具是否可用不能由顶部入口名称或正文关键词直接推断。

## 2. 实施顺序

### Task 1：冻结 Google 官方 1.7.0 契约

涉及：

- `package.json`
- `package-lock.json`
- `src/main/services/browser/chromeDevtoolsMcpClient.ts`
- `src/main/services/browser/chromeDevtoolsMcpAdapter.ts`
- 新增 `docs/verification/M16-Google-MCP-1.7.0工具映射.md`

任务：

- [x] 记录 npm 锁定版本、完整性哈希和官方 release commit。
- [x] 从实际 `chrome-devtools-mcp@1.7.0` 执行 `tools/list`，保存经审查的 schema fixture。
- [x] 为每个 ASTRYVE `browser.*` 标出官方工具、准确参数、返回转换和宿主附加策略。
- [x] 修正所有引用官方 `main` 分支却假定 1.7.0 行为的文档。
- [x] 对官方缺失、参数漂移、返回 content 类型变化写失败测试。
- [x] 确认 `pageId` 路由所需的 1.7.0 配置参数来自该版本官方 schema，不从最新版文档猜测。

完成条件：代码、fixture、文档和依赖使用同一版本事实源。

### Task 2：先修复消息历史 P1 缺陷

涉及：

- `src/main/ipc/message.ts`
- `src/main/services/history.ts`
- `src/main/services/agent/skillConversation.ts`
- 对应测试

任务：

- [x] 调整构建顺序，`activeRequest` 替换不得覆盖已注入文档。
- [x] 历史过滤改为“存在可回放内容”，包含 text、attachment、image 和 `toolContext`。
- [x] 失败/取消消息不得把未完成 thinking 当成可靠历史。
- [x] 历史图片保留来源说明；本轮仅对重新提供的图片像素启用视觉输入，文本模型明确收到缺少像素的边界。
- [x] 历史裁剪按完整问答和连续后缀进行，不能留下孤立回答或工具结果。
- [x] 覆盖纯文档、纯工具证据、纯截图、失败任务和长历史回归。

完成条件：新浏览器架构可以建立在正确的跨轮消息模型上。

### Task 3：统一非项目对话的可选工具循环

进展（2026-09-23）：普通对话的原生可选循环、无项目隔离任务、插件工具快照、无工具直接回答及模型工具能力声明已有代码与自动化；任务仍保留未勾选，直到图片/项目/Chrome 组合、模型自主搜索和旧关键词路由迁移后整体复核。不要将此记录误读为 `browser.activate` 已可用。

涉及：

- `src/main/ipc/message.ts`
- `src/main/services/agent/toolCallingLoop.ts`
- `src/main/services/agent/taskRuntimeManager.ts`
- `src/main/services/providerAdapters.ts`

任务：

- [ ] 把“普通流式聊天”和“有工具的 Agent”收敛为同一可选工具循环。
- [ ] 没有项目时也能创建轻量 capability task，不要求 workspace。
- [ ] 第一轮 `toolChoice` 使用 `auto`；不得因为暴露能力工具而强制至少调用一次。
- [ ] 模型没有调用工具时立即完成普通回答。
- [ ] 保留 coding task 必须先观察项目状态的独立规则，不误用于普通聊天。
- [ ] 初始化失败、模型不支持工具、任务创建失败时统一清理生成状态。
- [ ] 普通聊天不得默认无条件开启 web search；由能力策略和模型能力决定。
- [ ] 不支持原生 function calling 的模型不注册浏览器能力；明确请求实时 Chrome 时返回可恢复的模型能力提示，不退回关键词执行。

完成条件：任何支持原生工具调用的模型都可以自己选择是否调用能力，普通聊天没有额外交互。

### Task 4：实现 `browser.activate` 内置能力工具

代码进展（2026-09-23）：按锁定的官方 1.7.0 `list_pages` 契约接入；单页或唯一清洗 hint 可激活，2～7 个候选页可在当前对话选择并继续原调用；更多页面返回 `needs-selection` 并释放租约。已覆盖惰性连接、幂等、失败清理与审计的自动化；真实 Chrome 验收仍属 Task 14。

涉及：

- 新增 `src/main/services/browser/browserCapability.ts`
- `src/main/services/agent/taskRuntimeManager.ts`
- `src/shared/agent.ts`
- 对应测试

任务：

- [x] 定义最小 schema：`purpose` 和可选清洗后 `targetHint`。
- [x] 工具注册不启动 MCP、不读取页面。
- [x] 工具执行时获取回复级租约，懒启动官方 MCP 并调用官方 `list_pages`。
- [x] 同一回复重复 activate 返回同一能力状态，保持幂等。
- [x] 审计 `requested/activated/needs-selection/failed`，不记录完整敏感 URL。
- [x] 删除 `prefersBrowserTools()`、`prefersBrowserContinuation()` 对任务创建和工具可见性的决定权。
- [x] 只保留无原生工具模型的明确 Chrome 请求提示；它不连接 MCP，也不改变工具目录。

完成条件：是否进入浏览器流程完全由模型原生 tool call 决定。

### Task 5：支持逐轮动态工具目录

代码进展（2026-09-23）：已按可信宿主状态逐轮重算浏览器工具目录，校验当前页面 ID/URL，拒绝未暴露或不符的调用；Coding 首轮仍限定项目观察工具。正式 `bindingId + mcpGeneration` 与对话内多页面选择属于 Task 6/7，完成前不得把本任务整体勾为完成。

涉及：

- `src/main/services/agent/toolCallingLoop.ts`
- `src/main/services/agent/taskRuntime.ts`
- `src/main/services/agent/toolRegistry.ts`
- provider adapter 测试

任务：

- [ ] 将固定 `tools` 数组改成每轮从可信 `CapabilitySnapshot` 生成。
- [x] `browser.activate` 成功前只暴露激活工具；成功后按 purpose 暴露最小浏览器工具集（浏览器能力范围内）。
- [ ] 每轮保存工具目录哈希和激活来源，便于审计。
- [x] 工具结果、网页内容和模型正文不能扩大下一轮目录。
- [ ] 工具被撤销、绑定 stale 或租约释放后，从下一轮目录移除。
- [x] 模型调用未暴露工具时返回确定性 `TOOL_NOT_AVAILABLE`，不得执行注册表中的隐藏工具。
- [ ] 覆盖多轮激活、目录增加、目录收窄、取消和模型伪造工具名。

完成条件：同一个模型回复中可以先 activate，再在下一轮使用正式浏览器工具。

### Task 6：实现主进程可信页面绑定

涉及：

- 新增 `src/main/services/browser/browserBindingService.ts`
- `src/main/services/browser/browserGateway.ts`
- `src/main/services/browser/chromeDevtoolsMcpAdapter.ts`
- `src/shared/types.ts`

任务：

- [ ] 主进程生成不可猜测 `bindingId` 和单调递增 `mcpGeneration`。
- [ ] Renderer 只获取显示 DTO，不提交可信 pageId/URL/权限。
- [ ] 实现绑定复用、唯一 URL/title hint 匹配、单页选择和多页消歧。
- [ ] URL 清洗移除凭据、fragment 和敏感 query；origin 单独保存。
- [ ] 每次执行验证 binding、generation、pageId 和 origin。
- [ ] MCP 重启使旧绑定和 UID 立即 stale。
- [ ] 删除“`selected` 等于用户前台标签页”的实现和测试假设。
- [ ] 将 `browser.screenshotCurrent` 改为对“已绑定页面”截图，或使用准确名称替代。

完成条件：页面目标来自宿主可信绑定，不来自模型参数或不可靠的 selected 标记。

### Task 7：实现对话内页面消歧

代码进展（2026-09-23）：2～7 个候选页复用现有对话输入卡；显示限长标题与去凭据、查询、片段的地址，选择后恢复原 `browser.activate` 调用。仅激活工具使用最长 5 分钟的受控等待，取消仍随任务信号传播。超过 7 页、真实窗口关闭/任务替换和真实 Chrome 的端到端验收仍待完成，因此本任务不勾选完成。

涉及：

- 主进程 browser IPC
- `src/preload`
- Composer/任务时间线中的小型页面选择面板
- `requestUserInput` 或专用结构化恢复通道

任务：

- [ ] 多页面时显示限长标题、清洗 URL 和来源，不读取正文。
- [ ] 页面选择发生在当前对话，不跳转设置页，不要求重发消息。
- [ ] 选择结果回到原工具调用并继续同一个 task/call。
- [ ] 关闭、取消、窗口销毁和任务替换均解除等待并释放租约。
- [ ] 页面列表刷新不改变输入框尺寸，不循环启动 MCP。
- [ ] 可选 `+` 菜单只用于预选/更换页面，不作为自动调用前置条件。

完成条件：模型可自动发起浏览器调用，宿主只在官方 MCP 无法唯一确定目标时请用户消歧。

### Task 8：按目的生成最小浏览器工具集

涉及：

- `src/main/services/browser/browserTools.ts`
- `src/main/services/browser/browserConversation.ts`（删除路由职责）
- `src/main/services/agent/toolAuthorization.ts`

任务：

- [ ] `inspect` 只开放列页、等待、检查和查找。
- [ ] `screenshot` 开放稳定性检查与视口截图；元素截图只在模型明确选择局部操作后展开。
- [ ] `diagnose` 开放受限控制台、网络和性能读取。
- [ ] `interact` 开放普通交互，高风险工具仍由结构化策略逐次审批。
- [ ] 滚动按已授权页面的本地视图操作处理，不要求开启最高交互权限。
- [ ] 模型 purpose 不能覆盖站点策略、敏感字段和高风险审批。
- [ ] 所有内部工具映射到 Task 1 固定的 Google 1.7.0 契约。

完成条件：模型选择目的，宿主提供最小能力，不再由关键词增删单个工具。

### Task 9：修复打开、等待和重试状态机

涉及：

- `src/main/services/browser/browserGateway.ts`
- `src/main/services/browser/chromeDevtoolsMcpAdapter.ts`
- 浏览器工具测试

任务：

- [ ] 打开 URL 前规范化并复用唯一已存在页面。
- [ ] `new_page` 成功即记录页面 identity，等待超时不得再次打开同一 URL。
- [ ] 已知目标文字优先使用官方 `wait_for`。
- [ ] 通用稳定性使用受限官方 `evaluate_script` 采样，不自研页面控制协议。
- [ ] 只读调用在重连并唯一恢复绑定后最多重试一次。
- [ ] 写操作超时、断连或结果未知时不重放。
- [ ] 按 taskId/callId 做幂等，防止模型或网络重试产生重复副作用。

完成条件：页面打开后不会继续重复 `new_page`，等待和重试有明确上限。

### Task 10：截图稳定、顺序和持久化

涉及：

- `src/main/services/browser/browserGateway.ts`
- `src/main/services/browser/browserTools.ts`
- `src/main/ipc/message.ts`
- `src/main/db`
- Renderer 图片组件

任务：

- [ ] 严格执行“验证绑定 → 等待稳定 → 最新 snapshot → 官方 take_screenshot”。
- [ ] 普通页面截图固定官方 `fullPage: false`；元素截图不能替代页面截图。
- [ ] 先原子持久化 artifact，再在对应 tool call 的完成位置插入图片块。
- [ ] 图片块支持独立折叠、预览、缩放和关闭。
- [ ] 重进会话从数据库恢复图片，不依赖进程内截图 Map。
- [ ] 同一 taskId/callId 只允许一个截图 artifact。
- [ ] 保留 2 MiB 单图限制，增加每消息、每会话和全局配额及孤儿清理。
- [ ] 数据库存储失败时工具返回失败，不展示临时图片。

完成条件：截图内容正确、时机稳定、顺序正确、重启后仍可查看且不会重复。

### Task 11：完成结构化浏览器证据

涉及：

- `src/shared/types.ts`
- `src/main/ipc/message.ts`
- `src/main/services/history.ts`
- DB migration 与测试

任务：

- [ ] 将 `toolContext` 升级为带 evidenceId、bindingId、generation、来源、时间、hash、截断和 freshness 的结构。
- [ ] 只保存成功且经过 Gateway 清洗的 inspect/diagnostics 结果。
- [ ] 历史模型消息把 evidence 标记为不可信历史快照。
- [ ] 页面状态变化、重连或超出 TTL 后标记 stale，但保留用户可查看记录。
- [ ] 当前状态问题要求重新工具检查，不能把旧 evidence 当实时页面。
- [ ] 修复纯 evidence 消息被过滤的问题并设置完整会话预算。

完成条件：跨轮既能利用已验证证据，又不会把旧页面内容误当当前事实。

### Task 12：统一终态、超时与资源回收

涉及：

- `src/main/ipc/message.ts`
- `src/main/services/agent/taskRuntime.ts`
- `src/main/services/agent/toolRegistry.ts`
- MCP client/lease manager

任务：

- [ ] 所有发送路径使用一个顶层 try/catch/finally 完成 UI 终态和资源回收。
- [ ] MCP lease、审批、页面选择等待、截图临时 artifact 在 finally 中释放。
- [ ] 审批等待与执行超时分离，同时定义独立审批有效期。
- [ ] 任务总超时可以取消连接批准和页面选择等待。
- [ ] 回复完成、失败、取消、窗口销毁和任务替换后不残留 MCP 子进程。
- [ ] 连续第二次调用不得复用已关闭 client，也不得因旧 generation 返回 invalid result。
- [ ] 覆盖每个早退分支的发送状态恢复测试。

完成条件：首次与连续调用行为一致，对话结束自动关闭调用资源。

### Task 13：删除旧路由并更新文档

涉及：

- `src/main/services/browser/browserConversation.ts`
- `src/main/ipc/message.ts`
- M16/M17 文档、用户指南和验证单

任务：

- [ ] 删除关键词决定 `browserIntent`、任务类型和浏览器工具可见性的逻辑。
- [ ] 删除历史截图/计划块自动开启 Chrome 的逻辑。
- [ ] 文档统一为“模型调用 activate，宿主懒连接，官方 MCP 执行”。
- [ ] 明确没有 Google 插件依赖；内置 provider 只是 MCP 客户端编排层。
- [ ] 明确 selected/前台页限制，不再使用错误产品承诺。
- [ ] 设置页删除日常连接开关，只保留说明、站点策略和授权清除。

完成条件：代码和所有权威文档不再同时存在三种相互冲突的调用模式。

### Task 14：自动化与真实 Chrome 发布门槛

自动化：

- [ ] 全量 `npm test`。
- [ ] `npm run typecheck`。
- [ ] `npm run build`。
- [ ] Google 1.7.0 schema fixture/映射契约测试。
- [ ] 普通聊天模型不调用 activate 的零 MCP 启动测试。
- [ ] 不支持 function calling 的模型不会启动 MCP、不会伪造浏览器结果的测试。
- [ ] 模型 activate → 动态目录 → inspect/screenshot 的多轮测试。
- [ ] 连续两次浏览器请求、重连、拒绝、取消和窗口关闭测试。
- [ ] 文档、图片、纯 evidence 和长历史回归。

真实 Chrome 144+：

- [ ] 官方远程调试开启与 Allow 批准。
- [ ] 一个页面自动绑定；多个页面进入对话内选择器。
- [ ] 验证手动切换标签页后不错误依赖 selected。
- [ ] 已打开页面检查、打开新页、等待、快照、交互和诊断。
- [ ] 首次截图、页面加载后截图、连续截图和跨轮截图。
- [ ] 图片折叠、缩放、关闭预览、重启应用后恢复。
- [ ] 页面打开成功后不重复打开。
- [ ] Chrome 重启、MCP 重连、旧 page ID/UID 失效。
- [ ] 回复完成、失败和取消后子进程与审批均清理。

完成条件：自动化、生产构建和真实 Chrome 验收全部留下证据；任何一项未完成都不得声称 M16 最终完成。

## 3. 推荐批次

### 批次一：消息与工具循环基础

Task 1～5。先解决真实 P1 缺陷、官方版本基线和模型自主选择能力。

### 批次二：可信页面与权限

Task 6～9。完成绑定、消歧、动态最小工具集和重试状态机。

### 批次三：截图与上下文

Task 10～12。完成图片、证据、超时和资源回收。

### 批次四：迁移与发布

Task 13～14。删除旧逻辑、统一文档并完成全量验收。

每批独立提交并保持可回滚。不得把 Composer/Skill/插件大重构混入浏览器正确性修复提交。

## 4. 核心决策记录

- 不依赖用户必须输入某些关键词。
- 不依赖用户发送前手动开启 Chrome。
- 不把浏览器全部工具永久塞给模型；先暴露小型 activate，再动态展开。
- 不把 MCP selected 当作操作系统前台标签页。
- 不开发 Google 插件；以宿主内置 capability provider 对接 Google 官方 MCP。
- 不使用私有协议弥补 Google MCP 当前限制。
- 模型的工具选择不能绕过宿主权限与审批。
- 浏览器修复与统一 `+` 菜单、Skill/插件/Hook 重构分开交付。

## 5. 预计工作量

- 批次一：3～5 个工作日。
- 批次二：4～6 个工作日。
- 批次三：3～5 个工作日。
- 批次四：2～4 个工作日。

合计约 12～20 个工作日，不含等待用户完成真实 Chrome 官方批准和人工验收的时间。
