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

源码组合、开发缺口及注册表统一见 [当前实现](CURRENT_IMPLEMENTATION.md)。本文件维护验收要求，
不再复制另一份页面、命令、路由或迁移数量。历史 staging 与局部复审记录只证明当时观察的构件，
不能自动适用于当前源码。

每次组合变更须核对生产依赖图、Tauri 命令/manifest/capability、Cloud 条件路由与应用端口、
迁移目录和能力准入。测试要同时覆盖成功路径、未知 wire、错误主体/租户、过期代次与中途撤销，
不能以 fixture、静态营销页面或一个可见按钮代替真实执行结果。

## 既有局部独立复审（历史证据）

D1+S1 当前范围的独立 evaluator 结论为 `PASS-with-informational-notes`：六项标准全部通过，没有
blocker 或 non-blocker。复审以五个 mutation control 证明测试能够拒绝 ACK generation 漏增、冲突
重放错误返回 `expected + 2`、IPC 未知字段、错误的 transport 聚合优先级和非 generation-stable
publication；同时运行 client-core 357 tests、Desktop 99 tests 与 production build、local-storage
261 tests（另有 1 ignored）、Tauri 57 tests、typecheck、Rust fmt 和 Clippy `-D warnings`。对应运行时
证据为 task `task_fb98a01f7cb3`、artifact `art_fc8401b1604c`、check `check_a869d8246727`。

该结论只接受 D1+S1 的既定 criteria，不接受账号/商业授权、完整 Cloud/PostgreSQL、真实 Cloudflare、
目标平台构件或全系统 V1。复审对象是已被 `brand/` 重建替换的旧界面组合；对当前界面它只是历史仓库证据，
阶段 4 必须在冻结候选上重新取得。任何后续影响该范围的源码变化都要求重新取得适用证据。

## 本地实现通用验收门槛

每个 v1 垂直路径在被称为“本地已验收”前都必须有以下证据：

1. 仅使用已声明的公开合同/端口；所有 wire 或不可信输入从 `unknown` 严格验证，未知字段和
   不匹配响应失败关闭。
2. 服务器端从认证主体和默认绑定导出租户范围；Desktop、Host、缓存和请求参数不能选择或扩大
   `accountId`、`workspaceId`。
3. 展示层没有秘密、直接持久化、直接网络/提供商权威或通过 callback/fixture 获得的结果。
4. 对应的正向垂直测试和负向控制都已实际运行，并记录准确命令、退出状态和适用范围。
5. 本地路径没有引入嵌入式/自动化浏览器、非域名 Provider 产品、首发清单外平台、团队/多工作区、凭据迁移、CSV import
   或任何 compatibility/transition/fallback 路径；域名写入和 Registrar 能力必须经过具名审批和资格。
6. 所有共享入口、公开导出、协议、迁移和当前文档由具名整合负责人重新检查。

账户、授权和同步实现必须采用[首切片共享合同](FIRST_SLICE_SHARED_CONTRACT.md)的 operation id、schema、
ACK 关联和恢复语义；不得在 Cloud 或 Desktop 内复制或放宽这些 wire 定义。

