# GoodDealer License 与商业授权

状态：Accepted Product Baseline / Evidence Pending
更新日期：2026-08-14

## 1. 商业模式

计划提供：

- 月付 License。
- 年付 License。
- 终身 License。

License 控制的是软件使用权和版本权益，不参与域名平台操作。GoodDealer Sync Service 可以保存域名业务数据，但不得保存平台操作凭据。用户必须登录 GoodDealer 账号并通过设备与授权门禁后才能进入主界面。

## 2. 控制面边界

远程服务只负责：

- 账号注册、登录、会话刷新和安全恢复。
- 支付结果同步。
- License 签发、激活、续期和撤销。
- 所有平台合计最多两台设备的绑定、查询和解绑，以及单活动设备切换。
- 版本权益和更新通道。

Account/License 模块不处理域名业务 Payload；独立 Sync Service 处理业务数据。平台凭证不得经过任何 GoodDealer 服务端模块。

GoodDealer Staff 通过独立 Admin API 查询和处理订单、退款、Entitlement 与设备问题。License 人工调整、退款介入、设备强制移除和版本/Sunset 通道变更必须经过 Staff Scope、重新认证和审计；管理员仍不得接触平台凭证或代表用户执行域名操作。

## 3. 登录与授权凭证

客户端使用四类职责分离的凭证：

- `Auth Session`：用于在线账号请求，由短期 Access Token 和可轮换 Refresh Token 组成。
- `Offline Device Lease`：证明账号曾登录、当前安装已绑定，并允许在 `access_until` 前离线进入门禁。
- `Entitlement Token`：短期、可刷新的签名凭证，投影 Cloud 权威 `AccountEntitlement` 的计划、商业有效期、离线宽限和设备名额权益；它自身的 `expires_at` 不等于 Lifetime 商业权益到期。
- `ActiveDeviceLease`：证明本设备是当前唯一执行设备，并在 `offline_execute_until` 前允许业务 Mutation、平台访问、批准和执行。

四者均与 `account_id + device_id` 绑定。Desktop 的短期 Access Token 只驻留 Rust Secure Host 内存 Session Store；可轮换 Refresh Token、Entitlement Token、Offline Device Lease 和 ActiveDeviceLease 才持久化到 OS Keychain/Credential Manager。启动时由 Host 使用 Refresh Token 换取新 Access Token；普通 WebView、TypeScript、配置和日志不得保存任何原始凭证。

除永久离线 Sunset Credential 外，所有账号作用域的服务端签名在线凭证都使用强类型 Envelope，至少包含：

```text
typ
iss
aud
kid
schemaVersion
accountId
deviceId
accountSecurityEpoch
jti
issuedAt
expiresAt
payload
signature
```

本文领域说明其余位置使用 snake_case 语义名；`protocol/devices` 的公开 JSON Wire 一律使用 lowerCamelCase，并做显式一对一 Codec 映射，例如 `account_id <-> accountId`、`offline_execute_until <-> offlineExecuteUntil`。签名 canonical bytes、Strict unknown-field 校验、TypeScript/Rust/Cloud Golden Corpus 都以 Wire 名为准；不得把领域对象直接序列化或同时接受两种大小写。

所有安全代次（`account_security_epoch`、`credential_epoch`、`lease_epoch`、Key Version、Entitlement Revision）在线协议统一限制为 `1..Number.MAX_SAFE_INTEGER`，绑定 Challenge 的初始 `expected_key_version` 可为 `0`；TypeScript 与 Rust 在入口同时拒绝越界值。若未来需要更大范围，必须升协议版本并改为规范十进制字符串，不能继续使用 JavaScript Number。

