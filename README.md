ASTRYVE（桌面智能体客户端）
ASTRYVE 是基于 Electron 的桌面 AI 智能体客户端，可接入 DeepSeek、Kimi 等模型，支持流式对话、项目编码、图片分析和文档问答，并通过 Chrome DevTools MCP 接入浏览器工具。
- 形态：Electron + TypeScript 桌面应用
- 技术栈：Electron（electron-vite）· React + TS · Tailwind CSS · Zustand · SQLite；旧版 MySQL 后端仍兼容
- 持久化：每个账号使用独立的本地 SQLite 数据库和附件目录；旧 JSON 会自动导入并保留原文件。旧共享 MySQL 会话表不含账号字段，暂不供已登录账号使用
运行
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

# 工作/对话隔离、目录失效与重启恢复（先 build）
npm run smoke:3a
# 使用已配置模型增加真实生成、并发和后台审批验收
npm run smoke:3a -- --real-model

# Windows 安装包
npm run build:win

# 启动已构建产物
npm start
账号认证
当前默认构建为 local：使用隔离的本地工作区，不显示登录、退出或账号绑定入口，也不创建伪造的远程会话。运行 npm run build:local 可显式构建该模式，`npm run smoke:auth:local` 验证无认证服务时仍能进入客户端。

需要认证服务器时运行 npm run build:remote，或在执行 dev / build:win 前把构建环境变量 AI_AGENT_AUTH_MODE 设为 remote。该模式被编译进主进程，缺少 AI_AGENT_AUTH_URL=https://你的登录域名 时保持锁定。Sign in 会在系统浏览器打开 Web 登录页；认证服务的部署步骤与变量见 [README.md](server/auth/README.md) 和 [.env.example](server/auth/.env.example)。本机联调可将认证服务设为 AUTH_PUBLIC_URL=http://127.0.0.1:8787、`AUTH_INSECURE_LOCAL_DEV=1`，客户端设 AI_AGENT_AUTH_URL=http://127.0.0.1:8787。生产环境只允许 HTTPS。

未配置短信服务或已审核的 QQ、微信网站应用时，对应登录方式显示不可用。远程认证可通过 npm run test:auth 和 npm run smoke:auth 验证。本地数据不会自动迁移到远程账号目录。
旧版对话数据库（MySQL，可选）
旧版对话存储默认连接 127.0.0.1:3306，库名 ai_agent，用户 root，空密码。可用环境变量覆盖：`MYSQL_HOST / MYSQL_PORT / MYSQL_USER / MYSQL_PASSWORD / MYSQL_DATABASE`。登录后不连接该共享库，认证服务另需自己的 MySQL 8 数据库。
说明：未连接 MySQL 时会使用本地 SQLite 持久化，重启后历史仍保留；本地模式连接到旧 MySQL 时继续使用旧库。

模型配置与会话
- 兼容 DeepSeek / Kimi（OpenAI 兼容） 的流式对话，真实回复（含思考态 + 流式文本展示）。
- 设置 → 模型设置：选择提供方（DeepSeek/Kimi/自定义）、填 Base URL / API Key / 模型名，保存并「测试连接」。
- 也支持环境变量（无需 UI）：`DEEPSEEK_API_KEY`、`MOONSHOT_API_KEY`、`MODEL_BASE_URL`、`MODEL`、`MODEL_PROVIDER`、`CONTEXT_MESSAGES`。
- 非敏感配置保存到 %APPDATA%\ai-agent\ai-agent-config.json，API Key 使用 Electron safeStorage 单独加密；未配置时自动回退本地演示（Mock）。
- 多轮记忆 + 上下文长度：每个会话独立保存历史，并按模型上下文预算自动裁剪；不同会话不会互相注入正文。
- 会话标题自动生成：首条消息自动给会话命名，侧栏即时更新。
- 接口信息可看：主进程控制台打印 [model] request/response/stream done（模型 / URL / HTTP 状态 / 耗时），不含 prompt 与响应内容。注意：请求是从主进程发起的，所以在渲染进程的 DevTools 网络面板里看不到，要看请求请去运行 npm run dev 的终端。
- 模型名称显示在输入框上方和状态栏。
设计稿与文档
文档	说明
[design-ref.png](docs/design-ref.png)	设计稿参考图（三栏 IDE 风，深色主题）
[01-开发边界与规范.md](docs/01-开发边界与规范.md)	项目范围、技术架构和工程规范
[2026-09-23-work-chat-information-architecture.md](docs/superpowers/specs/2026-09-23-work-chat-information-architecture.md)	工作与对话会话划分、项目归属及数据迁移设计
[09-Skills规范.md](docs/09-Skills规范.md)	第三方 Skill 格式、安装、触发、权限与审计
[10-DeepSeek-Skills调用适配.md](docs/10-DeepSeek-Skills调用适配.md)	DeepSeek system message、原生工具调用与思考轮次适配
[插件平台威胁模型](docs/20-P4插件平台威胁模型.md)	插件、市场、MCP、Hooks、隔离 UI 与 Browser Gateway 威胁模型
[Chrome DevTools MCP 接入设计](docs/22-M16-Google-Chrome-DevTools-MCP接入设计.md)	Google 官方 Chrome DevTools MCP 接入边界
[2026-09-22-explicit-chrome-context-design.md](docs/superpowers/specs/2026-09-22-explicit-chrome-context-design.md)	模型驱动能力调用、可信页面绑定和 Chrome 安全设计
[](docs/verification/)	测试记录与性能基线


