# GoodDealer 术语索引

状态：Derived Navigation Index
更新日期：2026-08-03

## 使用规则

本文件帮助实现者、审查者和自动化工具定位术语，不拥有状态机、字段或协议。定义冲突时，以“权威来源”列链接的专题文档、ADR 和 Gate 台账为准；更新权威决策时必须同步检查本索引，但不得在此创建第二套业务规则。

反引号中的 CamelCase（如 `OfflineDeviceLease`、`ActiveDeviceLease`）是协议/代码标识符；正文中的带空格形式（如 “Offline Device Lease”）仅是面向用户的显示名称，不代表另一种凭证。“Active Lease”等缩写只能用于非规范叙述，Schema、Gate 和测试必须使用完整标识符。

## 运行时、账号与设备

| 术语 | 导航性定义 | 权威来源 |
| --- | --- | --- |
| `RuntimeMode` | Secure Host 当前准入模式的强类型状态；命令能力由模式决定 | [工程结构](ENGINEERING_STRUCTURE.md)、[License](LICENSING.md) |
| `Locked` | 授权、绑定或本地完整性权威失败后的门禁状态，不展示业务主界面 | [License](LICENSING.md) |
| `Standby` | 已绑定但无平台访问、Mutation、批准或执行权的 Cloud 只读设备状态 | [账号与同步](ACCOUNT_AND_SYNC.md) |
| `Activating` | 使用短期 Bootstrap Capability 重建并校验本地工作库、尚未取得 Active 权限的状态 | [账号与同步](ACCOUNT_AND_SYNC.md) |
| `Active` | 持有当前 ActiveDeviceLease，可在其他 Gate 允许范围内修改和访问平台的唯一日常账号设备状态；不包含正式停服后的 LocalContinuation | [ADR-0005](adr/0005-single-active-device-and-continuity.md) |
| `Draining` | 停止领取新任务并完成安全退出的状态；`handoff` 与 `suspend` 退出条件不同 | [账号与同步](ACCOUNT_AND_SYNC.md) |
| `LocalContinuation` | 仅用于正式停服预案、由独立 Sunset 凭证进入并使用域分离本地执行授权的受限状态，不是日常纯本地模式 | [License](LICENSING.md) |
| `AuthSession` | 用于在线 GoodDealer 账号请求的会话凭证 | [账号与同步](ACCOUNT_AND_SYNC.md) |
| `OfflineDeviceLease` | 证明设备绑定和授权离线宽限的服务端签名凭证 | [License](LICENSING.md) |
| `ActiveDeviceLease` | 绑定账号、设备和单调 Epoch 的唯一执行权凭证 | [账号与同步](ACCOUNT_AND_SYNC.md) |
| `DeviceBinding` | Cloud 权威维护的账号与设备绑定、签名公钥版本和撤销状态 | [ADR-0011](adr/0011-device-identity-lifecycle.md) |
| `DeviceSwitchRequest` | 正常或强制设备切换的账号级互斥、幂等聚合 | [账号与同步](ACCOUNT_AND_SYNC.md) |
| `Bootstrap Capability` | 绑定一次激活 Workflow 的短期单用途能力；strict step payload 携带 Checkpoint、Mutation 分页或重建摘要，以 nonce/number + CAS 推进，流程结束才整体消费，不授予 Active 权限；step Wire 尚未交付 | [账号与同步](ACCOUNT_AND_SYNC.md) |
| `Recovery Capability` | `gd.recovery-capability.v1` 的同设备/Workspace/Epoch/备份 Manifest 恢复 Workflow 能力；与 Bootstrap 域分离，strict step payload 只允许基线、完整有界白名单 diff 和 Candidate 回执；Envelope/step Wire 尚未交付 | [账号与同步](ACCOUNT_AND_SYNC.md)、[数据生命周期](DATA_LIFECYCLE.md) |
| `lease_epoch` | 服务端单调推进的活动设备代次，用于拒绝旧设备的新副作用 | [账号与同步](ACCOUNT_AND_SYNC.md) |
| `credential_epoch` | 设备凭证撤销和安全状态变化的服务端代次 | [ADR-0011](adr/0011-device-identity-lifecycle.md) |

## 平台连接与秘密

