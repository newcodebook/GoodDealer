# GoodDealer 数据生命周期与恢复

状态：Accepted Design Baseline / Evidence Pending
更新日期：2026-08-05

## 1. 域名身份

域名名称和一次持有经历是两个不同实体：

```text
DomainAsset       example.com 这一规范化名称的长期身份
OwnershipEpisode 一次连续持有经历
RegistrarBinding 某段时间内与具体注册商账户的绑定
```

`DomainAsset` 使用内部 UUID，`canonical_name` 在云端 Workspace 和各设备本地副本中唯一。过期、售出或转出不删除 DomainAsset。

### 生命周期规则

- 注册商转移：关闭旧 RegistrarBinding，创建新 Binding；如果所有权未中断，仍属于同一 OwnershipEpisode。
- 售出、丢失或过期删除：结束当前 OwnershipEpisode，历史成本、Listing 和审计保留。
- 重新购回：在同一 DomainAsset 下创建新的 OwnershipEpisode，新的购入成本不覆盖旧记录。
- 首次从注册商列表消失：标记 `unobserved`，不软删除、不立即结束持有。
- 连续多次缺失或其他证据确认后：转为 `missing_review`，由用户选择 transferred、sold、expired、lost 或修正账户绑定。

## 2. 多账户是一等实体

云端共享的 `ProviderConnection` 包含：

```text
id
provider
account_alias
remote_account_id（如可得）
capabilities
status
```

设备本地凭据绑定拆成普通层状态与 Secure Host 私有材料。Active Workspace 可见的 `DeviceCredentialBindingStatus` 只包含：

```text
binding_id
provider_connection_id
device_id
provider
credential_profile_id
credential_profile_version
credential_fingerprint
credential_health
health_generation
binding_version
```

Standby 需要的“本设备是否曾配置过”提示使用独立的 `DeviceCredentialCandidateStatus`，只包含 `provider_connection_id + device_id + candidate_state + state_version`。`candidate_state` 为 `never_configured | configured_candidate | unknown`：新设备初始化为 `never_configured`；Secure Host 成功提交凭据写事务后为 `configured_candidate`；用户显式删除后回到 `never_configured`；迁移缺失、状态损坏、重装后无法证明历史或 Host 发现不一致时为 `unknown`。它存于普通本机加密状态，可在 Standby 读取，但不能触发或替代 Keychain 查询、健康检查，也不能成为平台访问授权。

Rust Secure Host 私有的 `HostCredentialBinding` 包含：

```text
binding_id
provider_connection_id
binding_scope:
  active_device: device_id
  sunset_installation: sunset_installation_id + workspace_id + sunset_credential_generation + device_signing_key_id + device_signing_key_version
provider
credential_namespace
credential_profile_id
credential_profile_version
slots[]
  slot_id: SlotId
  secret_kind: SecretKind
  credential_ref
credential_health
health_generation
binding_version
```

设备本地的浏览器 Profile 由 browser-automation 独立拥有：

```text
BrowserSessionProfile
  browser_profile_id
  profile_scope:
    active_device: device_id
    sunset_installation: sunset_installation_id + workspace_id + sunset_credential_generation + device_signing_key_id + device_signing_key_version
  provider_connection_id
  session_mode: persistent | private
  profile_ref
  session_health
  profile_generation
  session_sequence
```

`binding_scope` 和 `profile_scope` 都是 Host 私有 strict 判别联合。`active_device` 必须且只能包含 Cloud `device_id`；`sunset_installation` 必须且只能包含 `sunset_installation_id + workspace_id + sunset_credential_generation + device_signing_key_id + device_signing_key_version`，不得伪造或回填 Cloud device ID。Active 与 Sunset 使用不同 credential/profile namespace、Root Directory 和唯一索引；同一个 Binding/Profile ID 不能换 scope，Sunset credential generation 推进必须切换 scope，并在新 scope 重新录入或显式复验凭据/Profile。

