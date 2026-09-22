# ASTRYVE 统一能力选择与显式 Chrome 上下文实施计划

> 日期：2026-09-22
> 状态：待执行
> 设计：`docs/superpowers/specs/2026-09-22-explicit-chrome-context-design.md`
> 原则：先统一能力生命周期和宿主可信绑定，再替换自动路由；每批保持可测试、可回退，不创建 Chrome 扩展。

## 1. 交付范围

本计划交付输入区统一 `+` 上下文菜单、Codex 风格的 Skill/插件选择、统一能力生命周期、结构化浏览器
绑定、只读/交互工具策略、标签页重连、浏览器证据持久化和完整验证。`+` 菜单合并现有附件/图片入口，
并提供 Chrome、Skills、插件三个子入口，但输入区不新增独立浏览器、Skill 或插件按钮。继续复用 Google
官方 Chrome DevTools MCP、现有 Browser Gateway 和插件运行时。

不包含浏览器侧边栏、Chrome 扩展、Native Messaging、选中文本同步、多浏览器支持、插件市场重做或
新的 Hook 配置编辑器。

## 2. 实施顺序

### Task 1：冻结能力调用基线与补充路由回归

涉及文件：

- `src/main/services/browser/browserConversation.test.ts`
- `src/main/ipc/message.ts`
- `src/main/ipc/message*.test.ts`
- `src/main/services/agent/skillRegistry.test.ts`
- `src/main/services/agent/pluginConversation.test.ts`
- `src/main/services/agent/pluginHooks.test.ts`
- `src/main/services/agent/pluginMcpTools.test.ts`
- `docs/verification/M16-Google-Chrome-DevTools-MCP验证测试单.md`

步骤：

- [ ] 记录当前自动触发用例、浏览器续接用例和工具集合。
- [ ] 记录当前 `/skill`、`@plugin`、Skill 自动匹配、插件任务快照、MCP 工具目录和 Hook 事件行为。
- [ ] 为"有 URL 但无显式绑定"、"讨论网页但不操作"和"明确绑定 Chrome"写失败测试。
- [ ] 为 `$skill`、自动/显式来源、插件只被发现但未执行、MCP 发现但未调用、Hook 事件触发写目标测试。
- [ ] 记录当前真实 Chrome 前置条件和现有未完成人工验收项。
- [ ] 确认工作树中已有超时与上下文修复，不覆盖无关改动。

完成条件：新测试准确描述统一能力生命周期，且在改实现前仅目标用例失败。

### Task 2：增加共享浏览器绑定契约与 IPC 校验

涉及文件：

- `src/shared/types.ts`
- `src/shared/browser.ts`
- `src/main/ipc/validation.ts`
- `src/main/ipc/validation.test.ts`
- `src/preload/index.ts`

步骤：

- [ ] 增加 `BrowserContextBinding` 和 `SendMessageInput.browserContext`。
- [ ] 限定 `schemaVersion`、provider、mode、target、字符串长度和 HTTP(S) URL。
- [ ] 拒绝 Renderer 自造的未知 provider、模式、额外字段和不安全 URL。
- [ ] 深拷贝并冻结进入任务的绑定，避免发送后被 UI 状态修改。
- [ ] 增加有效、缺失、畸形、超长和非 HTTP(S) 输入测试。

完成条件：主进程只接受封闭、规范化、可序列化的浏览器绑定。

### Task 3：实现标签页预览服务和短 MCP 租约

涉及文件：

- `src/shared/ipc.ts`
- `src/main/ipc/browser.ts`（新增或在现有设置 IPC 中建立聚焦模块）
- `src/main/services/browser/officialChromeBrowserRuntime.ts`
- `src/main/services/browser/chromeDevtoolsMcpAdapter.ts`
- 对应测试文件

步骤：

- [ ] 增加受信 IPC：获取清洗后的 Chrome 连接状态和标签页预览。
- [ ] 标签页预览只返回临时 page ID、限长标题、清洗 URL、来源和 active 状态。
- [ ] 打开弹出层不连接；显式刷新或首次加载列表才获取短租约并调用 `list_pages`。
- [ ] 列表完成、取消或窗口销毁时释放短租约。
- [ ] 覆盖连接拒绝、超时、窗口销毁和并发刷新，禁止遗留 MCP 子进程。

完成条件：不经过模型即可由可信 UI 获取真实标签页列表，且不会读取正文。

### Task 4：实现统一 `+` 上下文菜单

涉及文件：