| 术语 | 导航性定义 | 权威来源 |
| --- | --- | --- |
| `ProviderConnection` | Workspace 中一个具体平台账号/连接的业务聚合，不包含秘密原值 | [连接器](CONNECTORS.md) |
| `DeviceCredentialBindingStatus` | Active Workspace 可见的脱敏本机凭据状态；含 binding ID、ProviderConnection、Profile、fingerprint、health 与 version，不含 Ref 或秘密 | [数据生命周期](DATA_LIFECYCLE.md) |
| `DeviceCredentialCandidateStatus` | Standby 可读的本机非秘密存在性提示；仅表达从未配置、曾配置候选或未知，不证明秘密存在、健康或可用 | [数据生命周期](DATA_LIFECYCLE.md) |
| `HostCredentialBinding` | Rust Secure Host 私有的 Namespace、强类型 SlotId/SecretKind 与 Keychain 引用绑定；普通 TypeScript、Workspace 与 Cloud 不可见 | [数据生命周期](DATA_LIFECYCLE.md) |
| `credentialRef` | 只在 Host 内使用的 OS 秘密存储定位信息，不是调用方可选择的授权能力 | [ADR-0009](adr/0009-endpoint-capability-registry.md) |
| `Credential Profile` | Provider 级版本化凭据 Slot/SecretKind 契约 | [ADR-0009](adr/0009-endpoint-capability-registry.md) |
| `EndpointManifest` | 编译期、声明式、不可执行的连接器网络能力事实源 | [连接器](CONNECTORS.md) |
| `host_owned` | Manifest 对秘密响应的分类；具体 typed extractor 只由 Rust 私有编译期表绑定 | [ADR-0010](adr/0010-host-owned-secret-path.md) |
| `PUBLIC_BUSINESS` | 可同步且服务端可读的业务字段类别 | [安全模型](SECURITY.md) |
| `SENSITIVE_BUSINESS` | 可同步但限制员工访问和日志的业务字段类别 | [安全模型](SECURITY.md) |
| `DEVICE_SECRET` | 不得进入普通 TypeScript、Outbox 或 Cloud 的设备秘密类别 | [安全模型](SECURITY.md) |
| `DIAGNOSTIC_LOCAL` | 默认仅设备本地、只在独立授权下提交支持流程的诊断类别 | [安全模型](SECURITY.md) |

## Workspace、同步与恢复