Auth、Entitlement、OfflineDeviceLease、ActiveDeviceLease、Bootstrap Capability、`RecoveryCapability(purpose=local_recovery)` 和 Sunset 使用独立签名 Key，或不可混淆的 Key Purpose 做密码学域分离。Bootstrap 与 Recovery Capability 的 purpose、签名域和解析器互相拒绝，不能把激活只读能力兑换为恢复能力或反向复用。每个解析器先固定预期的 `typ + iss + aud + schema_version + key purpose`，再验签和解析 Payload；跨 Token 类型、未知字段、未知版本、非规范编码和未知或已撤销 Key 一律拒绝。账号在线凭证的 `jti` 必须在签发时全局唯一，服务端不得为两个不同凭证重复签发同一 JTI；一次性 Challenge 和轮换后的旧 Refresh Token 被消费后拒绝复用。Bootstrap/Recovery Capability 是 workflow-scoped 短期能力，不是首次呈交即失效：其每一步使用独立 step nonce/单调 step number 和服务端 CAS，只允许按冻结状态机重复呈交同一步的相同请求并返回同一结果，完成/放弃/到期后原子消费整个 Capability，跨步骤、并发不同 Payload 或完成后重放全部拒绝。Auth Session、Entitlement Token、OfflineDeviceLease 和 ActiveDeviceLease 是有效期内可重复验证的 Bearer Credential，正常重复呈交同一 JTI 不算重放，只按撤销、设备/Epoch、可信时间和风险状态判定。签名预映像使用版本化、长度定界的确定性编码，不直接签普通 JSON 字符串。设备绑定与密钥生命周期见 [ADR-0011](adr/0011-device-identity-lifecycle.md)。

Desktop 的 cloud-client 不读取或持有这些 Token。它只构造不含原始 Token 的类型化账号/Cloud 请求，并通过 TypeScript Tauri Adapter 交给 Rust `secure-http`；Secure Host 校验 Endpoint Allowlist 后从内存 Session Store 注入短期 Access Token。登录、刷新、撤销和轮换属于 Host-owned Session Command：Rust 持久化轮换后的 Refresh Token，只把 Access Token 放入 Host 内存，并只向 TypeScript 返回脱敏 AuthSessionStatus。Desktop 账号密码由品牌化 Local App WebView 表单通过专用 write-only IPC 直接交给该 Rust Command，原始值不持久化、不记录；其请求 Schema 只属于 Cloud `identity` 内部，不进入 `packages/protocol`。Host-native 输入保留为发布前安全复核的加固选项。account-web 使用独立的同源 HttpOnly/SameSite Web Session，不复用 Desktop Token 存储。

应用启动先进入 Account Gate。在线时以可刷新 Auth Session 校验账号，离线时以有效 Offline Device Lease 校验账号；同时要求设备绑定和 Entitlement 有效，随后 Standby 可以进入 Cloud Read-Only View。只有本机 ActiveDeviceLease 也有效时，Secure Host 才打开完整业务数据库及其中只承载 SyncMutation 的 MutationOutbox，并启用连接器和 Worker。ExecutionFact/DeviceAuditEvent 的原始签名 Envelope 先写入与业务库分库分钥的追加式 `evidence-spool`，不属于 Active Workspace 或 MutationOutbox；非 Active 状态只能通过状态机明示的窄读口访问该 Spool。普通 Access Token 到期只触发后台刷新，不单独导致 Locked。用户启用“记住此设备”后可静默恢复登录，不要求每次手输密码。

Cloud `licensing` 保存权威 `AccountEntitlement`；只有 `state=active | grace` 才能签发或刷新有期限的 Entitlement Token，`pending | suspended | revoked` 不签发新 Token。此前签发的 Token 仍按账号/设备 Epoch、撤销状态和自身有效期处理，不能仅因本地缓存状态继续刷新。客户端内置公钥并在本地验证；Envelope 始终含 `expires_at`，Payload 至少包含：

```text
license_id
entitlement_revision
payment_watermark
plan
entitlement_kind: subscription | lifetime
commercial_expires_at: ISO-8601 | null
offline_grace_until
device_limit: 2
active_device_limit: 1
standby_cloud_read: true
feature_entitlements
all_major_versions: true（Lifetime）
```

