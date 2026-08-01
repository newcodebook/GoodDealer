# GoodDealer 数据关系与所有权地图

状态：Derived Navigation Map
更新日期：2026-08-02

## 1. 边界

本文件只描述跨模块关系、信任边界和权威所有者，不复制实体字段、状态转换或数据库 Schema。字段和行为必须回到链接的专题文档；Repository、Migration 和 Wire Contract 仍由 [工程结构](ENGINEERING_STRUCTURE.md) 指定的模块拥有。实现变化若改变聚合关系、所有者或跨边界数据流，必须同步更新本图。

## 2. 账号、设备、Workspace 与平台连接

```mermaid
flowchart LR
    Account["Account"] --> Workspace["Private Workspace"]
    Account --> DeviceBinding["DeviceBinding (max 2 bound)"]
    Account --> Entitlement["AccountEntitlement"]
    DeviceBinding --> ActiveLease["ActiveDeviceLease (one current)"]
    Workspace --> Portfolio["Portfolio / DomainAsset"]
    Workspace --> ProviderConnection["ProviderConnection"]
    ProviderConnection -. "non-secret identity" .-> DeviceCredentialBinding["DeviceCredentialBinding (device local)"]
    DeviceCredentialBinding --> Keychain["OS Keychain / Credential Manager"]
```

| 关系或聚合 | 权威所有者 | 主要事实源 |
| --- | --- | --- |
| Account、AuthSession、账号安全状态 | Cloud `identity` | [账号与同步](ACCOUNT_AND_SYNC.md)、[License](LICENSING.md) |
| AccountEntitlement 与支付事实投影 | Cloud `licensing` | [License](LICENSING.md)、[用户旅程 JD-09](USER_JOURNEYS.md) |
| DeviceBinding、Challenge、签名 Key 版本、撤销 | Cloud `devices`；私钥由 Secure Host 拥有 | [ADR-0011](adr/0011-device-identity-lifecycle.md) |
| DeviceSwitchRequest、Bootstrap Capability、ActiveDeviceLease | Cloud `devices/workspace` 编排 | [账号与同步](ACCOUNT_AND_SYNC.md) |
| Workspace、Portfolio、DomainAsset、ProviderConnection | Cloud Workspace 模块与 Active 本地投影 | [架构](ARCHITECTURE.md)、[工程结构](ENGINEERING_STRUCTURE.md) |
| DeviceCredentialBinding、credentialRef 和秘密材料 | Device `secure-host-core` / OS Secret Store | [安全模型](SECURITY.md)、[ADR-0009](adr/0009-endpoint-capability-registry.md) |

Cloud 可以保存 ProviderConnection 的非秘密业务身份，但不能保存 DeviceCredentialBinding、credentialRef 实际值或平台秘密。Standby 可保留本机加密凭据，只有重新成为 Active 且其他 Gate 通过后才能读取和使用。

## 3. 三类追加记录必须分流

```mermaid
flowchart TB
    LocalTx["Active local transaction"] --> SyncMutation["SyncMutation / Outbox"]
    SyncMutation --> Materializer["Cloud materializer"]
    Materializer --> Revision["Workspace Revision"]
    Revision --> Cursor["Device / Reader Cursor"]
    Revision --> Checkpoint["Checkpoint + digest"]

    Attempt["Operation Attempt"] --> ExecutionFact["Execution Fact / LateExecutionEvent"]
    AdminOrUser["User / Staff security action"] --> AuditEvent["AuditEvent"]

    ExecutionFact -. "never replay as state" .-> Evidence["History / reconciliation evidence"]
    AuditEvent -. "never replay as state" .-> Evidence
```

