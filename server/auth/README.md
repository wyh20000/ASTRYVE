# 认证服务

运行环境：Node.js 24、MySQL 8、同机 HTTPS 反向代理。服务只监听回环地址，公网入口必须通过 HTTPS 代理。先在 `server/auth` 执行 `npm ci`，设置 `.env.example` 所列环境变量后执行 `npm start`。启动时自动创建账号表。认证服务有独立依赖，桌面客户端不打包短信 SDK。

当前桌面登录协议：

- `GET /health`、`GET /v1/auth/methods`；
- `POST /v1/auth/desktop/start`：提交 `redirectUri`（只能是随机端口 `127.0.0.1/auth/callback`）、43 字符随机 `state` 和 PKCE S256 `codeChallenge`；返回 `requestId` 与 HTTPS `loginUrl`；
- 浏览器访问 `GET /login?requestId=...`，获取有效期 10 分钟的 HttpOnly、SameSite Cookie 与页面 CSRF 值；
- Web 页面发送 `POST /v1/auth/sms/request`：`{"phone":"+8613800138000","requestId":"..."}`；验证 `POST /v1/auth/sms/verify`：`{"phone":"+8613800138000","code":"123456","requestId":"..."}`。两者都要求同源 `Origin`、Cookie 和 `X-CSRF-Token`。验证成功仅返回携带一次性授权码和 `state` 的本机回跳 URL；
- `POST /v1/auth/desktop/exchange`：提交 `requestId`、`code`、`verifier` 和原始 `redirectUri`。授权码 60 秒内单次原子消费，验证 PKCE 和精确回调后才返回会话；
- `POST /v1/auth/oauth/start`：在 Web Cookie、CSRF、Origin 校验后，使用 `provider=qq|wechat` 启动官方授权；平台只回调 `GET /v1/auth/oauth/callback/qq|wechat`，服务端单次消费 `state`、核对平台身份并返回桌面一次性授权码；
- `GET /v1/auth/session`、`POST /v1/auth/logout`：需要 `Authorization: Bearer <token>`。
- `POST /v1/auth/link/start`：已登录客户端发起 10 分钟短期账号绑定链接；浏览器访问 `GET /link?requestId=...` 后通过 `/v1/auth/link/sms/request|verify` 或 `/v1/auth/link/oauth/start` 验证新身份。链接始终绑定发起时的有效会话，退出后失效。QQ/微信绑定和登录共用已注册的平台回调地址，由随机 `state` 区分流程；身份若已属于别的账号返回冲突，不自动合并。

验证码经腾讯云短信官方 SDK 发送。未填平台配置时短信端点返回 503，不产生任何可用验证码。QQ 和微信服务端授权适配已编码；未填已审核的网站应用 ID 与密钥时，`/methods` 报告不可用。跨方式绑定代码与冲突保护已完成受控数据库测试，真实平台联调仍待完成。除明确列出的匿名端点外，接口均验证会话；未知路径在未登录时也返回 401。`AUTH_PUBLIC_URL` 必须是公开 HTTPS origin，并由同机反向代理转发到回环监听；`AUTH_INSECURE_LOCAL_DEV=1` 只用于本机 HTTP 开发。

本地真实数据库联调：为测试环境准备一个有 `CREATE DATABASE` 权限的 MySQL URL，设置 `AUTH_TEST_MYSQL_URL` 后运行 `npm run test:mysql`。测试会创建独立的随机数据库并在结束时删除，只在测试进程内注入短信替身，验证浏览器短信流程、错误验证码、PKCE、授权码并发单次兑换、会话校验及撤销。普通 `npm test` 没有该环境变量时跳过真实数据库测试。短信替身不会由生产启动入口使用，也不能代替腾讯云真实短信验收。

服务端只保存验证码的 HMAC、浏览器 Cookie、CSRF、授权码及随机会话令牌的 SHA-256 摘要。验证码 5 分钟有效、最多尝试 5 次；手机号和请求来源有限速。会话最长 30 天，可主动撤销。反向代理还应设置连接数和全局速率限制，配置日志不得记录请求正文、查询参数和 Authorization 头。单机进程内限流适用于本部署方式；多实例部署前需改为共享限流存储。MySQL 必须启用持久化备份，并按过期时间清理挑战、登录请求、授权码和会话历史。