所有时间字段使用真实存在日期的规范 UTC 秒格式 `YYYY-MM-DDTHH:mm:ssZ`。Envelope 必须满足 `issued_at < expires_at`。ActiveDeviceLease Payload 固定 `lease_epoch/renew_after/online_expires_at/offline_execute_until`，并满足 `issued_at < renew_after < online_expires_at <= offline_execute_until = expires_at <= issued_at + 24 小时`；Wire 分别为 `leaseEpoch/renewAfter/onlineExpiresAt/offlineExecuteUntil`。订阅 Token 总是满足 `commercial_expires_at <= offline_grace_until` 且 `issued_at < expires_at <= offline_grace_until`：由 `active` 聚合签发时 `issued_at <= commercial_expires_at`，由 `grace` 聚合签发时 `commercial_expires_at < issued_at`；客户端使用签名时间字段和可信时间判断当前处于商业有效期还是离线宽限，不接受调用方自报状态。`entitlement_kind = lifetime` 只在聚合为 `active` 时签发，且 `commercial_expires_at = null`、`all_major_versions = true`；这表达永久购买事实。外层凭证仍按安全策略到期并免费刷新，以传导账号安全、设备移除、退款或欺诈处置。实现不得把外层 `expires_at` 解释为 Lifetime 购买失效，也不得用 `plan` 字符串隐式推断上述字段。Wire Golden Corpus 同时覆盖 active/lifetime 与 grace 路径，并包含外层 expiry 超过 grace 和 Active 离线窗口超过 24 小时的负向向量；它仍只是格式证据，不等于 R0-06/JF-11 已关闭。

### 3.1 AccountEntitlement 权威聚合

Cloud `licensing` 以追加式 `ProviderPaymentEvent` 和受审计 `ManualEntitlementAdjustment` 为输入，唯一拥有 `AccountEntitlement` 聚合。最低字段包括 `account_id/entitlement_revision/payment_watermark/state/plan/entitlement_kind/commercial_expires_at/offline_grace_until/device_limit/active_device_limit/feature_entitlements/all_major_versions/derived_event_hash/updated_at`。`state` 只表达 `pending | active | grace | suspended | revoked`；Handler 不得用 `plan` 字符串或 Provider 特有分支绕过下述版本化商业映射。

每个账号的支付流一次只允许一个活动 Provider，并以单调 `billing_source_epoch` 分段；更换 Provider 必须先追加不可变 `ProviderMigrationBoundary`，固定 `boundary_id`、旧/新 Provider、旧 Epoch、新 Epoch、旧流的 `closed_frontier`、`closed_event_count`、`closed_event_set_digest` 与封口 Entitlement 摘要。三项 `closed_*` 字段共同定义旧 Epoch 唯一的 admitted reducer input 集合，Boundary 创建后禁止向该集合增加、替换或删除任何 Provider 事件或人工调整。每个 Epoch 的 Adapter 在启用前固定唯一 `ordering_mode: authoritative_sequence | occurred_at`：前者要求该 Epoch 的全部事件都具有同一可比较 Provider sequence/version，后者统一使用规范 UTC `occurred_at + provider_event_id`；不得逐事件混用两种时间轴。Epoch 内输入的规范 `effective_order` Schema 为 `(billing_source_epoch, source_position, precedence, stable_id)`：`source_position` 在 sequence 模式为 Provider 的规范无符号十进制 sequence/version，在 occurred-at 模式为规范 UTC 秒时间；`precedence` 的封闭编码与顺序固定为 `0-before-provider < 1-provider < 2-after-provider`；整数使用无符号十进制规范编码，字符串按 UTF-8 字节序比较。跨 Epoch 先比较 `billing_source_epoch`，同 Epoch 再比较其固定 ordering mode 下的 `source_position`、`precedence` 和 `stable_id`，因此 Provider 事件与人工调整落在同一位置时仍有唯一顺序。

