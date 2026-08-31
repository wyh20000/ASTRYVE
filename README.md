# AI Agent（桌面智能体客户端）

类 Codex / DeepSeek-Harness 的桌面 AI 智能体客户端。目标：连接 DeepSeek / Kimi 等开放模型 API，在本地完成 **编码、识图、浏览器操控** 等任务。

- **形态**：Electron + TypeScript 桌面应用
- **当前阶段**：P1/P2 已完成；P3（安全执行内核 / Coding / Docker / Skills）已完成计划，准备实施
- **技术栈**：Electron（electron-vite）· React + TS · Tailwind CSS · Zustand · **mysql2（MySQL）**
- **持久化**：优先连接本机 MySQL（自动建库建表）；连不上则**自动回退内存存储**，应用不崩溃

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

# 启动已构建产物
npm start
```

### 数据库（MySQL，可选）
默认连接 `127.0.0.1:3306`，库名 `ai_agent`，用户 `root`，空密码。可用环境变量覆盖：`MYSQL_HOST / MYSQL_PORT / MYSQL_USER / MYSQL_PASSWORD / MYSQL_DATABASE`。

> 说明：本仓库开发环境没有可连接的 MySQL（3306 关闭），所以默认用内存存储跑通全流程；在你本机启动 MySQL 后即自动用 MySQL 持久化。

## 模型接入与联调（已实现）

- 兼容 **DeepSeek / Kimi（OpenAI 兼容）** 的**流式对话**，真实回复（含思考态 + 流式文本展示）。
- **设置 → 模型设置**：选择提供方（DeepSeek/Kimi/自定义）、填 Base URL / API Key / 模型名，保存并「测试连接」。
- 也支持环境变量（无需 UI）：`DEEPSEEK_API_KEY`、`MOONSHOT_API_KEY`、`MODEL_BASE_URL`、`MODEL`、`MODEL_PROVIDER`、`CONTEXT_MESSAGES`。
- 非敏感配置保存到 `%APPDATA%\ai-agent\ai-agent-config.json`，API Key 使用 Electron `safeStorage` 单独加密；**未配置时自动回退本地演示（Mock）**。
- **多轮记忆 + 上下文长度**：按会话历史发送最近 N 条消息（默认 20，可在模型设置中调整）。
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

## P1 范围外（后续阶段）

- 真实文件系统 / 编辑器 / 终端执行 / 通用工具编排 → P3
- 浏览器操控 / 集成发布 → P4

> 新增能力请**先改文档（《01》《02》）再动代码**，严格遵循边界，避免范围蔓延。
