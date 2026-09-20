# AI Agent（桌面智能体客户端）

类 Codex / DeepSeek-Harness 的桌面 AI 智能体客户端。目标：连接 DeepSeek / Kimi 等开放模型 API，在本地完成 **编码、识图、浏览器操控** 等任务。

- **形态**：Electron + TypeScript 桌面应用
- **当前阶段**：P1/P2/P3 已完成；P4 M12 已完成，M13 插件运行时代码与自动化验证已完成、待人工验收；M14 市场、生命周期、MCP 和 Hooks 已实现，待资源/UI 安全项及真实环境总验收
- **技术栈**：Electron（electron-vite）· React + TS · Tailwind CSS · Zustand · **mysql2（MySQL）**
- **持久化**：认证后的账号使用各自目录内的本地 JSON 存储；旧共享 MySQL 会话表不含账号字段，暂不供已登录账号使用

## 运行

```bash
# 安装依赖（mysql2 为纯 JS，无需编译工具链）
npm install

# 开发（三端 HMR）
npm run dev

# 类型检查 & 构建
npm run typecheck
npm run build

# 单元测试（Vitest）
npm test

# 真实执行后端冒烟测试（需要本机运行环境 / Docker Desktop）
npm run smoke:local
npm run smoke:docker

# Windows 安装包
npm run build:win

# 启动已构建产物
npm start
```

### 账号认证（开发中）

首次启动显示 Three.js 锁定页。桌面端设置 `AI_AGENT_AUTH_URL=https://你的登录域名`，Sign in 会在系统浏览器打开 Web 登录页；认证服务的部署步骤与变量见 [server/auth/README.md](server/auth/README.md) 和 [server/auth/.env.example](server/auth/.env.example)。本机联调可将认证服务设为 `AUTH_PUBLIC_URL=http://127.0.0.1:8787`、`AUTH_INSECURE_LOCAL_DEV=1`，客户端设 `AI_AGENT_AUTH_URL=http://127.0.0.1:8787`。生产环境只允许 HTTPS。

未配置真实短信或已审核的 QQ、微信网站应用时，对应登录方式显示不可用。开发核验可运行 `npm run test:auth`、`npm run smoke:auth`；正式联调和发布条件见 [账号认证实施任务拆解](docs/19-账号认证实施任务拆解.md)。

### 旧版对话数据库（MySQL，可选）
旧版对话存储默认连接 `127.0.0.1:3306`，库名 `ai_agent`，用户 `root`，空密码。可用环境变量覆盖：`MYSQL_HOST / MYSQL_PORT / MYSQL_USER / MYSQL_PASSWORD / MYSQL_DATABASE`。登录后不连接该共享库，认证服务另需自己的 MySQL 8 数据库。

> 说明：本仓库开发环境没有可连接的 MySQL（3306 关闭），所以默认用内存存储跑通全流程；在你本机启动 MySQL 后即自动用 MySQL 持久化。

## 模型接入与联调（已实现）

- 兼容 **DeepSeek / Kimi（OpenAI 兼容）** 的**流式对话**，真实回复（含思考态 + 流式文本展示）。
- **设置 → 模型设置**：选择提供方（DeepSeek/Kimi/自定义）、填 Base URL / API Key / 模型名，保存并「测试连接」。
- 也支持环境变量（无需 UI）：`DEEPSEEK_API_KEY`、`MOONSHOT_API_KEY`、`MODEL_BASE_URL`、`MODEL`、`MODEL_PROVIDER`、`CONTEXT_MESSAGES`。
- 非敏感配置保存到 `%APPDATA%\ai-agent\ai-agent-config.json`，API Key 使用 Electron `safeStorage` 单独加密；**未配置时自动回退本地演示（Mock）**。
- **多轮记忆 + 上下文长度**：每个会话独立保存历史，并按模型上下文预算自动裁剪；不同会话不会互相注入正文。
- **会话标题自动生成**：首条消息自动给会话命名，侧栏即时更新。
- **接口信息可看**：主进程控制台打印 `[model] request/response/stream done`（模型 / URL / HTTP 状态 / 耗时），**不含 prompt 与响应内容**。注意：请求是从**主进程**发起的，所以在渲染进程的 DevTools 网络面板里看不到，要看请求请去运行 `npm run dev` 的终端。
- 侧栏底部冗余的「AI 模型/上下文/项目目录」已移除；**配置的模型名**显示在输入框上方与状态栏。

## 设计稿与文档

