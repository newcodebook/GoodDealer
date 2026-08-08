# ADR-0006：按运行时与安全边界组织工程结构

状态：Accepted，管理员边界与接口复用由 ADR-0007 扩展  
日期：2026-07-31

修订：2026-08-03（RuntimeMode 准入与三流 Drain）

## 背景

GoodDealer 已形成多种权限完全不同的运行状态：Locked、Standby、Activating、Active、Draining，以及仅用于永久停服预案的 LocalContinuation。Standby 只能读取云端投影；日常运行只有 Active 能打开完整工作库、产生 Mutation、读取平台、批准和执行操作。LocalContinuation 由正式 Sunset 构建与永久凭证单独进入，使用域分离的本地执行授权，不伪装成 Active。

Workspace 同步/Drain 协议包含 Mutation、ExecutionFact、Workspace-scope DeviceAuditEvent 三条独立追加流，以及 Checkpoint、Device/Reader Cursor、一致性摘要和恢复 Candidate；旧 Epoch 验证通过的 ExecutionFact 只增加 LateExecutionEvent 分类。Account-scope DeviceAuditEvent 使用独立设备链，User/Staff/Service AuditEvent 使用服务端独立链，均不进入 Workspace Drain。浏览器自动化的命令投递、导航/弹窗/下载策略和 Profile 管理由 Rust Host 承担，而 TypeScript 只定义 Recipe、契约和 Probe。

原工程草案使用宽泛的 `domain/application/schemas/cloud-contracts` 包，未为 account-web、Cloud Jobs、执行事实入口、Standby Cache、Rust 浏览器宿主和 Checkpoint 模块提供明确归属，无法通过工程边界执行现有安全决策。

## 决策

采用“按运行时/安全边界拆包，按业务能力组织模块”的工程结构。

### 应用边界

- `apps/desktop` 是 React + 薄 Tauri 适配层。
- `apps/account-web` 独立承载账号、License、设备和合规导出/删除，不依赖客户端业务门禁。
- `apps/admin-web` 与 Staff Admin API 由 ADR-0007 作为独立信任域补充。
- `apps/cloud` 使用 Public HTTP、Admin HTTP 与 Jobs 三个入口组装同一个模块化单体。
- Phase 0 不创建空的 `apps/mobile`；Phase 6 开始时再创建宿主。

### TypeScript 边界

- 跨端协议使用单个 `@gooddealer/protocol` 包和子路径导出，不提前拆成多个 pnpm 包。
- `client-core` 保持宿主无关；客户端 Anti-Entropy、Checkpoint 重建和 Outbox 属于 `client-core/sync`。
- client-core 拥有宿主无关 Port 与 Port DTO Schema；Desktop 的 TypeScript Tauri Adapter 实现这些 Port 并拥有 IPC Envelope，Rust `src-tauri` 只实现 Command Handler 与镜像校验。
- `cloud-client` 只依赖 protocol，负责不含原始 Token 的类型化请求构造和响应解析；Desktop 传输必须经 Tauri Adapter 与 Rust `secure-http`。账号 Token 只由 Host 从 Keychain 注入，Token-bearing 登录/刷新响应由 Host 解析并折叠为脱敏 AuthSessionStatus。
- 连接器通过 `connector-sdk` 注册并由专用 `connector-test-kit` 验证。
- TypeScript `browser-automation` 只保存 contracts、recipes、probe-runtime 和专用 test-kit。
- 不创建泛化的 `packages/test-kit`。

### Rust 边界

- `secure-host-core` 不依赖 Tauri/Wry，拥有 runtime-gate、设备身份、密码学、Keychain、受控 HTTP 和操作签名。
- `secure-http` 为 GoodDealer Cloud 和外部平台使用隔离的请求类型、Allowlist 与凭据命名空间；TypeScript 不接触账号 Token 或平台密钥。
- `local-storage` 依赖 `secure-host-core` 的 keychain/crypto 接口，并物理分离四个长期持久化域：Active Workspace、Standby Cache、LocalContinuation Workspace 与追加式 evidence-spool。四者分别拥有数据库文件、WAL、连接、Master Key 和 Migration/Schema Runner；Activation/Recovery Staging 是第五类临时隔离域，使用独立临时 Key，完成后销毁，不能安装为 Active 或 Sunset 数据库。
- `automation-host` 拥有 Remote WebView、Profile、脚本注入、窄 IPC、导航/弹窗/下载策略，并依赖 `secure-host-core` 的运行时门禁。
- `runtime-gate` 是命令准入组件的名称，避免与 Tauri 声明式 Capability 混淆。

### Cloud 模块边界

