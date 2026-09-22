# GoodDealer 验证边界与 v1 验收

## 读法与证据分类

本文件拥有 v1 的详细垂直验收定义，而 [路线图](ROADMAP.md) 只拥有简明能力地图和依赖。这里的
每一项证据必须说明它能支持的精确声明；本地实现证据和外部资格不能互相替代。

| 证据标签 | 观察对象 | 可以支持的声明 | 不能支持的声明 |
| --- | --- | --- | --- |
| **Decision constraint** | 已接受 ADR 与决策登记。 | 固定的范围、排除项和信任边界。 | 当前组合、部署、提供商可用性或发行。 |
| **Current source state** | 本次检查的生产入口、注册表、合同和模块源码。 | 该源码当前包含/不包含什么。 | 设计目标已经交付，或未检查入口的不可达性。 |
| **Local implementation evidence** | 可复现的模块、合同、垂直或边界测试。 | 被测试的本地行为和失败关闭边界。 | 部署、真实提供商、原生构件、客户可用性、发行或 Gate closure。 |
| **External qualification evidence** | 真实环境、最终原生构件、受控提供商观察、独立审查或批准。 | 所列的部署、提供商、原生、发行或 Gate 事实。 | 未观察的其他环境或未来能力。 |
| **Historical repository evidence** | 明确以审计/历史为目的的保留记录。 | 该历史时点的事实。 | 当前 readiness、可用性或 Gate closure。 |

本地 Desktop 与 Cloud API 工作可在已接受范围和本地合同下并行开始、继续和验收。通过本地测试只
表示相应的本地实现证据；它绝不证明部署、托管数据库、真实 Cloudflare 行为、原生签名/公证、
客户发行或 Gate。真实外部效果必须在其资格完成前失败关闭。

## 当前源码状态和范围控制

以下是本次源码快照，而不是能力可用性声明：