| 文档 | 说明 |
| --- | --- |
| [docs/design-ref.png](docs/design-ref.png) | 设计稿参考图（三栏 IDE 风，深色主题） |
| [docs/01-开发边界与规范.md](docs/01-开发边界与规范.md) | 整体范围 / 技术架构 / 工程规范 / 阶段路线 |
| [docs/02-第一阶段计划.md](docs/02-第一阶段计划.md) | P1 执行计划（目标、里程碑、任务拆解、验收） |
| [docs/03-设计稿还原分析.md](docs/03-设计稿还原分析.md) | 设计稿逐组件拆解与还原要点 |
| [docs/04-第二阶段计划.md](docs/04-第二阶段计划.md) | P2 范围、实现与验收标准 |
| [docs/05-二阶段未完成项.md](docs/05-二阶段未完成项.md) | P2 收口结果与外部联调项 |
| [docs/06-安全加固与沙盒设计.md](docs/06-安全加固与沙盒设计.md) | P2 后安全加固与 renderer sandbox 设计 |
| [docs/07-第三阶段计划.md](docs/07-第三阶段计划.md) | P3 Agent 执行内核、Coding、权限、Docker 与 Skills 计划 |
| [docs/09-Skills规范.md](docs/09-Skills规范.md) | M9 第三方 Skill 格式、来源、安装、触发、权限与审计规范 |
| [docs/10-DeepSeek-Skills调用适配.md](docs/10-DeepSeek-Skills调用适配.md) | DeepSeek system message、原生工具调用与思考轮次适配 |
| [docs/08-第四阶段计划.md](docs/08-第四阶段计划.md) | P4 插件运行时、市场与浏览器能力计划 |
| [docs/verification/M13-插件运行时页面验证测试单.md](docs/verification/M13-插件运行时页面验证测试单.md) | M13 本地插件运行时人工验收清单 |
| [docs/verification/M9-页面验证测试单.md](docs/verification/M9-页面验证测试单.md) | M9 可由非开发人员执行的页面与安全验收清单 |
| [docs/verification/M10-页面验证测试单.md](docs/verification/M10-页面验证测试单.md) | M10 Renderer Sandbox 与整体加固页面验收清单 |
| [docs/verification/M11-P3最终页面验证测试单.md](docs/verification/M11-P3最终页面验证测试单.md) | M11 / P3 最终端到端验收清单 |

## P1 已实现（M0–M6）

- ⚙️ M0 脚手架：electron-vite + React + TS + Tailwind + Zustand + 三端分层 + typed IPC（已通过 typecheck / build / 启动验证）
- 🧱 M1 布局骨架：左栏 + 对话主区 + 全局状态栏（右侧工作区 P1 已移除）；顶部自定义标题栏随主题变色（Windows）
- 📁 M2 侧栏：新对话、会话列表（今天/昨天/更早分组 + 选中态）、底部用户栏（含设置）
- 💬 M3 会话系统：新建/切换/搜索/删除/自动标题、本地持久化（MySQL/内存）
- 🗨️ M4 对话主区：消息渲染（用户/助手/思考过程可折叠/分段落 markdown/代码块含**语言标签+复制**/执行计划/创建文件列表）、输入框、滚动跟随
- 🎨 设置页（独立页面）：侧栏 ⚙️ 打开；左侧导航「主题设置 / 模型设置」。主题为**预设整体搭配（背景+文字+强调色）**，并支持**自定义背景色 / 文字颜色 / 强调色**（#xxxxxx，各自独立，提交时生效）
- ↔️ 侧栏拖拽：侧栏与内容区之间拖拽柄可加宽/变窄（180～400px），宽度持久化到 localStorage
- 🎬 M6 Mock 与打磨：Mock 流式回复（思考→计划→文件→文本）、⌘K/⌘N 快捷键、空/加载态

## P2 已实现（能力 + 样式）

- 🖼️ **识图分析**：粘贴 / 拖拽 / 选择图片 → 当前多模态模型流式分析；不自动切换备用模型，纯文本模型会在发送前给出独立提示
- 📄 **文档 / 表格解析**：PDF / Word(.docx) / Excel(.xlsx) / CSV 主进程提取文本注入上下文，模型总结 / 问答
- 🔎 **联网搜索（可选）**：Kimi `$web_search` 与 DeepSeek Responses API `web_search`；自定义 OpenAI 兼容端点隐藏入口
- ✍️ **通用文本能力**：系统提示升级为通用助手（总结 / 翻译 / 改写 / 解释 / 数据分析）
- 🎨 **回复样式优化**：markdown 完整渲染（表格 / 列表 / 引用 / 行内代码 / 链接 / 标题）、用户消息代码块带语言标签 + 复制、计划 / 文件块可折叠、流式动画

## P3 当前可用