- `src/renderer/src/components/chat/ChatInput.tsx`
- `src/renderer/src/components/chat/ChatInput.test.tsx`
- `src/renderer/src/components/chat/ChatInput.css` 或现有样式模块
- `src/renderer/src/stores/chatStore.ts`
- `src/renderer/src/stores/skillStore.ts`
- `src/renderer/src/stores/pluginStore.ts`

步骤：

- [ ] 将当前附件和图片两个按钮合并成一个固定尺寸 `ContextMenuButton`（`+` 图标）。
- [ ] 将 `+` 放在输入工具栏左侧、模型选择器之前；发送/停止继续固定在右侧。
- [ ] 一级菜单提供`上传文件`、`使用 Chrome`、`Skills`和`插件`；不在本批次虚构项目或最近文件能力。
- [ ] `上传文件`统一接受现有图片和文档格式，粘贴、拖拽、压缩和解析路径保持不变。
- [ ] `使用 Chrome`打开右侧子面板或二级菜单，在其中提供关闭、只读/交互分段控件和标签页列表。
- [ ] `Skills`和`插件`子面板支持搜索、空状态、禁用/错误状态和键盘选择，只读取本地元数据。
- [ ] 选择后在 Sender `header` 显示可移除、限宽的 Chrome、`$skill`和`@plugin`上下文标签。
- [ ] 菜单选择和正文 `$`/`@`补全写入同一份结构化草稿状态，删除任一表现都会同步清除选择。
- [ ] 窄窗口保持 `+` 按钮固定尺寸，菜单和子面板在可用宽度内换位或纵向覆盖，不横向溢出。
- [ ] 支持键盘打开、方向键、Enter、Esc、焦点返回和点击外部关闭。
- [ ] 加载、空列表、连接拒绝、超时、stale 和重试状态不改变输入区尺寸。
- [ ] 将用户选择写入当前会话草稿；发送时随消息提交不可变快照。
- [ ] 自然语言命中只能提示 `+` 按钮或 Chrome 菜单项一次，不自动打开菜单或建立连接。

完成条件：输入区工具栏只有一个 `+` 上下文入口，附件、图片、Chrome、Skills 和插件均从该入口
进入；常规/窄窗口无重叠，完整键盘路径可用。

### Task 5：对齐 Codex 的 Skill 选择与加载时机

涉及文件：

- `src/renderer/src/components/chat/ChatInput.tsx`
- `src/main/ipc/message.ts`
- `src/main/services/agent/skillRegistry.ts`
- `src/main/services/agent/skillManager.ts`
- `src/main/services/agent/skillConversation.ts`
- `src/shared/types.ts`
- 对应测试文件

步骤：

- [ ] 将 `$skill-name` 设为主显式语法，正文补全与 `+` 菜单均生成结构化 `explicitSkillIds`。
- [ ] 旧 `/skill-name` 保留一个迁移周期，解析后发出一次性弃用提示，并增加移除日期/版本记录。
- [ ] 自动匹配只考虑已启用、允许隐式调用且名称/描述匹配的 Skill；显式选择可以调用禁止隐式的 Skill。
- [ ] 在任何项目、插件或浏览器任务动作前解析依赖并完整加载 `SKILL.md` 与允许的资源。
- [ ] 将 Skill 工具声明作为最终工具目录的收窄策略，不能恢复宿主未注册或被审批策略禁用的工具。
- [ ] 在消息块和审计中记录 `activation: explicit | automatic`、入口、Skill 来源、版本和插件归属。
- [ ] 显式 Skill 不存在、禁用、冲突、资源非法或依赖缺失时，在执行工具前失败并给出可恢复错误。
- [ ] 覆盖内置、用户、项目和插件 Skill 的显式/自动选择、优先级、依赖与工具策略测试。

完成条件：Skill 的安装、匹配、加载和工具执行阶段可区分；`$skill`、菜单和自动匹配共用同一解析链路。

### Task 6：建立插件能力快照与 MCP 发现/执行边界

涉及文件：

- `src/main/ipc/message.ts`
- `src/main/services/agent/pluginConversation.ts`
- `src/main/services/agent/pluginManager.ts`
- `src/main/services/agent/pluginMcpRuntime.ts`
- `src/main/services/agent/pluginMcpTools.ts`
- `src/main/services/agent/taskRuntimeManager.ts`
- `src/main/services/agent/toolCallingLoop.ts`
- `src/shared/types.ts`
- 对应测试文件

步骤：

