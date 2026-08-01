# GoodDealer 工程结构与模块边界

状态：Accepted Design  
更新日期：2026-08-01

## 1. 目标

工程结构必须把产品安全决策变成编译期、测试期和运行时约束：

- 最多两台绑定设备，但只有 Active 可以修改业务状态和访问平台。
- Standby 只能读取 GoodDealer Cloud 已有数据，并使用分库分钥的加密缓存。
- 平台凭据、Browser Profile 和本地数据库密钥永不进入 Cloud。
- SyncMutation、LateExecutionEvent 和 AuditEvent 分属不同日志，不能统一回放。
- Cloud 不加载连接器，也不代表用户访问域名平台。
- License 过期后，独立 account-web 仍提供合规导出、删除和安全管理。
- Staff Admin 与用户账号/API 分离；管理员只能通过模块管理 Port 操作且不能获得平台秘密或创建用户平台副作用。
- Active/Standby 可以复用只读 Query Port 和 protocol Codec，但 Local/Cloud Repository、事务与写接口保持分离。

采用“按运行时/安全边界拆包，按业务能力组织模块”：只有需要独立运行、具有不同权限或跨宿主复用的部分才成为 App/Package/Crate；普通领域能力在所属模块内组织，避免一类一个包。

## 2. 顶层目录树

本节是目录树的唯一事实源；[ARCHITECTURE.md](ARCHITECTURE.md) 只保留摘要。

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
        execution-ledger/        # LateExecutionEvent 独立 Ingest 与隔离区
        recovery/                # StaleDeviceCandidate / RestoreCandidate
        connections/             # ProviderConnection 与 quota 摘要
        compliance/
        security-incidents/      # 账号接管、设备被盗、云端泄露的事件生命周期
        support-integration/     # 外部 Helpdesk Adapter 与可信 CaseReference
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
    connections/                 # ProviderConnection 视图与 DeviceCredentialBinding 管理
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
| Portfolio | client-core/portfolio | active-workspace/portfolio | — | workspace/state/portfolio |
| Registration | client-core/registration | active-workspace/registration | — | workspace/state/registration |
| DNS | client-core/dns | active-workspace/dns | — | workspace/state/dns（非敏感 Record） |
| Marketplace | client-core/marketplace | active-workspace/marketplace | — | workspace/state/marketplace |
| Pricing | client-core/pricing | active-workspace/pricing | — | workspace/state/pricing |
| Verification | client-core/verification | active-workspace/verification（含设备本地敏感挑战值） | — | workspace/state/verification（仅脱敏状态） |
| Sync（平台对账） | client-core/sync | active-workspace/platform-sync | — | workspace/state/platform-sync（三方基线与冲突） |
| Cloud Sync | client-core/sync、client-core/recovery | active-workspace/cloud-sync（Outbox/Cursor） | — | workspace/read、mutations、revisions、cursors、checkpoints、recovery |
| Operations | client-core/operations | active-workspace/operations（Queue/DAG/审批/结果） | secure-host-core/operation-signing | workspace/state/operations（脱敏状态）、execution-ledger（LateExecutionEvent） |
| Connections | client-core/connections | active-workspace/connections（共享元数据与设备绑定状态） | secure-host-core/keychain（credentialRef 实际值） | connections（共享元数据与 quota 摘要） |
| Browser Automation | client-core/browser-automation（编排）+ packages/browser-automation（契约/Recipe/Probe） | active-workspace/browser-automation（BrowserSessionProfile/Grant/Session/审计引用） | automation-host | workspace/state/browser-automation（非秘密设置与脱敏状态） |
| Account & Licensing | client-core/runtime-mode（投影） | —（Token/Lease 在 Keychain） | secure-host-core/runtime-gate、device-identity、keychain | identity、licensing、devices |
| Active Device Coordination | client-core/runtime-mode（切换用例） | active-workspace/cloud-sync（排空进度） | secure-host-core/runtime-gate | devices |
| Publication | —（未来发布界面） | — | — | publication |
| Backup & Restore | client-core/backup、client-core/recovery | local-storage/backup、migrations | secure-host-core/crypto、keychain | compliance（网页导出） |
| Audit | 各模块产生 AuditEvent | active-workspace/audit（本地审计链） | secure-host-core/crypto（HMAC） | audit |

`execution-ledger` 只拥有 LateExecutionEvent，`audit` 只拥有 AuditEvent；审计时间线可以通过只读投影组合两者，但不得转移或共享记录所有权。本地 `active-workspace/<capability>` 分别拥有 Repository 和 Schema 定义；因为它们共用一个 SQLite 数据库，`local-storage/migrations` 必须保持全局单一有序序列，禁止各能力独立维护不可排序的迁移流。