Cloud boundary 门禁要求对应 composition 的精确路由集合，来源是应用入口与注册表，
不是文档中的固定数量。账号、billing、设备、同步与观察副本路由都要使用各自的严格协议 schema，
从认证主体派生范围，并覆盖租户选择字段、未认证主体、错误客户端类型和缺失依赖的负向观察。
Repository topology 以
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
| **Cloudflare Registrar 账户库存** | 设置发起完整账户读取，收到受理前已持久记录请求。读到新回执就自动显示新汇总。 | Native 从当前 Zone 确定账户，或用固定窗口录入账户 ID 与用户 API Token 后预检完整清单。Host 校验固定槽位的账户范围并单独确认 Registrar 权益和资格。 | Cloud 仅签发明确配置的权益并接受普通资产同步。 | 同一 SQLCipher 事务消费原请求并写入注册商观察、资产、Outbox 与扫描回执。 | 账户替换、DNS 单独授权、撤销、旧 Lease、过时结果、墓碑与最终栅栏负例。 | 完整读取前退出或休眠，恢复时按同一连接、代次、设备和 Lease 从首面重新读取。 | 需用真实账户、包含适当权限的原生托管用户 API 令牌与目标系统分别取证。验收应另测账户中没有可用 Zone，以及损坏槽位的本地断开与清理。 |
| **阿里云 Registrar 账户库存** | 设置中的连接、刷新、持久汇总和断开。 | 中国站固定端点以 Native RAM AccessKey 签发官方 ACS3 `QueryDomainList`，验证页元数据和域名唯一性。 | 只签发明确配置的 `aliyun:registrar:observe`，接受一般资产同步。 | 原子提交注册观察、资产、Outbox 和完整回执，未给出的锁/自动续费保持未知。 | 错槽、撤销、重复、过时页和事务提交栅栏失效均不产生新资产。 | 重开重新读取已持久发起的完整扫描，保留先前成功结果。 | 真实验收需具名开发授权、中国站 RAM 只读凭据及一项已知域名。目标系统分别实机取证。 |
| **Atom 卖家库存** | 设置中的连接、刷新、持久汇总和断开。Native 回执前持久化刷新请求。 | 固定官方 HTTPS，Native 托管卖家 ID 与 token。分页上限、Listing ID、域名及真实匿名错误校验。首次库存预检完整通过后才建槽，发布时精确读回凭据。 | 仅明确配置的 `atom:marketplace:observe` 可签发。 | 原子归集资产、Listing 观察、Outbox 与扫描回执，同时消费原请求。相同连接中的资源替换保留旧绑定。 | 拒绝跨工作区、设备和 Lease，跨连接凭据、旧资源复活、交接期间准入、撤销后及迟到提交。 | 同一范围重开从首面续读；旧版待扫描标记需要显式刷新，失败时保留前次结果。 | 具名开发范围、获准 Seller API 的账号以及可核对的卖家清单。 |
| **Spaceship Registrar 账户库存** | 设置中原生连接、刷新、查看持久汇总和断开。 | 固定官方端点与最小读取权限，校验完整分页，凭据与联系人引用留在 Native。 | 签发 `spaceship:registrar:observe` 并接收普通资产同步。 | 连接准备、刷新意图和扫描回执持久；观察、资产、Outbox 原子提交。 | 拒绝代次替换、过时结果、无效页、撤销和最终栅栏失效。 | 重开重读已持久发起的扫描，保留上次完整结果。 | 真实验收需要具名开发范围、受控账户的 `domains:read` 凭据及可核对域名。Windows/macOS 分别取证。 |

新增域名能力的验收还必须覆盖：Host-owned 报价与单项确认、Grant/Lease/凭据代次即时复验、
计划摘要与资源绑定、未知结果对账、批量逐项结果和 Provider 页面回跳不构成成功。当前实现还包括下文 Afternic 归集与下架的有界生产组合。绑定合同、Desktop IPC 适配器和 Rust 事务测试覆盖严格请求/回执、实体和代次相关性、首次提交、精确重放、拒绝零写及 fence 回滚；这些本地测试不证明绑定 UI、完整能力门禁、撤销或真实 native/Zone 资格。目标能力不得借现有只读证据获得执行许可。

## 多平台交付阶段验收

