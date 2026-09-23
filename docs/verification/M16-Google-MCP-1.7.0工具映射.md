# Google Chrome DevTools MCP 1.7.0 契约核验

核验日期：2026-09-23。运行了锁定在 `package-lock.json` 的官方 npm 包，经本项目的 stdio 启动参数执行真实 `tools/list`；没有依赖 GitHub `main` 分支推断 1.7.0 的 schema。本次只核验工具目录，未把“可以列出工具”当成真实浏览器连续调用验收。

- 包：`chrome-devtools-mcp@1.7.0`
- npm 完整性：`sha512-6xFW7oiUxTxZuHcfyYBkKQtmttjCbfifKZMSEk5CV8H2FucvKweYiJr8CblddYHtYjA4C14K9VAs1r49906RBA==`
- [官方 1.7.0 发布记录](https://github.com/ChromeDevTools/chrome-devtools-mcp/releases/tag/chrome-devtools-mcp-v1.7.0)：发布提交 `774d78f`
- [固定版本源码](https://github.com/ChromeDevTools/chrome-devtools-mcp/tree/chrome-devtools-mcp-v1.7.0)
- 自动回归：`chromeDevtoolsMcpContract.test.ts` 每次从实际安装包执行 `tools/list`，检查 ASTRYVE 使用的 15 个工具、必填参数和参数类型；客户端连接时也运行相同检查，漂移即拒绝启动。

## 真实 `tools/list` 摘要

按当前启动参数返回 24 个工具。以下是官方返回的必填参数；“无”表示没有必填参数，并不表示没有可选参数。

| 工具 | 必填参数 |
| --- | --- |
| `click` | `pageId`, `uid` |
| `close_page` | `pageId` |
| `drag` | `pageId`, `from_uid`, `to_uid` |
| `evaluate_script` | `pageId`, `function` |
| `fill` | `pageId`, `uid`, `value` |
| `fill_form` | `pageId`, `elements` |
| `get_console_message` | `pageId`, `msgid` |
| `get_network_request` | `pageId` |
| `handle_dialog` | `pageId`, `action` |
| `hover` | `pageId`, `uid` |
| `lighthouse_audit` | `pageId` |
| `list_console_messages` | `pageId` |
| `list_network_requests` | `pageId` |
| `list_pages` | 无 |
| `navigate_page` | `pageId` |
| `new_page` | `url` |
| `press_key` | `pageId`, `key` |
| `select_page` | `pageId` |
| `take_heapsnapshot` | `pageId`, `filePath` |
| `take_screenshot` | `pageId` |
| `take_snapshot` | `pageId` |
| `type_text` | `pageId`, `text` |
| `upload_file` | `pageId`, `uid`, `filePath` |
| `wait_for` | `pageId`, `text` |

`pageId` 在这个版本的 schema 中是 `number`。本项目适配器只允许上表中的 15 个已审查工具；其他 9 个虽由官方提供，但目前不向模型开放，也不能从受信客户端白名单调用。

## ASTRYVE 到官方工具的映射

| 宿主能力 | 官方工具与关键参数 | 返回转换 / 宿主策略 |
| --- | --- | --- |
| 标签页列表、新建、选择、关闭 | `list_pages`、`new_page(url, background)`、`select_page(pageId, bringToFront)`、`close_page(pageId)` | 从 `structuredContent.pages` 读取 ID、URL、标题和 MCP 的 `selected`；它不等于操作系统前台页。关闭前检查最后一页与替代选择。 |
| 前进、后退、刷新、跳转 | `navigate_page(pageId, type, url?)` | 导航后清除元素 UID 缓存。 |
| 页面检查与查找 | `evaluate_script(pageId, function)`、`take_snapshot(pageId, verbose)` | 页面文本来自官方脚本执行；元素来自官方快照 UID，不伪造 CSS 到 UID 映射。 |
| 点击、悬停、填写、按键、拖拽 | `click(pageId, uid, dblClick?)`、`hover(pageId, uid)`、`fill(pageId, uid, value)`、`press_key(pageId, key)`、`drag(pageId, from_uid, to_uid)` | 高风险操作仍由宿主授权；模型不能提交受信 `pageId` 或绕过 UID 有效性检查。 |
| 截图 | `take_screenshot(pageId, format, quality, fullPage, uid?)` | 只接受官方 inline `image` 内容；页面稳定等待、大小上限与聊天证据持久化属于宿主策略。 |
| 诊断 | `list_console_messages(pageId, pageSize, types)`、`list_network_requests(pageId, pageSize)`、`evaluate_script(pageId, function)` | 限量读取，转换为受限诊断摘要。 |

## 尚未完成的核验

这个文件是 `tools/list` 摘要和当前已使用参数的契约记录，不是完整 JSON schema fixture。计划中的完整 schema fixture、所有返回 content 类型的失败测试、真实 Chrome 连续调用/重连/截图验收仍待完成。尤其不能凭 `selected` 判断用户眼前的活动标签页。
