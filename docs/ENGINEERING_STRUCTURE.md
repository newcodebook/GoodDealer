# GoodDealer 工程结构与模块边界

状态：Accepted Design  
更新日期：2026-08-14

## 1. 目标

除明确标注“当前骨架/当前证据”的段落外，本文描述的是必须达到的目标设计，不表示对应目录、Port、状态机、Adapter、Handler、数据库或测试已经实现。当前实现状态只以 [Phase 0 Gate 台账](phase0/PHASE0_GATE_REGISTER.md)、工程基线和可重跑证据为准；从任一章节单独进入本文都应按此边界理解。

工程结构必须把产品安全决策变成编译期、测试期和运行时约束：

- 日常账号/Cloud 路径最多两台绑定设备，且只有 Active 可以修改业务状态和访问平台；正式停服后的 LocalContinuation 使用独立 Sunset 本地授权，不属于该双设备路径。
- Standby 只能读取 GoodDealer Cloud 已有数据，并使用分库分钥的加密缓存。
- 平台凭据、Browser Profile 和本地数据库密钥永不进入 Cloud。
- 设备侧 Mutation、ExecutionFact 和 DeviceAuditEvent 分属三条独立追加流；旧 Epoch 通过裁决的 ExecutionFact 只增加 `LateExecutionEvent` 分类，三者不能统一回放。User/Staff/Service AuditEvent 属于服务端独立链，不进入设备 Drain。
- Cloud 不加载连接器，也不代表用户访问域名平台。
- License 过期后，独立 account-web 仍提供合规导出、删除和安全管理。
- Staff Admin 与用户账号/API 分离；管理员只能通过模块管理 Port 操作且不能获得平台秘密或创建用户平台副作用。
- Active/Standby 可以复用只读 Query Port 和 protocol Codec，但 Local/Cloud Repository、事务与写接口保持分离。

采用“按运行时/安全边界拆包，按业务能力组织模块”：只有需要独立运行、具有不同权限或跨宿主复用的部分才成为 App/Package/Crate；普通领域能力在所属模块内组织，避免一类一个包。

## 2. 目标所有权目录树与当前骨架

本节是目标所有权布局的唯一事实源；[ARCHITECTURE.md](ARCHITECTURE.md) 只保留摘要。目录树包含 Phase 0 后续工作将创建的目标路径，不代表每个路径当前已经存在。当前已经落地的骨架路径由 `scripts/check-workspace.mjs` 验证；该脚本只是当前实现清单，不能反向缩减本节的目标边界。目标与已实现清单的差异由 R0-15 持续验收，禁止把任一方描述成完整实现状态。

```text
apps/
  desktop/
    src/
      features/                  # React 业务页面，与 client-core 模块同名
      adapters/
        tauri/                   # 实现 TS Port、封装 Tauri IPC Envelope
    src-tauri/                   # 薄 Tauri 适配层
  account-web/                   # 登录、License、设备、合规导出/删除
    src/
  admin-web/                     # GoodDealer 内部运营后台，独立 Staff 信任域
    src/
      features/
      api/                       # 仅访问 protocol/admin 与 Admin API
  cloud/
    src/
      entrypoints/
        http.ts                  # 用户客户端与 account-web API（Fastify）
        admin-http.ts            # 独立 Admin API Composition Root（Fastify）
        jobs.ts                  # 导出打包、删除、通知、保留清理、Checkpoint、压缩
      modules/
        admin-access/            # 首版 Owner Identity/Session/Scope 与管理权限判定
        job-runtime/             # Job Lease、幂等、TenantContext、重试与 Quarantine
        identity/
        licensing/
        devices/                 # DeviceBinding、ActiveDeviceLease、排空验收编排
        workspace/
          state/                 # 当前物化业务状态；表/Repository/Migration 按能力归属
            portfolio/
            registration/
            dns/
            marketplace/
            pricing/
            verification/        # 仅脱敏验证状态
            platform-sync/       # 三方基线、Observed/Desired 与冲突
            operations/          # 脱敏计划与任务状态
            browser-automation/  # 非秘密自动化设置与脱敏状态
          read/
          mutations/
          revisions/
          cursors/
          checkpoints/           # Checkpoint、压缩水位与按实体类型的一致性摘要
        execution-ledger/        # 全部 ExecutionFact 独立 Ingest、旧 Epoch Late 分类与隔离区
        recovery/                # StaleDeviceCandidate / RestoreCandidate
        connections/             # ProviderConnection 与 quota 摘要
        compliance/
        security-incidents/      # 账号接管、设备被盗、云端泄露的事件生命周期
        support-integration/     # 外部 Helpdesk Adapter 与可信 SupportCaseReference
        notifications/
        publication/
        audit/
      db/                        # 仅连接池、事务基础设施与 Migration Runner；表和 Migration 归各模块

packages/
  protocol/                      # 唯一跨端协议包，子路径导出
    account/
    devices/
    workspace/
    execution-events/
    recovery/
    connectors/
    admin/                       # Staff Admin API DTO；普通客户端禁止导入
  client-core/
    runtime-mode/                # RuntimeMode 投影与设备切换用例路由
    portfolio/
    registration/
    dns/
    marketplace/
    pricing/
    verification/                # TXT/NS 挑战工作流与平台验证状态
    connections/                 # ProviderConnection 视图与 DeviceCredentialBindingStatus 管理
    browser-automation/          # 自动化会话编排、Grant 与接管/暂停状态机
    sync/                        # Outbox、触发器、Checkpoint 重建、Anti-Entropy
    operations/
    recovery/                    # 恢复中心：StaleDeviceCandidate / RestoreCandidate 处理
    backup/
  cloud-client/                  # 类型化 GoodDealer Cloud 客户端
  connector-sdk/
  connector-test-kit/
  connectors/
    spaceship/
    cloudflare/
    atom/
    afternic/
  browser-automation/            # 仅 TS 契约层
    contracts/
    recipes/
    probe-runtime/
    test-kit/
  ui/
  i18n/

crates/
  secure-host-core/              # 无 Tauri 依赖
    runtime-gate/
    device-identity/
    crypto/
    keychain/
    secure-http/
    operation-signing/
  local-storage/                 # 依赖 secure-host-core 的 keychain/crypto 接口
    active-workspace/
      portfolio/                 # 各能力拥有 Repository 与 Schema 定义
      registration/
      dns/
      marketplace/
      pricing/
      verification/
      platform-sync/
      cloud-sync/
      operations/
      connections/
      browser-automation/
      audit/
    evidence-spool/               # 与业务库分库分钥的 Active Fact/Audit 原始签名 Envelope
    local-continuation-workspace/  # 仅正式停服构建；独立数据库、密钥与迁移序列
      portfolio/
      registration/
      dns/
      marketplace/
      pricing/
      verification/
      platform-sync/               # Sunset 本地 Desired/Observed/Base/冲突；无 Cloud 对端
      connections/
      browser-automation/          # Sunset Consent/Grant/opaque Session 投影；不含 Profile 原件
      operations/
      audit/                       # SunsetExecutionFact / SunsetDeviceAuditEvent 本地链
      migrations/                  # LocalContinuation 独立全局有序迁移序列
    standby-cache/
    artifacts/
    backup/
    migrations/                  # 单个 SQLite 工作库的全局有序迁移序列
  automation-host/               # Remote WebView 会话、注入、导航/弹窗/下载策略
```

## 3. 领域模块到工程归属

[ARCHITECTURE.md](ARCHITECTURE.md) §3 的每个领域模块在工程中的唯一归属如下。新增领域能力必须先在此表登记，禁止落入未列出的公共目录：