本节是 [路线图](ROADMAP.md#当前执行顺序) 各阶段的验收标准。每一阶段收尾都必须满足通用条件；某阶段的
PASS 只覆盖该阶段，后续改动会使旧证据失效。

**通用条件（每阶段）：**

- 根 `pnpm check` 在 umask `002` 与 `022` 下都通过，PR CI 的 `quality`、Windows 与两个 macOS job 全部通过，`git diff --check` 干净。
- 生产 UI 只经 `@gooddealer/ui`、`@gooddealer/i18n` public exports 使用 `brand/` 移植资源；presentation inventory 计数测试通过。
- 资格前的能力在 UI 中显示不可用及原因，生产入口不存在可执行路径。
- 凭据只在 Host custody；日志、错误、Renderer 与非秘密持久化中没有凭据 canary。
- 独立评估者给出 PASS，当前态文档已同步。

| 阶段 | 验收标准 |
| --- | --- |
| **1. 当前态收口与冻结候选** | 全仓扫描后没有把局部 PASS 写成 V1 验收或外部资格的当前文档；冻结候选有提交引用和可复现的检查输出。 |
| **2. Desktop 设计页面生产组合** | 每个设计页面在真实构件中可达，并与 `brand/ui_kits/desktop` 对照无明显偏差；数据只来自 Host 投影，不依赖 `visual-fixtures`；人工任务没有浏览器执行或授权字段（合同负向测试覆盖）；没有接线的控件不存在死按钮。 |
| **3. Cloudflare 路径稳定** | 引导流程端到端可走通，跳过连接后可手动添加；导入与手动添加不产生重复资产；断网、Token 失效、权限不足和撤销后均失败关闭并给出可恢复提示；撤销是原子的，并在 Host 中即时生效。 |
| **4. 当前范围全系统 V1 汇合验收** | 本文件上方 v1 详细垂直验收表的每一行都在同一冻结候选上取得新鲜证据并通过独立复审；10 万资产每次分页读取在 release 构建下不超过 1 s（用户 2026-11-06 确认的预算，见 [DATABASE_SCHEMA](DATABASE_SCHEMA.md)；100 万资产只记录）。 |
| **5. 多平台共用框架与 Cloudflare 全能力** | 合同从 `unknown` 严格校验，未知字段与未知状态拒绝；负向测试覆盖越权、跨租户、伪造 grant/bid、角色串用凭据和批量部分失败；Cloudflare 每项写能力都有报价/预览 → 非资金整批确认或资金单项确认 → 执行 → 未知结果对账链路，重试幂等；框架中没有任何平台专有逻辑。 |
| **6–10. 各平台（按 ADR-0027 顺序）** | 平台事实快照为当次核对并附官方链接；能力清单覆盖四种角色，每项能力要么有资格证据，要么带原因标记为不可执行；每次出价与资金操作单独确认，不存在代理或自动出价；平台专有安全约束（HMAC、IP 白名单、query-string token、最小 scope）都有负向测试；新增平台不得绕过核心模型；如发现模型缺口，修复其所属模块并在架构边界变化时补 ADR。 |
| **11. 1.0 资格与发行** | 所有外部资格在 [Phase 0 外部资格台账](phase0/PHASE0_GATE_REGISTER.md) 中关闭；`pnpm gate:validate` 对 attestation 通过；最终构件签名/公证与 `1.0.0` / `stable` 批准完成。 |

## 可恢复性交付：业务备份与 Cloud 恢复

产品负责人已要求换机云恢复和独立业务备份。两条用户旅程都需要明确恢复数据、密钥保管、
原设备丢失、云不可用、冲突与未同步数据的行为，并以真实故障演练验收；已确认的 Windows/macOS
互相恢复、用户自选本地备份位置与最近一次备份目标见
[ADR-0023](adr/0023-business-backup-and-recovery.md)。下列门槛描述既有安装绑定 GDBK v1 和 rebootstrap 协议，
不预先限制新恢复方案必须继续使用同一安装绑定，也不把当前缺口排除出交付目标。
`gooddealer-local-storage` 已有 strict format、allowlisted projection、isolated candidate、guarded
current-DB replay 和私有测试协议，但该 v1 组合的生产 capability 保持 `unavailable`。它们不能被用于弥补
账号、授权、本地业务、同步或 Connector 的 V1 验收缺口，也不能被描述为灾难恢复。

### 账户归集后的注册资料

资产列表、域名详情和续费台使用 Cloudflare、Spaceship、阿里云各当前连接的最后完整扫描。SQLCipher 用例核对续费窗口、到期提示、自动续费计数和注册锁字段；变更资产代次、两个连接给出冲突资料、最新完整扫描缺席或凭据撤销时核对历史隔离。账户已观察的本代资产在证据不足时显示未知，旧资产历史和持久回执仍可审计。

### GDBK v2 独立备份

验证从当前授权创建两份文件，关闭并移除源库及其 SQLCipher key，以无授权 Host 打开，按页查看并导出 JSON。验证材料缺失、错钥、篡改、重排、尾随数据、目标已存在、发布前撤销授权及用户取消。Linux GTK 已验证原生选择和取消；在 Xvfb 与隔离 D-Bus 会话中，还通过未登录的 Linux 桌面完成合成备份解密、页面读回及原生对话框 JSON 导出。Windows/macOS 分别需要在目标系统核对文件权限、原生选择、持久发布以及双向复制后离线恢复。

授权导入回归覆盖无 Active 时拒绝、预览替换和目标资产变化后拒绝旧确认、最终授权变化时回滚整批新增、补齐与 Outbox、原工作区数据及墓碑保留、同一计划回放返回已提交结果、关闭重开后常规创建标记与单一回执仍在。勾选补齐空字段后，待确认预览列出具体备份值；旧代次和待确认重新添加拒绝补齐，已存在的非空字段保留，未新增资产的补齐计划也可以确认。

### 既有 GDBK v1 本地实现证据门槛

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
| v1 排除项 | 嵌入式/自动化浏览器、非域名 Provider 产品、首发清单外平台、代理出价、团队/多工作区、凭据迁移和 CSV import 没有可达产品路径；未资格化的域名外部 mutation（含交易市场与获取）同样不可达。 |
| 视觉与夹具 | `brand/`、视觉 fixture/gallery、样例数据和 disabled 控件只能用于展示 QA，不能证明状态、授权或外部结果。生产 UI 只消费 `@gooddealer/ui` public exports、声明的 tokens/assets 与 `@gooddealer/i18n` public exports。 |
| 过渡面 | 不存在旧路由、双 data/session 路径、兼容 API、别名、临时 adapter、迁移桥或未经声明的浏览器/提供商 fallback；ADR-0027 的具名私有协议实现不是隐式重试路径。 |
| 当前 Desktop 图 | production 入口只允许具名本地业务、认证、同步与 Cloudflare adapter；任何新增命令需同步 manifest、handler、capability、adapter 与策略测试。 |

## 官方、社区与私有 Provider 接口

[ADR-0027](adr/0027-multi-platform-domain-providers-and-marketplaces.md)明确已确认官方能力走官方 API，当前其余能力缺口全部自研私有 API；社区代码仅作参考。实现时必须验证：

- 固定 HTTPS 目标与重定向边界、当前账户绑定、会话过期/撤销、CSRF、登录页/未知 wire 拒绝；
  Cookie、Token、操作密码不进入普通持久化、Renderer、备份、Cloud、日志或错误。
- HTTP GET 仍可能有写入副作用；预取、探活、缓存和通用重试不得触发 Atom 等平台的写操作。
- 批量部分失败、超时未知结果、重开续作、价格单位、交易锁定和实现版本变化；写入失败不自动
  切换另一条接口执行。公开市场在售、请求受理和页面回跳不构成账户归属或验证成功。
- 社区源码引用须确认许可证与当前协议；不得复制 Cookie 明文文件、HTTP 秘密请求、费用或锁定默认值。
  Windows/macOS 分别完成 Native 会话输入/custody 验证；未取得外部资格前不宣称真实平台可用。

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


## 普通交接来源的回执与续作验收

- Cloud：严格 v2 view、错 source/target/epoch/proof/release reason、跨账户/工作区、重复 consumed proof、forced 冒充 normal、引导完成/失败后历史仍可读；真实 OAuth 登录来源 Lease 能启动普通交接。
- Native/Host：已签 body→公开 attempt→HTTP 顺序的崩溃窗口；无 attempt 的 Native 孤儿清理、已登记请求精确恢复、未知先对账、确定拒绝不再发送；不可向 Renderer、日志或业务备份泄露签名请求。
- SQLCipher：同 request/proof/target/barrier/最后本机 Active epoch 绑定；刷新/撤销/最终提交时失效全页回滚；重复页不增 readGeneration，错确认 token 拒绝，retired cursor 重开仍冻结；旧普通交接证据不得解冻后来强制接管的库。
- 此范围的源码与 PostgreSQL PASS 不代表目标引导/完整交接界面或 Windows/macOS 双机资格。完整设备验收仍须真实系统、部署签名用途、当前会话、设备钥匙与目标激活链路逐项取证。


## Afternic 连接、库存归集与具名商业权限

- Cloud/协议：role v5、Active Grant v4/commercialAuthority v2；具名 capabilities 严格升序唯一、write 依赖 observe、空集合不授予 Provider；锁定商业快照的精确交集，不从套餐或其他平台推断。
- Native：旧 floor 映射历史 Cloudflare 单权限并保留所有防重放/未知 lastActive 语义；相同 revision 或 digest 禁止权限/期限变化；新 revision+digest 可撤权，旧 admission 在 await/最终提交处拒绝。现有三种签名用途继续隔离。
- 存储：只追加 `202611180003`，保留已应用 SQL/历史绑定；完整扫描资产/Outbox/观察原子提交，多连接隔离，空库存/已删除全部跳过不伪造观察；prepared 新 Grant 与真实关闭重开后恢复原 proof；revoked handle 拒绝 Provider，撤权后仍可首次撤销与 purge；最终 epoch 变化回滚所有事实。
- 生产组合：四个严格 raw IPC、固定 Provider 端点、Native-only 凭据、共享串行 lane 与两个具名恢复准入；refresh 仅加载既存 slot；lost response 仅读取状态，queued 不表示成功；Renderer role/permission/qualification/capture 条件分别约束入口。
- 首次 Native 凭据完整只读预检发生在唯一连接槽的保留之前。迁移 `202611200001` 保留空扫描的观察顺序：缺席降为未知并使读缓存失效，原绑定不动。同秒随后收到的精确观察可以更新显示，旧预览须在批准时重新核对最新扫描中的同一事实。写入 429 沿原尝试持久保存首次 GET 的可执行时间，重开只读对账。
- 检查结果与独立评估记录见 [Afternic 审查](reviews/2026-11-19-afternic-inventory-review.md)。测试 store、TLS fixture 与源代码组合不构成真实账户、Windows/macOS custody/capture、OpenBao 部署或发行资格。资格清单继续关闭；下架计划和上架/改价的本地验收见下文，私有验证及 DNS 客户闭环仍须实现；真实接口与目标系统另行验收。


## Afternic 整批下架、后台执行与重开对账

- 持久预览绑定完整 Listing 前像、源完整扫描/观察、资产代次、连接 incarnation/凭据代次、原绑定和适配版本；覆盖过期、篡改、跨租户、重复目标、目标缺项及未知字段。
- 同一预览重复/真正并发批准只产生一个 operation；并发 claim 只发出一个非序列化许可。发送前后崩溃及 SQLCipher 关闭重开仅恢复 GET，跨新计划/新绑定不能绕过未决同域名请求。
- 精确缺席和 detach 同事务/最终栅栏提交，普通撤销/新 incarnation 不能借旧回执伪装成功；原 unknown 尝试保持不可变。混合已解决/未解决 unknown 的通用批量计数必须各归其类。
- 失败 GET/仍存在持久只读退避，普通指数延迟封顶 900 秒，合法完整 u32 Retry-After 可延长；不提前调度。空轮询和重复批准不推进 readGeneration。
- 交接 progress 与 proof 独立拒绝已有下架尝试的虚假空流；并发批准与屏障/签证不能同时成功。屏障拒绝新预览/批准/claim/发送，queued/running/unknown/终结历史和重开均覆盖；屏障冻结来源流后迟到 GET 不能追加旧 epoch 观察或审计。原机以后重新取得执行权时须重新 GET，以新上下文关联原事实，不能补造旧响应证据。
- Native 在可能阻塞的 Host 复核前后检查 power/cancel；休眠先原子失效旧 epoch，关闭只唤醒一次，缺失/损坏 slot 进入 remediation，暂时 custody 不可用仅退避。下架专用 guard 不能被宣称为所有既有 Provider 流程的休眠保护。
- UI 批准严格对应当前选中计划，换计划/角色降级/工作区替换期间不能批准旧详情；丢失响应只查状态，防重复点击；summary/detail 状态与计数均严格校验。
- 证据及修复见 [下架审查](reviews/2026-11-19-afternic-delist-review.md)。目标源码编译不替代完整应用目标构建、OS 注册/休眠/凭据实机、真实 Afternic 和发行资格；未取得这些证据时资格登记保持拒绝。


## 执行证据与来源交接

- 当前执行上下文必须包含独立签名的当前授权摘要、Native nonce、同 boot 原始连续时钟样本；错用途、串租户、旧代次、撤销、上下文过期、休眠/重开及 boot 变化都需拒绝或重新取得上下文。历史 verifier 使用签发时不可变公钥证据，不能用当前 keyring 覆盖旧证据。
- 批量批准、item approval、claim fact 与配对审计在原业务事务提交；签名失败、撤销或最终栅栏变化全部回滚。claim 仅证明本地持久认领；前置拒绝和结果审计不得补造 Provider 成功。
- 原 audit/fact ledger 的生产 ingest/receipt/seal 须在真实 PostgreSQL 验证：跨租户/错用途、合法签名语义隔离、无效签名不污染流、因果前项缺失不占位、精确重复返回原回执、跨 epoch 同 attempt 并发唯一约束与已封链拒绝新项。
- 初始 request v2 保存后未发、发后响应丢失、回答与屏障提交间崩溃须从原幂等键 resolve；只有同 epoch 的 not-found 能重发原字节。更高 epoch 不自动新建，旧/未知 epoch 不建立新屏障。首次设备 bootstrap 没有来源 Lease，不得被普通交接 CAS 的数据库触发器误拒绝。
- SQLCipher 验证真实三流折叠、冻结未决数、取消递增代次、晚到 GET 拒绝旧 producer；Native 每轮有界上传、未知 ACK 精确重传、独立退避、shutdown join 和最终 credential/Host fence。后台交接不得被快速 evidence backlog 放大为网络重试循环。
- Renderer 从生产设置目录进入，目标名称和编号同时预览；确认一次、重开读取持久状态、待目标引导明确展示，未知/只读状态不发起新交接。无效或缺失未决计数不能显示成零。使用单一状态区域报告有意义变化，轮询不反复播报加载。
- 以上源码/数据库证据不替代真实 OpenBao 第四用途部署、真实 Provider、双设备目标引导与 Windows/macOS 实机验收；保留完整目标中的后续旅程。


## 目标引导终结与执行上下文发布

目标 status/cancel 必须由当前绑定会话派生账户、默认工作区、设备；跨目标、撤销、错误用途及未知 wire 拒绝。真实 PostgreSQL 分别证明取消与激活、步骤及过期的竞争，两种先后赢家均不会留下可用 pending epoch、nonce 或 pin；原来源 Lease 释放/三流 seal/回执保持，旧 id 重放不触碰新工作流。登录分配的无 workspace allocation 只有同账户个人默认绑定才允许 mutation drain，其他绑定仍拒绝。

Host 在没有业务数据库的 Standby 安装上也能持久确认、重开和精确对账；每个 custody 初始化前缀可恢复，已建立记录缺失/损坏拒绝。security epoch 变化要求重新确认，不能无限 pending，也不能自动重发旧确认。Native 401 不在终止链刷新或授予 Active；power/session/Host 变化阻止旧网络操作与发布。后台成功轮询和失败退避均独立于证据热循环。

执行上下文的慢验签/custody/SQLCipher 阶段与短内存发布分离。测试须证明持有 custody 锁时最终 publish 仍可完成、stage 丢失不保留旧执行权威、旧/外 Host stage 和 clock/boot/generation 变化拒绝；恢复保留原 t0。上述源码/数据库测试不替代 Windows/macOS 实机或双设备 OpenBao 部署资格。

### 目标设备首次安装验收

首次安装须从真实来源交接进入无副本目标的一次确认，恢复 Cloud 最后成功同步的非空资产、generation 和墓碑，再使用精确安装回执激活原 pending epoch。checkpoint 构建、读回核验、发布与 pin 在真实 PostgreSQL 同事务验证；Cloud 只读页必须按 UTF8 字节预算保持连续，最终摘要不得遗漏墓碑。签名器与独立 bootstrap 注册表不一致时 claim 不落盘。

SQLCipher 与 Native 验收必须覆盖 journal 每个持久前缀、请求发送前后崩溃、各类丢 ACK 的原回执对账、gen2 普通编辑/删除、缺页/重复字段/缺少必填 nullable 字段、并发激活与取消，以及初始化标记缺失/数据库截断拒绝。已有副本不能被首次安装覆盖；普通授权刷新不能发布尚未完成安装的库。取消意图须在未知激活对账期间保留，只有确认为 uncommitted 才继续取消，不重发激活。

终止后接收新工作流须验证原 Cloud 精确终态、同租户/安装/设备、可信未写库事实及新预览确认。覆盖原状态/receipt 丢 ACK、旧请求仍存于认证历史、v1 保守升级、完整/部分/缺失 Reserved 写入的重开、历史缺失/篡改/跨 scope/容量耗尽，以及 write-started 后取消、SQL 已提交但 journal 未确认、数据库截断等拒绝路径。记录 started 与实际 SQL 阶段分别重验终态和取消；Native 串行锁不能代替 Host 边界。轮询 allowed 不得启动；新工作流出现不能隐藏旧阻塞，资格变化须撤回预览。

最终仍需根 `pnpm check`、独立审查、Windows/macOS 分别编译与实机证据。源码测试、本机 PostgreSQL、目标编译均不等于部署的 OpenBao 第五用途、真实双设备或发行资格。

### 强制接管至首次云恢复验收

目标从专用浏览器重新认证开始，经新来源预览、一次批准、持久 waiting、期限后领取、非空 checkpoint/mutation 安装和 Active＋新鲜 execution context 后开放资产；登录本身、轮询和缓存 claimable 都不能创建或批准新意图。必须分别验证 Fresh、可信未写库终态可接收、已有副本拒绝且不释放来源。已有副本和无 held 来源云恢复仍在总交付范围。

真实 PostgreSQL 以生产角色验证原密码/Passkey 会话五分钟期限、code 绝对期限、refresh 不延长、单次消费与回滚、来源 CAS、精确幂等、未知请求 cancel-intent 墓碑阻止迟到 POST；跨租户/设备/密钥/用途、撤销和并发均拒绝。Lease 历史上限覆盖同 epoch 较短续租、released 旧记录、伪 normal 标签及完整 consumed proof 例外；历史 block 同时阻止 Grant、Lease 与 execution-context。慢签名跨 waiting 边界/期限回滚，claim/cancel/renew 竞争保持单 Active。

Host/SQLCipher 验证 claim 前持久安装资格、v3 forced origin、原请求/receipt 丢 ACK 和重启、取消与领取竞争后沿原 bootstrap lane 终止、未知激活先对账、终态证据跨 scope/代次拒绝。Native 复用目标 mutex 并在唤醒安装前释放；独立等待/退避不随 evidence 热唤醒转为循环。Renderer 和 IPC 必须使用相同真实 raw wire，严格拒绝 JSON 包装、重复键及未知选择器，资格变化丢弃迟到预览。

部署迁移 026 前核对历史 Lease；保守回填以锁后切换时刻加 24 小时为最低上限，可能导致额外等待。它不能撤销已经发出的离线权威或修复历史重叠。源码、真实本机 PG/SQLCipher、Linux/Windows 目标严格检查与独立审查记录在 [执行台账](phase0/PHASE0_EXECUTION_PLAN.md)；实际部署、双设备、macOS/Windows 实机和发行资格仍单独验收。

## Afternic 持久上架、改价与平台等待

- 四字段 create 与非空所选键 update 从 unknown 严格解析；拒绝重复域名/键、未知字段、null、非整美元、浮点和越界，保留明确的 0/false。预览从完整库存与当前代次冻结，变更目标/连接/价格/所选字段必须重新预览。
- 真正并发批准只创建一次父执行，queued→running 事务唯一领取 POST/PATCH；发送前持久签名批准、配对审计和 fact。任何 HTTP 响应、提交失败或重开遗留 running/unknown 均先 GET，不重新写入。
- create 已存在、update 缺席、前像漂移和跨 create/update/remove 未决冲突拒绝；最终栅栏同时回滚结果、绑定、观察与审计。原下架签名与 FK 在追加迁移后保持原样。
- `fieldsMatched` 只表示批准字段匹配。OWNERSHIP_* 持久待验证、PENDING/INACTIVE/ON_HOLD/UNKNOWN 持久平台等待，真实状态与指数只读退避保留；SOLD/合规/所有权冲突不能显示完成上架。
- Cloud 030/031 直调 append 同样验证 purpose/action/event/target、签名、跨租户、历史 epoch、配对 audit、并发与封链；旧 remove 领域不变。
- 三个 raw IPC、原 ProviderLane、客户表单/历史/详情及工作区发布版本边界分别验证。交接冻结后迟到响应不追加旧来源流。
- 独立记录见 [上架/改价审查](reviews/2026-11-19-afternic-listing-write-review.md)。源码/真实 PostgreSQL 与 SQLCipher 通过不替代 Linux 真实账号、Windows/macOS 实机或发行资格；私有所有权验证/DNS 仍未实现。

## Afternic 首次真实接口验收

Linux 真实账号已通过连接、完整库存归集和重开复读。首次新增 188 个资产，重开再次读到 188 个且新增 0。用户已在桌面界面确认数据正确。剩余真实写入从受控 `wecin.com` 预览开始。 [执行台账](phase0/PHASE0_EXECUTION_PLAN.md#2026-11-20-afternic-linux-真实库存归集)

通过真实开发 Cloud 的签名授权，在 Linux debug 构建使用设置中的 Afternic 入口。确认界面展示 `wecin.com` 和截止时间，原生窗口单独接收凭据，完整库存归集后可以查看持久资产及 Listing。预览整批一次确认，依次核验上架、改价和下架，记录精确 GET 的实际结果。重启使用同一槽，遗留未知写入只查对账。真实动作、签名与服务端证据按 [受控验收工作包](phase0/AFTERNIC_CONTROLLED_ACCEPTANCE_TASK_FRAME.md) 记录。

源码验收另覆盖默认构建关门、Linux debug 之外构建拒绝、续期内同一 Lease epoch 复用、越域与跨连接、代次漂移、休眠、过期签名与提交栅栏、SQLCipher 关闭重开以及迟到 UI 回复。Linux 开发取证后仍需确认 Windows/macOS 实机和生产资格。
