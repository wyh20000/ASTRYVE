# M16 Google Chrome DevTools MCP 接入设计

## 决策

M16 使用 Google Chrome 团队维护的官方 `chrome-devtools-mcp`，不再继续开发自有 Chrome
扩展、Native Messaging Host 或私有浏览器协议。生产依赖精确固定为 `1.7.0`；升级前必须
重新核对官方配置、工具 schema、结构化输出、Chrome 版本要求并完成回归，不能直接改为
`latest`。

官方依据：

- [Chrome DevTools MCP 入门](https://developer.chrome.com/docs/devtools/agents/get-started)
- [配置参考](https://developer.chrome.com/docs/devtools/agents/get-started/configuration)
- [自动连接现有 Chrome](https://developer.chrome.com/docs/devtools/agents/use-cases/auto-connect)
- [官方工具参考](https://github.com/ChromeDevTools/chrome-devtools-mcp/blob/main/docs/tool-reference.md)
- [官方高级用法](https://github.com/ChromeDevTools/chrome-devtools-mcp/blob/main/docs/advanced-usage.md)

## 固定架构

调用链只有一条：模型或已授权插件 → Tool Registry → 权限与审批 → Browser Gateway →
受信 `ChromeDevtoolsMcpAdapter` → Google 官方 MCP stdio 服务 → 用户现有 Chrome。

原始 MCP 工具、stdio 进程、page ID 和官方 UID 不直接注册给模型或普通插件。Gateway
继续负责网站名单、HTTP(S) 限制、标签页页面版本、过期元素引用、并发、超时、取消、
敏感字段、高风险确认、结果限额和审计。

## 官方启动配置

仅使用固定版本官方帮助与配置文档声明的参数：

- `--auto-connect`：连接 Chrome 144+ 中由用户在 `chrome://inspect/#remote-debugging`
  开启的远程调试服务；用户仍需在 Chrome 官方提示中批准连接。
- `--experimental-page-id-routing=true`：官方 1.7.0 提供的 page ID 路由，用于并发安全地
  把 Gateway 标签页绑定到每个页面级工具。
- `--experimental-structured-content=true`：读取官方结构化 pages、snapshot、console 和
  network 输出；由于官方将其标为实验配置，版本不得漂移。
- `--no-usage-statistics`、`--no-performance-crux`：关闭非必要遥测与 CrUX 请求。
- `--redact-network-headers`：要求官方服务先脱敏敏感网络头。
- `--category-emulation=false`、`--category-performance=false`：不公开当前产品未使用类别。
- `--screenshot-max-width=1600`、`--screenshot-max-height=1200`：限制截图尺寸。

应用直接执行已安装包的官方入口，不使用 `npx`、不在运行时下载代码。Electron 打包时将
该依赖解包，并用 `ELECTRON_RUN_AS_NODE=1` 启动。模型识别到明确浏览器意图后进入受限浏览器
Agent，第一次浏览器工具调用时按需启动官方进程；不需要在设置页手动开启。连接失败或官方请求
超时不会缓存旧会话，下一次调用会重新连接，但宿主不自动重放可能已经成功的写操作。连接租约
只覆盖当前回复，回复完成、失败或取消后自动关闭 MCP 客户端和子进程；应用退出也执行清理。

## 工具映射

适配层仅允许以下固定版本官方工具：

- 标签页：`list_pages`、`new_page`、`select_page`、`close_page`、`navigate_page`。
- 页面读取：`take_snapshot`、`evaluate_script`。
- 交互：`click`、`hover`、`fill`、`press_key`、`drag`。
- 媒体与诊断：`take_screenshot`、`list_console_messages`、`list_network_requests`。

每个页面级调用都传官方 schema 声明的 `pageId`。元素只从最新 `take_snapshot` 的官方
`uid` 产生，经过 Gateway 转换为不透明引用；导航后引用失效。`evaluate_script` 只执行
宿主内置、固定用途函数，模型不能提交任意脚本。

官方稳定快照不提供 CSS 选择器或 DOM tag 到 UID 的可靠映射，因此现阶段 `css` 和
`tag` 定位必须明确失败；不得猜测 UID、解析私有 CDP 字段或新增非官方工具。所有调用参数
在发送前与服务器启动时返回的官方 input schema 对照，出现未知字段或缺少必填字段即拒绝。

## 用户与安全边界

- 默认网站策略仍为拒绝；blocked list 优先于 allow-all 和 allowed list。
- 列页不会自动授权页面内容。检查、定位、交互、截图和诊断必须携带当前 URL，并由
  Gateway 再次核对实际标签页 origin。
- 密码、验证码、令牌、支付字段和疑似凭据不得由模型填写；网页内容始终视为不可信。
- 高风险按钮仍通过宿主 `browser.confirmClick` 单次审批，官方 MCP 不能绕过。
- 网络诊断仅消费官方已脱敏结构化输出，审计不保存页面正文、截图、Cookie 或参数明文。
- 截图原始 Base64 不进入模型工具结果；宿主将受限 JPEG 转为助手消息附件并随会话保存，界面
  提供预览及缩放。审计仍不持久化截图内容。
- 返回模型的标签页和检查 URL 会移除用户名、密码、查询参数与片段，避免临时令牌泄漏。
- Chrome 未开启远程调试、用户拒绝连接、官方工具缺失或 schema 漂移时，浏览器能力保持
  不可用，不回退到自研协议或非官方实现。

## 验收门槛

自动化必须覆盖官方工具名和参数映射、结构化输出校验、UID 引用、未知参数失败、网站
拒绝、敏感输入、高风险审批、取消、超时和结果限额。人工验收必须使用真实 Chrome 144+
完成启用、官方确认、列页、导航、快照、交互、截图、诊断、拒绝连接、Chrome 重启和应用
退出清理。自动化与真实 Chrome 验收均完成前，M16 不标记最终完成。

2026-09-21 自动化记录：系统 Node 与 Electron Node 模式均成功启动固定版本官方进程并
完成 MCP stdio 握手，各发现 24 个工具；桌面全量 144 个测试文件、1090 项测试、类型
检查、生产构建和 npm 生产依赖审计通过（0 漏洞）。

同日补充验证：Windows 解包产物中的官方包位于 `app.asar.unpacked`，已由打包后的
`ASTRYVE.exe` 以 Node 模式启动并完成 24 工具握手。Chrome `153.0.8010.50` 已完成真实
`list_pages`、新建页面、快照 UID、填写、点击、脚本、截图、控制台、网络、刷新、切换和
关闭页面闭环；仅操作 `127.0.0.1` 临时测试页。适配层在连接失败时返回
`chrome://inspect/#remote-debugging` 操作引导，在官方结构化结果报告重连时清空旧 UID、
要求重新获取标签页；关闭当前选中页前先用官方 `select_page` 选择其他页面，最后一页按
官方 `close_page` 约束拒绝关闭。

2026-09-22 交互修正：普通对话可自动触发浏览器工具；设置页只保留网站允许/阻止策略与官方
启用说明，不再提供冗余的连接开关。打开 URL 前先按规范化地址复用现有标签页，避免模型因等待
加载而重复 `new_page`；等待期间仅调用官方 `evaluate_script` 读取 `document.readyState`、标题和
当前 URL，稳定后再执行一次快照检查。官方 `--auto-connect` 的 Chrome 144+、远程调试开关和
Chrome 原生批准弹窗仍是必要前提，不由宿主绕过。

真实官方快照允许语义节点缺少 `role` 或 `name`；Gateway 必须省略这些缺失键，不能把
JavaScript `undefined` 送入严格 JSON 工具结果。截图前使用固定宿主脚本检查文档、图片、字体、
资源数和页面高度，在连续稳定后才调用官方 `take_screenshot`；图片块按工具完成时刻写入消息时间线，
只通过附件 ID 引用已持久化 JPEG，并支持独立折叠。本轮变更通过 145 个测试文件、
1111 项测试、Node/Web 类型检查与生产构建；真实 Chrome
连续调用仍按验证测试单等待用户在官方批准弹窗前完成回归。
