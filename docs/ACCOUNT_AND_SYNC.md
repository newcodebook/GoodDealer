# GoodDealer 账号、授权与同步边界

## 两类权威

Cloud 控制面拥有 GoodDealer 账号、登录会话、订阅/Entitlement、设备绑定、ActiveDeviceLease
和 Epoch。Desktop 必须验证这些事实后开放相应能力。该门禁不拥有业务数据：通过门禁后，
Desktop 从本地 SQLCipher 读取并向本地 SQLCipher 提交业务事务。

每个账号首发只有一个由服务器身份和 default-owner binding 导出的个人默认工作区。Renderer、
请求参数或本地样例不能选择或伪造 `(accountId, workspaceId)`。Host 只使用已验证授权中绑定的
工作区打开对应本地数据库。

## Desktop 登录会话

Account Web 的注册、邮箱验证/重发、密码登录/恢复、会话查询和退出由独立 Identity ingress 处理。明文密码与验证码
不进入共享协议、浏览器持久状态或日志；密码使用固定 Argon2id 策略，未知账号也执行同参数 decoy
检查。验证码只以 server-peppered digest 保存，邮件内容以 AES-256-GCM 加密进入 durable outbox；worker
只领取当前、未过期且仍有尝试预算的 challenge，并向 transport 传递稳定 outbox 幂等键。
验证成功的同一事务会激活账户并创建个人默认 Workspace、default-owner binding、初始 revision 和
device state；验证不创建 Session，用户必须显式登录。登录在签发新 Session 前撤销已呈现的有效旧
Session，退出立即撤销精确 family。密码恢复使用独立 challenge，在替换 hash 时推进 Security Epoch
并撤销全部旧 Session。开发邮件只投递到 loopback Mailpit；生产邮件 Provider、隔离 staging 和公开
注册资格保持关闭。
完整边界见 [ADR-0022](adr/0022-account-identity-and-email-delivery.md)。

Account Web 继续使用 `gd_session` Cookie。Desktop 不复用该 Cookie：Native Host 通过系统浏览器
发起固定客户端、固定回调地址的 Authorization Code + PKCE S256 流程。授权页固定在 Account Web 源（`https://account.gooddealer.com/v1/desktop-oauth/authorize`，经同源 `/v1/*` 代理到 Cloud），使浏览器的 host-only `gd_session` 能到达授权路由；token、Grant 与同步仍只走 API 源。没有会话时 Cloud 以相对 302 跳转到同源登录页并携带 `continue`，Account Web 只接受恰好一个同源、带查询、无片段的 Desktop 授权路径，登录或发现已有会话后以 `location.replace` 返回，其他目标一律忽略。Cloud 只保存授权码、
access token 和 refresh token 的 SHA-256 摘要；授权码五分钟内有效且只能消费一次。access token
短期有效并只驻留 Native 内存，refresh token 每次使用后轮换并只存系统凭据项（macOS Keychain；Linux 按 ADR-0025 使用 Secret Service）；重放已轮换
refresh token 会撤销整个 token family。每次 refresh 前，Native 先持久化一个 pending request ID；
如果请求结果未知，它保留旧 refresh token 与同一 request ID，并以这对值重试。Cloud 不保存原始
token，而是从所呈现的 refresh token、request ID 和 rotation generation 确定性恢复同一 token pair
及原始过期时间。已完成轮换后，只有旧 refresh token 加同一 request ID 可以取得该结果；同一旧
token 搭配不同 request ID 是 reuse，失败关闭并撤销整个 token family。`temporarily_unavailable` 或
网络错误保留 refresh custody 和 pending request ID；只有确定的 `invalid_grant` 才清除两者并要求
重新登录。Renderer 只能观察脱敏状态，不能读取 OAuth URL、PKCE 材料或任何 token。

code 签发前采用两段式浏览器授权：Account Web 会话先创建两分钟 challenge 并回跳 Native；
Native 用独立 Keychain 中的 Ed25519 设备密钥签署绑定 account/device/key/PKCE/client/redirect/
nonce digest/expiry 的固定 transcript，再返回浏览器完成授权。首次安装在账户有空闲槽位时由同一
事务建立 version 1 active key 和 binding；首次绑定还要求 Account Web 会话由五分钟内的密码或
Passkey 认证创建，且 challenge 以 Cookie 会话摘要绑定两段浏览器流程，其期限不越过该重新认证
窗口。既有设备必须匹配当前 active key。错误签名或会话替换不消费 challenge，成功验签、
challenge 消费与 code 写入原子提交。

Desktop 使用 `Authorization: Bearer` 调用 Grant 路由。Cloud 从 access token 对应会话服务端推导
账号与设备，再解析当前 Lease 和默认工作区；请求体不能选择这些权威字段。Account Web Cookie
与 Desktop Bearer 同时出现时拒绝，二者不能互相替代客户端类型。