`HostCredentialBinding`、任一 Slot 的 `credential_ref`、`profile_ref` 和 `session_health` 不得进入普通 TypeScript、Active Workspace、Sync Mutation 或服务端数据库；普通层只通过当前模式允许的 `binding_id + binding_version` 脱敏投影关联。`DeviceCredentialCandidateStatus` 也不得上传 Cloud，且不能扩展为 secret existence probe。`BrowserSessionProfile` 以 `profile_scope + provider_connection_id + session_mode` 唯一，不能用 DeviceCredentialBindingStatus 表达浏览器会话模式。`browser_profile_id` 是 Host 私有稳定 ID；`profile_generation` 在创建、清除/重置、账号身份变化后的重新认证、损坏恢复、Profile 迁移或 Key/Namespace 重绑时单调推进，普通 Cookie 刷新和 Recipe 允许的导航不推进。`session_sequence` 在 Session 创建/重建、用户接管、越界手工导航、private Session 重置或关闭时推进，当前 Ticket 允许的 Recipe Step 不推进。两者回退、缺失或变化都会使已签发 Sunset Context/Ticket 失败关闭。

日常账号/Cloud 路径的平台配额非秘密摘要随 `ProviderConnection` 同步，包括 `quota_scope: credential | provider_account | provider_global | unknown`、剩余配额、重置时间、`backoff_until` 和最近刷新时间；只有当前 Active 设备读取平台并更新该共享摘要，切换后的设备必须先继承退避状态，不能立即重复全量刷新。正式停服后的 LocalContinuation 可在 Sunset 授权下读取平台，但只更新独立 LocalContinuation Workspace 的本地 quota/backoff 与 platform-sync 状态，不上传或改写 Cloud 共享摘要。两类摘要都可能滞后，不能替代连接器本地的并发控制。

所有 RegistrarBinding、DnsBinding 和 MarketplaceListing 都绑定 `provider_connection_id`，不能只绑定 Provider 名称。

UI、操作计划、冲突和错误必须显示账户别名。例如：`Spaceship / 主账户`、`Atom / Portfolio-B`。

同一域名出现在同平台多个账户时不自动选择权威账户，创建 `account_ownership_conflict` 由用户解决。

### 2.1 ProviderConnection 建立与健康状态机

普通层统一使用以下脱敏状态机，连接器不得各自发明布尔 `connected`：

```text
unconfigured
  -> capturing | authenticating
  -> verifying
  -> healthy | retained_unverified | invalid | action_required | revoked
```

- API/OAuth 凭据走 Host-owned `capturing`，浏览器会话走隔离 `authenticating`；两者的 Consent、秘密路径和 Profile 不可互换。
- `verifying` 只有当前 Active 或 LocalContinuation 对应 Host 授权分支可以进入。普通 TypeScript 只观察脱敏状态，不读取秘密、Keychain existence、原始健康响应或 generation 裁决依据。
- `healthy` 绑定准确的 ProviderConnection、设备或 Sunset installation scope、Credential/Profile、版本与单调 generation。任何作用域或 generation 变化都会使旧健康结论失效。
- 设备切回 Active 后，保留凭据先进入 `retained_unverified`；只有窄健康复验 Endpoint/Browser 流程成功才回到 `healthy`。失败或无法验证进入 `invalid | action_required` 并要求重录或重新登录。
- 用户删除、Provider 撤销或安全处置进入 `revoked`；未知/损坏状态失败关闭，不能降级为可用。

状态转换由 `client-core/connections` 编排，权威秘密、健康 generation 和原子提交由 Secure Host 拥有；Cloud 只同步 ProviderConnection 和允许公开的脱敏业务状态。

## 3. 数据库密钥恢复

只把数据库主密钥存入 OS Keychain 会导致系统重装、签名身份变化或 Keychain 损坏时无法恢复。采用双封装：

1. 首次启动生成随机 Database Master Key。
2. Master Key 存入 OS Keychain。
3. 同时生成一次性 Recovery Secret，并使用 Argon2id 派生 Recovery KEK。
4. 使用经过审计的 AEAD 算法加密 Master Key，把密文、Salt 和参数保存在数据库旁的 Key Envelope 中。
5. Recovery Secret 只显示给用户，不上传服务端、不再次明文显示。
6. Keychain 丢失时，用户输入 Recovery Secret 解封 Master Key 并重新写入 Keychain。

