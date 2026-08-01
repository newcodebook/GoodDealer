# GoodDealer 术语索引

状态：Derived Navigation Index
更新日期：2026-08-02

## 使用规则

本文件帮助实现者、审查者和自动化工具定位术语，不拥有状态机、字段或协议。定义冲突时，以“权威来源”列链接的专题文档、ADR 和 Gate 台账为准；更新权威决策时必须同步检查本索引，但不得在此创建第二套业务规则。

## 运行时、账号与设备

| 术语 | 导航性定义 | 权威来源 |
| --- | --- | --- |
| `RuntimeMode` | Secure Host 当前准入模式的强类型状态；命令能力由模式决定 | [工程结构](ENGINEERING_STRUCTURE.md)、[License](LICENSING.md) |
| `Locked` | 授权、绑定或本地完整性权威失败后的门禁状态，不展示业务主界面 | [License](LICENSING.md) |
| `Standby` | 已绑定但无平台访问、Mutation、批准或执行权的 Cloud 只读设备状态 | [账号与同步](ACCOUNT_AND_SYNC.md) |
| `Activating` | 使用短期 Bootstrap Capability 重建并校验本地工作库、尚未取得 Active 权限的状态 | [账号与同步](ACCOUNT_AND_SYNC.md) |
| `Active` | 持有当前 ActiveDeviceLease，可在其他 Gate 允许范围内修改和访问平台的唯一设备状态 | [ADR-0005](adr/0005-single-active-device-and-continuity.md) |
| `Draining` | 停止领取新任务并完成安全退出的状态；`handoff` 与 `suspend` 退出条件不同 | [账号与同步](ACCOUNT_AND_SYNC.md) |
| `LocalContinuation` | 仅用于正式停服预案的受限本地延续状态，不是日常纯本地模式 | [License](LICENSING.md) |
| `AuthSession` | 用于在线 GoodDealer 账号请求的会话凭证 | [账号与同步](ACCOUNT_AND_SYNC.md) |
| `OfflineDeviceLease` | 证明设备绑定和授权离线宽限的服务端签名凭证 | [License](LICENSING.md) |
| `ActiveDeviceLease` | 绑定账号、设备和单调 Epoch 的唯一执行权凭证 | [账号与同步](ACCOUNT_AND_SYNC.md) |
| `DeviceBinding` | Cloud 权威维护的账号与设备绑定、签名公钥版本和撤销状态 | [ADR-0011](adr/0011-device-identity-lifecycle.md) |
| `DeviceSwitchRequest` | 正常或强制设备切换的账号级互斥、幂等聚合 | [账号与同步](ACCOUNT_AND_SYNC.md) |
| `Bootstrap Capability` | 只允许下载、迁移、重建和摘要校验的短期单用途能力，不授予 Active 权限 | [用户旅程](USER_JOURNEYS.md) |
| `lease_epoch` | 服务端单调推进的活动设备代次，用于拒绝旧设备的新副作用 | [账号与同步](ACCOUNT_AND_SYNC.md) |
| `credential_epoch` | 设备凭证撤销和安全状态变化的服务端代次 | [ADR-0011](adr/0011-device-identity-lifecycle.md) |

## 平台连接与秘密

| 术语 | 导航性定义 | 权威来源 |
| --- | --- | --- |
| `ProviderConnection` | Workspace 中一个具体平台账号/连接的业务聚合，不包含秘密原值 | [连接器](CONNECTORS.md) |
| `DeviceCredentialBinding` | 某设备本地的 ProviderConnection、Credential Profile、Slot 与 Keychain 引用绑定 | [账号与同步](ACCOUNT_AND_SYNC.md) |
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
| `SyncMutation` | 可回放为业务状态的版本化设备修改记录 | [账号与同步](ACCOUNT_AND_SYNC.md) |
| `Outbox` | Active 本地事务中持久化、等待上传的封闭同步投影 | [账号与同步](ACCOUNT_AND_SYNC.md) |
| `Cursor` | Device/Reader 已消费的 Cloud 位置；连续确认水位与最大已见序号不能混用 | [账号与同步](ACCOUNT_AND_SYNC.md) |
| `Checkpoint` | 有摘要保护的 Workspace 重建基线；后续 Mutation 从该点回放 | [数据生命周期](DATA_LIFECYCLE.md) |
| `OwnershipEpisode` | 域名与账号/平台所有关系的有界时间段 | [同步语义](SYNC_SEMANTICS.md) |
| `StaleDeviceCandidate` | 旧 Epoch 本地修改的隔离候选，不能静默成为当前 Mutation | [同步语义](SYNC_SEMANTICS.md) |
| `RestoreCandidate` | 备份与当前 Cloud 比较形成的恢复候选，应用前需要当前 Revision 下复核 | [数据生命周期](DATA_LIFECYCLE.md) |
| `LateExecutionEvent` | 旧 Epoch 已发生、可验签的执行事实；不回放为 Desired/Observed State | [账号与同步](ACCOUNT_AND_SYNC.md) |

## 操作、自动化与验证

| 术语 | 导航性定义 | 权威来源 |
| --- | --- | --- |
| `OperationPlan` | 基于明确实体集合、基线与前置条件生成的可预览副作用计划 | [操作语义](OPERATIONS.md) |
| `ApprovedOperation` | 当前 Active 设备对具体计划的本机签名批准，不随设备切换迁移 | [账号与同步](ACCOUNT_AND_SYNC.md) |
| `Attempt` | 一次持久化执行尝试，拥有明确副作用提交边界和恢复语义 | [操作语义](OPERATIONS.md) |
| `outcome_unknown` | 已跨过可能产生副作用的边界但结果无法证明，只允许确认，不允许普通重试 | [操作语义](OPERATIONS.md) |
| `BrowserSessionConsent` | 用户允许建立或继续平台登录会话的同意，不等于业务操作批准 | [浏览器自动化](BROWSER_AUTOMATION.md) |
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
| `CaseReference` | 外部 Helpdesk Case 与内部受控访问/审计之间的可信关联 | [用户旅程](USER_JOURNEYS.md) |
| `Gate` | 需要权威设计和可重跑证据才能关闭的阶段准入条件 | [Phase 0 Gate 台账](PHASE0_GATE_REGISTER.md) |
| `Fallback` | Gate 未关闭时必须使用的收窄能力或失败关闭路径 | [Phase 0 Gate 台账](PHASE0_GATE_REGISTER.md) |