Native 在 code exchange 或 refresh 后立即以 access token 拉取 Grant，使用构件内 build-pinned
Grant/Lease 公钥 registry 双重验签并检查本地单调 Epoch floor；只有验证成功才持久化 workspace
binding、激活本地 mutation authority 并报告 `authenticated`。首次 code exchange 在此之前不持久化
refresh token；因此首次 Grant 失败报告只能重新登录的 `authorization_failed`。该状态清除 refresh
custody、阻止后台 refresh，并通过持久化 security-locked binding 在重启后继续阻断。refresh 因服务端
已完成轮换而先保存新 refresh token；临时 Grant 失败时保留对应的未提交 access token、安全锁住本地
runtime，并报告 `authorization_retryable`。Native 优先以该 access token 重试 Grant，不重复轮换 refresh；
只有 access 过期才执行下一次正常轮换。用户选择重新登录时，Native 先占用与 refresh/callback 相同的
并发门并清除这两项旧凭据，再创建新的 pending 浏览器流程。网络错误、HTTP 408/425/429 和 Cloud/OpenBao 5xx 进入有界
指数退避；其他 Grant 状态以及畸形、空或超限的 Grant 协议响应均为确定性拒绝，与坏签名或激活拒绝一样清除
refresh custody，报告 `authorization_failed` 并要求重新登录。
registry 轮换通过签名/notarized Desktop 版本先重叠发布
old/new key，再切换 OpenBao signing version，移除 `kid` 即撤销。

## 同步模型

```text
local business transaction
  +-- business rows
  `-- sync_outbox (allowlisted, secret-free)
              |
              v
        Cloud sync replica -- ACK/Cursor --> local replication metadata

Cloud pull --> strict validation --> conflict decision --> local transaction --> local Query
```

同步是本地业务数据库的异步复制机制，不是业务调用链。Cloud transport 失败时，本地事务仍成功，
并保持待同步状态。Cloud 空结果不是删除指令；删除必须是具名、经过验证并可冲突处理的 Mutation。

### 客户同步快照与冲突路由

客户只消费 Native 读取的持久化 `SyncSnapshot`，不消费内部复制 drain 进度。快照包含
`pendingMutationCount`、`openConflictCount`、`rejectedMutationCount`、`recoveryRequired`、
`appliedThroughServerRevision`、最近复制活动时间和 transport 观察时间；transport 仅为
`checking`、`reachable`、`offline` 或 `blocked`。首次启动和每次重启均从 `checking` 开始，直到
Native 完成新的 transport 观察；界面不得用旧观察或 `navigator.onLine` 推断可达性。

`sync.conflicts` 是独立的主导航/路由。Active 本地权威可以对一个候选提交一个带版本、Revision 和
当前值摘要的明确选择；商业只读/Standby 只能读取冲突投影，resolution admission 必须为 unavailable。
locked、retryable、security 和 recovery surface 不属于 workspace route，因而不能进入该路由。
冲突 resolution receipt 只证明本地事务已经提交（或幂等重放）并已按需要排队 Outbox；它不是 Cloud
ACK。成功后必须重新读取本地状态和冲突投影。

## 数据边界

允许同步的数据必须逐实体、逐字段列入协议白名单。V1 `domain_asset` 可包含 note、portfolioId、
tags、targetPrice 等业务字段。未知字段失败关闭。

以下信息全部只留本地，即使其中一部分通常被称为 metadata：第三方平台账号、Provider Account
ID、账号别名、API Key、Token、Cookie、密码、2FA、Browser Profile、Credential Binding、
恢复/解锁材料。它们不得进入 Outbox、wire、Cloud、日志、错误、审计 payload、fixture 或 UI
普通状态。

## Provider 边界

Provider 调用只能由本地 Secure Host 使用本地凭据发起。观察或操作结果先原子写入本地业务库，
随后才生成允许同步的脱敏业务投影。Cloud 可以保存该投影供同步和恢复，但不持有连接账号，
不读取凭据，也不调用 Provider。

## 授权失效与离线

有效账号、设备和 Lease 在产品定义的离线期限内可以继续本地业务；客户端不能自行扩大期限。
商业到期、商业暂停或退款后，既有 Host 仍可查看和受控导出已验证工作区，但不能修改、同步或
执行 Provider 操作。设备撤销、账号安全恢复和本地完整性失败进入安全锁定，不继承商业只读。
任何限制、重新登录或设备切换都不得用 Cloud 副本覆盖或清空本地数据库。

详细不变量见 [ADR-0016](adr/0016-local-business-database-and-cloud-sync-boundary.md)。首个实现切片的
operation id、schema、Cloud/Desktop 接线与错误语义见[首切片共享合同](FIRST_SLICE_SHARED_CONTRACT.md)。