| 区域 | Current source state | 声明限制 |
| --- | --- | --- |
| Desktop Host | Tauri 精确注册当前具名本地业务、备份、认证和 Cloudflare 命令；Runtime 分离读写门禁，过期后可通过 OS-protected verified binding 只读重开；`secure-host-core` 持有 device/refresh custody、PKCE/device PoP、build-pinned 公钥 registry 与 Grant/Lease Ed25519 验签，`gooddealer-local-storage` 的 `DesktopLocalHost` 持有 SQLCipher key、本地业务与全部备份 authority。Native Bearer Grant transport 验签后激活 runtime。 | 不证明生产 Cloud/OpenBao 已部署、build-pinned registry 已用真实 key 构建、原生备份 picker/handle/KEK/anchor 资格或客户发行已完成。 |
| Desktop production graph | `apps/desktop/src/app.tsx` 通过具名 authentication、local-business、portfolio、sync/conflict 和 Cloudflare adapters 组合 `DesktopShell`/`DesktopRouter`；不导入 `cloud-client`、Provider transport 或数据库实现。Workspace route 由授权 surface 与同步状态共同筛选，冲突解决后只发布 generation-stable 的完整权威重读。 | 本地纵向与局部独立复审不等于真实登录、Provider、全系统 V1 或发行可用。 |
| Cloud public and jobs composition | `publicBusinessRoutes` 精确注册当前公共业务 route；Desktop OAuth 独立入口组合 Account Web session、PKCE、设备 challenge/PoP、首次绑定的五分钟密码/Passkey 重新认证与同 Web 会话约束、access/refresh token，Grant route 只接受绑定设备的 Desktop Bearer 主体。OpenBao Transit adapter 实现分钥、固定版本、有界 wire 和本地公钥复验。`adminBusinessRoutes` 仍为空；`periodicJobs` 精确注册 Licensing provider inbox/reconciliation，并只经窄应用端口调度。 | 本地 adapter/route/job 测试不等于已部署客户 API、生产 self-hosted scheduler/worker、live provider 或已配置生产 OpenBao；PostgreSQL composition 测试需要 `GOODDEALER_POSTGRES_*` 环境。 |
| Identity account-access source | 独立 Identity ingress 和 Account Web 源码组合注册、验证/重发、密码登录/恢复、session discovery、登录轮换和服务端退出；后续 recovery migration 增加用途隔离 reset challenge、challenge-bound outbox、bounded dead-letter 与旧会话撤销。成功验证在一个 PostgreSQL 事务内激活账户并创建个人默认工作区，随后要求显式登录。 | 真实 staging Resend 投递、完整浏览器旅程和 25 条 migration 已取得部署证据；生产邮件域名/资格、live payment、生产 OpenBao/worker 与容量仍不在本行声明范围。 |
| Staging authorization deployment | [`api.gooddealer.com`](DEVELOPMENT_CLOUD.md) 与 `account.gooddealer.com` 已通过 Cloudflare 和独立 Nginx/Let's Encrypt 站点接入 loopback Cloud；当前 release 使用同源代理、Resend 事务邮件、注册/邮箱验证/密码登录、真实 Cookie session、25 条 migration、Stripe test-mode 商业链路与 systemd worker。无数据库或开发工具权限的临时邮箱用户已完成注册、验证、登录、刷新恢复和退出，退出后的旧 session 返回 401。 | PostgreSQL 18.4 低于仓库锁定的 18.6，仍不构成生产 PostgreSQL 资格、live payment、生产 OpenBao/worker、HA、灾难恢复或生产客户可用性。 |
| 首切片共享合同 | `@gooddealer/protocol` 与 `@gooddealer/cloud-client` 已公开 tenant-neutral 激活、整体签名授权 Grant v3、Mutation ACK、Pull Cursor、Checkpoint 与恢复输入合同。 | 合同、fail-closed Grant route、OpenBao adapter 与本地验签不证明生产 OpenBao custody 或发行资格。 |
| Cloudflare Secure Host | `secure-host-core` 已实现私有 Zone/DNS 只读 Service、固定 `api.cloudflare.com` 的加固 HTTPS Transport、v3 完整公开元组信封与 exact-base/explicit-target Keychain 发布；Tauri 已组合独立 ProviderLane、原生秘密录入和 stored observation，Renderer 已组合 activation/status/recovery/read-only observation。Activation 只把 Host durable prewrite handle 交给 Secure Host；prewrite COMMIT 原子 deny use，之后取消不再中断。Exact B 才能 marker/write，mismatch/malformed/unreadable 与 orphan 都在不推进 ledger/head 的前提下 sticky remediation。其 crate 不包含备份实现或依赖。 | Renderer 组合与本地测试不证明真实 Cloudflare、目标平台签名/Keychain 构件或提供商资格；完成这些外部证据前不能声明客户可用。 |
| GDBK backup/restore | `gooddealer-local-storage` 的 `DesktopLocalHost` 独占 authority continuity、strict GDBK v1、allowlisted projection、isolated candidate、guarded current-DB honest replay；client-core 合同、Desktop raw-wire adapter 和仅在 `cfg(test)` 编译的 continuity/rebootstrap runtime/custody/database 状态机已在私有开发组合中验证。 | true-create-only fake 只证明私有协议；生产不保留 recovery shell，只保留 fixed-resource residue absence gate，且缺少 picker/handle、真实 KEK、独立 non-rollbackable anchor、true create-only slot custody、safe `SQLITE_FCNTL_HAS_MOVED`/custody VFS、durable filesystem 与签名目标平台故障资格。备份、continuity、rebootstrap 均为 `unavailable`，不能声明恢复或灾难恢复可用。 |
| 已接受目标 | ADR-0013、ADR-0024、连接器规范和 ADR-0017 固定个人默认工作区、域名 Provider capability manifest、资金单项确认和无嵌入式/自动化浏览器。 | 决定约束不等于实际资产或 Provider 能力已执行。 |

Desktop production 图的范围控制由源码测试持续验证；后续组合任何 feature、Host 或 connector 时必须
更新当前态并重新执行 production-entrypoint reachability 检查，不得恢复已删除的 connector 注册、
兼容或过渡路径。

## 当前局部独立复审

D1+S1 当前范围的独立 evaluator 结论为 `PASS-with-informational-notes`：六项标准全部通过，没有
blocker 或 non-blocker。复审以五个 mutation control 证明测试能够拒绝 ACK generation 漏增、冲突
重放错误返回 `expected + 2`、IPC 未知字段、错误的 transport 聚合优先级和非 generation-stable
publication；同时运行 client-core 357 tests、Desktop 99 tests 与 production build、local-storage
261 tests（另有 1 ignored）、Tauri 57 tests、typecheck、Rust fmt 和 Clippy `-D warnings`。对应运行时
证据为 task `task_fb98a01f7cb3`、artifact `art_fc8401b1604c`、check `check_a869d8246727`。