## 4. RuntimeMode 是一等边界

权威状态机位于 Rust `secure-host-core/runtime-gate`。UI 中的 `client-core/runtime-mode` 只保存 Host 返回的只读快照并决定页面呈现，不得自行构造或提升状态。

```text
Locked
  -> Standby
  -> Activating
  -> Active
  -> Draining(reason: handoff | suspend)
       handoff -> Standby
       suspend -> Active | Standby

LocalContinuation             # 仅 Sunset 构建/凭证可进入
```

状态准入：

| 命令类别 | Locked | Standby | Activating | Active | Draining | LocalContinuation |
| --- | --- | --- | --- | --- | --- | --- |
| 账号、续费、设备、合规入口 | 是 | 是 | 是 | 是 | 是 | 本地有限支持 |
| Cloud Workspace 只读 | 否 | 是 | 是 | 是 | 是 | 否 |
| 打开 Standby Cache | 否 | 是 | 是 | 否 | 否 | 否 |
| 打开 Active Workspace | 否 | 否 | 恢复/校验 | 是 | 是 | 是 |
| 业务 Mutation | 否 | 否 | 否 | 是 | 否 | 是 |
| 平台读取/写入 | 否 | 否 | 否 | 是 | 仅完成当前原子步骤 | 是 |
| ApprovedOperation 签名 | 否 | 否 | 否 | 是 | 否 | 是 |

关键转换条件：

- `Locked -> Standby`：账号或 OfflineDeviceLease、设备绑定和 Entitlement 有效。
- `Standby -> Activating`：取得绑定到当前 DeviceSwitchRequest 的短期只读 Bootstrap Capability；应用支持 Workspace Schema，开始建立当前 Revision 基线。Bootstrap Capability 不授予 Mutation、平台访问、批准或执行权限。
- `Activating -> Active`：Checkpoint + 后续 Mutation 回放完成并通过按实体类型的一致性摘要校验后，服务端原子签发 ActiveDeviceLease。
- `Active -> Draining(reason)`：收到正常切换、退出或安全暂停请求；立即停止领取新任务。`reason` 不改变命令准入，只决定退出条件。
- `Draining(reason=handoff) -> Standby`：Outbox 冲刷成功，服务端按最后 `client_sequence` 完成排空验收并释放 Lease。
- `Draining(reason=suspend) -> Active/Standby`：当前原子步骤结束并尽力冲刷；Cloud 不可用或冲刷失败不阻塞退出，恢复时先执行 Outbox 与结果未知对账。
- `任意状态 -> Locked`：授权失效、设备移除或安全门禁失败；已经发出的原子平台请求进入结果确认语义。
- `LocalContinuation`：只接受独立 Sunset Signing Key 签发的永久凭证，不出现在日常模式选择器中。

同一账号最多存在一个未完成的 DeviceSwitchRequest/Bootstrap Capability。重复申请使用幂等键返回同一请求，新的申请不得与旧申请竞争激活。

## 5. 应用运行时所有权

### apps/desktop

- React 只负责界面、交互和 RuntimeMode 投影。
- `src/features/<capability>` 组织业务页面，目录名与 client-core 模块一致，UI、用例和领域三层使用同一套名字。
- `src/adapters/tauri` 实现 client-core 定义的 TypeScript Port，把 Port DTO 映射为最小化 Tauri IPC Envelope，并调用对应 Command。
- `src-tauri` 是薄适配层：注册 Tauri Command、组装 Rust Crate、映射窗口事件和平台能力。
- 不在 `src-tauri` 内实现业务规则、密钥算法、数据库迁移或浏览器 Recipe 逻辑。
- Desktop 可以组装 Active 和 Standby 两套本地存储，并且只打开 RuntimeMode 准入矩阵允许的存储组合。Activating 期间允许只读挂载 Standby Cache，同时在独立 Staging 中恢复/构建 Active Workspace；两库不得交叉写入，Cache 不得作为 Mutation 基线，进入 Active 前必须关闭 Cache。

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
- `protocol/account` 对客户端公开的是登录命令、脱敏 AuthSessionStatus 和错误码，不定义会把原始 Access/Refresh Token 返回普通 TypeScript 的 DTO。
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
- `connections` 拥有 ProviderConnection 视图、DeviceCredentialBinding 管理和凭据健康；凭据实际值仍在 OS Keychain。
- `browser-automation` 拥有自动化会话编排、BrowserAutomationGrant、授权级别和接管/暂停状态机；Recipe 内容与 Probe 在 packages/browser-automation，WebView 控制在 automation-host。
- 通过 Port 访问本地存储、Cloud、连接器和安全 Host，不直接导入 Tauri API。Port 接口与宿主无关的 Port DTO Schema 属于 client-core 各模块公开出口；`apps/desktop/src/adapters/tauri` 在 TypeScript 中实现 Port 并拥有 Tauri IPC Envelope，`src-tauri` 只实现 Rust Command Handler 和镜像 DTO 校验。`protocol` 不承载客户端内部 IPC。