| 术语 | 导航性定义 | 权威来源 |
| --- | --- | --- |
| `Desired State` | 用户希望 GoodDealer 管理的目标业务状态，不能直接触发平台副作用 | [同步语义](SYNC_SEMANTICS.md) |
| `Observed State` | 最近一次有证据的平台实际状态及其新鲜度 | [同步语义](SYNC_SEMANTICS.md) |
| `Base` | 本地编辑开始时用于三方比较的稳定 Cloud 基线 | [同步语义](SYNC_SEMANTICS.md) |
| `Revision` | GoodDealer Workspace 内部提交顺序，不代表外部平台时间或真实状态 | [同步语义](SYNC_SEMANTICS.md) |
| `SyncMutation` / Mutation | Mutation 流中可回放为业务状态的版本化设备修改记录；不包含执行事实或审计 | [账号与同步](ACCOUNT_AND_SYNC.md) |
| `ExecutionFact` | Active 路径所有 Epoch 的既成 Operation 尝试、远端结果与确认事实；原始签名 Envelope 经独立 evidence-spool 上传，不回放为业务状态 | [账号与同步](ACCOUNT_AND_SYNC.md) |
| `AuditEvent` | 日常 `DeviceAuditEvent \| UserAuditEvent \| StaffAuditEvent \| ServiceAuditEvent` 判别联合；设备链与服务端链分别排序和签名，不伪造彼此字段 | [账号与同步](ACCOUNT_AND_SYNC.md) |
| `MutationOutbox` / Outbox | Active 本地事务中持久化、只承载 SyncMutation 的封闭上传队列；ExecutionFact 与 DeviceAuditEvent 存在独立 evidence-spool，Outbox 不是三流总称 | [账号与同步](ACCOUNT_AND_SYNC.md) |
| `Cursor` | Device/Reader 已消费的 Cloud 位置；连续确认水位与最大已见序号不能混用 | [账号与同步](ACCOUNT_AND_SYNC.md) |
| `Checkpoint` | 有摘要保护的 Workspace 重建基线；后续 Mutation 从该点回放 | [数据生命周期](DATA_LIFECYCLE.md) |
| `OwnershipEpisode` | 域名与账号/平台所有关系的有界时间段 | [同步语义](SYNC_SEMANTICS.md) |
| `StaleChangeProposal` | 旧 Epoch 设备签名提交的可变修改提案；不得包含 Cloud 独占的 Candidate ID、比较 Revision、当前值 Hash 或状态 | [账号与同步](ACCOUNT_AND_SYNC.md) |
| `StaleDeviceCandidate` | Cloud recovery 根据 StaleChangeProposal 生成的隔离候选，不能静默成为当前 Mutation | [同步语义](SYNC_SEMANTICS.md) |
| `RestoreCandidate` | 备份与当前 Cloud 比较形成的恢复候选，应用前需要当前 Revision 下复核 | [数据生命周期](DATA_LIFECYCLE.md) |
| `LateExecutionEvent` | 服务端对“旧 Epoch 且验证通过”的 ExecutionFact 增加的分类，不是客户端上传的第四条日志 | [账号与同步](ACCOUNT_AND_SYNC.md) |
| `LateClosedEpochProviderEvent` | ProviderMigrationBoundary 封口后才到达的旧支付来源事实；只进入历史/对账，不属于 admitted reducer input，也不改变 Boundary、Entitlement Revision 或 payment watermark | [License](LICENSING.md) |
| `DrainManifest` | 设备签名的 handoff 排空证明，分别绑定 Mutation、ExecutionFact、Workspace-scope DeviceAuditEvent 的连续水位、Gap、待上传数和摘要；不包含 Account DeviceAudit 或 User/Staff/Service 审计链 | [账号与同步](ACCOUNT_AND_SYNC.md) |
| `DrainProof` | 设备签名的通用三流排空证明；`handoff` 变体为 DrainManifest，`synchronized_backup` 变体不能释放 Lease 或推进 Epoch | [账号与同步](ACCOUNT_AND_SYNC.md) |
| `BackupExportSchema` | 两类本地备份共同使用的版本化字段级白名单投影；完整 Workspace/DB/WAL 不能成为最终 Payload | [数据生命周期](DATA_LIFECYCLE.md) |
| `SynchronizedBackup` | 通过 `DrainProof(purpose=synchronized_backup)` 后创建，Manifest 以 `proof_id + proof_digest` 绑定同一冻结边界的 Cloud Revision、本地提交序号与连续水位 | [数据生命周期](DATA_LIFECYCLE.md) |
| `EmergencyLocalSnapshot` | Cloud 不可达或排空失败时显式创建的未同步快照；恢复差异只能生成 RestoreCandidate | [数据生命周期](DATA_LIFECYCLE.md) |
| `PendingSignedEvidenceArchive` | Emergency 快照中不可执行的未上传签名事实原件；仅在同一设备身份且原私钥仍可用时按原 ID/序列/签名走原 Epoch 证据 Ingest，跨设备只能保全、不能代提交或恢复权限 | [数据生命周期](DATA_LIFECYCLE.md) |
| `RemovedEvidenceSpool` | 独立 evidence-spool 在设备 Removed/Locked 后暴露的窄读能力；用 Tombstone + 一次性 Challenge + `removed_evidence_pop_only` 旧 Key 实时 PoP 上传 Cloud 移除前，或本机获知撤销前且仍在原离线窗口内合法形成的签名证据 | [账号与同步](ACCOUNT_AND_SYNC.md)、[ADR-0011](adr/0011-device-identity-lifecycle.md) |
| `RemovedDeviceTombstone` | Cloud 在设备移除事务创建的服务端签名事实，固定 `removed_at`、原 `offline_execute_until`、Credential Epoch、旧签名 Key 与允许的 evidence kind | [ADR-0011](adr/0011-device-identity-lifecycle.md) |
| `InternalRecoveryPoint` | 仅同设备受控回滚使用、不可导出或迁移的应用私有完整恢复点，不属于用户备份 | [数据生命周期](DATA_LIFECYCLE.md) |

## 操作、自动化与验证

