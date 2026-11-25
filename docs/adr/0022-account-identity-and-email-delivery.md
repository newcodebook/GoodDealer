# ADR-0022：账户身份、个人工作区与邮件交付

状态：Accepted

## 身份与会话

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
只允许连接 loopback Mailpit；生产邮件 adapter 和发件域名须独立完成投递资格，Mailpit UI/SMTP 不得公开监听。

成功验证只激活账户并原子创建个人默认 Workspace、default-owner binding、初始 revision 和设备状态；
用户随后显式登录。登录先撤销有效的已呈现 Web Session，再签发随机 32-byte Account Web session
credential，并用 host-only `Secure; HttpOnly; SameSite=Lax; Path=/` Cookie 替换浏览器此前提供的值。
退出撤销精确 Session family 并清除 Cookie。Identity 每次请求
重新读取 session、family、expiry 和 Account Security Epoch；浏览器只看到认证状态，不看到
account selector 或 session 内部事实。

## 工作区与租户

`Account` 是身份和商业范围，`Workspace` 是业务资料的租户边界。账户完成验证并激活时，
identity/workspace 组合必须在一个服务器事务中创建：

- 一个不可变 ID 的 Account；
- 一个不可变 ID 的个人默认 Workspace；
- 该 Account 对该 Workspace 的唯一所有者绑定。

首发产品只支持这个账户拥有的一个个人工作区。它不提供邀请、团队成员、工作区创建、
工作区切换、所有权转移或将账户数据并入其他账户工作区的行为。商业授权和账户安全事实
保持 Account 范围；资产、同步变更、游标、投影和审计工作区记录保持 `(accountId, workspaceId)`
租户范围。

客户端只提交经协议定义的业务意图。会话主体、默认所有者绑定和工作区范围必须由服务器端
解析；客户端、缓存、UI 或请求参数都不能选择、伪造或扩大租户范围。

账户激活、默认工作区、所有者绑定、初始 revision 与设备状态在同一服务器事务内完成，任何失败均回滚。
Origin 检查防止 login CSRF；所有 mutation 按可信代理客户端地址有界限流，只输出 operation/outcome/time
脱敏遥测。新增多工作区、协作或所有权转移须明确身份、商业归属、迁移与租户授权模型。
