# 认证服务

运行环境：Node.js 24、MySQL 8、同机 HTTPS 反向代理。服务只监听回环地址，公网入口必须通过 HTTPS 代理。先在 `server/auth` 执行 `npm ci`，设置 `.env.example` 所列环境变量后执行 `npm start`。启动时自动创建账号表。认证服务有独立依赖，桌面客户端不打包短信 SDK。

目前可用的端点：

- `GET /health`、`GET /v1/auth/methods`；
- `POST /v1/auth/sms/request`：`{"phone":"+8613800138000"}`；
- `POST /v1/auth/sms/verify`：`{"phone":"+8613800138000","code":"123456"}`；
- `GET /v1/auth/session`、`POST /v1/auth/logout`：需要 `Authorization: Bearer <token>`。

验证码经腾讯云短信官方 SDK 发送。未填平台配置时短信端点返回 503，不产生任何可用验证码。QQ 和微信适配仍待实现，`/methods` 会报告不可用。除明确列出的匿名端点外，接口均验证会话；未知路径在未登录时也返回 401。

服务端只保存验证码的 HMAC 和随机会话令牌的 SHA-256 摘要。验证码 5 分钟有效、最多尝试 5 次；手机号和请求来源有限速。会话最长 30 天，可主动撤销。反向代理还应设置连接数和全局速率限制，配置日志不得记录请求正文和 Authorization 头。单机进程内限流适用于本部署方式；多实例部署前需改为共享限流存储。