| 领域模块 | 客户端 TypeScript | 本地持久化 | 安全 Host / Rust | Cloud 模块 |
| --- | --- | --- | --- | --- |
| Portfolio | client-core/portfolio | active-workspace/portfolio + local-continuation-workspace/portfolio | — | workspace/state/portfolio |
| Registration | client-core/registration | active-workspace/registration + local-continuation-workspace/registration | — | workspace/state/registration |
| DNS | client-core/dns | active-workspace/dns + local-continuation-workspace/dns | — | workspace/state/dns（非敏感 Record） |
| Marketplace | client-core/marketplace | active-workspace/marketplace + local-continuation-workspace/marketplace | — | workspace/state/marketplace |
| Pricing | client-core/pricing | active-workspace/pricing + local-continuation-workspace/pricing | — | workspace/state/pricing |
| Verification | client-core/verification | active-workspace/verification + local-continuation-workspace/verification（均只含 challenge ref/fingerprint 与脱敏状态） | secure-host-core/keychain（原始敏感挑战 Vault；模式命名空间隔离） | workspace/state/verification（仅脱敏状态） |
| Sync（平台对账） | client-core/sync | active-workspace/platform-sync + local-continuation-workspace/platform-sync（Sunset 本地 Desired/Observed/Base/冲突，无 Cloud Revision/Mutation） | — | workspace/state/platform-sync（三方基线与冲突；仅 Active 同步路径） |
| Cloud Sync | client-core/sync、client-core/recovery | active-workspace/cloud-sync（Outbox/Cursor） | — | workspace/read、mutations、revisions、cursors、checkpoints、recovery |
| Operations | client-core/operations | active-workspace/operations（Queue/DAG/审批）+ evidence-spool（ExecutionFact 原始签名 Envelope）+ local-continuation-workspace/operations（Sunset 本地状态、Queue/DAG/批准引用与 SunsetExecutionFact） | secure-host-core/operation-signing、stream-signing | workspace/state/operations（脱敏状态）、execution-ledger（仅 Active 路径 ExecutionFact；旧 Epoch 裁决为 LateExecutionEvent） |
| Connections | client-core/connections | active-workspace/connections + local-continuation-workspace/connections（两者共享元数据/绑定状态分离） | secure-host-core/keychain（credentialRef 实际值；模式命名空间隔离） | connections（共享元数据与 quota 摘要） |
| Browser Automation | client-core/browser-automation（编排）+ packages/browser-automation（契约/Recipe/Probe） | active-workspace/browser-automation（日常 Consent/Grant/opaque Session 投影）+ local-continuation-workspace/browser-automation（Sunset Consent/Grant/opaque Session 投影；同库消费 Sunset 批准引用）；均不含 Profile 原件/Ref/health/generation/sequence | automation-host 私有 Profile 目录与 `BrowserSessionProfile` 权威元数据（Active/Sunset namespace 分离） | workspace/state/browser-automation（非秘密设置与脱敏状态） |
| Account & Licensing | client-core/runtime-mode（投影） | —（Access Token 在 Host 内存；Refresh/Entitlement Token/Lease 在 Keychain） | secure-host-core/runtime-gate、device-identity、session-store、keychain | identity、licensing、devices |
| Active Device Coordination | client-core/runtime-mode（切换用例） | active-workspace/cloud-sync（排空进度） | secure-host-core/runtime-gate | devices |
| Publication | —（未来发布界面） | — | — | publication |
| Backup & Restore | client-core/backup、client-core/recovery | local-storage/backup、active migrations、local-continuation migrations | secure-host-core/crypto、keychain | compliance（网页导出） |
| Audit | 各模块产生模式对应的 AuditEvent | evidence-spool（Active DeviceAuditEvent 原始签名 Envelope）+ local-continuation-workspace/audit（SunsetDeviceAuditEvent 本地唯一追加链） | secure-host-core/crypto、stream-signing | audit（不接收 SunsetDeviceAuditEvent） |

Cloud `execution-ledger` 拥有所有 Active 路径 `ExecutionFact`，旧 Epoch 通过裁决后只增加 `LateExecutionEvent` 分类；Cloud `audit` 独占日常 AuditEvent 及其序列/Hash 链。两者只能通过 `audit_event_ref/hash` 和只读时间线投影关联，不得转移或共享记录所有权。`SunsetExecutionFact` 与 `SunsetDeviceAuditEvent` 只属于本机 LocalContinuation Workspace，使用独立 Schema、Key Purpose、Transcript 和本地唯一追加链，绝不进入 Cloud Ingest、三流 Drain 或日常解析器。本地 `active-workspace/<capability>` 与 `local-continuation-workspace/<capability>` 分别拥有各自 Repository 和 Schema 定义，禁止互相导入或复用写 Repository。Active 各能力共用一个 SQLite 数据库，因此 `local-storage/migrations` 是 Active 的全局单一有序序列；LocalContinuation 各能力共用另一数据库，因此只使用 `local-continuation-workspace/migrations` 的独立全局序列。evidence-spool 另有独立 Schema、迁移序列和密钥；三者不能交叉挂载事务、Migration 或 Outbox。

## 4. RuntimeMode 是一等边界

目标权威状态机位于 Rust `secure-host-core/runtime-gate`。UI 中的 `client-core/runtime-mode` 只保存 Host 返回的只读快照并决定页面呈现，不得自行构造或提升状态。当前骨架只有跨语言 RuntimeMode 枚举和测试级准入 Fixture，生产状态机、Command 接线与消费点复验仍由 R0-16 阻塞。

```text
Locked
  -> Standby
  -> Activating
  -> Active
  -> Draining(reason: handoff | suspend)
       handoff -> Standby
       suspend -> Active | Standby | Activating(purpose: local_recovery)
       local_recovery -> Active | isolated recovery / InternalRecoveryPoint rollback

LocalContinuation             # 仅 Sunset 构建/凭证可进入
```

状态准入：

| 命令类别 | Locked | Standby | Activating | Active | Draining | LocalContinuation |
| --- | --- | --- | --- | --- | --- | --- |
| 账号、续费、设备、合规入口 | 是 | 是 | 是 | 是 | 是 | 本地有限支持 |
| Cloud Workspace 只读 | 否 | 是 | 是 | 是 | 是 | 否 |
| 打开 Standby Cache | 否 | 是 | 是 | 否 | 否 | 否 |
| 打开 Active Workspace | 否；仅可读独立 RemovedEvidenceSpool | 否 | 否，仅允许独立 Activation/Recovery Staging | 是 | 是 | 否 |
| 打开 LocalContinuation Workspace | 否 | 否 | 否 | 否 | 否 | 是，仅正式停服构建 |
| SyncMutation / MutationOutbox | 否 | 否 | 否 | 是 | 否 | 否 |
| 本地业务状态写入 | 否 | 否 | 否 | 是；同事务生成 SyncMutation | 否 | 是；仅本地事务并追加 Sunset 审计，不生成 SyncMutation/Outbox |
| 平台读取/写入 | 否 | 否 | 否 | 是 | 否；进入 Draining 前已完成或隔离在途提交 | 是 |
| 模式对应的 Operation 批准签名 | 否 | 否 | 否 | `ApprovedOperation` | 否 | 仅 `SunsetApprovedOperation` |
| Attempt 结果落账 | 否 | 仅原 Epoch 签名证据 Ingest | 恢复扫描 | 是；写 ExecutionFact/DeviceAuditEvent 到 evidence-spool | 否；进入前已完成/隔离并持久化 Envelope | 是；只写 SunsetExecutionFact/SunsetDeviceAuditEvent 本地链 |
| Workspace Mutation/ExecutionFact/DeviceAuditEvent 上传 | 仅 Tombstone + 旧设备 PoP 的 evidence-only ExecutionFact/DeviceAuditEvent；不得读取业务库、提交 Mutation/Proposal 或恢复 Scope | 仅原 Epoch 签名 ExecutionFact/DeviceAuditEvent 与 StaleChangeProposal；Account DeviceAudit 独立续传；不得上传 Candidate | 恢复冲刷 | 是 | 是，只上传进入前已持久化 Envelope/序列，不得分配新序列或产生新业务意图 | 否 |
| 凭据健康检查/修复 | 否 | 否 | 否 | 是，仅 Manifest 声明 `credentialAccessPolicy=health_reverification` 的无业务副作用 Host-owned 窄 Endpoint 可复验 `retained_unverified` 并解除隔离 | 否 | 是；使用相同策略但独立 Sunset Binding scope |
| 创建/检查本地备份 | 否 | 否 | 否 | 是 | 否 | 是 |
| 恢复秘密 | 仅 `local_integrity_failure` 的 Host-owned Recovery Shell；修复后重新判权 | 否 | 是 | 是，须转入隔离恢复流程 | 否 | 是 |
| 恢复业务数据/Schema Migration | 不在 Locked 内执行；只能选择转 Activating/Cloud 重建 | 否 | 是，仅 Staging | 否，先转 Activating | 否 | 是，仅本地 |