- [ ] 将插件定义为能力包：安装/启用只进入后续新任务的候选集合，不产生插件“执行”事件。
- [ ] `@plugin-id` 和 `+` 菜单写入结构化 `explicitPluginIds`；正文仅负责补全/展示，不作为主进程信任边界。
- [ ] 支持用户只描述任务时，从已启用插件的元数据、Skills 和工具中选择合适能力，并记录自动选择原因。
- [ ] 发送时固定插件 ID、版本、组件、连接、认证状态、工具策略和外部目标，任务中途变更只影响下一任务。
- [ ] 独立 MCP 与插件 MCP 只在启用且策略允许时进入工具发现；应用 allowlist/denylist 后生成最终目录。
- [ ] 明确区分 `discovered`、`selected`、`approval_pending`、`executed` 和 `failed`，只有真实 tool call 计为执行。
- [ ] `/mcp` 只返回连接、认证、目录和错误状态，不调用业务工具，也不加入普通 `+` 菜单。
- [ ] 应用服务器默认及工具级 `auto`、`prompt`、`writes`、`approve` 审批策略；Skill/插件选择不得跳过审批。
- [ ] 任务完成、失败或取消后关闭插件 MCP 租约/临时进程，MCP 结果继续按不可信工具内容处理。
- [ ] 时间线显示实际子能力和来源，例如插件 Skill 名或 MCP 工具名，不显示含糊的“运行插件”。

完成条件：插件选择不会直接执行任何代码；插件版本和 MCP 目录按任务固定，发现工具与调用工具可审计地区分。

### Task 7：对齐 Hook 生命周期与可见性

涉及文件：

- `src/main/services/agent/pluginHooks.ts`
- `src/main/services/agent/pluginLifecycle.ts`
- `src/main/services/agent/taskRuntime.ts`
- `src/main/services/agent/toolCallingLoop.ts`
- `src/main/ipc/message.ts`
- `src/renderer/src/components/chat/Blocks.tsx`
- 对应测试文件

步骤：

- [ ] 为 `SessionStart`、`UserPromptSubmit`、`PreToolUse`、`PermissionRequest`、`PostToolUse`、`Stop`、
  `Interrupt` 建立明确的宿主触发点和事件输入契约。
- [ ] Hook 只从本轮插件快照加载，并在事件和 matcher 匹配时运行；不向模型注册为普通工具。
- [ ] 禁止 Hook 增加工具、扩大权限、自行通过审批或修改 Chrome 绑定；所有改写在宿主允许的字段内校验。
- [ ] `PreToolUse` 阻止发生在执行前；`PostToolUse` 阻止必须保留“工具已执行”的真实审计语义。
- [ ] `Stop` 的继续语义和 `Interrupt` 的清理语义有次数上限，避免无限续跑或中断后残留任务资源。
- [ ] 隔离 Hook 超时、退出码、stdout/stderr 和异常；一个插件 Hook 失败不得破坏其他清理流程。
- [ ] Composer 不提供 Hook 入口；仅在阻止、警告、失败或用户查看审计时显示 Hook 记录。
- [ ] 增加事件顺序、matcher、阻止、改写、超时、异常、取消和插件禁用/升级边界测试。

完成条件：Hook 完全由生命周期事件驱动，和模型工具调用相互区分，关键结果可见且可审计。

### Task 8：用显式绑定替换自动浏览器任务路由

涉及文件：

- `src/main/ipc/message.ts`
- `src/main/services/browser/browserConversation.ts`
- `src/main/services/browser/browserConversation.test.ts`
- `src/main/services/agent/taskRuntimeManager.ts`

步骤：

- [ ] `runReply` 接收已校验的 `browserContext`，不再根据正文生成 `browserIntent`。
- [ ] 无绑定时不调用 `createBrowserTask`，也不把 `browser.*` 加入项目工具集合。
- [ ] 有绑定且无项目时创建浏览器任务；有项目时将受限浏览器工具加入项目任务。
- [ ] 将现有意图函数改成 Renderer 可使用的纯建议，不拥有任务路由权限。
- [ ] 删除依赖历史计划块或截图自动开启下一轮浏览器的逻辑。
- [ ] 浏览器提示词保留操作规范，但明确它不能改变工具目录。

完成条件：URL 和关键词不能启动 MCP；只有可信绑定能让浏览器工具进入任务。

### Task 9：实现模式化工具白名单

涉及文件：

- `src/main/services/browser/browserTools.ts`
- `src/main/services/browser/browserConversation.ts` 或新增 `browserToolPolicy.ts`
- `src/main/services/agent/toolCallingLoop.ts`
- 对应测试文件

步骤：