每个 `ProviderPaymentEvent` 以 `(provider, provider_event_id)` 幂等保存原始类型、Provider customer/order/subscription 引用、Provider sequence/version（若该 Epoch 使用 sequence）、`occurred_at/received_at`、`billing_source_epoch`、已验证 Payload Hash 和完整 `effective_order`。其中 `source_position` 必须来自该 Epoch 已冻结 ordering mode，`precedence=1-provider`，`stable_id` 是 `provider` 与 `provider_event_id` 的版本化长度定界规范编码，不能用字符串拼接产生歧义。每个 `ManualEntitlementAdjustment` 至少保存 `adjustment_id`、创建时 CAS 的 `expected_entitlement_revision`、上述完整 `effective_order`、显式 `supersedes[]`、actor/Staff Security Epoch、AdminPurposeRef、原因、参数 Hash 和重新认证证据；其 `precedence` 只能为 `0-before-provider | 2-after-provider`，`stable_id=adjustment_id`。同一 `adjustment_id` 不同内容拒绝。人工调整由操作者在当前 Provider frontier 的预览上选择生效位置，服务端写入不可变排序元组；`precedence` 只解决同一 `source_position` 的 Provider/人工先后，`supersedes` 只覆盖明确列出的较早输入。

内部 Fixture/人工不可售 Entitlement 的空支付流使用唯一规范初始态：`billing_source_epoch=1`、`provider=none`、`ordering_mode=authoritative_sequence`、frontier `0`。该 Epoch 禁止 ProviderPaymentEvent；每个 ManualEntitlementAdjustment 在账号事务内取得从 `1` 开始的单调 `manual_source_position`，写入 `source_position=manual_source_position`、`precedence=2-after-provider`、`stable_id=adjustment_id`。以后接入真实 Provider 必须追加 ProviderMigrationBoundary 并从新 Epoch 开始，不能在 `provider=none` Epoch 混入支付事件。这样无 Provider 账号也能构造唯一排序元组，且不会依赖不存在的 Provider frontier。

Reducer 每次都从完整 admitted reducer input 按 `effective_order` 重放。`ProviderMigrationBoundary` 是两个 Epoch 之间的边界记录，不进入任一 Epoch 的 `effective_order`、不与同位置 Provider/Adjustment 竞争。`authoritative_sequence` Epoch 只有在 `closed_frontier` 以内 sequence 连续无 Gap、重复 ID/sequence 冲突已失败关闭且 Provider reconciliation 已完成时才能封口；`occurred_at` Epoch 必须取得 Provider 的最终 Export/Snapshot，把对账范围及其摘要绑定进 `closed_event_set_digest` 后才能封口。Reducer 必须重放 Boundary 冻结的旧 Epoch admitted 集合，逐字节验证 `closed_event_count + closed_event_set_digest +` 封口 Entitlement 摘要，再把该不可变快照作为新 Epoch 初始状态。

Boundary 创建后才到达、声称属于旧 Epoch 的 Provider 事实以独立 `LateClosedEpochProviderEvent` 历史/对账记录保存，保留其原始 `effective_order`、Payload Hash、接收时间和关联 Boundary，但不进入任何当前或旧 Epoch 的 admitted reducer input，不修改 Boundary，不推进 `entitlement_revision` 或 `payment_watermark`，也不能伪装成新来源事件。若该迟到事实应改变当前商业结论，必须在当前 Epoch 追加显式引用它的 `ManualEntitlementAdjustment`；该 Adjustment 才进入当前 reducer、revision 和 watermark。这样既不按到达顺序覆盖人工调整，也不暗中跨越迁移边界。若商业意图是人工结论持续覆盖未来事件，必须由新的 Adjustment 显式 supersede 对应事实，不能依靠“最后写入”。接受 Adjustment 时在同一账号事务锁定并核验 `expected_entitlement_revision`，成功后至少递增一次 revision；并发或预览过期要求重新生成 Adjustment。`payment_watermark` 是当前 Entitlement Revision 实际消费的 admitted ProviderPaymentEvent、ProviderMigrationBoundary 与 ManualEntitlementAdjustment 的规范 ID、Payload Hash、排序和 supersedes 关系的域分离摘要；人工调整因此会推进 revision 并改变 watermark。签发 Entitlement Token 时把二者写入 Payload。消费点要求 `entitlement_revision` 只能递增；同一 revision 的 `payment_watermark` 必须逐字节完全一致，更高 revision 的 watermark 只做该 revision 的完整性绑定，禁止按字符串或数值大小比较 watermark。