关键转换条件：

- `Locked -> Standby`：账号或 OfflineDeviceLease、设备绑定和 Entitlement 有效。
- `Locked(local_integrity_failure) -> Activating(purpose=local_recovery)`：Host-owned Recovery Shell 只解封/重包 Database Master Key 并完成完整性诊断；账号、设备绑定和 Entitlement 重新在线验证有效后，才能转入隔离 Staging 或 Cloud 重建。Removed/授权失效等其他 Locked 原因禁止该转换，Recovery Shell 本身不打开业务行或恢复任何执行权。
- `Standby -> Activating`：取得绑定到当前 DeviceSwitchRequest 的短期只读 Bootstrap Capability；应用支持 Workspace Schema，开始建立当前 Revision 基线。Bootstrap Capability 不授予 Mutation、平台访问、批准或执行权限；它绑定整个多步激活 Workflow，以携带实际 Checkpoint 选择、Mutation 分页范围/cursor 或重建摘要的 strict 判别 step payload、单调 step nonce/number + 服务端 CAS 幂等推进，签发 Lease、放弃或到期时才整体消费。strict step Wire、摘要 Transcript 与 Cloud Fixture Handler 已交付；生产 Capability 验签、持久化事务 Handler、Rust/客户端重建与 Lease 签发尚未交付。
- `Activating -> Active`：Checkpoint + 后续 Mutation 回放完成并通过按实体类型的一致性摘要校验后，服务端原子签发 ActiveDeviceLease。
- `Active -> Draining(reason)`：收到正常切换、退出或安全暂停请求；立即停止领取新任务。`reason` 不改变命令准入，只决定退出条件。
- `Active -> Draining(reason=suspend) -> Activating(purpose=local_recovery)`：本机恢复必须先冻结 Worker、平台访问、Mutation 和批准，尽力冲刷后关闭 Active Workspace；仅使用绑定同一设备、Workspace、当前 Lease Epoch、`backup_id + manifest_digest` 的短期窄化 Recovery Capability 打开独立 Recovery Staging。该 Capability 使用 `gd.recovery-capability.v1` / `gooddealer-desktop/local-recovery` / `gooddealer.devices.recovery-capability.v1` 独立域，只允许用 strict 判别 step payload 固定当前 Cloud 基线、提交包含完整有界 `BackupExportSchema` 白名单 diff 的 Manifest-bound 请求并读取 Cloud 创建 Candidate 的回执；不能 Apply Candidate、生成 Mutation 或签发 Lease。它绑定完整多步 Workflow，以单调 step nonce/number + 服务端 CAS 幂等推进，摘要覆盖除 nonce/自身外的完整请求，Candidate 回执、放弃或到期时才整体消费；不同 Payload、越序和并发竞争失败关闭。Staging 校验、迁移、比较和 Candidate 创建完成后必须安全销毁，随后用当下最新 Cloud Checkpoint + Mutation 重新构建正式工作库并完成激活；只在回到 Active 后读取 Candidate 并逐字段 CAS Apply。Capability 与 Bootstrap 使用不同 purpose/domain，换包、换 Manifest 或跨 purpose 重放失败。失败时保持隔离恢复状态或只通过同设备 `InternalRecoveryPoint` 回滚。回滚出的 Session、Lease/Epoch、批准、Ticket、Worker Lease 与可信时间全部失效，重新读取当前 Host/Cloud 权威状态并对账前不得 Active，也不能绕过 Candidate/CAS。Recovery Envelope、step DTO 与 Handler 当前尚未交付。
- `Draining(reason=handoff) -> Standby`：Mutation、ExecutionFact、Workspace-scope DeviceAuditEvent 三条设备流冲刷成功，服务端验证签名 `DrainManifest` 中每条流的连续水位、Gap、待上传数和摘要后释放 Lease；Account DeviceAudit 与 User/Staff/Service AuditEvent 不属于 Workspace Drain，单一最大序号无效。
- `Draining(reason=suspend) -> Active/Standby`：进入 Draining 前，Active 先停止签发 PlatformAccessContext，等待已提交的单次请求结束或隔离为 `outcome_unknown`，并在同一模式转换屏障前持久化对应签名 ExecutionFact/DeviceAuditEvent Envelope 与序列；存在未决请求、未持久化结果或未封口 Sequencer 时拒绝提交 Mode 转换。进入后只上传既有 Envelope，不再访问平台、落账新结果或分配新序列。Cloud 不可用或冲刷失败不阻塞 suspend 退出，恢复时先执行 Outbox 与结果未知对账。
- `任意状态 -> Locked`：授权失效、设备移除或安全门禁失败；已经发出的原子平台请求进入结果确认语义。
- `LocalContinuation`：只接受独立 Sunset Signing Key 签发的永久凭证，不出现在日常模式选择器中；平台访问、批准、浏览器连接建立和浏览器执行分别使用 `SunsetAuthorization`、`SunsetApprovedOperation`、`SunsetBrowserSessionAccessContext` 与 `SunsetAutomationExecutionTicket`，不能复用或伪装成 ActiveDeviceLease/Epoch。业务状态只写独立 LocalContinuation Workspace；执行结果和审计只追加 `SunsetExecutionFact`/`SunsetDeviceAuditEvent` 本地链，不生成 SyncMutation、MutationOutbox 或 Cloud 上传意图。

同一账号最多存在一个未完成的 DeviceSwitchRequest/Bootstrap Capability。重复申请使用幂等键返回同一请求，新的申请不得与旧申请竞争激活。

## 5. 应用运行时所有权

### apps/desktop

