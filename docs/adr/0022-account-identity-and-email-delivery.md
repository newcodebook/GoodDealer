# ADR-0022：账户密码身份使用独立 ingress、持久挑战与加密邮件 outbox

状态：Accepted and composed for development.

## 决策

Account Web 的注册、邮箱验证/重发、密码登录/恢复、会话查询和退出由独立 Identity HTTP ingress 拥有，不加入通用
`publicBusinessRoutes`，也不把明文密码或验证码加入 `@gooddealer/protocol`。Ingress 从 `unknown`
严格读取固定字段，限制请求体大小，只接受获准的精确 HTTPS Origin，并在应用层立即把密码转换为
一次性、可清零的 `ConsumeOncePassword`。

密码使用 Argon2id v19、64 MiB、3 次迭代、parallelism 1、16-byte salt 和 32-byte hash。已存在、
不存在、未验证和损坏 hash 的登录路径都执行一次同参数 Argon2id 检查，并对外返回相同拒绝身份。
生产 composition 必须显式选择 Argon2id port；默认拒绝 port 继续用于未组合和测试边界。

邮箱验证和密码恢复使用不同 HMAC purpose 的六位一次性验证码。数据库只保存由独立 32-byte
server pepper 计算的 HMAC-SHA-256 digest、15 分钟 expiry、六次失败上限、60 秒 resend cooldown
和消费时间，不保存验证码明文。密码恢复在同一账户事务中替换 Argon2id hash、推进 Account
Security Epoch 并撤销全部旧 Session；未知或不可恢复邮箱仍返回相同请求接受身份。
邮件作为事务内 durable outbox 记录提交；收件人、主题和正文使用独立 32-byte AES-256-GCM key
加密，记录 key id、nonce、ciphertext 和 authentication tag。Worker 通过有界 claim lease 领取，
成功后确认，失败按有界退避重试，第二十次失败进入 durable terminal state；每次投递携带稳定的 outbox
幂等键，重发后只有绑定当前、未过期且仍有尝试预算的 challenge digest 邮件可再领取。开发 adapter
只允许连接 loopback Mailpit；生产邮件 adapter 和发件
域名在单独资格完成前保持未组合。

成功验证只激活账户并原子创建个人默认 Workspace、default-owner binding、初始 revision 和设备状态；
用户随后显式登录。登录先撤销有效的已呈现 Web Session，再签发随机 32-byte Account Web session
credential，并用 host-only `Secure; HttpOnly; SameSite=Lax; Path=/` Cookie 替换浏览器此前提供的值。
退出撤销精确 Session family 并清除 Cookie。Identity 每次请求
重新读取 session、family、expiry 和 Account Security Epoch；浏览器只看到认证状态，不看到
account selector 或 session 内部事实。

## 理由与边界

独立 ingress 让秘密凭据不进入通用业务协议、OpenAPI 业务路由和客户端共享状态。Challenge digest
减少数据库泄露后的直接重放面；pepper 防止六位空间被离线穷举。加密 outbox 同时满足事务后可靠
投递和“验证码不得明文持久化”。Account Web 与 API 同源，Origin 检查阻止 login CSRF；Cookie
属性、旧会话先撤销和新凭据签发阻止 session fixation。所有 mutation 还接受按可信代理客户端地址
划分的有界限流，并只输出 operation/outcome/time 的脱敏遥测标签。

本决策不声明生产邮件、公开客户注册、隔离 staging、Passkey、邮件信誉或生产反滥用容量已经
资格化。当前源码的恢复与退出实现、PostgreSQL 集成证据和 loopback Mailpit 开发组合都不能替代
真实事务邮件投递与无开发权限用户的 staging 浏览器纵向；Mailpit UI/SMTP 不得公开监听。