支付商业映射固定为：

- 订阅续费失败进入 7 天 `grace`；宽限内付款成功恢复 `active`，宽限结束仍失败转 `suspended`。
- 取消订阅在当前已付周期结束生效且不自动退款；升级在补差价支付确认后立即生效，降级在下一续费周期生效。
- 首次购买默认提供 14 天全额退款窗口，但销售地强制法律和数字内容规则优先。
- 部分退款默认只改变支付余额，不改变 Entitlement；只有封闭 Provider 原因码或受审计 `ManualEntitlementAdjustment` 才改变当前权益。
- 已确认拒付或欺诈零宽限并立即 `suspended`；普通支付失败不得归类为欺诈。
- Lifetime 全额退款撤销 Lifetime Entitlement；部分退款默认不撤销，除非存在显式、受审计的 Adjustment。
- 退款、拒付和人工调整只追加新事实，不改写既有 ProviderPaymentEvent。

JF-11 只有在重复、乱序、延迟、退款后续费、人工调整，以及两种 ordering mode 的封口、Gap/未完成 reconciliation 拒绝、Boundary 后迟到事件历史化和当前 Epoch 显式 Adjustment 传导的事务 Corpus 全部通过后才能关闭。设计获批不替代该证据。

签名建议使用 Ed25519。私钥只存在于 Account/License 控制面，客户端只包含公钥。

## 4. 月付与年付

- 激活后允许一定离线宽限期。
- 客户端在 Entitlement Token 剩余有效期进入刷新窗口后后台换取新凭证。
- 刷新失败使用指数退避，不因一次网络失败立即降级。
- 退款、拒付或欺诈撤销在下一次成功联网刷新时传导；离线期间受已签名 Token 和宽限期约束。
- 宽限期内无法访问授权服务仍可继续使用。
- 宽限期结束后退出业务主界面，回到账号/续费门禁页。
- 过期状态不允许查看资产、导出、备份、恢复或发起紧急下架；本地数据库保持加密且不删除。
- 恢复订阅并取得有效 Token 后重新进入主界面，恢复原有数据和任务状态。

离线宽限期固定为 7 天。

### 可信时间与时钟回拨

- 每次成功访问授权服务时记录服务端签名时间 `last_trusted_time`。
- 本地同时保存单调时钟进度和上次墙上时钟。
- 检测到系统时间明显早于 `last_trusted_time` 时，不延长 Token 或宽限期，而进入受限校时宽限。
- 休眠、时区切换和夏令时不视为回拨；所有判断使用 UTC。
- 可信时间记录带本地完整性校验，但不声称能抵御拥有本机管理员权限的攻击者。

## 5. 终身 License

- 终身 License 包含 GoodDealer 所有未来大版本，不设置 `max_major_version`。
- 终身 `AccountEntitlement` 永久有效，不依赖周期性订阅租约或再次付费；设备持有的短期 Entitlement Token 仍需免费刷新。
- Offline Device Lease 有效期为 30 天，剩余 7 天进入续签窗口，以执行账号安全状态、远程解绑和两设备上限。
- 首次设备绑定、换机、主动解绑、账号安全恢复和获取更新仍需要登录账号。
- 终身授权不绕过账号门禁；已记住的设备可以在 Offline Device Lease 有效期内离线进入主界面。
- 日常运行仍需有效 ActiveDeviceLease；永久停服时按第 9 节的延续承诺解除该依赖。
- 退款、欺诈或违反付款约定导致的撤销在客户端下次联网时传导；不声称能让离线设备实时撤销。

## 6. 设备管理