- React 只负责界面、交互和 RuntimeMode 投影。
- `src/features/<capability>` 组织业务页面，目录名与 client-core 模块一致，UI、用例和领域三层使用同一套名字。
- `src/adapters/tauri` 实现 client-core 定义的 TypeScript Port，把 Port DTO 映射为最小化 Tauri IPC Envelope，并调用对应 Command。
- `src-tauri` 是薄适配层：注册 Tauri Command、组装 Rust Crate、映射窗口事件和平台能力。
- `src-tauri/build.rs` 使用 `tauri_build::AppManifest::commands` 声明完整自定义 Command 清单；该清单、`tauri::generate_handler!` 注册集合与 Capability 中逐命令 Permission 集合必须完全一致并由结构测试失败关闭。Local App Capability 按明确 WebView label 授权；若同一 Window 内存在 Remote WebView，不得使用窗口级 Capability 把 Local 权限合并给该窗口的全部 WebView。
- 不在 `src-tauri` 内实现业务规则、密钥算法、数据库迁移或浏览器 Recipe 逻辑。
- Desktop 可以组装四个互相隔离的长期持久化域：Active Workspace、Standby Cache、LocalContinuation Workspace 与 evidence-spool；每个域拥有独立文件、WAL、连接、Master Key 和 Migration/Schema Runner，并且只打开 RuntimeMode 准入矩阵允许的组合。Activating 期间允许只读挂载 Standby Cache，同时在另一个临时、分钥的 Activation/Recovery Staging 中恢复/构建 Active Workspace；所有域不得交叉写入或共享事务，Cache 不得作为 Mutation 基线，进入 Active 前必须关闭 Cache，Staging 完成后销毁。evidence-spool 只经 Active/Standby Ingest 或 RemovedEvidenceSpool 窄口访问；LocalContinuation 不挂载它。

### apps/account-web

- 负责注册、登录、Passkey、License、会话、设备、合规导出和删除。
- License 过期后仍允许合规与账号安全入口，不依赖客户端业务门禁。
- 依赖 `cloud-client` 与 `protocol`，不得依赖 `client-core`、连接器或 Rust Host。
- 不接收、展示或请求平台 API Key、Cookie、Browser Profile 和本地备份密钥。

### apps/admin-web

- GoodDealer 内部员工使用，不是 account-web 的隐藏路由或角色切换模式；采用独立域名、构建产物、Session Cookie、CSP 和 CSRF 策略。
- 只依赖 `protocol/admin` 及自身 API Adapter，不依赖 `client-core`、连接器、Rust Host 或普通 cloud-client。
- Staff 登录使用独立 StaffIdentity；首版只有一名管理员（Owner），正式环境要求 Passkey。Role/Scope 结构保留，首版仅签发 Owner 身份。
- 通过 Admin API 调用业务模块公开的管理 Port，不直接访问 PostgreSQL、Repository 或 ORM Entity。
- 不显示、请求或恢复平台凭据、Cookie、Browser Profile、数据库密钥或用户本地备份秘密，也不能代表用户访问域名平台。

### apps/cloud

- `entrypoints/http.ts` 提供用户客户端与 account-web API；`entrypoints/admin-http.ts` 提供独立 Staff Admin API；两者首版均使用 Fastify，但拥有不同的认证、Scope、Route 注册和错误暴露策略。
- Fastify Route 校验使用从 protocol Zod Schema 构建期派生的 JSON Schema（`fastify-type-provider-zod` 或等价工具）；Zod 是唯一契约事实源，禁止手写与之平行的 JSON Schema。
- `entrypoints/jobs.ts` 使用基于 PostgreSQL 的任务队列（建议 pg-boss）调度导出、删除、通知、保留清理、Checkpoint 和压缩，延续“PostgreSQL 为正确性来源、不依赖 Redis”的基线；它不依赖 Fastify 或 HTTP Request Context。
- 窄 `job-runtime` 只负责 Job Lease、心跳、幂等、超时、退避、隔离和安全重放。业务 Payload、结果、取消和补偿语义仍由 compliance、notifications、workspace/checkpoints 等目标模块拥有。
- 每个 Job Envelope 必须携带不可为空的 TenantContext、业务 Job ID、Payload Version、幂等键、创建者/触发源和目标模块；不得先无租户扫描再由 Handler 自行过滤。
- 三个入口组装同一组模块、Repository 和事务边界，首版仍是一个模块化单体；Admin API 可以使用同一构建产物的独立进程/端口部署。
- `src/db` 只包含连接池、事务基础设施和 Migration Runner；表、Migration 和 Repository 归各模块目录所有。
- Cloud 只依赖 `protocol` 和云端基础设施，不依赖 `client-core`、连接器或浏览器自动化。
- 服务端不存在访问域名平台的通用 HTTP Gateway。

不提前创建 `apps/mobile`。Phase 6 启动时，基于已验证的 `client-core`、`protocol` 和 `secure-host-core` 新建移动宿主。

## 6. TypeScript Package 边界

### protocol

`@gooddealer/protocol` 是唯一跨客户端/Cloud 的协议包，通过子路径导出：

```text
@gooddealer/protocol/account
@gooddealer/protocol/devices
@gooddealer/protocol/workspace
@gooddealer/protocol/execution-events
@gooddealer/protocol/recovery
@gooddealer/protocol/connectors
@gooddealer/protocol/admin
```

- 只包含 DTO、Zod Schema、枚举、错误码、版本、兼容性转换，以及协议级确定性 Codec/Golden Vector；不包含带副作用的领域用例。
- Workspace 字段元数据同时携带隐私分类（`PUBLIC_BUSINESS` 等）与合并等级 `mergeClass: auto | manual | safety_priority`；服务端设备↔云端合并与客户端平台对账消费同一份标注，禁止两端各自维护高风险字段清单。
- `protocol/account` 对客户端公开的是不含登录凭据的登录流程控制命令、脱敏 AuthSessionStatus 和错误码，不定义会把原始 Access/Refresh Token 返回普通 TypeScript 的 DTO。
- 含账号密码等登录凭据的请求 Schema 不进入 `packages/protocol`；它们只归 Cloud `identity` 模块内部所有且不得导出。
- `protocol/workspace` 拥有 Workspace Entity、SyncMutation、Revision、Cursor、Checkpoint 和确定性业务摘要；不拥有执行事实、Audit、Drain 或恢复 Candidate。
- `protocol/execution-events` 拥有 ExecutionFact、`DeviceAuditEvent | UserAuditEvent | StaffAuditEvent | ServiceAuditEvent` 判别联合、DrainProof/DrainManifest、序列域、域分离签名 Transcript、canonical envelope 与滚动摘要 Golden Corpus。
- `protocol/recovery` 拥有 StaleChangeProposal、Cloud 生成的 StaleDeviceCandidate/RestoreCandidate、字段级 CAS、BackupExportSchema、SynchronizedBackup/EmergencyLocalSnapshot Manifest、PendingSignedEvidenceArchive 和 InternalRecoveryPoint 的本机接口契约。
- `protocol/admin` 只保存 Staff Admin API DTO、Scope、错误码和兼容转换；import-boundary 必须禁止 desktop、account-web、client-core、cloud-client 和连接器导入该子路径。
- 不包含 Repository、网络客户端、领域用例、ORM Model 或平台实现。
- 子路径之间通过显式公共出口依赖，禁止深层相对导入。
- 只有出现真实的独立发布、权限隔离或版本节奏需求时才拆成多个 pnpm 包。

### client-core

- 宿主无关的客户端应用与领域核心。
- `sync` 拥有本地 Outbox、上传触发器、Device Cursor、Checkpoint 重建和客户端 Anti-Entropy。
- `operations` 拥有 Planner、ApprovedOperation、Queue/DAG、重试、取消和结果确认。
- `runtime-mode` 只定义 UI 可消费的状态投影和用例路由，权威准入仍在 Rust runtime-gate。
- `verification` 拥有 TXT/NS 挑战工作流、DNS 传播轮询和平台验证状态。
- `connections` 拥有 ProviderConnection 视图、Active Workspace 中的 DeviceCredentialBindingStatus，以及普通本机加密层的 DeviceCredentialCandidateStatus；后者仅供 Standby 显示 `never_configured | configured_candidate | unknown`，不查询秘密存储。`secure-host-core` 独占 HostCredentialBinding、Namespace、强类型 SlotId/SecretKind 与 OS Keychain 引用。
- `browser-automation` 拥有自动化会话编排、BrowserAutomationGrant、授权级别和接管/暂停状态机；Recipe 内容与 Probe 在 packages/browser-automation，WebView 控制在 automation-host。
- 通过 Port 访问本地存储、Cloud、连接器和安全 Host，不直接导入 Tauri API。Port 接口与宿主无关的 Port DTO Schema 属于 client-core 各模块公开出口；`apps/desktop/src/adapters/tauri` 在 TypeScript 中实现 Port 并拥有 Tauri IPC Envelope，`src-tauri` 只实现 Rust Command Handler 和镜像 DTO 校验。`protocol` 不承载客户端内部 IPC。