### cloud-client

- 只依赖 `protocol`，负责只读 Workspace、Mutation、设备切换、Execution Event Ingest、合规 API 及非秘密账号操作的类型化请求构造与响应解析，并通过注入的 Transport Port 发送。
- 不缓存领域状态，不实现冲突合并，不读取 Keychain，不持有账号 Token 或平台凭据，也不得自行构造 `Authorization` Header。
- Desktop 中由 `apps/desktop/src/adapters/tauri` 组合 cloud-client 与 Tauri Transport；Transport 把已批准的 GoodDealer Cloud Endpoint ID、方法和 Payload 交给 Rust `secure-http`，由 Host 从 Keychain 读取并注入 Auth Session Token。
- Desktop 的登录、Token 刷新、撤销和轮换是 Host-owned Session Command：Rust 解析 Token-bearing Response 并直接写入 Keychain，只向 TypeScript 返回脱敏 AuthSessionStatus；这些响应不得经过 cloud-client。
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
- Mutation、Revision、Cursor、Checkpoint、Candidate 与脱敏执行事件 Schema。
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
- `DataFreshness` 必须包含来源、Server Revision、最后云同步时间、最后平台读取时间和 `can_edit`，避免把 Cloud 缓存误认为平台实时状态。
- 共享 Query Port 只能返回允许同步的非秘密业务投影。DeviceCredentialBinding 健康、Browser Profile、Keychain 状态、本地 Artifact 等使用独立 Active-only Query Port；不得为了表面统一而在共享 DTO 中加入秘密字段或大量语义不明的可空字段。

只读 Query Port 可以按 Portfolio、DNS、Marketplace、Operations 等能力复用，但底层 Local/Cloud Adapter 保持独立。

### 7.3 写路径与 Repository 不共享

Active 写入固定为：

```text
client-core Command
  -> 本地领域事务
  -> Active Workspace 状态 + Outbox 同事务提交
  -> 异步上传 SyncMutation
```

禁止让同一个 `saveDomain()` 或通用 CRUD Repository 在 Active 时写 SQLite、Standby 时直接写 Cloud。Standby 没有 Command/Mutation 实现；Cloud Mutation API 是同步传输协议，不是 UI 的远程 Repository。

以下内容不得在本地与 Cloud 之间共享实现：

- Repository 接口、ORM Entity、数据库模型和 Migration。
- SQLite 与 PostgreSQL 事务边界。
- Device Secret、Queue、Grant、WAL/Outbox 内部结构。
- RuntimeMode/ActiveDeviceLease 门禁和服务端租户授权。

Local Repository 由 `local-storage/active-workspace/<capability>` 实现；Cloud Repository 由 `workspace/state/<capability>` 实现。两者只通过 protocol DTO、Mutation 和确定性 Codec 对齐。

## 8. Rust Crate 边界

### secure-host-core

无 Tauri/Wry 依赖，拥有最高安全边界：

- `runtime-gate`：RuntimeMode 状态机、命令分类和准入。
- `device-identity`：设备 ID、设备签名密钥和可信时间锚点。
- `crypto`：AEAD、Hash、签名验证和密钥封装接口。
- `keychain`：OS Keychain/Credential Manager 抽象。
- `secure-http`：消费构建期 EndpointManifest 生成的嵌入式注册表；按 `device_id + provider_connection_id` 解析凭据绑定，执行 URL/DNS/IP、固定 443、禁重定向、注入、typed extractor、脱敏、超时和响应限制。
- `secret-capture`：定义 Host-owned 原生秘密输入 Port、私有秘密内存类型和批量 Keychain 写入；普通 Tauri IPC 只返回 `credential_binding_id`、fingerprint 和脱敏状态，Keychain Ref 不离开 Host。
- `operation-signing`：ApprovedOperation、LateExecutionEvent 签名与防重放序列，以及短期、一次性的本机 AutomationExecutionTicket 签发与校验。

Rust 集成测试直接针对该 Crate 运行，不需要启动 Tauri WebView。

EndpointManifest 由各编译期 Connector 拥有，构建工具单向生成 `connector-sdk` 的 Endpoint ID/公开参数类型和 `secure-host-core` 的注册表；生成物在 CI 重建并差异检查。Device Identity 的公开 DTO 由 `protocol/devices` 拥有，Cloud `devices` 拥有 Challenge/版本/撤销状态，Rust `device-identity` 只拥有私钥、确定性 Transcript 与签名 Port。