- 使用随机安装 ID 加不可逆设备摘要，不采集完整硬件序列号。
- 一个账号最多绑定两台设备。
- 任意时刻只有一台活动设备，另一台为 Standby；Standby 可读取 GoodDealer Cloud 已有业务数据，但不能产生 Mutation、读取外部平台、批准或执行任务。
- 第三台设备只能进入设备管理流程，解绑一台旧设备后才能绑定。
- 重装系统或换机可由用户自助解绑。
- Windows、macOS、iOS 和 Android 共享同一两设备额度与单活动设备规则。
- 远程解绑在 Cloud 接受请求时立即记录权威 `removed_at`、把 DeviceBinding 标记为 removed、撤销在线 Session/Scope 与后续 Lease 续签，并释放设备名额；若目标是 Active，新平台执行权仍等待原 `offline_execute_until`。目标设备本地只有在下次联网看到撤销或其已有签名凭证到期时才停止相应离线能力，因此不能声称对离线设备实时生效。
- 正常切换要求旧设备暂停任务，分别冲刷 Mutation、ExecutionFact、Workspace-scope DeviceAuditEvent 并通过签名 handoff DrainManifest 后释放 ActiveDeviceLease；Account-scope DeviceAuditEvent 独立续传，不阻塞 handoff。新设备先取得绑定切换请求的短期只读 Bootstrap Capability，完成重建和摘要校验后才取得递增 `lease_epoch` 的 ActiveDeviceLease 并进入可编辑主界面。
- 旧设备不可达时允许强制切换，但必须等待旧设备实际签名的 `offline_execute_until` 到期；该窗口最长 24 小时，也可能被更早截止收窄。
- 绑定设备通过 Sync Service 交接业务数据；平台凭据仍按设备单独配置，详见 [ACCOUNT_AND_SYNC.md](ACCOUNT_AND_SYNC.md)。

## 7. 过期与锁定行为

出现以下任一权威失败时进入 Locked：Entitlement 过期且离线宽限结束；设备绑定被移除；Offline Device Lease 到期且在线刷新被权威拒绝；本地凭证/数据库完整性校验失败。普通 Access Token 到期、暂时无法刷新或账号服务短时不可用不单独触发 Locked。

- 不打开业务数据库，不挂载主界面。
- 只显示登录、续费、设备管理、网络诊断、语言和退出入口；仅当 `lock_reason=local_integrity_failure` 且账号、设备绑定和 Entitlement 重新验证有效时，额外显示 Host-owned“本地安全恢复”入口。
- 不允许只读查看、导出、创建备份、普通业务恢复、平台写入或已售域名紧急下架。“本地安全恢复”是例外的窄 Recovery Shell：只允许输入 Recovery Secret 解封 Database Master Key、重建 Keychain 包装、执行密文/Schema 完整性检查，或选择转入隔离 Activating/Cloud 重建；它不得挂载主界面、读取业务行、恢复设备身份/Lease/批准或调用平台。修复成功后必须重新评估权威账号/设备/Entitlement，再进入 Standby 或 Activating，不能在 Locked 内直接恢复业务能力。设备 Removed、授权无效或其他 lock reason 不得借此入口读取旧业务库。
- 在确认授权失效时，调度器不再领取新任务；已经发出的原子请求不强行中断，保存最小恢复标记后停止后台业务处理。
- 锁定前尽力冲刷 Active Workspace 中的 MutationOutbox，以及独立 evidence-spool 中的 ExecutionFact/DeviceAuditEvent 原始签名 Envelope；冲刷失败不推迟锁定。未同步 Mutation 保留在关闭的业务库内，证据保留在分库分钥 Spool；恢复授权后按状态机允许的通道先续传再继续同步，设备已 Removed 时只能使用 Tombstone + 旧 Key 实时 PoP 的 evidence-only 窄入口。
- 重新取得有效授权后，首先对未确认任务进行远端对账，再允许用户继续操作。

客户端不会因授权失效删除、改写或上传用户的本地业务数据；恢复授权后可继续使用。这里的“不能使用软件”指业务功能和数据入口被锁定，并非销毁数据。