- 📁 对话可绑定授权项目，并按项目选择「请求批准 / 帮我批准 / 只读」权限档位。
- 🛡️ 本机 Coding 执行必须由用户显式选择；仅开放固定程序白名单和结构化参数，禁止 shell 字符串。
- ⚙️ 命令在独立 Electron utility process 中运行；Windows 使用 Job Object 清理完整子进程树，支持停止、超时、输出限量和持久化审计。
- 🔎 模型可按需列出/搜索/分段读取授权项目文件，并查看受限 Git status、diff、log、show；敏感路径、链接、二进制和生成目录被过滤。
- 🐳 Docker 断网沙箱、本机执行、结构化文本补丁、逐文件 diff 和经精确审批的宿主安全写回已开放。
- 🧩 Skills 支持应用私有安装、Codex/Agents 目录只读发现、本机 Skill Pack 导入、GitHub/精选市场安装，以及 `/skill-name` 本轮真实调用；安装内容不会自动执行，也不能扩大工具权限。
- 🔒 renderer 已启用 Chromium sandbox、context isolation 与严格 CSP；文件、命令、Docker、Git 和密钥能力仅能通过 preload 白名单 IPC 请求主进程。
- 🧾 “设置 → 安全与数据”可清除本机脱敏审计记录；审计只保存受限元数据和目标哈希。

## 权限与 Docker 要求

- `只读模式`：只允许安全读取；写入、命令和联网请求直接拒绝。
- `请求批准`：写回、命令和联网等敏感操作逐次显示应用内审批。
- `帮我批准`：仅对确定性的低风险操作按策略放行，高风险操作仍需批准；不存在“完全访问”。
- Docker 模式需要 Docker Desktop/Engine、Linux containers 和可用镜像。容器固定断网、非 root、只读根文件系统、移除 capabilities，不挂载 Docker socket，也不会静默降级到本机执行。

## 本地插件运行时（M13）

- 在“设置 → 插件”中导入本地文件夹或 ZIP；系统先在临时区检查路径、链接、大小和清单，再原子安装。
- 工具型插件需要在 `plugin.json` 的 `tools` 中声明 `name`、`description`、相对 `entry`、`operation` 和封闭的 `parameters`。插件权限必须覆盖其操作，例如读取文件需要 `workspace.read`。
- 对话中输入 `@` 可用键盘选择插件；不显式选择时，模型可从新任务捕获的已启用插件中自主选择。插件变化不会改变正在运行的任务。
- 插件代码只在独立 Electron Utility Process 中运行，仍要经过现有 Tool Registry、项目权限和审批。Worker 有握手、心跳、超时、取消及 200KB 消息限制。
- 本地插件可在 `plugin.json` 声明 `"icon": "assets/icon.png"`；图标只允许包内 `assets/` 下的 PNG、JPEG 或 WebP，主进程限制大小并验证文件内容后供页面显示。
- 其他静态图片可在 `"assets": ["assets/banner.webp"]` 中逐项声明；主应用 Renderer 仅能按插件 ID 读取已声明图片，不接受任意文件路径，也不加载插件 HTML、脚本或样式。
- 可选隔离界面声明为 `"ui": "ui/index.html"`。插件详情页可显式打开至独立沙箱窗口；HTML 必须自包含，窗口只暴露插件 ID/名称/版本和关闭方法，不提供主应用 IPC、Node、网络或本机文件访问。
- 连续三次启动或执行失败会自动隔离；可在插件列表查看原因并点击“恢复”。恢复只允许后续新任务重试，不会重放旧调用。
- 当前支持 DeepSeek、Kimi 和自定义 OpenAI 兼容端点的结构化工具调用链。插件市场可浏览官方/社区来源、查看权限与兼容性并完成安装、更新和回滚；已显式绑定且连接成功的 HTTPS MCP 工具也会进入任务快照并逐次审批。连接管理界面、原生 OpenAI Responses 与 Gemini 属于后续里程碑。

## 常见故障排查

- Docker 显示不可用：先确认 Docker Desktop 已启动并处于 Linux containers，再到“设置 → Agent 设置”刷新镜像状态。
- 镜像缺失：在 Docker 外部明确安装所需镜像；应用不会自动构建项目 Dockerfile。
- 补丁提示基线变化：文件在任务期间被其他程序修改，重新读取文件并生成新补丁，不要覆盖现有改动。
- 页面修改后未刷新：确认文件操作已成功完成；右侧文件树会接收工作区变更事件，未保存的编辑标签不会被后台覆盖。
- MySQL 不可用：应用会回退内存存储，重启后历史不会保留；需要持久化时检查上方数据库配置。

## 后续阶段

- 插件静态资源白名单与隔离 UI → P4 后续批次；Chrome 扩展在独立项目开发，完成后通过当前仓库保留的中立协议接入

> 新增能力请**先改文档（《01》《02》）再动代码**，严格遵循边界，避免范围蔓延。