- [ ] 为 `read` 和 `interact` 生成确定性的浏览器工具集合。
- [ ] 只读模式彻底排除所有写工具，并测试模型无法构造未知调用绕过。
- [ ] `screenshotElement` 只在用户明确请求局部截图时加入。
- [ ] `closeTab`、`history` 和 `confirmClick` 仅在相应明确请求下加入。
- [ ] 保持网站授权、高风险审批、敏感输入阻止和审计规则不变。
- [ ] 审批等待不消耗工具实际执行超时，任务总超时仍可取消等待。

完成条件：提示词失效或网页注入都不能扩大本轮浏览器工具集合。

### Task 10：解析绑定目标并处理 MCP 重连

涉及文件：

- `src/main/services/browser/browserGateway.ts`
- `src/main/services/browser/chromeDevtoolsMcpAdapter.ts`
- `src/main/services/browser/officialChromeBrowserRuntime.ts`
- 对应测试文件

步骤：

- [ ] `active` 绑定在调用时解析官方 selected 页面。
- [ ] `page` 绑定校验 page ID 与 expected origin/URL，防止标签页被替换。
- [ ] MCP 重连后清除旧 page ID 和元素 UID，重新列页并执行唯一匹配。
- [ ] 多个匹配、无匹配或来源变化时返回 `BROWSER_BINDING_STALE`。
- [ ] stale 绑定禁止写操作，不自动选择相似标题页面。
- [ ] 写操作超时或断连后不重放；后续调用要求重新获取标签页状态。

完成条件：用户绑定的目标可验证，重连和标签页变化不会把操作发到错误页面。

### Task 11：完成跨轮浏览器证据与视觉边界

涉及文件：

- `src/shared/types.ts`
- `src/main/services/history.ts`
- `src/main/services/history.test.ts`
- `src/main/ipc/message.ts`
- `src/renderer/src/components/chat/Blocks.tsx`

步骤：

- [ ] 将成功的 `inspect` 和受限诊断结果保存为不可见 `toolContext` 块。
- [ ] 每块和每消息分别限长，历史只取最近三块并标记网页内容不可信。
- [ ] 失败任务不把未完成 thinking 回传为可靠跨轮推理。
- [ ] 截图继续按真实工具顺序保存为附件和图片块。
- [ ] 视觉模型仅在宿主实际回传图片内容后分析；文本模型收到明确的无视觉边界。
- [ ] 增加"上一轮工具失败但页面证据存在"和"截图存在但模型无视觉"回归测试。

完成条件：后续追问能引用真实页面证据，同时不编造截图内容。

### Task 12：会话状态、清除与兼容迁移

涉及文件：

- `src/renderer/src/stores/chatStore.ts` 或对应会话状态模块
- `src/main/db` 的会话模型与迁移
- `src/main/ipc/session.ts`
- 相关测试

步骤：

- [ ] 决定并实现绑定的持久化范围：默认记住到当前会话，用户可随时关闭。
- [ ] 只持久化模式和目标描述；page ID 标为临时值，应用重启后必须重新解析。
- [ ] 删除会话、登出、切换账号和关闭浏览器能力时清理绑定与短租约。
- [ ] 旧会话缺少字段时默认为关闭，不从历史正文推断开启。
- [ ] 插件和 Skill 状态变化不能静默打开 Chrome。
- [ ] 显式 Skill/插件只属于当前草稿和已发送消息；发送后保留历史快照，但不自动带入下一条草稿。
- [ ] 自动匹配结果仅保存在任务/消息记录，不回写成显式标签或修改用户正文。
- [ ] 迁移旧 `/skill` 消息和仅含正文 `@plugin` 的历史展示，新请求统一使用结构化 ID 与激活来源。

完成条件：升级兼容旧数据，绑定不会跨会话、账号或任务泄漏。

### Task 13：验证、文档和发布门槛

涉及文件：

- `docs/08-第四阶段计划.md`
- `docs/verification/M16-Google-Chrome-DevTools-MCP验证测试单.md`
- `README.md`
- 新增显式 Chrome 上下文页面验收记录（如需要）

自动化：

- [ ] 运行 Skill Registry、Plugin Conversation、Plugin MCP、Plugin Hooks、任务快照和工具循环定向测试。
- [ ] 运行 Browser Gateway、Browser Tools、路由、历史和 Renderer 控件定向测试。
- [ ] 运行完整 `npm test`，记录与本变更无关的既有失败。
- [ ] 运行 `npm run typecheck`。
- [ ] 运行 `npm run build`。
- [ ] 运行 `npm run smoke:browser-mcp`，仅使用受控测试页面。
- [ ] 运行 `git diff --check` 和生产依赖审计。