授权失效后 Sync Worker 和 ActiveDeviceLease 停止。云端业务数据默认保留 90 天供续费恢复和网页合规导出，并在删除前通知用户；到期后进入异步删除流程。账号删除请求仍遵循独立的 7 天冷静期和 30 天业务清除期限；Legal Hold 与目标市场强制法律优先。

客户端功能锁定不影响法定数据权利。账号网页端在订阅过期后仍提供服务端业务数据的机器可读导出、账号/云端数据删除，以及会话和绑定设备安全管理；这些入口需要重新认证、限流、审计和邮件通知，且不包含服务端从未持有的本地秘密。

## 8. Token 刷新协议

建议初始参数：

- 所有日常 Entitlement Token（包括 Lifetime 权益投影）有效期初始为 30 天；该期限是凭证刷新边界，不是 Lifetime 商业到期日。
- 剩余 7 天进入刷新窗口；应用启动、恢复网络和每日维护时尝试刷新。
- 离线宽限独立于 Token 有效期，固定为 7 天。
- Auth Session 使用短期 Access Token 和可轮换 Refresh Token；Refresh Token 每次成功使用后轮换，复用旧 Token 触发会话风险处理。
- Offline Device Lease Payload 具有独立 `renew_after`，其 `access_until` 规范映射为 Envelope 外层 `expires_at`，不再增加第二个重复截止字段；必须满足 `issued_at < renew_after < access_until = expires_at`。Wire 使用 `payload.renewAfter` 与外层 `expiresAt`；续签失败时指数退避，超过该截止后回到账号门禁。
- ActiveDeviceLease 具有 `lease_epoch`、`renew_after`、`online_expires_at` 和 `offline_execute_until`；在线续签滚动延长最多 24 小时的离线执行许可。
- 服务端返回新签名 Auth/Entitlement Token、可信时间、计划、设备状态和撤销原因码。
- 刷新响应不得包含或请求任何域名业务摘要。
- 撤销只影响后续授权能力，不删除本地数据；离线设备在本地签名期限内可能延迟生效。
- Lifetime `AccountEntitlement` 不失效且覆盖所有大版本，但 Entitlement Token、Offline Device Lease 与 ActiveDeviceLease 仍需按周期联网免费续签；该续签只刷新安全状态投影，不产生续费费用。

## 9. 终身授权停服延续

如果 GoodDealer 永久停止运营，将向终身用户及停服时订阅有效的用户提供最终本地延续版本或永久离线凭证，使其能够访问、导出本地数据并继续最后可用版本当时仍兼容的设备本地平台操作；不承诺永久兼容未来 OS、第三方 API、网页结构或平台政策。