首次设置必须引导用户打印、抄写或保存 Recovery Secret，并立即完成恢复校验。用户可以选择跳过，但 UI 必须明确提示：云端可以重建已同步业务数据，平台凭据、Cookie、本地诊断和未同步数据仍可能永久丢失。

加密备份是本地业务库、允许 Artifact 与用户可选平台凭据的恢复路径；它不承诺迁移 Browser Profile、设备身份或 GoodDealer 授权凭证。备份口令与 Recovery Secret 相互独立。云端重建是业务数据恢复路径，但不能代替设备本地凭据和允许的 Artifact 备份。

### 3.1 Backup Content Manifest

首版维护一种版本化加密容器格式，但容器中的业务区段有两种明确工件类型：

- `SynchronizedBackup`：创建前通过三流 `DrainProof(purpose=synchronized_backup)`，其 `synchronized_snapshot_binding` 绑定 Server Revision 与本地提交序号；Proof 不得含 DeviceSwitchRequest，也不能释放 Lease 或推进 Epoch。Backup Manifest 必须引用确切的 `proof_id + proof_digest`，且 Proof、短写门禁和 SQLite 一致性读取源来自同一冻结边界。
- `EmergencyLocalSnapshot`：仅在 GoodDealer Cloud 不可达或排空失败时由用户显式创建；Manifest 明确标记未同步，恢复时所有相对云端基线的差异只能生成 RestoreCandidate，绝不恢复旧 Outbox、Queue 或执行权。为避免已发生但未上传的外部事实丢失，它可以包含下述只读 `PendingSignedEvidenceArchive`。

两类 Manifest 都必须包含随机全局唯一 `backup_id`、`manifest_version`、kind、Workspace、Schema/应用版本、创建时间、每个加密 section 的类型/长度/Hash，以及版本化 `manifest_digest`。`manifest_digest = SHA-256("GOODDEALER-BACKUP-MANIFEST-V1" || uint32_be(canonical_manifest_length) || canonical_manifest_bytes)`，覆盖上述字段、section Hash 和 SynchronizedBackup 的 `proof_id + proof_digest`，不覆盖容器外元数据。恢复选择、Recovery Capability 和审计均同时绑定 `backup_id + manifest_digest`；文件、section 或 Manifest 被替换时失败关闭。

两种工件都必须从一致性读取源投影到版本化、字段级白名单 `BackupExportSchema`。SQLite Backup API 或等效机制只用于建立一致性读取源，不得把完整 Active Workspace、SQLCipher 文件、WAL、锁文件或运行时表直接作为最终备份 Payload。业务数据和可选凭据区段使用同一 Manifest，不增加独立 Credential Vault 格式。

默认包含：

- `BackupExportSchema` 白名单列出的业务实体投影、Schema/应用版本、Server Revision、本地提交序号和三流确认水位。
- 历史 Operation、ExecutionFact 与 Audit 的脱敏只读投影及引用；恢复后只读，不重新入队，也不重建完整性链的写权限。
- `EmergencyLocalSnapshot` 可额外包含尚未上传的原始签名 ExecutionFact/DeviceAuditEvent Envelope、ExecutionFact 的只读 `ExecutionAuthorizationEvidence`、原链 sequence/previous hash 和验证所需可信时间/Key Version 材料，统一置于 `PendingSignedEvidenceArchive`。Archive 必须继续服从脱敏 Schema，不含设备私钥、秘密、Mutation、可执行批准、Ticket 或 Worker 状态。只有恢复到同一设备身份、OS 安全存储仍持有匹配原 Key ID/Version 私钥，且原 Epoch Ingest 或 RemovedEvidenceSpool 状态机允许时，才可保持原 ID/序列/签名和原域分离授权证据提交；跨设备、旧私钥缺失或已擦除时只能作为加密取证材料保全，当前 Active 不得代提交，也不能降级为无 PoP 上传。任一接收端都只能验证并保存这类不可执行证据，不能重签、编辑、重新执行、成为 Candidate 或恢复任何权限。
- 用户选择保留且被 Schema 允许的本地 Artifact 索引、内容 Hash 与加密 Blob/Chunk；只有索引而没有内容的 Artifact 不得标记为可恢复。