该结论只接受 D1+S1 的既定 criteria，不接受账号/商业授权、完整 Cloud/PostgreSQL、真实 Cloudflare、
目标平台构件或全系统 V1。任何后续影响该范围的源码变化都要求重新取得适用证据。

## 本地实现通用验收门槛

每个 v1 垂直路径在被称为“本地已验收”前都必须有以下证据：

1. 仅使用已声明的公开合同/端口；所有 wire 或不可信输入从 `unknown` 严格验证，未知字段和
   不匹配响应失败关闭。
2. 服务器端从认证主体和默认绑定导出租户范围；Desktop、Host、缓存和请求参数不能选择或扩大
   `accountId`、`workspaceId`。
3. 展示层没有秘密、直接持久化、直接网络/提供商权威或通过 callback/fixture 获得的结果。
4. 对应的正向垂直测试和负向控制都已实际运行，并记录准确命令、退出状态和适用范围。
5. 本地路径没有引入嵌入式/自动化浏览器、非域名 Provider 产品、团队/多工作区、凭据迁移、CSV import
   或任何 compatibility/transition/fallback 路径；域名写入和 Registrar 能力必须经过具名审批和资格。
6. 所有共享入口、公开导出、协议、迁移和当前文档由具名整合负责人重新检查。

账户、授权和同步实现必须采用[首切片共享合同](FIRST_SLICE_SHARED_CONTRACT.md)的 operation id、schema、
ACK 关联和恢复语义；不得在 Cloud 或 Desktop 内复制或放宽这些 wire 定义。

Cloud boundary 门禁 fail closed 地要求当前精确 allowlist：两条 boundary path，以及账号激活、Desktop
Grant、billing checkout/status/cancel/fixed-term confirm 六条业务 path。两条 boundary route 使用各自的
boundary schema 和认证语义；六条业务 route 使用 protocol public schema、从认证主体派生范围，并覆盖
租户选择字段、未认证主体和错误客户端类型的负向观察。Repository topology 以
`gooddealer-local-storage` 的私有 SQLCipher key capability 为唯一存储标记：
`getrandom`、`security-framework` 与 `zeroize` 由该 crate 直接声明，Desktop Tauri 不重复持有这些
数据库 key 依赖；`secure-host-core` 不得重新导出 database-key type、slot 或 lifecycle primitive。

## v1 详细垂直验收

这是 [路线图](ROADMAP.md) 当前 v1 主路径的详细验收表，不是第二份能力地图。每行都必须保持
授权走 UI → Host → Cloud control plane；业务走 UI → Host → local SQLCipher，随后由 Outbox 异步
复制到 Cloud。任一未组合层都不能由其他层的测试替代。