- 使用与日常 License 私钥隔离的 `Sunset Signing Key` 签发延续凭证。
- Sunset Root/Signing Key 使用生产与 CI 均不可访问的离线硬件介质；恢复材料至少跨两个物理地点并采用 2-of-3 管理控制，首版不采购外部商业托管。
- 每个正式版本都准备可验证的 LocalContinuation 制品、离线签发材料和恢复 Runbook，每年至少完成一次完全脱离生产服务的恢复、签发与导入演练。Lifetime SKU 只有在最近一次演练通过、材料可恢复且条款披露完成时才允许销售。
- 最终版本支持 `LocalContinuation`，取消账号登录、Offline Device Lease、ActiveDeviceLease 和云同步依赖。
- `LocalContinuation` 的能力集只从本机验证的 Sunset 授权材料派生，不读取、映射或复用日常账号/Cloud Scope。当前实现尚未交付该派生与 Host 消费链，故保持 fail-closed 只读；完整能力派生、跨 Cloud Scope 拒绝和负向证据是未来 Sunset 切片开放本地写入或平台能力前的强制设计前置项。
- Sunset Credential 是通用账号在线凭证 Envelope 的明确例外：它使用独立 strict lowerCamelCase 永久离线 Envelope，固定 `typ=gd.sunset-credential.v1`、`iss=https://accounts.gooddealer.com`、`aud=gooddealer-local-continuation/sunset-credential`、`kid`、`keyPurpose=gooddealer.sunset.credential.v1`、`schemaVersion`、`sunsetCredentialId`、`eligibleEntitlementSnapshot`、`authorizedCapabilities`、`workspaceExportDigest`、`issuedAt`、`signature`，故意不含 `accountId/deviceId/accountSecurityEpoch/jti/expiresAt`，也不能被日常凭证解析器接受；领域层对应使用 snake_case 语义名。`sunsetCredentialId` 全局唯一并绑定其规范内容摘要。签名 Transcript 固定为 `GOODDEALER-SUNSET-CREDENTIAL-V1`，覆盖除 signature 外完整字段的版本化长度定界规范编码。永久性只适用于该离线 Credential，导入后派生的 Authorization/ApprovedOperation/Session Context/Ticket 仍必须短期到期。导入时由 Host 绑定新的 `sunset_installation_id + device_signing_key` 并建立不可回退的本地 credential generation/可信时间锚点。平台访问使用独立 `SunsetAuthorization`/`SunsetApprovedOperation`；浏览器路径再使用 `SunsetBrowserSessionAccessContext`/`SunsetAutomationExecutionTicket`。它们不能构造或复用日常 Lease/Epoch/Context/Ticket；平台凭据仍需在该设备重新录入或按封闭来源复验 HostCredentialBinding Profile/Slot/health generation 或 Browser Profile generation。登录/获取 Key/修复连接的窄 Authorization 不要求凭据已存在或健康，也不能用于业务提交。
- 停服前提供云端业务数据全量下载，并通过多个静态渠道分发签名安装包和凭证。
- 商业条款明确适用用户、触发条件和可继续使用的最后版本。

## 10. 支付提供商

首个支付和税务接入使用 Paddle Merchant of Record。领域层只依赖统一 ProviderPaymentEvent，不绑定 Paddle；未来更换 Provider 必须通过 ProviderMigrationBoundary 和新 Adapter，不能把 Paddle 事件名渗入 Entitlement 聚合。

## 11. 反盗版原则

- 目标是提高批量盗版成本，不追求不可破解。
- 不安装内核驱动或侵入式反篡改组件。
- 不采集域名资产作为授权验证依据。
- 不因反盗版机制降低密钥和本地数据安全。

账号、设备绑定、业务数据同步、凭据隔离与备份边界见 [ACCOUNT_AND_SYNC.md](ACCOUNT_AND_SYNC.md) 和 [ADR-0004](adr/0004-cloud-business-data-sync.md)。

## 12. 开源实现参考

完整许可证登记见 [OPEN_SOURCE_REFERENCES.md](OPEN_SOURCE_REFERENCES.md)。

- [Keygen API](https://github.com/keygen-sh/keygen-api) 可用于参考 License、Policy、Entitlement、Machine、Fingerprint、Proof、设备激活和离线 License 的领域词汇与测试组织。
- Keygen 当前代码使用 FCL-1.0-ALv2：允许目的受“Competing Use”限制，各版本在发布两年后才获得 Apache-2.0 Future License。GoodDealer 未经逐版本法律审查不得复制、链接或部署当前实现；本项目也不得声称采用 Keygen。
- [SimpleWebAuthn](https://github.com/MasterKale/SimpleWebAuthn) 可用于 Passkey 重新认证，确认设备移除、License 管理和高风险 Owner 操作；它不签发 Entitlement、Offline Device Lease、ActiveDeviceLease 或 Sunset 凭证。

GoodDealer 的 `typ/iss/aud/kid/schema_version/account_id/device_id/account_security_epoch/jti` 强类型 Envelope、可信时间、Lease Epoch、离线执行窗口和 Sunset Signing Key 域分离仍为本项目自有安全协议。参考项目的 Machine/Fingerprint 不得被误用为不可伪造的设备身份。