### cloud-client

- 只依赖 `protocol`，负责只读 Workspace、Mutation、设备切换、`ExecutionFact` Ingest、合规 API 及非秘密账号操作的类型化请求构造与响应解析，并通过注入的 Transport Port 发送。
- 不缓存领域状态，不实现冲突合并，不读取 Keychain，不持有账号 Token 或平台凭据，也不得自行构造 `Authorization` Header。
- Desktop 中由 `apps/desktop/src/adapters/tauri` 组合 cloud-client 与 Tauri Transport；Transport 只把已批准的 GoodDealer Cloud Endpoint ID 和公开 Payload 交给 Rust `secure-http`，Method 与网络策略由 Host 注册表决定，短期 Access Token 由 Host 内存 Session Store 注入。
- Desktop 的登录、Token 刷新、撤销和轮换是 Host-owned Session Command：Rust 解析 Token-bearing Response，把轮换 Refresh Token 持久化到 Keychain、Access Token 仅存入 Host 内存，并只向 TypeScript 返回脱敏 AuthSessionStatus；这些响应不得经过 cloud-client。启动时 Host 使用 Refresh Token 换取新 Access Token。
- account-web 使用独立的同源 Web Transport 与 HttpOnly/SameSite 会话 Cookie；不得复用 Desktop Keychain Token 通道。

### connector-sdk 与 connectors

- `connector-sdk` 定义能力接口、Capability Descriptor、QuotaScope、统一结果和运行端口。
- 每个连接器是独立包，只依赖 `connector-sdk`、允许的 `protocol/connectors` 和浏览器自动化契约。
- `connector-test-kit` 只提供连接器契约测试，不作为通用测试工具箱。
- `client-core` 依赖连接器接口，不直接依赖具体连接器；Desktop Composition Root 注册首批连接器。

### browser-automation

- TypeScript 侧只包含 contracts、recipes、probe-runtime 和专用 test-kit。
- Probe 在不可信页面环境运行，不持有 Tauri Command、数据库或平台 API Secret。
- WebView 创建、Profile、脚本投递、导航/弹窗/下载拦截与 IPC 验证不属于此包，由 Rust `automation-host` 承担。

### ui 与 i18n

- `ui` 只包含视觉组件、表格和无业务含义的交互原语。
- Portfolio、Operation、设备切换等业务页面保留在 App Feature 中，不塞入通用 UI 包。
- `i18n` 保存语言资源、格式化和 Key 类型，不依赖业务实现。

不创建泛化的 `packages/test-kit`。跨模块 Fixture 应归属对应模块；只有明确复用范围的工具才进入命名具体的 test-kit。

## 7. 本地与 Cloud 接口复用边界

本地 Active Workspace 与 Cloud Workspace 表示同一组业务概念，但具有不同的正确性、权限和事务语义。复用目标是统一数据语言和客户端查询体验，不是把两套存储伪装成同一个 CRUD Repository。

### 7.1 共享协议与确定性 Codec

`protocol/workspace` 可以同时供 client-core、cloud-client 和 Cloud 使用，并拥有：

- Workspace Entity DTO、ID、枚举、错误码和字段级数据分类。
- Mutation、Revision、Cursor 与 Checkpoint Schema；Candidate/Backup 归 `protocol/recovery`，ExecutionFact/Audit/Drain 归 `protocol/execution-events`。
- Schema Version、兼容转换和确定性序列化 Codec。
- Anti-Entropy 摘要使用的字段顺序、空值、日期、定点金额和 Unicode 编码规则。
- 客户端与 Cloud 必须共同通过的 Golden Test Vector。

确定性 Codec 属于协议语义，不包含 Repository、事务、网络、运行时门禁或领域用例。

域名规范化与金额精度是已确认的第一天双端需求：`canonical_name` 的 Punycode/大小写规范化和 ISO 4217 定点金额规则从一开始就抽入 protocol/workspace 的命名能力模块，客户端建档、云端 Mutation 校验、`canonical_name` 唯一约束和一致性摘要消费同一实现——两端规范化差一个字节，Anti-Entropy 摘要比对就永远失败。其他纯函数仍须在至少两个运行端出现真实重复并具有完全相同语义后才允许抽入命名具体的能力模块；禁止创建 `shared`、`common` 或 `utils` 杂物包。

### 7.2 Active 与 Standby 共享只读 Query Port

client-core 为 UI 定义宿主无关、只读的能力 Query Port，例如：

```typescript
interface PortfolioQueryPort {
  listDomains(query: DomainQuery): Promise<DomainPage>;
  getDomain(id: DomainAssetId): Promise<DomainDetails>;
  getFreshness(): Promise<DataFreshness>;
}
```

- Active 使用 `ActiveLocalPortfolioAdapter -> Tauri IPC -> local-storage`。
- Standby 使用 `StandbyCloudPortfolioAdapter -> cloud-client -> workspace/read`。
- Desktop Composition Root 按 RuntimeMode 注入实现；UI 不自行选择数据源。
- `DataFreshness` 必须包含来源、Server Revision、最后云同步时间、最后平台读取时间和 `canEdit`，避免把 Cloud 缓存误认为平台实时状态。
- 共享 Query Port 只能返回允许同步的非秘密业务投影。DeviceCredentialBindingStatus、Browser automation 非秘密编排状态和本地 Artifact 使用模式限定的专用 Query Port；Browser Profile 原件、Ref、health、generation、sequence、Keychain 状态与 HostCredentialBinding 永不通过普通 Query Port 暴露。不得为了表面统一而在共享 DTO 中加入秘密字段或大量语义不明的可空字段。

只读 Query Port 可以按 Portfolio、DNS、Marketplace、Operations 等能力复用，但底层 Local/Cloud Adapter 保持独立。

### 7.3 写路径与 Repository 不共享

Active 写入固定为：

```text
client-core Command
  -> 本地领域事务
  -> Active Workspace 状态 + Outbox 同事务提交
  -> 异步上传 SyncMutation
```

LocalContinuation 写入固定为：

```text
client-core Command
  -> Sunset 模式本地领域事务
  -> LocalContinuation Workspace 状态 + SunsetDeviceAuditEvent 同事务提交
  -> 外部请求结果另以 SunsetExecutionFact 追加并引用对应 SunsetDeviceAuditEvent
  -X-> SyncMutation / MutationOutbox / Cloud Ingest
```

禁止让同一个 `saveDomain()` 或通用 CRUD Repository 在 Active 时写 SQLite、Standby 时直接写 Cloud。Standby 没有 Command/Mutation 实现；Cloud Mutation API 是同步传输协议，不是 UI 的远程 Repository。

以下内容不得在本地与 Cloud 之间共享实现：

- Repository 接口、ORM Entity、数据库模型和 Migration。
- SQLite 与 PostgreSQL 事务边界。
- Device Secret、Queue、Grant、WAL/Outbox 内部结构。
- RuntimeMode/ActiveDeviceLease 门禁和服务端租户授权。