### local-storage

依赖 `secure-host-core` 暴露的 keychain/crypto 接口：

- `active-workspace`：完整 SQLCipher 业务库、Outbox、Queue 和本地审计。
- `standby-cache`：独立 SQLCipher 文件、独立缓存密钥、Reader Cursor 和可丢弃投影。
- `artifacts`：下载、CSV、截图和临时文件生命周期。
- `backup`：一致性快照、加密包、Manifest 和恢复 Staging。
- `migrations`：Active Workspace 的全局单一有序版本迁移与失败恢复；Repository/Schema 虽按 capability 归属，但 Migration 不各自形成独立序列。

Active 与 Standby 不共享数据库文件、WAL、连接或 Master Key。设备降级到 Standby 时关闭 Active Workspace；此前配置的平台凭据继续保存在 Keychain，但 runtime-gate 禁止调用。

Standby Cache 可以直接重建，Schema 不兼容时优先删除并重新拉取，不承担 Active Workspace 的跨版本迁移复杂度。

### automation-host

- 负责 Remote WebView 生命周期；Profile 按 `device_id + provider_connection_id + session_mode` 隔离，同一平台的不同账户不得共享 Cookie 或本地存储。
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
| support-integration | 外部 Helpdesk Adapter、可信 CaseReference 和账号关联；不复制完整工单、秘密或资产清单 |
| security-incidents | SecurityIncident、影响范围、遏制动作、证据保全、通知决定和关闭状态；不代替外部 SupportCase |
| identity | 账号、密码/Passkey、Auth Session、Refresh Token 轮换 |
| licensing | Entitlement、支付事件、可信时间和 Sunset 元数据 |
| devices | DeviceBinding、ActiveDeviceLease、Epoch、切换状态和排空验收编排 |
| job-runtime | Job Lease、心跳、幂等、Payload 版本路由、重试/超时、Quarantine 和人工安全重放；不拥有业务 Job 状态 |
| workspace/state/&lt;capability&gt; | 当前物化业务状态；按 capability 拥有表、Repository 与 Migration |
| workspace/read | Standby/Active 查询、只读投影和数据新鲜度元数据 |
| workspace/mutations | Mutation 幂等、`client_sequence`、`base_revision` 和事务提交 |
| workspace/revisions | Server Revision 分配、实体版本和提交顺序 |
| workspace/cursors | Device/Reader Cursor 与最慢 Cursor 水位 |
| workspace/checkpoints | Checkpoint 生成、压缩水位、重建和按实体类型的一致性摘要计算 |
| execution-ledger | LateExecutionEvent 独立 Ingest、签名/时间/序列验证和安全隔离区 |
| recovery | StaleDeviceCandidate、RestoreCandidate 和重新应用流程 |
| connections | ProviderConnection 共享元数据、QuotaScope 和退避摘要 |
| compliance | DataRightsRequest、机器可读导出、账号删除编排和处理状态 |
| notifications | 邮件、安全通知、切换请求和业务告警投递 |
| publication | 用户显式发布投影，与私有 Workspace 隔离 |
| audit | 服务端管理与安全审计，不替代设备本地审计链 |

跨模块协作只能通过公开 Application Port：

- `devices` 在释放 Lease 时调用 `workspace/mutations` 的 Drain Verification Port，核对最后 `client_sequence`；不得直接读取 Mutation 表。
- `workspace/mutations` 通过 `workspace/state/<capability>` 的公开写入 Port 物化已接受 Mutation，不直接操作其他 capability 的表。
- `workspace/read` 与 `workspace/checkpoints` 通过 state 的公开查询/快照 Port 读取已提交状态；checkpoints 同时尊重 Cursor 与 Candidate 引用水位。
- `execution-ledger` 追加事实后发布“需要对账”事件，不直接修改 Desired/Observed State。
- `compliance` 编排各模块导出/删除接口，不直接执行跨模块 SQL 删除。
- `security-incidents` 通过各模块公开的遏制、证据与通知 Port 编排安全事件，不直接修改设备、身份或 Workspace 表；外部 Helpdesk 只保存关联 CaseReference。
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

使用 TypeScript Project References、`package.json` exports、ESLint import-boundary 规则和 Rust 可见性限制执行这些约束。任何跨模块临时绕行必须形成 ADR，不能使用深层相对导入隐藏耦合。

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
| `client_sequence` 排空验收与 Epoch 递增 | cloud/devices + workspace integration tests |
| LateExecutionEvent 验证、重放、隔离和不回放为状态 | cloud/execution-ledger integration tests |
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
