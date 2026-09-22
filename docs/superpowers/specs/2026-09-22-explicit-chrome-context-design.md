# ASTRYVE 模型驱动能力调用与 Chrome DevTools MCP 设计

> 状态：设计已重写，待按实施计划落地
>
> 决策日期：2026-09-22
>
> Chrome 执行后端：Google Chrome 团队维护的 `chrome-devtools-mcp`，当前锁定 `1.7.0`

## 1. 决策摘要

ASTRYVE 不再通过关键词、正则或宿主自然语言分类器判断用户是否想使用 Chrome，也不要求用户在发送消息前手动开启 Chrome 上下文。

Chrome 作为内置能力提供者进入统一模型工具循环：

1. 每轮模型首先只看到体积很小的 `browser.activate` 能力工具。
2. 模型以 `tool_choice: auto` 自主决定是否调用；普通聊天可以直接回答。
3. `browser.activate` 被调用后，宿主才懒启动 Google 官方 MCP，并通过官方 `list_pages` 获取页面。
4. 宿主确定可信页面绑定后，下一轮模型工具目录动态增加受策略限制的 `browser.*` 工具。
5. 所有页面读取、截图、交互最终都映射到固定版本的 Google 官方工具，不自研 Chrome 协议、扩展或页面控制实现。

这与 Codex/其他 MCP 客户端的核心行为保持一致：模型看见能力描述并选择工具，宿主负责连接、权限、审批、审计和生命周期，MCP 服务器负责真实执行。

`browser.activate` 是 ASTRYVE 的宿主编排工具，不冒充 Google 官方工具；它只负责延迟连接和建立页面绑定，不读取正文、不截图、不执行交互。

## 2. 为什么不使用旧方案

旧实现依赖 `prefersBrowserTools()`、`prefersBrowserContinuation()` 和历史正文决定是否创建浏览器任务。该方案存在无法消除的误判：

- 同一句“看看这个问题”可能指附件、代码或浏览器页面；
- 没命中关键词时，模型根本看不到浏览器工具，无法自行决定调用；
- 命中关键词时又可能错误启动 Chrome；
- 短追问依赖历史计划块和截图推断，调用行为不可预测；
- 为规避误判而改成强制手动绑定，会重新引入用户每次开启的负担。

新设计删除宿主语义判断。宿主只校验结构化状态与权限，不理解用户句子的业务含义。

## 3. 目标与非目标

目标：

- 模型而不是正则决定是否使用浏览器。
- 不在设置页提供日常调用开关；普通对话中自然触发。
- 首次调用、连续调用和跨轮追问使用同一工具循环。
- 连接仅在真实工具选择后发生，回复结束后可靠释放。
- 严格使用 Google 官方 MCP 的进程、传输、工具名、参数和返回结构。
- 对页面选择、站点访问、写操作、截图和证据持久化建立宿主安全边界。
- 页面加载未稳定时不截图，图片按真实工具完成顺序插入时间线并可折叠、预览和持久化。

非目标：

- 不开发 Google/Chrome 插件。
- 不开发 Chrome 扩展、Native Messaging 或私有 CDP 客户端。
- 不声称 MCP 的 `selected` 一定等于用户肉眼正在看的前台标签页。
- 不把 Google MCP 原始工具直接交给普通插件。
- 不在本设计中重做整个 Composer、Skills、插件市场或 Hook UI。

## 4. 能力发现与两阶段工具目录

### 4.1 第一阶段：休眠能力

只要当前模型支持原生 function calling，所有非受限对话都可看到：

```ts
interface BrowserActivateArgs {
  purpose: 'inspect' | 'screenshot' | 'diagnose' | 'interact'
  targetHint?: {
    url?: string
    title?: string
  }
}
```

工具说明必须清楚告诉模型：

- 只有需要读取或操作用户实时 Chrome 状态时才调用；
- 常识、代码解释、已提供的附件和普通联网检索不应调用；
- 工具不会直接读取页面，只会请求建立浏览器能力；
- 不确定是否需要实时页面时，应先根据现有上下文回答或向用户提问。

第一轮使用 `tool_choice: auto`，禁止因为存在 `browser.activate` 而设置 `required`。

不支持原生 function calling 的模型不能获得浏览器能力。宿主应在用户明确询问实时 Chrome 状态但
模型无法调用工具时显示“当前模型不支持工具调用”的可恢复提示，允许切换模型；不得退回关键词路由，
也不得让模型用正文伪装工具结果。