日常 Local Repository 由 `local-storage/active-workspace/<capability>` 实现，Sunset Local Repository 由 `local-storage/local-continuation-workspace/<capability>` 独立实现，Cloud Repository 由 `workspace/state/<capability>` 实现。Active 与 Cloud 只通过 protocol DTO、Mutation 和确定性 Codec 对齐；LocalContinuation 没有 Cloud/Mutation 对端，只能复用纯领域值对象和无 I/O 规则，不能复用 Active Repository、Outbox、Migration 或模式门禁实现。LocalContinuation 的 `platform-sync` 只把本机平台读取写成 Sunset 自身的 Observed/Base、把本地意图写成 Desired 并保存冲突/新鲜度；它不读取 Cloud Revision，也不产生 SyncMutation、Cursor 或 Cloud 对账事件。

## 8. Rust Crate 边界

### secure-host-core

无 Tauri/Wry 依赖，拥有最高安全边界：

- `runtime-gate`：RuntimeMode 状态机、命令分类和准入。
- `sunset-continuation`：验证独立 Sunset Signing Key 凭证，绑定安装实例/Workspace/设备 Key，维护不可回退的 Sunset credential generation 与本地可信时间，并派生短期 `SunsetAuthorization`；日常构建不注册导入或进入路径。
- `device-identity`：设备 ID、设备签名密钥和可信时间锚点。
- `crypto`：AEAD、Hash、签名验证和密钥封装接口。
- `keychain`：OS Keychain/Credential Manager 抽象。
- `secure-http`：消费构建期 EndpointManifest 生成的嵌入式注册表；Manifest 只标记 `host_owned`，具体 typed extractor 由 Rust 私有编译期表按 Endpoint 绑定，两张表在任何 Host 资源前做全表双向一致性校验；按 Host 私有 `binding_scope + provider_connection_id` 查询版本化 Credential Profile 与完整 Slot/SecretKind 绑定：Active scope 固定 `device_id`，Sunset scope 固定 `sunset_installation_id + workspace_id + sunset_credential_generation + device_signing_key_id/version`，两者 Namespace/唯一索引互斥。随后以完整作用域读取秘密并执行封闭参数编码和总量限制、固定幂等 Header、URL/DNS/IP、固定连接地址、TLS Host、禁系统代理/重定向、秘密延迟加载、公开响应白名单或秘密 Body 消费、脱敏、超时和流式/解压响应限制。Fixture Executor seam 只在测试编译，生产模块不能接受外部 Transport 实现。
- `secret-capture`：定义 Host-owned 原生秘密输入 Port、不可 Clone/Debug 脱敏/释放清零的秘密内存类型，以及带 Device、Account 或 Provider Connection/Profile/来源 Endpoint 强类型作用域的原子批量 Keychain 写入；Store 只返回整批回执，普通 Tauri IPC 只返回 `credential_binding_id`、fingerprint 和脱敏状态，Keychain Ref 不离开 Host。
- `operation-signing`：按 RuntimeMode 使用封闭判别类型签发和校验 `ApprovedOperation | SunsetApprovedOperation` 与短期、一次性的 `AutomationExecutionTicket | SunsetAutomationExecutionTicket`；两组 Key Purpose、Schema、Transcript、Nonce 存储和解析器完全分离。
- `stream-signing`：对 ExecutionFact、DeviceAuditEvent 和 DrainProof 使用不同域分离 Transcript 的设备 Ed25519 签名、Key Version、可信时间锚点与防重放序列；对 SunsetExecutionFact/SunsetDeviceAuditEvent 使用仅 LocalContinuation 可调用的独立 Key Purpose、Transcript 和本地唯一追加序列。Active 与 Sunset 解析器互相拒绝；本地 HMAC 只用于磁盘完整性，不能充当 Cloud Ingest 签名。`LateExecutionEvent` 只由服务端对旧 Epoch ExecutionFact 裁决分类。

Rust 集成测试直接针对该 Crate 运行，不需要启动 Tauri WebView。

EndpointManifest 由各编译期 Connector 拥有，构建工具单向生成 `connector-sdk` 的 Endpoint ID/公开请求与响应类型和 `secure-host-core` 的完整安全注册表；前端不导出 Origin、注入或网络策略，生成物在 CI 重建并差异检查。Device Identity 的公开 DTO 由 `protocol/devices` 拥有，Cloud `devices` 拥有 Challenge/版本/撤销状态，Rust `device-identity` 只拥有私钥、确定性 Transcript 与签名 Port。

### local-storage

依赖 `secure-host-core` 暴露的 keychain/crypto 接口：

- `active-workspace`：完整 SQLCipher 业务库、MutationOutbox、Queue、ExecutionFact/DeviceAuditEvent 的只读业务引用和本地审计投影；不拥有签名证据上传原件。
- `evidence-spool`：与业务库分库分钥、追加式保存原始签名 ExecutionFact/DeviceAuditEvent Envelope 的移除存活队列。Active/Standby 按各自 Ingest 权限消费；设备 Removed/Locked 后只暴露 `RemovedEvidenceSpool` 窄读口。每条记录先于对应 Attempt 结果提交落盘，并以稳定 Envelope ID/digest 与业务引用幂等对账；业务库关闭、损坏或删除不能删除未确认证据。
- `local-continuation-workspace`：仅正式停服构建打开的独立 SQLCipher 业务库，拥有 Sunset 各 capability Repository（含本地 platform-sync）、Browser Consent/Grant/opaque Session 投影、SunsetExecutionFact/SunsetDeviceAuditEvent 本地链和独立 Master Key；Browser Profile 原件及其 Ref/health/generation/sequence 属于 automation-host 私有模式命名空间，不进入该库。本库不包含 MutationOutbox、Cloud Cursor、Active Lease/Epoch 或日常 Fact/Audit 队列。
- `standby-cache`：独立 SQLCipher 文件、独立缓存密钥、Reader Cursor 和可丢弃投影。
- `artifacts`：下载、CSV、截图和临时文件生命周期。
- `backup`：一致性快照、加密包、Manifest 和恢复 Staging。
- `migrations`：根 `local-storage/migrations` 只管理 Active Workspace 的全局单一有序版本迁移与失败恢复；`local-continuation-workspace/migrations` 单独管理 Sunset 数据库。两个序列、Migration ID 空间和 Runner 互相拒绝，Repository/Schema 虽按 capability 归属，但同一数据库内的能力不得各自形成独立序列。

Standby Cache 使用可丢弃的独立 Cache Schema/重建版本，不运行 Active 或 Sunset Migration；evidence-spool 使用自己的追加式 Schema 与独立 Migration 序列；Activation/Recovery Staging 只运行其工作流明示的校验/迁移计划，不能成为任一长期域的 Migration 入口。

Active、Standby、LocalContinuation 与 evidence-spool 不共享数据库文件、WAL、连接、Master Key 或 Migration Runner。设备降级到 Standby 时关闭 Active Workspace；此前配置的平台凭据继续保存在 Keychain，但 runtime-gate 禁止调用。进入 LocalContinuation 只能由正式 Sunset 导入流程打开独立 Workspace，不能把现有 Active 数据库原地改标。

Standby Cache 可以直接重建，Schema 不兼容时优先删除并重新拉取，不承担 Active Workspace 的跨版本迁移复杂度。

### automation-host