- `devices` 拥有绑定、ActiveDeviceLease、Epoch 和排空验收编排。
- `workspace` 明确包含 state、read、mutations、revisions、cursors 和 checkpoints；`state/<capability>` 拥有当前物化业务表、Repository 与模块 Migration，checkpoints 负责服务端一致性摘要与压缩水位。
- `workspace/mutations` 通过 state 的公开写入 Port 物化状态；read 与 checkpoints 通过查询/快照 Port 读取，不直接跨 capability 操作表。
- `devices` 通过公开 Port 请求 `workspace/mutations`、`execution-ledger` 与 `audit` 分别验证签名 `DrainManifest` 中 Mutation、ExecutionFact、Workspace-scope DeviceAuditEvent 三条设备流的连续接收水位、Gap、待上传数和摘要，不能直接读取其表，也不能用单一最大序号证明排空；Account DeviceAudit 与 User/Staff/Service AuditEvent 不属于该验收。
- `execution-ledger` 独立接收所有 ExecutionFact，旧 Epoch 验证通过后标记为 LateExecutionEvent，并管理验证失败隔离区；`audit` 以 `DeviceAuditEvent | UserAuditEvent | StaffAuditEvent | ServiceAuditEvent` 判别联合接收审计记录并按来源维护独立序列/Hash 链。ExecutionFact 与各类 AuditEvent 都不经过 SyncMutation，只通过引用关联。
- recovery、connections、compliance、notifications、publication 和 audit 分别拥有自己的数据与用例。
- Cloud 不依赖 client-core、连接器或平台凭据。

### RuntimeMode

日常 RuntimeMode 的权威状态由 Rust runtime-gate 与云端 Scope/ActiveDeviceLease 共同决定，不能只依赖 UI。枚举预留 `LocalContinuation`，但只有正式 Sunset 构建在 Rust 验证独立 Sunset Signing Key 凭证后可以进入，日常版本不提供纯本地开关。LocalContinuation 使用 `SunsetAuthorization | SunsetApprovedOperation | SunsetBrowserSessionAccessContext | SunsetAutomationExecutionTicket`，绑定安装实例、Workspace、设备签名 Key、本地可信时间、runtime/Sunset credential generation，以及按封闭来源选择的 HostCredentialBinding generation 或 Browser Profile generation；连接建立变体可使用 `credential_source=none`，但不能业务提交。它们和日常 Lease/Context/ApprovedOperation/AutomationExecutionTicket 使用不同 Key Purpose、Schema、Transcript、Nonce 表与解析器，并在所有消费点互相拒绝。

## 结果

优点：

- Active/Standby/LocalContinuation/evidence-spool 的四域物理隔离、临时 Staging 和命令准入形成可测试的结构边界。
- TypeScript Port、Desktop IPC 和 Rust Handler 分层明确，账号 Token 与平台密钥不会因类型化客户端下沉到 TypeScript。
- Rust 安全核心可以脱离 Tauri 做集成测试，并为未来移动宿主复用。
- 浏览器自动化的最高权限宿主有明确的 Rust 工程归属。
- Checkpoint、Anti-Entropy、排空验收和迟到事实不再隐藏在泛化的 Sync 模块中。
- 本地 Repository/Schema 按 capability 归属且 SQLite Migration 保持全局单序列；Cloud 当前物化状态也有明确 owner。
- account-web 与客户端 License 门禁解耦，能够兑现过期后的合规数据权利。
- 保持模块化单体，避免在没有容量证据时引入微服务与空包维护成本。

代价：

- Composition Root、协议子路径和模块公开 Port 需要严格维护。
- Active/Standby 分库、RuntimeMode 转换和 Cloud 跨模块协作需要更多集成测试。
- automation-host 必须分别适配 WebView2 与 WKWebView。
- 单 protocol 包需要 lint 与 exports 规则防止内部子模块重新耦合成杂物包。

## 不采用的方案

### Phase 0 创建 mobile 空应用

不采用。宿主无关核心已经为移动端预留复用边界，空应用只会产生过时配置和无效维护。

### 立即把 protocol 拆成多个包

不采用。当前消费方和版本节奏相同，单包子路径导出已能执行依赖卫生；出现真实独立发布压力后再拆。

### 浏览器自动化全部放在 TypeScript

不采用。WebView 生命周期、脚本投递、Profile、导航、弹窗、下载和权限隔离属于 Rust Host 安全边界。

### 按技术层创建泛化公共包

不采用。宽泛的 domain、application、schemas、cloud-contracts 和 test-kit 容易成为跨模块绕行入口；公共代码必须有明确协议或能力归属。

### 首版拆分 Cloud 微服务

不采用。Public HTTP、Admin HTTP 与 Jobs 可以作为不同进程入口，但共享同一个模块化单体和 PostgreSQL 正确性来源；只有容量或故障隔离证据出现后再拆。

详细规则见 [工程结构与模块边界](../ENGINEERING_STRUCTURE.md) 和 [系统架构](../ARCHITECTURE.md)；管理员安全边界、Fastify 与本地/Cloud 接口复用见 [ADR-0007](0007-admin-boundary-and-interface-reuse.md)。