默认不包含、但可由用户显式开启“包含平台 API 凭据”的内容：

- 连接器允许导出的 API Key、API Secret 或平台 OAuth 凭据。
- 每个凭据项的 ProviderConnection、类型、导出时间和兼容平台；不保存 OS Keychain 元数据。

永不包含：

- Browser Profile、Cookie、Local Storage 和登录会话。
- 设备签名私钥、ApprovedOperation、AutomationExecutionTicket。
- GoodDealer Auth Session、Entitlement Token、OfflineDeviceLease、ActiveDeviceLease。
- 数据库 Master Key 明文、Recovery Secret、备份口令或解密密钥。
- Mutation/ExecutionFact/DeviceAuditEvent 上传队列及其调度状态、Gap 集、旧 Mutation Outbox、Durable Queue、Worker Lease、未执行 Attempt、Browser Grant、运行时恢复标记和 DeviceSwitchRequest/Bootstrap Capability。`PendingSignedEvidenceArchive` 保存的是不可执行的签名原件，不恢复上述队列或权限。
- DNS/所有权验证的原始挑战值；Active Workspace 只能持有 Host-owned challenge ref/fingerprint。

恢复时先展示 Manifest 和不可移植项。凭据只能写入当前设备的新 Keychain 条目，并重新执行健康检查；不得恢复旧设备身份、Lease、批准或执行权。

## 4. 快照保留

默认策略：

- 当前正规化 Observed State：始终保留。
- 未变化的原始快照：按内容 Hash 去重。
- 最近 30 天：每日一个成功快照。
- 31～90 天：每周一个。
- 91～365 天：每月一个。
- 超过一年：默认只保留年度快照和关键状态变化快照。
- 错误诊断、DOM 和截图：默认 30 天，可由用户立即清除。

用户可调整保留期限。清理任务为 `Priority-4 Maintenance`，运行前确认没有未完成 Operation 引用目标 Artifact。

## 5. 审计完整性

“不可变审计”在用户拥有本机完全权限的情况下无法绝对保证。准确表述为：

- 应用不提供修改历史记录的入口。
- AuditEvent 只追加。
- 事件包含前一事件 Hash，形成完整性链。
- 可选使用 Keychain 中的本机完整性密钥生成 HMAC。
- 检测到链断裂时提示日志可能被修改，不声称能抵御拥有本机管理员权限的攻击者。

业务审计默认长期保留；大体积请求/响应 Payload 按快照策略压缩或清理。

## 6. Schema 迁移

迁移回滚和恢复前保护使用应用私有的 `InternalRecoveryPoint`，不属于两类用户备份工件。它只能保存在当前设备受控目录和独立密钥域中，不可导出、跨设备迁移或作为新 Workspace 初始化源；允许包含忠实事务回滚所需的完整本地运行时状态，但其中 Session、Lease/Epoch、ApprovedOperation、Ticket、Worker Lease、消费状态和可信时间锚点一律视为不可恢复授权。Manifest 固定 Workspace/设备、Schema、应用版本、创建原因、Hash、TTL 和原子替换状态；回滚后先冻结 Worker/平台访问/批准，重新读取当前 Host/Cloud 权威账号、设备、Epoch、可信时间和消费状态并完成对账，验证前不得进入 Active。成功迁移/恢复及 TTL 到期后清理，崩溃启动时只允许恢复到同设备同 Workspace 的受控版本。用户备份的 `BackupExportSchema` 与秘密/队列排除规则不能反向套用到 InternalRecoveryPoint。