桌面界面与会话管理
- 会话管理：新建、切换、搜索和删除会话，支持自动标题、按日期分组和历史分页。
- 消息展示：支持 Markdown、可复制的代码块、可折叠的思考过程、执行计划和文件列表。
- 界面设置：支持预设主题、自定义配色和拖拽调整侧栏宽度。Windows 标题栏随主题变化。
多模态与联网搜索
- 🖼️ 识图分析：粘贴 / 拖拽 / 选择图片 → 当前多模态模型流式分析；不自动切换备用模型，纯文本模型会在发送前给出独立提示
- 📄 文档 / 表格解析：PDF / Word(.docx) / Excel(.xlsx) / CSV 主进程提取文本注入上下文，模型总结 / 问答
- 🔎 联网搜索（本轮选择）：普通问答默认不联网；点击输入框「联网」后使用 Kimi $web_search、DeepSeek Responses API web_search 或自定义兼容端点的搜索能力，不兼容时提示并回退普通回答
- ✍️ 通用文本能力：系统提示升级为通用助手（总结 / 翻译 / 改写 / 解释 / 数据分析）
- 🎨 回复样式优化：markdown 完整渲染（表格 / 列表 / 引用 / 行内代码 / 链接 / 标题）、用户消息代码块带语言标签 + 复制、计划 / 文件块可折叠、流式动画
工作区与工具执行
- 📁 对话可绑定授权项目，并按项目选择「请求批准 / 帮我批准 / 只读」权限档位。
- 🛡️ 本机 Coding 执行必须由用户显式选择；仅开放固定程序白名单和结构化参数，禁止 shell 字符串。
- ⚙️ 命令在独立 Electron utility process 中运行；Windows 使用 Job Object 清理完整子进程树，支持停止、超时、输出限量和持久化审计。
- 🔎 模型可按需列出/搜索/分段读取授权项目文件，并查看受限 Git status、diff、log、show；敏感路径、链接、二进制和生成目录被过滤。
- 🐳 支持 Docker 沙箱与本机执行、结构化文本补丁、逐文件 diff，以及审批后的宿主文件写回。
- 🧩 Skills 支持应用私有安装、Codex/Agents 目录只读发现、本机 Skill Pack 导入、GitHub/精选市场安装，以及 /skill-name 本轮真实调用；安装内容不会自动执行，也不能扩大工具权限。
- 🔒 渲染进程启用 Chromium sandbox、context isolation 和严格 CSP。文件、命令、Docker、Git 和密钥操作通过 preload 白名单 IPC 请求主进程。
- 🧾 “设置 → 安全与数据”可清除本机脱敏审计记录；审计只保存受限元数据和目标哈希。
权限与 Docker 要求
- 只读模式：只允许安全读取；写入、命令和联网请求直接拒绝。
- 请求批准：写回、命令和联网等敏感操作逐次显示应用内审批。
- 帮我批准：仅对确定性的低风险操作按策略放行，高风险操作仍需批准；不存在“完全访问”。
- Docker 模式需要 Docker Desktop/Engine、Linux containers 和可用镜像。容器固定断网、非 root、只读根文件系统、移除 capabilities，不挂载 Docker socket，也不会静默降级到本机执行。
本地插件运行时
- 在“设置 → 插件”中导入本地文件夹或 ZIP；系统先在临时区检查路径、链接、大小和清单，再原子安装。
- 工具型插件需要在 plugin.json 的 tools 中声明 name、`description`、相对 entry、`operation` 和封闭的 parameters。插件权限必须覆盖其操作，例如读取文件需要 workspace.read。
- 对话中输入 @ 可用键盘选择插件；不显式选择时，模型可从新任务捕获的已启用插件中自主选择。插件变化不会改变正在运行的任务。
- 插件代码只在独立 Electron Utility Process 中运行，仍要经过现有 Tool Registry、项目权限和审批。Worker 有握手、心跳、超时、取消及 200KB 消息限制。
- 本地插件可在 plugin.json 声明 "icon": "assets/icon.png"；图标只允许包内 assets/ 下的 PNG、JPEG 或 WebP，主进程限制大小并验证文件内容后供页面显示。
- 其他静态图片可在 "assets": ["assets/banner.webp"] 中逐项声明；主应用 Renderer 仅能按插件 ID 读取已声明图片，不接受任意文件路径，也不加载插件 HTML、脚本或样式。
- 可选隔离界面声明为 "ui": "ui/index.html"。插件详情页可显式打开至独立沙箱窗口；HTML 必须自包含，窗口只暴露插件 ID/名称/版本和关闭方法，不提供主应用 IPC、Node、网络或本机文件访问。
- 连续三次启动或执行失败会自动隔离；可在插件列表查看原因并点击“恢复”。恢复只允许后续新任务重试，不会重放旧调用。
- 支持 DeepSeek、Kimi 和自定义 OpenAI 兼容端点的结构化工具调用。插件市场可浏览官方和社区来源、查看权限与兼容性，以及安装、更新和回滚。绑定并连接成功的 HTTPS MCP 工具会纳入任务的工具列表，并按调用审批。
常见故障排查
- Docker 显示不可用：先确认 Docker Desktop 已启动并处于 Linux containers，再到“设置 → Agent 设置”刷新镜像状态。
- 镜像缺失：在 Docker 外部明确安装所需镜像；应用不会自动构建项目 Dockerfile。
- 补丁提示基线变化：文件在任务期间被其他程序修改，重新读取文件并生成新补丁，不要覆盖现有改动。
- 页面修改后未刷新：确认文件操作已成功完成；右侧文件树会接收工作区变更事件，未保存的编辑标签不会被后台覆盖。
- MySQL 不可用：应用会使用本地 SQLite，重启后历史仍保留；如需连接旧 MySQL，请检查上方数据库配置。