| v1 能力 | Desktop UI | Host 边界 | Cloud API | 持久化 | 本地正向证据 | 必须失败关闭的负向控制 | 后续外部资格及其唯一授权声明 |
| --- | --- | --- | --- | --- | --- | --- | --- |
| **Account Web 接入与个人默认工作区** | 同源页面严格解析注册、验证/重发、登录、session discovery、恢复和退出响应；密码/验证码不进浏览器存储，退出先移除浏览器账户 authority。 | 浏览器没有数据库、邮件 Provider 或账户选择权；Cookie 为 Secure/HttpOnly/host-only/SameSite=Lax。 | 独立 Identity ingress 执行 Origin、可信代理地址限流、统一拒绝、登录轮换和服务端退出；验证后必须显式登录。 | 注册只建立 pending identity；成功验证的单一事务激活 Account 并创建 Workspace/binding/revision/device state。reset 单一事务替换 hash、推进 Epoch、撤销旧会话；邮件加密 outbox 有 challenge binding、retry/dead-letter。 | Account Web source tests、Identity HTTP tests、PostgreSQL 原子回滚/并发/expiry/replay/mail failure/reset/rotation/logout 集成。 | 重复/并发注册、错误/过期/重放验证码、未验证/错误密码、Origin/CSRF、Cookie fixation、旧 Session、邮箱枚举响应、敏感遥测和半成品 workspace 均被拒绝。 | 只有真实事务邮件、隔离 HTTPS staging、当前 migration 应用和无开发权限测试用户完整浏览器旅程，才授权“staging 可用”；本地/Mailpit 不授权该声明。 |
| **Desktop OAuth、Grant 与 Lease** | 只发起系统浏览器 OAuth 并显示粗粒度 checking/authenticated/retryable/locked 状态；Renderer 不接触 access/refresh、Grant、Lease、设备密钥或原始错误。 | Native 独占 PKCE、device PoP、refresh custody 和 Grant/Lease 双重验签；只有签名、purpose/audience、账号/工作区/设备绑定、Epoch 和时间窗全部有效才开放本地 capability。 | OAuth/token/Grant route 从 Account Web session、绑定设备和服务器权威派生范围；refresh、重试和恢复不允许客户端扩大主体或租户。 | Cloud 保存会话、设备和权威记录；Native 只把允许持久化的 device/refresh binding 放入 OS-protected custody，不写入 Renderer 或普通本地业务表。 | 完整 OAuth→callback→token→Grant→Lease→Host admission 纵向；刷新、重启、有效离线窗口和授权成功后的权威重读；严格 wire 与签名测试。 | state/callback 重放、错误客户端、未知字段、错误签名/purpose/audience、workspace/device mismatch、过期或回滚 Epoch、超窗离线、Grant retry 非允许错误和秘密泄漏均被拒绝。 | 生产 OpenBao、公开身份入口、生产邮件和目标平台 custody 资格只授权各自真实环境声明；本地验签不等于生产授权服务可用。 |
| **商业授权与降级访问** | Account Web 展示购买、取消、退款与状态；Desktop 只消费归一化 authority，并把 Active 映射为可写、commercial read-only/Standby 映射为仅查看，不从 Provider UI 猜测权益。 | Host 以已验签 CommercialAuthority 与设备授权共同决定 capability；过期、暂停、退款和恢复不能清空或改写本地业务数据。 | Cloud 聚合 Stripe/可选 PayPal inbox、订阅、paid-through、退款和恢复为唯一 CommercialAuthority；同一时刻只允许一个 Provider 激活。 | Provider 原始事件先进入 durable inbox；聚合权威、工作项和 receipt 由事务/CAS 更新，Provider 凭据不进入 Desktop。 | Stripe test-mode checkout/webhook/cancel/paid-through/refund/recovery、单 Provider 约束、重复事件幂等和 Desktop capability 映射。 | 伪造回调、错误签名、乱序/重复事件、双 Provider 激活、取消即刻剥夺 paid-through、退款后仍写入、客户端自报 entitlement 和原始 Provider 数据泄漏均被拒绝。 | Stripe live、商户配置、税务/销售地区、生产 worker 和可选 PayPal 资格才授权真实收费；test mode 不授权生产销售。 |
| **本地域名资产读写** | list/detail/edit 使用本地 Query/Command；显示本地提交和待同步状态。 | Host 拥有路径和密钥，只公开具名命令。 | Cloud 只接收字段白名单 Mutation 并返回 ACK/Cursor。 | 本地业务表与 Outbox 原子提交；Pull 经本地事务合并。 | Cloud transport 缺失仍可读写、原子回滚、空副本 no-op、Pull 不回声 Outbox。 | 未授权、路径/密钥/租户注入、秘密字段、Cloud 空副本删除和直接 Cloud Query 均失败关闭。 | Cloud 部署只授权同步服务主张；本地行为不依赖该资格。 |
| **Secret-free 同步与 Conflict Center** | `SyncSnapshot` 同时展示 SQLite durable counts 与 Native transport；`sync.conflicts` 在 Active 可 resolve，在 commercial read-only/Standby 只读，locked/retryable/security/recovery route-free。receipt 只表示本地提交，不表示 Cloud ACK。 | Native 固定 Cloud origin，串行化 Push/ACK/Pull/Checkpoint 并按 `RecoveryRequired > SecurityBlocked > AuthorizationBlocked > Retryable > Valid > NotAttempted` 聚合；Host 唯一推进 `readGeneration`，resolve 要求 `current == expected`，成功严格返回 `expected + 1`，随后只发布 generation-stable 全量重读。 | 服务端从认证主体派生工作区，严格解析 Mutation/ACK/Cursor/Checkpoint；RLS 与 capability façade 不接受客户端租户扩张。 | 本地业务写与 Outbox 原子提交；Inbox/materializer、conflict、tombstone、receipt、cursor/checkpoint 和 visible-generation 更新遵守事务边界，Cloud 只保存 allowlisted replica。 | Push/ACK/Pull/Checkpoint、重启从 `checking`、空副本 no-op、精确幂等重放、冲突 CAS、原子 publication，以及当前独立 evaluator 的五项 mutation controls。 | 中间 generation 变化、提交失败后增代、`expected + 2` 重放、未知 IPC 字段、Push auth/retryable/security 被 Pull success 掩盖、取消/drain 后 late success、秘密/Provider identity 同步和 Cloud 空副本删除均被拒绝。 | live PostgreSQL 并发/RLS、容量、长稳和受控故障只授权对应同步运行资格；局部 evaluator 不等于全系统 V1 或生产 Cloud。 |
| **Cloudflare API-only Zone/DNS 只读观察** | 显示本地保存的连接状态和本地 Provider 观察。 | 本地 Host 独占第三方账号、Provider Account ID、别名、Token 和 HTTPS read。 | 无 Cloud Observation submit/read；Cloud 不调用 Provider。 | Provider 账号和密封凭据只写本地；允许的业务字段经 DomainAsset Outbox 同步。 | no-secret Mutation、无 Cloud connection persistence、Host read allowlist 和本地结果持久化测试。 | 账号 metadata/Token 泄漏、Cloud Provider 调用、DNS 写、浏览器 fallback 和任意网络均被拒绝。 | 条款、最小 Token、受控 Zone 和独立审查才授权真实 Provider 可用性。 |

