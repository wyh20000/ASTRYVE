# 09 · 第三方 Skills、技能市场与调用规范

> 适用版本：P3 M9。目标是兼容 Codex/Agent Skills 常见生态，让用户安装并通过 `/skill-name`
> 在真实模型对话中调用第三方 Skill。Skill 是不可信内容，不能扩大应用权限。

## 1. 兼容目录

```text
skill-name/
├─ SKILL.md                 # 必需：frontmatter + 指令正文
├─ agents/openai.yaml       # 可选：展示名称、短说明、隐式调用策略
├─ references/              # 可选：Markdown、文本、JSON、YAML 参考资料
├─ assets/                  # 可选：图片或模板
└─ scripts/                 # 可选：工具脚本；安装和加载时绝不执行
```

支持单个 Skill，也支持仓库内包含多个 `skills/**/SKILL.md` 的 Skill Pack。典型示例：

- `obra/superpowers`：一个仓库包含多个可组合 Skills。
- `mattpocock/skills` 的 `grill-me`：用户调用入口会依赖同仓库的 `grilling`。

## 2. 来源与优先级

从高到低：

1. 项目：`<workspace>/.agents/skills`、兼容旧目录 `<workspace>/.aiagent/skills`。
2. 应用安装：应用私有数据目录中的 `skills/`；GitHub 和本机导入均复制到这里。
3. Codex 只读发现：`~/.codex/skills`。
4. Agents 只读发现：`~/.agents/skills`。
5. 应用内置。

应用不会直接改写 Codex/Agents 的目录。重名时只激活最高优先级的有效项；禁用最高优先级项不会
偷偷启用同名低优先级项。来源、覆盖关系和错误会显示在技能中心。

## 3. 格式兼容

`SKILL.md` 必须包含 `name`、`description` 和非空正文。兼容并识别：

- `disable-model-invocation: true`：只能由用户通过 `/...` 或选择器显式调用。
- `tools`：可选。声明时只暴露交集工具；省略时沿用当前任务原有工具，但仍经过 Policy Engine。
- `resources`、`auto-trigger`：保留本应用扩展；未知 frontmatter 字段会忽略，不因厂商元数据而拒绝整个 Skill。
- `agents/openai.yaml` 的 `interface.display_name`、`interface.short_description`、
  `policy.allow_implicit_invocation`。

解析限制：名称 1–64 字符；说明最多 1024 字符；主说明最多 96KB；自动加载的文本参考资料最多
12 个、合计 192KB。单项错误与其他 Skills 隔离。

## 4. 技能市场与安装

技能中心分为“已安装”和“技能市场”：

- 推荐项包含 Superpowers 与 Grill Me。
- 市场通过 GitHub API 加载 OpenAI curated Skills；失败时仍保留内置推荐项。
- 支持搜索、从 GitHub 仓库/子目录安装、从本机目录导入、启用/禁用、显式更新和卸载。
- GitHub 安装解析分支后固定为 40 位提交 SHA，并保存仓库和原始安装地址。
- `/grill-me` 等薄包装 Skill 会在安装时一并寻找并安装同仓库依赖。
- 更新重新获取精确提交，但不会后台静默更新。

安装先进入应用安装目录内的临时目录，校验完成后再原子替换。限制 500 个文件、单文件 512KB、
总计 5MB；拒绝链接、越界路径和异常文件类型。卸载移动到应用私有 `.trash`，不会删除外部来源。

## 5. `/...` 真实调用

1. 用户在输入框键入 `/`，页面从当前已启用 Skill 中显示快捷指令菜单。
2. `/skill-name 用户任务` 只允许出现在消息开头，名称被主进程确定性解析。
3. 命令前缀从发送给模型的用户任务中移除；原始消息仍保留在会话记录中。
4. 主 Skill 及依赖被加入本轮系统上下文；时间线显示实际加载的名称、来源和版本。
5. 不存在、禁用、冲突失效或缺少依赖时，本轮直接报错，不作为普通聊天悄悄发送。
6. 显式 `/...` 高于自动触发。依赖最大深度 4、单轮最多加载 8 个，循环依赖会被拒绝。

Skill 提示要求模型明确显示“已启用”，但真正的生效证据以主进程时间线块和审计记录为准，不能只相信
模型自己声称使用了 Skill。

## 6. 模型厂商适配

Skills 不直接调用厂商私有“技能 API”，而是由应用把已验证的 Skill 指令组合进系统消息，并继续使用
厂商原生工具调用协议。DeepSeek 首版适配见 `docs/10-DeepSeek-Skills调用适配.md`。其他模型必须查阅
其官方文档后增加独立适配说明和回归测试，不能假设所有 OpenAI 兼容端点行为完全一致。

## 7. 权限与脚本

- Skill 不能添加 Tool Registry 中不存在的工具，也不能改变工作区、执行环境或权限档位。
- 工具调用仍进入 Task Runtime、Policy Engine 和原生批准流程。
- `scripts/` 可以随包安装，但安装、发现、预览、启用和加载均不能执行它。
- 只有当用户任务本身允许、Skill 明确指导、模型通过现有受控工具提出调用并通过策略/审批后，脚本才可能执行。
- Renderer 只接收脱敏元数据，不接收 Skill 正文、资源正文或真实磁盘路径。

## 8. 审计

每次任务记录 `skill.use`，每个自动注入的参考资料记录 `skill.resource`。记录 Skill ID、来源、版本、任务和
工作区身份，不记录正文、资源内容、用户提示或密钥。页面时间线同时显示本轮真实加载结果。