- 数据库记录 `schema_version`、`created_by_app_version` 和 `last_migrated_by_app_version`。
- 每次迁移前自动创建加密 `InternalRecoveryPoint`，Manifest 包含 Schema 版本、应用版本、Hash、创建时间、TTL 和原子替换状态。
- 迁移尽量在单个 SQLite Transaction 内执行；不可事务化步骤使用两阶段标记。
- 迁移失败时自动恢复迁移前快照，并阻止新版本继续写入。
- 旧应用检测到更高 Schema 时进入兼容性错误，不尝试降级写入。
- 跨版本恢复先校验备份 Manifest，只在隔离 Staging 副本上逐级迁移和校验，再与当前 Cloud 基线比较并由 Cloud 生成 RestoreCandidate；不得仅因迁移成功就替换当前工作库。除全新 Workspace 初始化外，Staging 工作库永不直接安装为 Active：Candidate 创建与摘要校验后安全销毁 Staging 及其临时 Key，以当下最新 Cloud Checkpoint + Mutation 重建并完成正式激活，再由用户在 Active 恢复中心逐字段 Apply Candidate 生成新 Mutation。`InternalRecoveryPoint` 的同设备事务回滚是独立路径，不经过 Candidate。
- 每个正式版本测试从所有仍支持的旧 Schema 升级。

## 7. CSV 与文件安全

任何供 Excel/表格软件打开、且包含用户可控值的 CSV，必须对以下开头进行公式注入防护：`=`、`+`、`-`、`@`、Tab、CR。

防护策略由导出目标决定：

- 人类查看型 CSV：在危险值前加单引号，并按 RFC 4180 转义。
- 平台规定模板：只允许进入平台允许的字段和格式；用户备注等不进入模板。若平台字段确实允许危险前缀，导出前显示警告并使用平台验证规则。

下载、临时 CSV 和备份都登记为 Artifact，并有明确保留和清理状态。

## 8. 云端业务数据生命周期

账号删除在身份验证后立即冻结危险写入，并进入 7 天可撤销冷静期。冷静期结束后，主库、搜索、对象存储、分析副本和 Helpdesk 可删除内容必须在 30 天内清除或返回带依据的 Legal Hold 回执。PITR 与隔离备份最长保留 35 天，任何恢复开放业务入口前都必须重放 AntiResurrectionLedger。

- 用户数据导出下载链接保留 7 天。
- 普通 Support 内容在工单关闭后保留 180 天；账号删除生效后的 30 天清除期限优先，除非存在显式 Legal Hold。
- 最小化安全与访问审计保留 365 天。
- 支付、税务与法定会计事实与业务内容分离、限制访问并保留 7 年。
- AntiResurrectionLedger 只保存不可逆最小标识与删除水位，初始保留 90 天且不得短于最长可恢复窗口加 30 天。
- Legal Hold 必须逐对象记录依据、范围、Owner、复核时间和到期条件，不允许隐含永久保留。

生产主数据位于 AWS `ap-southeast-1`，加密灾备副本位于 `ap-southeast-2`；删除流程必须覆盖两区及全部子处理者。Development 只允许 Fixture/纯员工合成数据，生产数据不得恢复到 Development 或 Staging。

