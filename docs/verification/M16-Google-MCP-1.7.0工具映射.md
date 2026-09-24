# Google Chrome DevTools MCP 1.7.0 契约核验

核验日期：2026-09-23。运行了锁定在 `package-lock.json` 的官方 npm 包，经本项目的 stdio 启动参数执行真实 `tools/list`；没有依赖 GitHub `main` 分支推断 1.7.0 的 schema。本次只核验工具目录，未把“可以列出工具”当成真实浏览器连续调用验收。

- 包：`chrome-devtools-mcp@1.7.0`
- npm 完整性：`sha512-6xFW7oiUxTxZuHcfyYBkKQtmttjCbfifKZMSEk5CV8H2FucvKweYiJr8CblddYHtYjA4C14K9VAs1r49906RBA==`
- [官方 1.7.0 发布记录](https://github.com/ChromeDevTools/chrome-devtools-mcp/releases/tag/chrome-devtools-mcp-v1.7.0)：发布提交 `774d78f`
- [固定版本源码](https://github.com/ChromeDevTools/chrome-devtools-mcp/tree/chrome-devtools-mcp-v1.7.0)
- 完整 schema fixture：`src/main/services/browser/fixtures/chrome-devtools-mcp-1.7.0-tools.json`，包含当前启动参数返回的全部 24 个工具的原始 `inputSchema`。`chromeDevtoolsMcpContract.test.ts` 每次从实际安装包执行 `tools/list` 并与 fixture 比较；客户端连接时检查 ASTRYVE 使用的 15 个工具、必填参数和关键参数类型，漂移即拒绝启动。

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

`--experimental-page-id-routing=true` 是锁定包 `build/src/bin/chrome-devtools-mcp-cli-options.js` 中的 `experimentalPageIdRouting` 布尔 CLI 选项；上述真实 `tools/list` 返回的各页面工具因此含有数字 `pageId`。这是版本内代码及实际 schema 的双重核验，不是从 `main` 分支猜测。

## ASTRYVE 到官方工具的映射

| 宿主能力 | 官方工具与关键参数 | 返回转换 / 宿主策略 |
| --- | --- | --- |
| 标签页列表、新建、选择、关闭 | `list_pages`、`new_page(url, background)`、`select_page(pageId, bringToFront)`、`close_page(pageId)` | 从 `structuredContent.pages` 读取 ID、URL、标题和 MCP 的 `selected`；它不等于操作系统前台页。关闭前检查最后一页与替代选择。 |
| 前进、后退、刷新、跳转 | `navigate_page(pageId, type, url?)` | 导航后清除元素 UID 缓存。 |
| 页面检查与查找 | `evaluate_script(pageId, function)`、`take_snapshot(pageId, verbose)` | 页面文本来自官方脚本执行；元素来自官方快照 UID，不伪造 CSS 到 UID 映射。 |
| 点击、悬停、填写、按键、拖拽 | `click(pageId, uid, dblClick?)`、`hover(pageId, uid)`、`fill(pageId, uid, value)`、`press_key(pageId, key)`、`drag(pageId, from_uid, to_uid)` | 高风险操作仍由宿主授权；模型不能提交受信 `pageId` 或绕过 UID 有效性检查。 |
| 截图 | `take_screenshot(pageId, format, quality, fullPage, uid?)` | 只接受官方 inline `image` 内容；页面稳定等待、大小上限与聊天证据持久化属于宿主策略。 |
| 诊断 | `list_console_messages(pageId, pageSize, types)`、`list_network_requests(pageId, pageSize)`、`evaluate_script(pageId, function)` | 限量读取，转换为受限诊断摘要。 |

当前 `browser.*` 名称逐项对应如下。`tabId`/`elementId` 是 ASTRYVE 的宿主引用；适配器只在通过 Gateway 校验后把它们转成官方数字 `pageId`/快照 `uid`。页面内容、错误、截图和审批都不能反向改变该映射。此表记录当前实现，不表示这些旧工具在新激活架构下都会继续暴露。

| 宿主工具 | 官方调用 | 宿主附加策略 / 返回 |
| --- | --- | --- |
| `browser.listTabs` | `list_pages()` | `structuredContent.pages` → 有界标签页 DTO。 |
| `browser.openTab` | `list_pages()`、`new_page(url, background:false)`、`evaluate_script(pageId,function)` | 复用 URL，创建后等待；等待失败仍返回已创建 ID，不重复打开。 |
| `browser.closeTab` | `list_pages()`、可选 `select_page(pageId,bringToFront:false)`、`close_page(pageId)` | 禁止关闭最后一页，清理 UID。 |
| `browser.selectTab` | `select_page(pageId,bringToFront:true)` | 更新 Gateway 选择，不等同于证明 OS 前台页。 |
| `browser.navigate` | `navigate_page(pageId,type:'url',url)` | HTTP(S) 与站点策略检查，清理 UID。 |
| `browser.history` | `navigate_page(pageId,type:'back'/'forward')` | 清理 UID。 |
| `browser.reload` | `navigate_page(pageId,type:'reload')` | 清理 UID。 |
| `browser.waitForPage` | `evaluate_script(pageId,function)`、后续 `take_snapshot(pageId,verbose:false)` | 宿主限时采样与检查摘要；已知文本的官方 `wait_for` 尚待 Task 9 接入。 |
| `browser.inspect` | `evaluate_script(pageId,function)`、`take_snapshot(pageId,verbose:false)` | 清洗限长文本、标题、URL 和轮廓。 |
| `browser.find` | `take_snapshot(pageId,verbose:false)` | 快照 UID → 版本化元素引用；CSS/tag 不映射。 |
| `browser.click` | `click(pageId,uid)` | 引用、origin 和审批校验后执行。 |
| `browser.confirmClick` | `click(pageId,uid)` | 同一官方工具，但宿主要求高风险逐次审批。 |
| `browser.doubleClick` | `click(pageId,uid,dblClick:true)` | 引用、origin 和审批校验。 |
| `browser.hover` | `hover(pageId,uid)` | 引用与 origin 校验。 |
| `browser.scroll` | `evaluate_script(pageId,function)` | 有界滚动值；属于宿主策略，不是另一个官方滚动工具。 |
| `browser.type` | `fill(pageId,uid,value)` | 敏感字段与审批策略在宿主。 |
| `browser.key` | `press_key(pageId,key)` | 引用、origin 和审批校验。 |
| `browser.select` | `fill(pageId,uid,value)` | 当前适配器映射；真实控件兼容性尚待 Chrome 验收。 |
| `browser.check` | `fill(pageId,uid,value:'true'/'false')` | 当前适配器映射；真实控件兼容性尚待 Chrome 验收。 |
| `browser.drag` | `drag(pageId,from_uid,to_uid)` | 双引用版本和同页校验。 |
| `browser.screenshot` | `take_screenshot(pageId,format:'jpeg',quality:70,fullPage:false)` | inline `image` → 临时截图 artifact；最终持久化由宿主执行。 |
| `browser.screenshotCurrent` | 不再注册 | 旧实现依赖 MCP `selected`，无法证明用户当前可见页面；重复截图改用已绑定页的 `browser.screenshot`。 |
| `browser.screenshotElement` | `take_screenshot(pageId,format:'jpeg',quality:70,fullPage:false,uid)` | 只截指定快照元素，不能替代页面截图。 |
| `browser.diagnostics` | `list_console_messages(pageId,pageSize:100,types)`、`list_network_requests(pageId,pageSize:100)`、`evaluate_script(pageId,function)` | 有界错误、失败请求和性能摘要。 |

## 尚未完成的核验

真实 Chrome 连续调用/重连/截图验收仍待完成。返回 content 类型的失败测试目前只覆盖适配器已使用的部分路径，还需逐项补齐。尤其不能凭 `selected` 判断用户眼前的活动标签页。