新增域名能力的验收还必须覆盖：Host-owned 报价与单项确认、Grant/Lease/凭据代次即时复验、
计划摘要与资源绑定、未知结果对账、批量逐项结果和 Provider 页面回跳不构成成功。当前只有
上述只读观察实现；目标能力不得借现有只读证据获得执行许可。

## 非 V1 主路径：GDBK 与 rebootstrap

安装绑定的 GDBK v1 备份、隔离恢复、continuity 和 rebootstrap 不属于当前 V1 acceptance 主路径。
`gooddealer-local-storage` 已有 strict format、allowlisted projection、isolated candidate、guarded
current-DB replay 和私有测试协议，但生产 capability 统一保持 `unavailable`。它们不能被用于弥补
账号、授权、本地业务、同步或 Connector 的 V1 验收缺口，也不能被描述为灾难恢复。

### GDBK 本地实现证据门槛

只有以下证据全部绑定到同一次完整组合，GDBK 才能从 `unavailable` 变为本地可用：

1. 严格 parser/encoder corpus 覆盖每个 header/manifest 字段和字节突变、未知/重复字段、版本/suite、
   frame truncate/reorder/duplicate/omit、final 后数据、trailing bytes、计数溢出和 512 MiB/16,384 frame/
   1 MiB frame 上限；失败前后 active DB、catalog、pointer 和 key state 零变化。
2. 安装级 `backup-wrap-v1` KEK 的 CSPRNG、purpose separation、non-sync ThisDeviceOnly ACL、最多三 slot
   轮换/引用保留、与 registry 独立的 monotonic rollback anchor、registry rollback 与 key loss 失败关闭证据；session/Lease 更新不得改变 KEK identity，
   但 stale time/authorization/generation 必须阻止 publish。
3. generated schema inventory 和 secret canary 证明投影只含 allowlisted 业务 root，且 Provider credentials/
   identities、OAuth/session、database key、Lease/Grant/Ticket/ApprovedOperation、authority/entitlement、sync
   delivery/cursor/Inbox/conflict/receipt/catalog 全部缺席；目标、temp、journal、manifest 和 crash remnant 无
   明文或 key canary。
4. handle race matrix 在每个 check/open/read/write/rename 边界替换 source、destination 或 parent 为 symlink、
   hard link、renamed inode、directory、FIFO/device/reparse；证明无越界读写、覆盖、明文发布或 active DB
   identity 改变。两阶段日志还必须注入 ENOSPC/EDQUOT、short write、file/directory fsync failure 与每个
   journal state crash，并在 restart 后只得到完整 available 或 invalid/quarantined。
5. restore fault/mutation matrix 证明隔离 candidate 失败不触及 active DB；exact revision/candidate set/dialog/
   artifact/authority CAS 杀死 stale/replay；恢复只产生新的 mutation/field/tombstone/history/secret-free
   Outbox，保持所有当前 floors，并在 subsequent push/pull 中保持显式 conflict/tombstone 语义。