- 负责 Remote WebView 生命周期和 Browser Host 私有 `BrowserSessionProfile` 元数据存储；Profile 原件、`profile_ref/session_health/profile_generation/session_sequence` 不进入 Active/LocalContinuation Workspace 或普通 TypeScript。Active 以 `device_id + provider_connection_id + session_mode` 隔离；Sunset 使用独立安装身份作用域，两个 Profile 根目录和解析器 namespace 互相拒绝，同一平台不同账户不得共享 Cookie 或本地存储。
- 负责 `eval_with_callback`、初始化脚本、窄 IPC Handler 和 ActionRequest/Report 序列校验。
- 负责 NavigationPolicy、`on_navigation`、`on_new_window`、`on_page_load` 和下载目标拦截。
- 依赖 `secure-host-core` 的 runtime-gate、设备身份和安全校验接口；不得读取 Active Workspace 的通用 Repository 或任意 Keychain 项。
- Windows WebView2 与 macOS WKWebView 的差异封装在此 Crate 的平台适配模块中。

依赖方向：

```text
apps/desktop/src-tauri -> automation-host
apps/desktop/src-tauri -> local-storage
apps/desktop/src-tauri -> secure-host-core
automation-host -> secure-host-core
local-storage   -> secure-host-core
```

`secure-host-core` 不得反向依赖任何 Tauri Adapter、local-storage 或 automation-host。

## 9. Cloud 模块所有权

| 模块 | 拥有的数据与职责 |
| --- | --- |
| admin-access | StaffIdentity、StaffSession、Role/Scope、管理员登录与授权判定；不拥有客户业务表 |
| support-integration | 外部 Helpdesk Adapter、可信 SupportCaseReference、账号关联、外部 revision/同步水位和映射必要状态；不复制完整工单、附件、秘密或资产清单 |
| security-incidents | SecurityIncident、影响范围、遏制动作、证据保全、通知决定和关闭状态；不代替外部 SupportCase |
| identity | 账号、密码/Passkey、Auth Session、Refresh Token 轮换、AccountSecurityState 与 `account_security_epoch` |
| licensing | 完整 AccountEntitlement 聚合、ProviderPaymentEvent、ManualEntitlementAdjustment、Reducer、Entitlement Token 签发、可信时间和 Sunset 元数据 |
| devices | DeviceBinding、ActiveDeviceLease、Epoch、切换状态和排空验收编排 |
| job-runtime | Job Lease、心跳、幂等、Payload 版本路由、重试/超时、Quarantine 和人工安全重放；不拥有业务 Job 状态 |
| workspace/state/&lt;capability&gt; | 当前物化业务状态；按 capability 拥有表、Repository 与 Migration |
| workspace/read | Standby/Active 查询、只读投影和数据新鲜度元数据 |
| workspace/mutations | Mutation 幂等、`mutation_sequence`、`base_revision` 和事务提交 |
| workspace/revisions | Server Revision 分配、实体版本和提交顺序 |
| workspace/cursors | Device/Reader Cursor 与最慢 Cursor 水位 |
| workspace/checkpoints | Checkpoint 生成、压缩水位、重建和按实体类型的一致性摘要计算 |
| execution-ledger | 所有 ExecutionFact 的独立 Ingest、签名/时间/序列验证、旧 Epoch `LateExecutionEvent` 裁决和安全隔离区 |
| audit | DeviceAuditEvent/UserAuditEvent/StaffAuditEvent/ServiceAuditEvent 判别联合的独立 Ingest、分链序列/Hash、保留策略和安全隔离区 |
| recovery | StaleChangeProposal 验签与服务端字段拒绝、StaleDeviceCandidate/RestoreCandidate 生成和重新应用流程 |
| connections | ProviderConnection 共享元数据、QuotaScope 和退避摘要 |
| compliance | 带 `kind: export | deletion` 的 DataRightsRequest、两条状态机、`deletion_epoch`、处理者 AccountDeletionTombstone/全局 AntiResurrectionLedger、机器可读导出、专用删除 Job 编排和处理状态 |
| notifications | 邮件、安全通知、切换请求和业务告警投递 |
| publication | 用户显式发布投影，与私有 Workspace 隔离 |

跨模块协作只能通过公开 Application Port：

- `devices` 在释放 Lease 时调用 `workspace/mutations`、`execution-ledger` 与 `audit` 的 Drain Verification Port，在同一编排事务中独立读取逐流 `contiguous_received_through`、Gap 和摘要，并与签名 `DrainManifest` 的 `last_assigned_sequence/pending_count` 声明比对；不得直接读取各模块表，也不得用一个跨流最大序号替代三条连续水位。本地尾部声明属于完整、协作客户端保证，不得提升为 Cloud 可独立证明的事实。
- `workspace/mutations` 通过 `workspace/state/<capability>` 的公开写入 Port 物化已接受 Mutation，不直接操作其他 capability 的表。
- `workspace/read` 与 `workspace/checkpoints` 通过 state 的公开查询/快照 Port 读取已提交状态；checkpoints 同时尊重 Cursor 与 Candidate 引用水位。
- `execution-ledger` 追加事实后发布“需要对账”事件，不直接修改 Desired/Observed State。
- `compliance` 编排各模块导出/删除接口，不直接执行跨模块 SQL 删除。
- `security-incidents` 通过各模块公开的遏制、证据与通知 Port 编排安全事件，不直接修改设备、身份或 Workspace 表；外部 Helpdesk 只保存关联 SupportCaseReference。
- `identity` 公开账号安全冻结/撤销 Port，`devices` 公开 Lease/Challenge/credential epoch 撤销 Port，`licensing` 公开 Entitlement 冻结/Revision 校验 Port，`compliance` 通过这些 Port 编排账号删除；任何模块不得跨边界直接更新另一模块的表。恢复与 PITR 在开放业务入口前必须先查询 compliance 的 AccountDeletionTombstone 水位。
- `admin-http` 只调用各模块显式公开的 Admin Application Port；不得直接注入 Repository、共享 ORM Entity 或执行跨模块 SQL。所有管理操作先由 `admin-access` 授权，再向 `audit` 写入 Staff actor、原因、工单标识和前后摘要。
- TenantContext 从 Public/Admin 认证、Job 创建、事务、Repository 到对象存储 Key 全程显式传播；缺失或不匹配时在模块 Port 前拒绝。Admin 跨租户查询使用独立入口，不能复用普通租户 Repository 后关闭过滤。
- Quarantine 中的 Job 只能使用原 TenantContext、Payload Version、幂等键和授权上下文重放；管理员不能编辑 Payload 后伪装成同一个 Job。
- 管理员不得创建用户 Desired State、SyncMutation、ApprovedOperation 或平台执行请求。确需修复云端元数据时，使用模块拥有的受控 Repair Command，并保留可追溯审计。

每个 Cloud 模块拥有自己的表、Migration 和 Repository。`workspace/state` 内进一步按 capability 分配所有权。首版可以共用一个 PostgreSQL Database 和事务基础设施，但禁止共享 ORM Entity 作为模块 API。Cloud Migration 按模块存放，文件名使用全局 UTC 时间戳或等价全局序号排序；Migration Runner 必须在部署前检测重复序号和依赖顺序。

## 10. 依赖与导入规则

允许方向：

```text
desktop -> client-core -> protocol
client-core -> connector-sdk
client-core/browser-automation -> browser-automation/contracts
desktop/src/composition-root.ts -> connectors -> connector-sdk -> protocol/connectors
desktop -> cloud-client -> protocol
desktop/src/adapters/tauri -> cloud-client
account-web -> cloud-client -> protocol
admin-web -> protocol/admin
cloud/admin-http -> protocol/admin
connectors -> connector-sdk -> protocol/connectors
connectors -> browser-automation/contracts
cloud -> protocol
desktop/src-tauri -> Rust crates
automation-host -> secure-host-core
local-storage -> secure-host-core
```

禁止方向：