### 4.2 第二阶段：已激活能力

`browser.activate` 成功后，工具循环必须在下一轮重新计算工具目录。根据 `purpose`、页面绑定、站点策略和任务权限暴露最小集合：

- `inspect`：页面列表、等待、快照/检查、查找。
- `screenshot`：检查加载状态、视口截图；只有用户明确要求局部时开放元素截图。
- `diagnose`：受限控制台、网络和性能诊断。
- `interact`：在读取能力基础上开放普通交互；高风险动作继续逐次审批。

工具目录是每轮动态快照，而不是任务创建时一次性固定。模型不能通过网页内容、Skill 文本或插件输出扩展目录。

### 4.3 普通对话行为

若模型未调用 `browser.activate`：

- 不启动 MCP 子进程；
- 不调用 `list_pages`；
- 不显示浏览器工具时间线；
- 正常生成回答。

因此系统不需要关键词白名单，也不会因为消息中出现 URL、“页面”或“截图”就自动连接。

## 5. 页面绑定与“当前页面”限制

### 5.1 不把 `selected` 宣称为前台标签页

Google MCP 的页面工具围绕 MCP 会话中的 selected page/page ID 工作。连接已有 Chrome 时，`selected` 可能在用户手动切换标签页后与浏览器前台页面不同步。

因此：

- 产品文案使用“已选择的 Chrome 页面”，不使用“系统当前活动标签页”的确定性承诺；
- `browser.screenshotCurrent` 不得通过 `list_pages` 中的 selected 盲选后声称截取了用户当前可见页面；
- 严格官方 MCP 模式下，不通过自研 CDP、窗口句柄或扩展弥补该限制。

### 5.2 绑定规则

```ts
interface BrowserPageBinding {
  schemaVersion: 2
  bindingId: string       // 主进程生成的不可猜测短期 ID
  mcpGeneration: number   // MCP 会话代次
  pageId: string          // 仅在当前 MCP generation 内有效
  origin: string
  normalizedUrl: string   // 移除凭据、fragment 和敏感 query
  title?: string
  selectedAt: number
  state: 'ready' | 'stale'
}
```

Renderer 只持有 `bindingId` 和清洗后的显示信息；不得提交可被宿主直接信任的 page ID、URL 或权限模式。

激活时按以下顺序选择：

1. 当前会话存在仍可验证的绑定：复用。
2. 模型提供了 URL/title hint，且 `list_pages` 恰好唯一精确匹配：绑定该页。
3. 只有一个可用普通页面：绑定该页。
4. 多页面或匹配不唯一：在当前对话内显示页面选择器并暂停工具调用；不跳转设置页。

页面选择器是安全消歧，不是开启功能的前置开关。用户选择后原任务继续，不要求重新发送消息。

### 5.3 重连

- MCP 断开、超时或重启后，旧 page ID 和 UID 全部失效。
- `mcpGeneration` 增加并将现有绑定标记 stale。
- 重连后通过清洗后的 URL/origin/title 做唯一匹配；不能唯一匹配就重新选择。
- 可能已经成功的写操作绝不自动重放。
- screenshot/read 调用可以在重新建立唯一绑定后重试一次；同一调用 ID 不得重复持久化图片。

## 6. 官方 MCP 映射纪律

### 6.1 版本化来源

生产依赖、工具 schema 快照、适配器测试和文档必须指向同一固定版本。当前为 `chrome-devtools-mcp@1.7.0`。

禁止一边锁定 1.7.0，一边依据官方仓库 `main` 分支新增字段。升级流程必须：

1. 阅读 Google 官方 release/changelog。
2. 固定新版本和完整性哈希。
3. 重新抓取 `tools/list` 并审查 schema 差异。
4. 更新逐项映射测试和真实 Chrome 验收。
5. 通过后一次性提交依赖、代码与版本化文档。

### 6.2 适配器映射表

`docs/22-M16-Google-Chrome-DevTools-MCP接入设计.md` 必须维护表格，至少记录：

- ASTRYVE 工具名；
- Google 官方工具名；
- 固定版本中的准确参数；
- 宿主增加的清洗、限额和审批；
- 返回值转换；
- 对应契约测试。