6. production-entrypoint/static boundary 证明只有具名 `local_backup_restore_status`、
   `local_backup_export`、`local_backup_artifact_select`、`local_backup_restore_begin` 可以接入，并且在
   Host/local-storage/Desktop/client 任一组成或测试缺失时 capability 仍为 `unavailable`。当前仓库底座和
   本地测试不能代替签名原生构件的目标平台资格。
7. continuity/rebootstrap 生产资格必须另外证明：anchor 是独立且 non-rollbackable；slot key 使用满足
   全部属性的 true create-only 原语；SQLite active file 通过 safe `SQLITE_FCNTL_HAS_MOVED` wrapper 或
   custody-controlled VFS/open-by-handle 防止同 UID swap-and-swap-back 副作用。当前官方
   `security-framework` 3.7.0、普通 Keychain/upsert、私有 fake、retained-fd identity/digest 和源码测试
   均不能代替这些证据；缺失时生产在持久化前返回 `Unavailable`。

## 跨越全部 v1 路径的负向边界

| 边界 | 必须验证的拒绝行为 |
| --- | --- |
| 授权与租户 | 客户端或缓存不能创建、选择、替换或扩大 Account/Workspace 范围；所有读取首先由服务器端绑定授权。 |
| 协议 | 未知、缺失、类型错误或与请求不一致的 wire 数据从 `unknown` 拒绝，不能隐式 fallback。 |
| 秘密与外部效果 | 秘密不进入普通应用状态、Cloud、日志、错误、审计或夹具；外部动作没有明确最小权限合同时不得发生。 |
| v1 排除项 | 嵌入式/自动化浏览器、非域名 Provider 产品、市场连接、团队/多工作区、凭据迁移和 CSV import 没有可达产品路径；未资格化的域名外部 mutation 同样不可达。 |
| 视觉与夹具 | `brand/`、视觉 fixture/gallery、样例数据和 disabled 控件只能用于展示 QA，不能证明状态、授权或外部结果。生产 UI 只消费 `@gooddealer/ui` public exports、声明的 tokens/assets 与 `@gooddealer/i18n` public exports。 |
| 过渡面 | 不存在旧路由、双 data/session 路径、兼容 API、别名、临时 adapter、迁移桥或浏览器/提供商 fallback。 |
| 当前 Desktop 图 | production 入口只允许具名本地业务、认证、同步与 Cloudflare adapter；任何新增命令需同步 manifest、handler、capability、adapter 与策略测试。 |

## 外部资格不是本地完成门槛

| 外部资格 | 所需证据 | 它限制的声明 | 它不限制的工作 |
| --- | --- | --- | --- |
| Cloud 部署与托管数据库 | 已批准环境、迁移应用、运行监控和运行时观察。 | 已部署服务、托管数据和客户可用 Cloud API。 | 已冻结合同下的本地身份、投影、API 和持久化实现。 |
| Cloudflare 资格 | 按能力完成条款、最小权限、受控资源、限流/错误/移除、资金确认、未知结果对账和独立安全审查。 | 仅对应能力的真实 Provider 执行或客户可用性。 | capability 合同、秘密隔离、脱敏投影和失败关闭的本地测试。 |
| 原生资格 | 最终平台构件、签名/公证或 Windows/macOS 观察。 | 原生已签名/已公证或可交付客户端。 | Tauri/React/Host 的本地受限实现和测试。 |
| 发行与 Gate | 干净构件、持久归档、独立审查和 ADR-0018 所需批准。 | `1.0.0` / `stable`、客户发行和 Gate closure。 | 已接受 v1 范围内的本地工作包和垂直验收。 |

## 运行与报告规则

完整仓库变更运行根 `pnpm check`；每个变更还运行其拥有模块的测试、必要的协议/边界检查、当前
源码检查、内部链接验证、受影响术语扫描和 `git diff --check`。报告只记录本次实际命令与输出。

任何“通过”都必须使用限定语：`本地实现证据通过`、`当前源码状态已检查` 或明确的 `外部资格
已取得`。不得把本地或历史仓库证据称为部署、提供商、原生、发行或 Gate 通过。

macOS 官方签名、公证与官方渠道发行在 Apple Developer 账号具备前保持延期。该延期不阻止
本地功能开发和测试；当前只把 Homebrew/用户自行下载未签名安装包作为开发分发方向，最终包仍
须经过 Gatekeeper 实机观察并明确提示用户手动允许，不能称为已签名、已公证或正式发行。