```text
cloud -X-> client-core
cloud -X-> connectors
account-web -X-> client-core
desktop / account-web / client-core / cloud-client -X-> protocol/admin
admin-web -X-> client-core / cloud-client / connectors
protocol -X-> application / infrastructure
client-core -X-> Tauri IPC / cloud-client implementation
cloud-client -X-> keychain / raw token
secure-host-core -X-> Tauri / Wry
browser-automation TS -X-> local-storage / keychain
Standby path -X-> connector execution / Mutation Outbox
```

目标实施组合是 TypeScript Project References、`package.json` exports、ESLint import-boundary 规则、自定义结构扫描和 Rust 可见性限制。当前可执行基线只有 Package Exports 与 `scripts/check-boundaries.mjs`/`boundary-policy.mjs` 覆盖的具体 Connector 注册边、`protocol/admin` 部分信任域、Cloud/client-core/admin/account-web 禁止边和 secure-host-core Manifest 依赖；Project References、ESLint 规则、protocol 子路径精确允许矩阵、泛化 HTTP/Shell/Tauri Command 扫描和完整 Rust 可见性测试仍由 R0-15 `In Progress` 跟踪。任何跨模块临时绕行必须形成 ADR，不能使用深层相对导入隐藏耦合。

具体 Connector 的唯一注册边是 `apps/desktop/src/composition-root.ts -> packages/connectors/*`。除该 Composition Root 和连接器自己的测试外，Desktop Feature、client-core、cloud-client、account-web、admin-web 与 Cloud 均不得导入具体 Connector；Repository 根目录结构测试必须对这一窄边做精确路径校验。

## 11. 测试归属

| 测试 | 归属 |
| --- | --- |
| RuntimeMode 状态转换和命令准入矩阵 | secure-host-core |
| Active/Standby 分库分钥、错误模式禁止打开数据库 | local-storage |
| WebView2/WKWebView 注入、导航、弹窗、下载与 Profile | automation-host + Desktop E2E |
| ConnectorCapabilities、QuotaScope、映射和脱敏 | connector-test-kit + 各 connector |
| Outbox、同步触发器、Checkpoint 重建、Anti-Entropy | client-core/sync |
| Port DTO、Desktop IPC Envelope 与 Rust 镜像校验 | client-core + desktop adapters/tauri + src-tauri contract tests |
| Active/Standby Query Port 等价结果与 DataFreshness | client-core + local/cloud adapter contract tests |
| protocol/workspace 确定性 Codec 与摘要 Golden Vector | protocol + client-core + cloud/workspace contract tests |
| Desktop Cloud 请求不暴露 Token、Host 注入认证头 | cloud-client + desktop adapters/tauri + secure-host-core integration tests |
| 本地 capability Repository/Schema 与全局 SQLite Migration 顺序 | local-storage integration tests |
| Mutation 幂等、Revision、Cursor、摘要和压缩水位 | cloud/workspace integration tests |
| workspace/state 数据所有权、物化和全局 Cloud Migration 排序 | cloud/workspace integration tests |
| Mutation/ExecutionFact/Workspace-scope DeviceAuditEvent 三流 `DrainManifest` 连续水位、Gap、摘要、Account DeviceAudit 非阻塞与 Epoch 递增 | cloud/devices + workspace/execution-ledger/audit integration tests |
| ExecutionFact/LateExecutionEvent 验证、隔离和不回放为状态 | cloud/execution-ledger integration tests |
| AuditEvent 独立序列/Hash 链、隔离与 ExecutionFact 引用 | cloud/audit integration tests |
| 过期 License 的网页导出/删除 | account-web + cloud/compliance E2E |
| Admin/Public Route 隔离、Staff Scope、直接 Repository 绕行与 Staff 审计 | admin-web + cloud/admin-http E2E + structure tests |
| Tauri Capability 与 Remote WebView 越权 | Desktop packaged E2E |

Repository 根目录的结构测试必须验证：禁止依赖边、协议子路径出口、Cloud 不包含连接器依赖，以及生产构建中没有泛化的任意 HTTP/Shell Command。

## 12. 演进规则

- `protocol` 只有在真实的独立发布或版本节奏出现后才拆包。
- `apps/mobile` 只在 Phase 6 正式启动时创建。
- Public HTTP、Admin HTTP 与 Jobs 只有在容量、故障隔离或发布节奏提供证据后才拆成独立服务；拆分前保持同一模块化单体。
- Public HTTP 与 Admin HTTP 首版使用 Fastify 的独立 Composition Root；不得因共用框架而共享认证 Hook 或自动注册全部 Route。只有明确的边缘运行时需求出现后才重新评估 Hono，不在首版并用两套 HTTP 框架。
- Connector SDK 若未来对外开放，需另行设计签名、兼容性和权限模型；首版连接器仍编译进客户端。
- `LocalContinuation` 只在 Sunset 预案演练和最终停服构建中启用，不能逐渐演变为常规纯本地模式。

工程结构的基础决策见 [ADR-0006](adr/0006-runtime-and-security-boundaries.md)，管理员边界、Fastify 与本地/Cloud 接口复用见 [ADR-0007](adr/0007-admin-boundary-and-interface-reuse.md)。产品安全与同步语义仍以 [ACCOUNT_AND_SYNC.md](ACCOUNT_AND_SYNC.md)、[SECURITY.md](SECURITY.md) 和 [SYNC_SEMANTICS.md](SYNC_SEMANTICS.md) 为准。

## 13. 跨语言契约实现参考

跨语言工具的完整登记、许可证和采用级别见 [OPEN_SOURCE_REFERENCES.md](OPEN_SOURCE_REFERENCES.md)。候选工具按“谁拥有契约”分流，不能混成双向生成环：

| 契约边界 | 事实源 | 可评估来源 | 要求 |
| --- | --- | --- | --- |
| Cloud Workspace/Public/Admin Protocol | `packages/protocol` 的 Zod Schema | Smithy 的 Trait/模型校验思想；JSON Schema 构建链 | Zod 保持唯一事实源；Rust/Cloud/TS 使用同一正负 Golden Corpus，明确 unknown/missing/enum/version/error Envelope |
| 普通 Tauri IPC | Rust-owned Command DTO 或经 ADR 确认的共享 Schema | [ts-rs](https://github.com/Aleph-Alpha/ts-rs)、[Schemars](https://github.com/GREsau/schemars)、[Specta](https://github.com/specta-rs/specta)、[tauri-specta](https://github.com/specta-rs/tauri-specta) | 只能有一个生成方向；生成物只读并由 CI 重建/差异检查；tauri-specta v2 RC 不进入 Phase 0 固定基线 |
| Host-owned Secret/Auth Response | Rust 私有版本化 Wire Contract | Schemars/私有 Golden Vector 可作测试工具 | 不生成或导出给普通 TS；Host 内 typed extractor 直接折叠为 Keychain 条目，只返回 `credential_binding_id`/fingerprint/脱敏状态，Keychain Ref 不离开 Host |
| 未来移动端共享类型 | 尚未决策 | [Typeshare](https://github.com/1Password/typeshare) | Phase 6 前不因潜在 Swift/Kotlin 支持引入工具链 |

Phase 0 可以用两个最小 Spike 比较“ts-rs/Schemars + Golden Corpus”和“Specta/tauri-specta”，但 Spike 结果必须进入后续 typed IPC/Auth Gate 的版本、未知字段、错误 Envelope 与 Adapter/Handler 接线验收；R0-10 仍在补根门禁对 Rust Corpus 的编排与锁定工具链证据，Connector 注册边和完整信任域执行归 R0-15，不能只因生成的 TypeScript 能编译就扩大证据范围。
