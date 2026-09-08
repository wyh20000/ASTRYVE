# 10 · DeepSeek Skills 调用适配

> 本文记录应用如何依据 DeepSeek 官方接口把第三方 Skill 用于真实对话。核对日期：2026-09-08。

## 1. 官方接口依据

DeepSeek Chat Completions 接收 `system`、`user`、`assistant`、`tool` 消息，并通过 `tools` 提供原生
function calling；`tool_choice` 可设为 `auto`、`required` 或指定函数。模型产生的参数不能直接信任，应用仍需
解析和验证。参考：

- [Chat Completions API](https://api-docs.deepseek.com/api/create-chat-completion/)
- [Tool Calls 指南](https://api-docs.deepseek.com/guides/tool_calls/)
- [Thinking Mode](https://api-docs.deepseek.com/guides/thinking_mode/)

Thinking Mode 与工具调用组合时，DeepSeek 要求后续请求完整回传上一轮 assistant 的
`reasoning_content`，否则可能返回 400。当前 DeepSeek provider adapter 会保留该字段；Kimi 和自定义端点
仍使用各自适配策略。

## 2. 本应用发送方式

当用户发送 `/grill-me 检查我的计划`：

1. 主进程确定性识别 `/grill-me`，校验其已启用并解析依赖。
2. 发送给模型的用户内容变为“检查我的计划”。
3. 应用核心 system prompt 保持最前，之后加入有明确不可信边界的 Skill 指令与资源。
4. Coding 场景继续通过 DeepSeek 原生 `tools` 暴露工具；Skill 只能缩小工具集合，不能放大权限。
5. 每轮 assistant/tool 消息按官方格式续传，包括 Thinking Mode 的 `reasoning_content`。
6. 页面先显示主进程生成的“本轮已加载”块，再显示模型输出，避免只凭模型自报判断是否生效。

## 3. 验证要求

- 抓取测试请求体，断言 system message 含激活 Skill 和依赖正文，user message 不含 `/skill-name` 前缀。
- DeepSeek 工具多轮测试断言 `reasoning_content` 被原样回传。
- 禁用/卸载/依赖缺失时不得发送模型请求。
- 伪造未允许工具、Skill 内“无需批准”等文本仍必须被策略层拒绝。