| 术语 | 导航性定义 | 权威来源 |
| --- | --- | --- |
| `OperationPlan` | 基于明确实体集合、基线与前置条件生成的可预览副作用计划 | [操作语义](OPERATIONS.md) |
| `ApprovedOperation` | 当前 Active 设备对具体计划的本机签名批准，不随设备切换迁移 | [账号与同步](ACCOUNT_AND_SYNC.md) |
| `SunsetAuthorization` | LocalContinuation 的本地根授权；以 purpose/credential_source 判别联合区分无凭据的连接建立和绑定 Host Binding 或 Browser Profile generation 的平台访问 | [操作语义](OPERATIONS.md) |
| `SunsetApprovedOperation` | LocalContinuation 对具体计划的本机签名批准；绑定 Sunset 凭证/安装实例且不能被 Active 路径解析 | [操作语义](OPERATIONS.md) |
| `SunsetExecutionFact` | LocalContinuation 的本地执行事实；不含账号/Active Lease/Epoch，使用独立 Key Purpose、Transcript 和唯一追加链，永不进入 Cloud Ingest | [操作语义](OPERATIONS.md) |
| `SunsetDeviceAuditEvent` | LocalContinuation 的本地设备审计；授权来源是 Sunset 授权、批准或运行时安全上下文之一，与日常 AuditEvent 双向拒绝 | [操作语义](OPERATIONS.md) |
| `SunsetBrowserSessionAccessContext` | LocalContinuation 的窄化浏览器连接建立 Context；只允许受 Consent/NavigationPolicy 约束的登录、取 Key 或修复连接 | [浏览器自动化](BROWSER_AUTOMATION.md) |
| `SunsetAutomationExecutionTicket` | LocalContinuation 浏览器业务执行的一次性本地票据；使用独立 Key Purpose、Schema、Transcript 与 Nonce 表，不能被 Active 路径兑换 | [浏览器自动化](BROWSER_AUTOMATION.md) |
| `Attempt` | 一次持久化执行尝试，拥有明确副作用提交边界和恢复语义 | [操作语义](OPERATIONS.md) |
| `outcome_unknown` | 已跨过可能产生副作用的边界但结果无法证明，只允许确认，不允许普通重试 | [操作语义](OPERATIONS.md) |
| `BrowserSessionConsent` | 用户允许建立或继续平台登录会话的同意，不等于业务操作批准 | [浏览器自动化](BROWSER_AUTOMATION.md) |
| `BrowserSessionAccessContext` | Host-owned 的受限登录会话准入 Guard；不要求已有健康凭据，也不能读取秘密或执行平台业务动作 | [浏览器自动化](BROWSER_AUTOMATION.md) |
| `BrowserAutomationGrant` | 绑定具体业务范围、会话和计划的自动化授权 | [浏览器自动化](BROWSER_AUTOMATION.md) |
| `AutomationExecutionTicket` | Secure Host 签发、由 automation-host 单次兑换的短期执行根能力 | [浏览器自动化](BROWSER_AUTOMATION.md) |
| `Recipe` | 经过签名、版本化和受限解释的网页操作描述，不是任意脚本 | [浏览器自动化](BROWSER_AUTOMATION.md) |
| `VerificationAttempt` | 域名所有权验证的权威工作流聚合 | [验证工作流](VERIFICATION.md) |
| `DnsAuthoritySnapshot` | DNS 委派、RRset 和传播判断所依据的版本化证据 | [验证工作流](VERIFICATION.md) |

## 运营与治理

| 术语 | 导航性定义 | 权威来源 |
| --- | --- | --- |
| `TenantContext` | 从可信入口到事务、Repository 和对象存储 Key 全程强制传播的租户上下文 | [工程结构](ENGINEERING_STRUCTURE.md) |
| `StaffIdentity` | 与用户账号完全分离的内部管理员身份 | [安全模型](SECURITY.md) |
| `SupportCaseReference` | 外部 Helpdesk SupportCase 与内部受控访问/审计之间的可信关联；`AdminPurposeRef` 的判别类型之一 | [用户旅程](USER_JOURNEYS.md) |
| `AdminPurposeRef` | `SupportCaseReference \| DataRightsRequestId \| SecurityIncidentId` 判别联合；每种引用保留自身状态与授权语义 | [用户旅程](USER_JOURNEYS.md) |
| `AdminReadAuthorization` | 短期、目标/查询形状/字段 Scope/案件与新鲜重新认证绑定的跨账号明细读取授权；不可兑换管理命令 | [安全模型](SECURITY.md) |
| `AdminActionAuthorization` | 短期、目标与参数绑定、可撤销的 Staff 管理命令授权；绑定目标账号安全 Epoch、命令相关 Aggregate Revision，执行和重放时复验 Scope、PurposeRef、专属 Epoch/Revision 与有效期 | [安全模型](SECURITY.md) |
| `Gate` | 需要权威设计和可重跑证据才能关闭的阶段准入条件 | [Phase 0 Gate 台账](PHASE0_GATE_REGISTER.md) |
| `GateClosureAttestation` | 与技术 Evidence Manifest 分离的不可变 Gate 关闭证明；绑定最终 Manifest 摘要、制品、具名责任身份、时间和独立性声明 | [Phase 0 Gate 台账](PHASE0_GATE_REGISTER.md) |
| `Fallback` | Gate 未关闭时必须使用的收窄能力或失败关闭路径 | [Phase 0 Gate 台账](PHASE0_GATE_REGISTER.md) |