- DomainAsset、OwnershipEpisode、ProviderConnection 共享元数据、Desired/Observed State 和脱敏审计摘要强制同步。
- 云端使用自己的正规化 Schema、Mutation Log、Server Revision 和软删除墓碑，不保存客户端数据库文件。
- Mutation Log 使用周期性服务端 Checkpoint；设备重建 = 固定一个已发布且摘要有效的 Checkpoint + 后续 Mutation 回放，不从历史起点回放。Bootstrap 创建 pin 后，该 Checkpoint 与完整后续 Mutation 链在完成/放弃前不得清理。
- 早于保留策略的 Mutation 由压缩任务清理；压缩不得越过 `status=active` 的 Device Cursor 或未解决 Candidate 引用。压缩事务必须先生成并验证覆盖拟删除水位的完整 Checkpoint，原子发布为 `available` 后才允许删除 Mutation；任何时刻至少保留一条可从 available Checkpoint 重建到当前 Revision 的完整链。正常/强制切换在签发新 ActiveDeviceLease 的事务中把旧活动 DeviceCursor 退休为 `replaced` 并激活新 Cursor；DeviceBinding 移除或 Workspace 离开也在对应控制面事务退休 Cursor，避免永久阻塞压缩。Reader Cursor 是带租约/TTL 的可丢弃消费位置：TTL 过期或压缩竞态时原子设置 `status=retired`、对应 reason 与 `resume_requirement=rebootstrap_required`；设备移除时设置 `status=retired/reason=device_removed/resume_requirement=none`，因为已移除设备无权重新 Bootstrap。退休后不再阻塞压缩；生命周期状态与恢复要求不是同一枚举。所有 ExecutionFact（不论是否被分类为 LateExecutionEvent）以及 DeviceAuditEvent/UserAuditEvent/StaffAuditEvent/ServiceAuditEvent 都不随 Mutation 压缩删除；各类执行 Payload 最小化、365 天安全审计保留及显式 Legal Hold，不能以 `late` 分类决定生命周期。Checkpoint 数量和 Cursor TTL 是版本化运维配置，变化必须通过恢复/压缩兼容测试。
- Staff 跨账号读取、Repair Command、License/设备/合规管理产生独立 Staff AuditEvent，保存 actor、Scope、理由/工单标识和前后摘要；不得与用户业务 Mutation 合并或因 Workspace 压缩而删除。最小安全审计保留 365 天，Legal Hold 另按对象登记。
- 业务实体软删除产生 `EntityTombstone`；在恢复窗口结束前可撤销，之后由 Workspace 压缩任务清理历史版本。
- 订阅过期时停止同步但不立即删除云端数据；默认保留 90 天供续费恢复和网页合规导出，并在删除前通知用户。90 天后进入与账号删除相同的冻结、清除和 AntiResurrectionLedger 流程；目标市场强制法律或显式 Legal Hold 优先。
- 账号网页端的数据导出覆盖服务端持有的当前业务记录、必要历史和机器可读关系标识，不包含从未上传的设备秘密。
- 账号删除或合规删除请求需要覆盖主库、搜索索引、对象存储、分析副本和备份轮转，并向用户说明备份延迟删除周期。compliance 控制面拥有可按处理者重试/传播窗口过期的 `AccountDeletionTombstone`，以及独立全局 `AntiResurrectionLedger`；二者都不属于 Workspace 软删除。Ledger 水位至少保留到所有可恢复 PITR、备份、归档和副本的最长窗口结束，任何恢复开放业务入口前必须先应用其不可回退水位，禁止复活已删除账号。
- 外部 Helpdesk 是独立子处理者：供应商合同与数据清单必须固定处理区域、跨境依据、消息/附件/账号标识保留期、Legal Hold 例外、删除传播接口与完成回执。账号删除不能只删除内部 SupportCaseReference；必须向 Helpdesk 发出删除/匿名化请求并记录外部 revision、水位和最终回执，依法保留的例外需向用户披露。
- 从云端重建设备只能恢复业务数据，不能恢复 API Key、Cookie、Browser Profile、Recovery Secret 或其他设备秘密。

## 9. 本地备份恢复与云端对账