内部工具可以组合多个官方调用，但必须逐项可追溯，不能把宿主推断描述成官方保证。

### 6.3 官方推荐工作流

交互遵守官方顺序：列页/确定 page ID → 等待已知页面条件 → 获取最新 snapshot → 使用最新 UID 交互。截图用于视觉证据，自动化优先使用 snapshot；页面或 UID 变化后重新 snapshot。

## 7. 权限模型

模型决定“想调用什么”，宿主决定“能否执行”，两者不能混为一层。

### 7.1 激活

`browser.activate` 可自动调用。它只懒启动 MCP、触发 Chrome 官方连接批准并列出页面，不读取正文。

Chrome 144+ 远程调试开关和 Chrome 原生 Allow 对话框仍是 Google 官方前置条件，ASTRYVE 不绕过。

### 7.2 读取

- 首次访问新 origin 走站点读取策略：允许一次、允许该站点、拒绝。
- 列页结果只向模型返回清洗后的 URL 和限长标题。
- 页面正文、snapshot、控制台和网络数据均视为不可信数据。

### 7.3 交互

- 普通滚动属于本地视图操作，可在已授权页面上执行，但仍记录审计。
- 点击、输入、上传、拖放等按既有 Browser Gateway 策略执行。
- 提交、购买、删除、发送、权限授予、历史/关闭页面等高风险操作逐次审批。
- 敏感字段输入由 Gateway 拒绝，不因模型选择或插件来源放宽。

## 8. 生命周期状态机

```text
dormant
  -> activating
  -> needs_chrome_approval | needs_page_selection | ready
ready
  -> executing
  -> ready | stale | failed
ready | stale | failed
  -> releasing
  -> dormant
```

规则：

- 应用启动时只注册能力描述，不启动 MCP。
- 首次 `browser.activate` 才创建回复租约。
- 同一回复内所有浏览器调用共享租约和 generation。
- 回复完成、失败、取消、窗口销毁后必须在 finally 中释放租约并关闭子进程。
- 会话只持久化页面描述和站点授权，不持久化可长期信任的 page ID/UID。
- 下一轮模型再次选择浏览器时，可静默重连并验证唯一绑定；无需用户回设置页。
- 审批等待不消耗单次工具执行超时，但受任务总超时和独立审批有效期约束。

## 9. 页面稳定与截图

截图调用必须按以下顺序：

1. 验证绑定 generation、page ID 和 origin。
2. 使用官方 `evaluate_script` 读取受限稳定性指标：`document.readyState`、URL、标题、图片、字体、资源数和页面高度。
3. 连续采样达到稳定条件；有明确目标文字时优先调用官方 `wait_for`。
4. 获取一次最新 snapshot，用于确认页面身份和状态。
5. 调用官方 `take_screenshot`，普通页面截图固定 `fullPage: false`。
6. 将图片作为宿主 artifact 原子持久化，再把图片块追加到当前工具调用所在时间线位置。

不得：

- 页面尚在变化时立即截图；
- 为等待加载重复 `new_page`；
- 用根元素截图冒充视口截图；
- 因模型重复相同调用而插入重复图片；
- 把 Base64 放进模型可见正文。

图片 UI 必须支持折叠、展开、缩放和关闭预览。再次进入会话时从持久化 attachment/artifact 恢复，不能依赖进程内 Map。

## 10. 跨轮证据

```ts
interface BrowserEvidenceBlock {
  kind: 'toolContext'
  evidenceId: string
  toolName: string
  bindingId: string
  mcpGeneration: number
  origin: string
  normalizedUrl: string
  capturedAt: number
  content: string
  truncated: boolean
  contentHash: string
  freshness: 'snapshot' | 'stale'
}
```

要求：

- 只保存 Gateway 清洗、脱敏、限长后的结果。
- `inspect` 单块最多 16,000 字符，每个问答最多三块，整个会话另设总预算。
- 历史工具证据即使没有 assistant 正文也必须进入模型历史。
- 历史证据明确标记采集时间和“历史快照”，不得当作当前实时状态。
- 新一轮若问题要求当前状态，模型应再次激活并检查；不能只凭旧证据作实时结论。
- 视觉模型只在宿主明确附带相关图片时获得像素；文本模型不得声称看见截图。
- 失败任务不保存未完成推理为可靠证据。

## 11. 图片与数据留存

