# 插件/技能页对齐 Codex —— 改造约束清单

> 用途：这是一次「还原度优先，但逻辑不能错」的布局改造。
> 现有 **44+ 测试**锁定了行为与结构契约，本文件记录哪些能改、哪些不能动，
> 避免为了还原度悄悄破坏已承诺的行为。

## 一、绝对不可动的逻辑（红线）

| 领域 | 不可动的内容 | 原因 |
| --- | --- | --- |
| 市场筛选 | `filterMarketplaceEntries`、`latestMarketplaceEntries` | 被测试直接调用；同时决定范围筛选与能力搜索 |
| 安装风险 | `describePluginInstallRisk` 的 install / update / older / installed 四种模式 | 决定了权限/发布者变化提示与按钮文案 |
| 详情抽屉 | `pending` + `opener` 焦点回退、`trapPluginDialogFocus` | 键盘可达性契约（有独立测试） |
| 卸载 | `PluginUninstallChoices` 的 keep / clear 三分支 | 有独立测试断言三种选择 |
| MCP | 连接 / 重授权 / 重试 / 断开的 pending、failed、restricted 状态 | 有独立测试 |
| 自动更新 | `preferences.autoUpdate` 偏好与受管插件的可禁用不可卸载 | 有独立测试 |
| 数据源 | 官方源 URL、SHA 固定、清单解析路径 | 刚修好的同步链路 |

## 二、测试锁定的呈现契约（改布局必须满足）

### 技能页
- 描述文字**必须保持可见**（`审查项目代码` 在折叠态就能看到）
- 以下内容**必须只在展开后出现**：
  - `声明 1 个工具，仍受权限审批`
  - `references/checklist.md`
  - `已被高优先级同名项覆盖`
  - `Skill frontmatter 未闭合`
- 启用开关必须是 `role="switch"` + `aria-checked`，
  且带 `aria-label="禁用 <名称>"`

### 插件页
- 已安装行必须包含：名称、描述、版本号、权限中文标签、来源名称
- 启用态是标准开关语义（`role="switch"`）
- 非受管插件必须有可访问的**卸载**与**历史版本**入口
- 无效清单渲染为禁用的诊断行
- 市场卡片必须提供 `aria-label="查看 <名称> 详情"`
- 范围筛选按钮用 `aria-pressed`

## 三、Codex 与当前的布局差异（改造清单）

| 区块 | Codex | 当前 | 状态 |
| --- | --- | --- | --- |
| 市场列表 | 图标卡片 + 分组区块（热门/新品/分类） | ✅ 图标卡片 + 推荐/分类分组 | **已完成** |
| 市场卡片操作 | 右上角 `+` | ✅ 右上角 `+`（保留风险逻辑） | **已完成** |
| 图标容器 | 中性底、无装饰边框 | ✅ 中性底、无边框 | **已完成** |
| 已安装列表 | 紧凑图标网格（图标+名称） | 两列卡片（描述+徽章） | 待做 |
| 插件详情 | 独立页（hero + 技能 + 信息表） | 右侧抽屉 | 待做 |
| 技能页 | 已安装/市场分段 + 分组列表 | 两列卡片 | 待做 |
| 技能详情 | 弹窗（含内容预览） | 无独立详情 | 待做 |

## 四、分组数据的诚实边界

Codex 的「热门 / 新品推荐 / Small Business」是**运营分组**。
本项目数据里只有：

- `recommended: boolean`
- `categories: string[]`
- `sourceKind: 'official' | 'community' | 'github'`

因此分组**只用这些字段**（推荐 → 分类 → 其他），
**不虚构**热门排行、下载量或运营位。
`buildMarketGroups` 的 6 条测试固化了这个边界。

## 五、验证方式

- 单元/契约测试：`npm test`
- 真实窗口 + 截图：`npm run smoke:theme`
- 市场同步链路：`npm run smoke:market`