- 创建 `SynchronizedBackup` 时先在同一短写门禁中固定 `local_commit_sequence`、Server Revision、三流水位和 SQLite Backup API 一致性只读源，再生成绑定该边界的 `DrainProof(purpose=synchronized_backup)`；Backup Manifest 必须保存确切的 `proof_id + proof_digest`。任何边界漂移、旧 Proof 重放或 Proof 与读取源不匹配都拒绝创建。随后只向临时 `BackupExportSchema` 投影允许字段并流式加密；不得复制运行中的数据库、WAL、锁文件，也不得把一致性数据库副本直接发布为最终工件。
- 本地加密备份的创建、导出、选择文件和恢复都由用户主动发起。
- 备份文件在离开应用私有目录前完成加密；GoodDealer 不集成远程备份服务，也不持有备份口令。
- 用户可以自行复制备份文件到任意存储介质，软件不负责该介质的版本、可用性和删除保证。
- 恢复前先创建当前数据库的加密 `InternalRecoveryPoint`，把备份打开到隔离的 Staging Database，并在副本完成 Schema 迁移和完整性检查。Staging 只由绑定同一设备、Workspace、当前 Lease Epoch 与 `backup_id + manifest_digest` 的 `RecoveryCapability(purpose=local_recovery)` 打开；该 Capability 使用 `gd.recovery-capability.v1`、`gooddealer-desktop/local-recovery` 与 `gooddealer.devices.recovery-capability.v1` 独立域，和 Bootstrap 双向拒绝。它只允许用 strict 判别 step payload 固定当前 Checkpoint 基线、提交含完整有界 `BackupExportSchema` 白名单 diff 的 Manifest-bound 请求，以及读取 Candidate 创建回执。各步骤使用单调 `step_number + step_nonce` 和服务端 CAS；request digest 绑定除 nonce/自身外的完整请求和 payload，同一步相同请求幂等，不同 Payload、越序/并发竞争、Candidate 回执后或放弃/到期后的重放失败关闭，完成时才原子消费整个 Capability。权威 Wire 详见 [账号与同步 §10](ACCOUNT_AND_SYNC.md#10-备份恢复语义)，当前未实现。
- 校验 Workspace、Schema、备份时间和备份时的 Server Revision 后拉取当前云端状态；云端当前值作为业务基线。Cloud recovery 从白名单 diff 生成 `RestoreCandidate`，Recovery Capability 不得直接生成 Mutation、Apply Candidate、覆盖正式数据库或签发 Lease。
- Candidate 创建与摘要校验完成后安全销毁 Staging 及临时 Key；随后以当下最新 Cloud Checkpoint + 后续 Mutation 重新构建正式工作库并完成 Active 激活，不保留可再次打开的“封存”业务副本，也不得把 Staging 安装为 Active。
- 只在回到 Active 后，用户才可选择重新应用字段，并以 Candidate 的 `comparison_revision + current_value_hash` 做字段级 CAS；失败时转为 `rebase_required` 并重新展示、批准，成功后才基于当前 Server Revision 生成新 Mutation。Sold、Nameserver、DNS 删除、所有权和价格等高风险字段必须逐项预览。
- 云端不可用时，Staging Database 只能在隔离只读区打开；不能替换当前同步库。只有用户明确创建全新 Workspace 时，才允许以备份业务数据初始化云端。
- 平台凭据等本地秘密可以在当前设备单独恢复，不参与云端业务数据覆盖。

## 10. 旧 Epoch 的事实与恢复候选

强制切换后，旧设备可能在旧 `lease_epoch` 下保留执行事实和可变业务修改。服务端必须按语义分流：

- Operation 尝试、平台响应、远端任务 ID、结果状态、确认等级和 `outcome_unknown` 写入追加式 `ExecutionFact`，不能由用户丢弃；旧 Epoch 通过裁决后标记为 `LateExecutionEvent`。
- ExecutionFact 保存来源设备、原 Epoch、Execution Fact ID、Operation Item/Workflow Node/Attempt、execution sequence、发生/接收时间、ApprovedOperation/Plan Hash、幂等键摘要、证据等级、脱敏结果、`audit_event_ref/hash`，以及只读、域分离的 `ExecutionAuthorizationEvidence`。后者只供 Cloud 验证当时的批准来源；Worker/runtime-gate 永远不得把它兑换、解释或恢复为 ApprovedOperation/Ticket。
- ExecutionFact 通过独立追加式 Ingest 接收，不伪装成 SyncMutation。入库前验证旧 Lease 在动作发生/开始时仍处于离线执行窗口内、设备签名、ApprovedOperation、计划 Hash、可信时间锚点、单调时钟增量和防重放序列；验证失败的报告进入 execution-ledger 隔离区。
- 对应 DeviceAuditEvent 通过独立设备 Audit Ingest 进入自身序列与 Hash 链；`chain_id` 由 `(workspace, device, epoch, device_audit)` 唯一确定并由 Cloud 登记，不能新起链、分叉或遗漏已登记链来绕过 Gap。验证失败时进入 audit 隔离区；不得把 DeviceAuditEvent 改写成 LateExecutionEvent。User/Staff/Service AuditEvent 没有设备 Lease Epoch，不进入该设备 Ingest。
- ExecutionFact/LateExecutionEvent 只补全历史与对账，DeviceAuditEvent 只补全设备审计；都不直接覆盖当前 Desired/Observed State，当前活动设备必须重新读取平台完成对账。
- 服务端拒绝把旧 Epoch 的 Desired State、价格目标、标签、备注、Portfolio 等可变修改直接写入当前 Workspace。设备只能上传“一字段一 Proposal”的签名 `StaleChangeProposal` Envelope；封闭 Payload 只允许唯一 `field_path/base_value_hash/candidate_value`，Envelope 另含稳定 `proposal_id/idempotency_key`、用于防跨域重放的 Workspace/设备/原 Epoch、来源 Revision 和域分离签名。批量修改必须拆成多个 Proposal；服务端必须把签名声明与认证 Route/设备/Epoch 权威上下文逐项比对，不能信任声明来选择 Tenant。
- Cloud recovery 独占创建完整 `StaleDeviceCandidate` Envelope：`candidate_id/kind/workspace_id/source_ref/comparison_revision/current_value_hash/status/created_at/updated_at` 全部从权威上下文、当前 Workspace 和服务端时钟派生；只把已经验签并通过字段白名单的 `field_path/base_value_hash/candidate_value` 从 Proposal Payload 复制进去。Proposal 出现 Candidate Envelope 字段、未知字段或试图指定服务端时间/比较版本时失败关闭。`(workspace, device, epoch, proposal_id)` 唯一映射到一个 Candidate：相同 canonical digest 的重复提交返回同一结果，同 ID 不同内容或跨设备/Epoch 重放拒绝。Candidate 不包含执行结果或审计事实。
- `RestoreCandidate` 同样只能由 Cloud recovery 创建。客户端从已验证 Backup Manifest 提交的白名单 diff 只含 `backup_id + manifest_digest + field_path + backup_base_value_hash + backup_value`；Candidate ID、kind、Workspace、source ref、comparison revision、current value hash、状态和时间戳均由 Cloud 派生，备份中同名字段一律不能恢复或覆盖。
- 用户在当前活动设备 Apply 时提交 `expected_revision + expected_current_value_hash + candidate_id` 做字段级 CAS。Revision 或字段 Hash 变化时原子转为 `rebase_required`、重新展示并再次批准；CAS 成功后才生成新 Mutation。
- 候选默认保留 90 天；涉及合规删除时随账号数据一起清理，用户也可提前丢弃。
- 旧 Operation 不得恢复到队列；其有效执行事实永久与 Operation 历史关联，Candidate 被丢弃也不删除事实。

云同步、凭据隔离和本地备份边界见 [ACCOUNT_AND_SYNC.md](ACCOUNT_AND_SYNC.md)。

## 11. 开源备份参考

完整来源和许可证见 [OPEN_SOURCE_REFERENCES.md](OPEN_SOURCE_REFERENCES.md)。

| 来源 | 可借鉴内容 | 不可替代的本项目契约 |
| --- | --- | --- |
| [age](https://github.com/FiloSottile/age) | 稳定文件格式、recipient/passphrase、流式加密和互操作测试 | 不定义 Backup Content Manifest、Export Schema、Staging、Cloud 基线或 RestoreCandidate |
| [rage](https://github.com/str4d/rage) | age 格式的 Rust Library 与流式 Reader/Writer，作为 Phase 0 容器候选 | 在冻结版本化 Crypto Profile 前只做 Spike；不得把完整 Active SQLCipher/WAL 直接作为最终工件 |
| [rclone](https://github.com/rclone/rclone) | 加密配置分层、远端适配和完整性操作经验 | 首版不集成远程备份服务，不复制其配置或凭据模型 |

推荐的 Spike 顺序是：先从一致性读取源生成白名单临时 Export Schema，再以 rage 流式加密并原子发布。错误口令、Manifest AAD 篡改、截断、版本降级、磁盘写满和进程崩溃都必须在没有明文临时文件、没有旧授权复活的前提下失败关闭。