- 截图二进制/附件使用稳定 artifact ID，消息只引用 ID。
- 单图继续限制 2 MiB；同时增加每条消息、每会话和全局缓存配额。
- 会话删除时级联删除截图；孤儿 artifact 定期回收。
- 完整 URL query、Cookie、authorization header 和敏感表单值不得进入审计或 evidence。
- 数据库存储失败时工具调用必须显示失败，不能展示只存在内存、重启即丢失的图片。

## 12. 错误与恢复

| 场景 | 行为 |
| --- | --- |
| 模型没有调用浏览器 | 普通回答，不启动 MCP |
| Chrome 未开启远程调试 | 返回可恢复引导；不循环重试 |
| 用户拒绝官方连接 | 当前调用失败，输入框恢复；不降级成声称已读取页面的回答 |
| 多页面无法消歧 | 对话内页面选择器暂停并恢复同一任务 |
| 页面关闭或重连 | 标记 stale，重新列页；写操作不重放 |
| 页面等待超时 | 保留已知页面状态，允许用户重试；不重复打开页面 |
| 截图持久化失败 | 不插入图片块，返回明确错误 |
| 模型反复激活 | 相同回复复用租约，激活调用幂等 |
| 回复结束 | finally 释放租约、审批和子进程 |

## 13. 与统一 `+` 菜单的关系

`+` 菜单不是浏览器调用开关。后续可以提供以下可选增强：

- 预先选择某个页面；
- 查看当前绑定；
- 手动解除绑定；
- 上传文件、选择 Skill 或插件。

没有任何手动选择时，模型仍可调用 `browser.activate`。因此 Composer 重构可以独立排期，不阻塞浏览器正确性修复。

设置页只保留：

- Chrome 版本和远程调试说明；
- 站点允许/阻止策略；
- 授权清除与诊断。

不提供“开启浏览器能力后才能对话调用”的日常总开关。

## 14. 验收标准

1. “你好”“解释这段代码”等普通请求不启动 MCP，模型可直接回答。
2. 模型认为需要实时 Chrome 时自主调用 `browser.activate`，不依赖宿主关键词。
3. 首次连接仅出现 Google 官方批准流程；成功后同一回复继续执行目标工具。
4. 多页面时不把 MCP selected 冒充用户前台页；无法唯一确定时使用对话内选择器。
5. 连续两轮截图均绑定正确页面，等待稳定后截图，图片按工具完成顺序显示。
6. 图片可折叠、缩放、重开会话后恢复，且不会重复插入。
7. 首次调用、后续调用、失败重试和新会话均不会遗留 MCP 子进程或卡住发送状态。
8. 页面打开成功后不会因为等待逻辑再次 `new_page`。
9. MCP 重连后旧 page ID/UID 不再使用，写操作不自动重放。
10. 纯 `toolContext` 消息、文档正文和相关图片能正确进入后续模型上下文。
11. 所有 ASTRYVE 浏览器工具均有 `1.7.0` 官方工具/schema 映射和契约测试。
12. 单元测试、类型检查、生产构建以及真实 Chrome 144+ 人工 E2E 全部通过后才可发布。
13. 不支持原生 function calling 的模型不会启动浏览器，并给出准确的能力限制提示。

## 15. 官方参考

Google 部分只以以下来源为规范依据：

- Chrome for Developers：Chrome DevTools for agents 入门
  - https://developer.chrome.com/docs/devtools/agents/get-started
- Chrome for Developers：连接现有 Chrome
  - https://developer.chrome.com/docs/devtools/agents/use-cases/auto-connect
- Chrome for Developers：配置
  - https://developer.chrome.com/docs/devtools/agents/get-started/configuration
- ChromeDevTools 官方仓库固定版本 `chrome-devtools-mcp-v1.7.0`
  - https://github.com/ChromeDevTools/chrome-devtools-mcp/tree/chrome-devtools-mcp-v1.7.0
- 官方 release
  - https://github.com/ChromeDevTools/chrome-devtools-mcp/releases/tag/chrome-devtools-mcp-v1.7.0
- 官方已确认的 selected/前台页差异
  - https://github.com/ChromeDevTools/chrome-devtools-mcp/issues/933

OpenAI/Codex 文档只能作为产品交互参考，不得作为 Google MCP 工具、参数或行为的技术依据。