人工验收：

- [ ] 使用 `$skill`、`+` 菜单和纯自然语言分别触发同一 Skill，确认显式/自动来源展示正确。
- [ ] 使用 `@plugin`、`+` 菜单和纯任务描述使用插件能力，确认实际子能力可见且插件不会被笼统“执行”。
- [ ] 打开 `/mcp` 只查看状态，确认不会调用业务工具；再发任务确认具体调用与审批单独出现。
- [ ] 验证 Hook 无 Composer 入口，仅在匹配事件运行，阻止/失败时有清晰记录。
- [ ] 未选择 Chrome 时发送含 URL、页面、截图、点击等文字，确认不连接 MCP。
- [ ] 从 `+` 菜单选择 Chrome、只读模式和指定标签页，读取、截图和后续追问成功。
- [ ] 只读模式要求点击，确认模型没有点击工具可用。
- [ ] 切换到交互模式，确认站点授权和高风险审批仍生效。
- [ ] 绑定指定页后切换 Chrome 活动页，确认操作仍指向指定页。
- [ ] 关闭或复制同 URL 标签页，确认 stale/歧义时要求重新选择。
- [ ] 拒绝 Chrome 官方连接、取消站点审批和工具超时后均可恢复。
- [ ] 常规窗口、窄窗口、键盘和屏幕阅读器路径通过，输入区始终只有一个 `+` 能力入口。
- [ ] 回复完成、失败、取消和应用退出后无遗留 Chrome 或插件 MCP 子进程。

文档：

- [ ] 将 M16 的自动浏览器意图说明改成显式 Chrome 上下文说明。
- [ ] 更新用户指南：`$skill`、`@plugin`、自动匹配、`/mcp` 状态、Hook 可见性和统一 `+` 菜单。
- [ ] 更新 Chrome 指南：远程调试、模式、站点授权和故障恢复。
- [ ] 记录文本模型不能分析未回传截图像素的限制。

完成条件：自动化、构建、Skills/插件/MCP/Hook 生命周期验收、真实 Chrome 人工验收和文档全部闭环
后才能发布；已显式选择但加载/连接失败时不得静默降级成未使用该能力的普通回答。

## 3. 推荐批次

### 批次一：统一入口与 Skill

Task 1～5。交付统一 `+` 菜单、共享契约、`$skill` 主语法和显式/自动 Skill 可见性。

### 批次二：插件、MCP 与 Hook

Task 6～7。交付插件任务快照、MCP 发现/执行边界、审批策略和事件驱动 Hook。

### 批次三：显式 Chrome 边界

Task 8～10。交付显式浏览器路由、只读/交互硬边界、标签页验证和重连安全。完成后停止关键词自动
启动 Chrome MCP。

### 批次四：上下文与发布

Task 11～13。交付跨轮证据、兼容迁移、全能力验收和文档闭环。

## 4. 风险与决策点

- Chrome 官方 page ID 在 MCP 重连后不稳定，不能作为长期会话主键。
- 同 URL 多标签页无法仅凭 URL 安全恢复写目标，必须重新选择。
- 标签页预览本身会暴露标题和 URL，应限长、清洗并只在用户打开控件后获取。
- 只读/交互是工具目录边界，不替代网站授权和高风险审批。
- 旧自动路由与新显式绑定不能长期并存，否则用户仍无法预测调用时机。
- `+` 菜单及 Chrome 子面板内部允许多个设置项，但输入区工具栏只能有一个常驻上下文入口。
- 自动 Skill/插件匹配若没有时间线证据，用户仍会把“可用”误解为“已执行”；激活来源必须结构化保存。
- 将所有启用插件工具无界加入目录会放大延迟和上下文，应在不依赖关键词开关的前提下使用插件元数据、
  连接策略和任务快照控制目录规模。
- Hook 属于事件回调，不能复用模型 tool call UI；尤其要保留 `PostToolUse` 发生时工具已经执行的事实。
- 插件升级和连接变更不能改写运行中任务快照；紧急吊销必须走单独、可审计的中断路径。

## 5. 预计工作量

- 批次一：4～6 个工作日。
- 批次二：3～5 个工作日。
- 批次三：3～5 个工作日。
- 批次四：2～4 个工作日。
- 合计：单人约 12～20 个工作日，不含外部模型故障、第三方 MCP/OAuth、Chrome 官方授权等待和发布
  审核时间。若当前插件 Hook 已覆盖全部目标事件，可缩短 2～3 个工作日。