| 记录类别 | 可回放为业务状态 | 去重/顺序所有者 | 保留与恢复边界 |
| --- | --- | --- | --- |
| SyncMutation | 是 | Workspace Sync | 可由 Checkpoint + 后续 Mutation 重建；压缩受 Cursor/Candidate 基线约束 |
| Execution Fact / LateExecutionEvent | 否 | Operations / execution-ledger | 只作为已发生副作用的证据、确认和对账输入 |
| AuditEvent / Staff AuditEvent | 否 | Audit / admin-access | 独立完整性链和保留策略，不与 Mutation 压缩合并 |

详细合并和回放语义由 [同步语义](SYNC_SEMANTICS.md)、[账号与同步](ACCOUNT_AND_SYNC.md) 和 [操作语义](OPERATIONS.md) 拥有。

## 4. Desired、Observed、执行与候选

```mermaid
flowchart LR
    Desired["Desired State"] --> Planner["Operation Planner"]
    Observed["Observed State + freshness"] --> Planner
    Planner --> Plan["OperationPlan"]
    Plan --> Approval["ApprovedOperation"]
    Approval --> Attempt["Attempt"]
    Attempt --> Fact["Execution Fact"]
    Fact --> Refresh["Platform refresh / reconciliation"]
    Refresh --> Observed

    OldEpoch["Old Epoch local changes"] --> StaleCandidate["StaleDeviceCandidate"]
    Backup["Backup projection"] --> RestoreCandidate["RestoreCandidate"]
    StaleCandidate --> Review["Review + current Revision rebase"]
    RestoreCandidate --> Review
    Review --> NewMutation["New current-Revision Mutation"]
```

- Desired State 不能直接触发平台副作用；必须经当前 Active 设备重新预览、批准和执行。
- Observed State 是带来源和新鲜度的证据，不以 Cloud Revision 冒充平台真实时间。
- StaleDeviceCandidate 与 RestoreCandidate 只能经过当前基线复核生成新 Mutation，不能静默覆盖当前状态。
- ApprovedOperation、Ticket、未完成队列和旧 Outbox 不进入可恢复业务备份投影。

## 5. 自动化与验证边界

| 流程 | 编排所有者 | 执行所有者 | 关键跨边界对象 |
| --- | --- | --- | --- |
| API/CSV/Manual 平台操作 | `client-core/operations` | Connector + `secure-host-core/secure-http` | OperationPlan、ApprovedOperation、Attempt、Execution Fact |
| 浏览器自动化 | `client-core/operations` | `automation-host`，Ticket 由 Secure Host 签发 | BrowserSessionConsent、BrowserAutomationGrant、AutomationExecutionTicket、Recipe |
| 域名所有权验证 | `client-core/verification` | `dns/registration/operations` | VerificationAttempt、DnsAuthoritySnapshot、Operation outcome |

Remote Browser WebView 不拥有 Keychain、数据库、Shell 或通用高权限 Command；automation-host 不能自行扩大 Recipe 或 Ticket 能力。Verification 的 DNS 写入必须保留同名 RRset，并把秘密挑战值排除在普通 TypeScript 和 Sync Projection 之外。

## 6. 备份、恢复与生产数据副本

| 数据面 | 允许进入备份/副本 | 禁止内容 | 权威来源 |
| --- | --- | --- | --- |
| 用户本地备份 | 版本化白名单业务投影；用户显式选择时可包含受独立保护的平台凭据区段 | 设备私钥、Auth/Lease、ApprovedOperation、Ticket、Browser Profile、Queue、旧 Outbox | [数据生命周期](DATA_LIFECYCLE.md) |
| Cloud 主库/搜索/对象存储/分析 | 业务和必要运营投影，按 TenantContext 隔离 | 平台秘密、credentialRef 实际值、未授权诊断 | [安全模型](SECURITY.md) |
| Cloud 备份/PITR | 与生产数据分类一致的加密副本 | 更低信任环境恢复、绕过 Tombstone 的数据复活 | [用户旅程 JF-18/JD-11](USER_JOURNEYS.md) |

具体区域、复制、删除传播和 KMS/IaC 责任在 JD-11 关闭前保持未决；临时环境或 SDK 默认值不能形成产品承诺。
