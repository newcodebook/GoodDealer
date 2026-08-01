# GoodDealer Phase 0 Gate 台账

状态：Active

更新日期：2026-08-01

## 1. 使用规则

本台账是 Phase 0 当前执行状态的唯一入口；Finding 的原始证据和关闭条件见 [PHASE0_READINESS_REVIEW_2026-08-01.md](PHASE0_READINESS_REVIEW_2026-08-01.md)。每个 Gate 必须同时具备权威设计落档和可重现证据，才可以标记为 `Closed`。

状态只使用：

- `Open`：尚未形成可验收方案。
- `In Progress`：权威设计或实现证据仍不完整。
- `Blocked`：存在明确外部阻塞，已记录 fallback。
- `Closed`：关闭条件全部满足，证据可重跑。

负责人使用角色而不是姓名。实现者不能作为唯一验收人；涉及安全、租户隔离、秘密或真实外部写入的 Gate 必须由 Security Reviewer 独立验收。

## 2. 当前 Gate

| Finding | WP | Owner / Reviewer | 假设与环境 | 必须证据 | Fallback | 状态 |
| --- | --- | --- | --- | --- | --- | --- |
| R0-01 Phase 0 执行计划 | 全部 | Engineering Baseline / Architecture Reviewer | WP-0～WP-6 独立验收 | 本台账包含 Owner、环境、证据、Fallback 和状态 | 单个 WP 阻塞时不拖住无依赖 WP | Closed |
| R0-02 Endpoint Capability | WP-1/WP-6 | Secure Host / Security Reviewer | Fixture + Fake Provider；Windows/macOS | EndpointManifest 生成物；URL、重定向、DNS/IP、跨连接凭据绑定负向矩阵 | 连接器保持 Manual/Read-only | In Progress |
| R0-03 Host-owned Secret | WP-1/WP-6 | Secure Host / Security Reviewer | Canary Secret；Windows/macOS | DOM、TS Heap、IPC、DB/WAL、日志、Crash、Outbox、Cloud 扫描 | 禁止真实凭据流程 | In Progress |
| R0-04 Sync Projection | WP-2 | Local Storage + Workspace Protocol / Security Reviewer | 属性测试 + Fixture DB | 封闭 Projection；未知字段和 DEVICE_SECRET 失败关闭 | 只允许本地、不可上传 Fixture | Open |
| R0-05 Outbox Drain | WP-2 | Client Sync + Cloud Devices / Data Reviewer | 乱序、缺口、重复、并发切换 | 逐流连续水位和 Drain Manifest 测试 | 禁止正常 handoff，保留 Standby | Open |
| R0-06 Device Identity | WP-1/WP-2 | Cloud Devices + Secure Host / Security Reviewer | 签名 Golden Vector + 并发 Fixture | Nonce/PoP、轮换、撤销、强类型 Envelope、重放矩阵 | 设备保持未绑定，不签发 Lease | In Progress |
| R0-07 Recipe/Ticket | WP-3 | Browser Host / Security Reviewer | 无副作用页面 Fixture；双引擎 | 受限 AST、Host 复验、根 Ticket 兑换、递增 Step、崩溃失效 | Manual 模式或系统浏览器 | Open |
| R0-08 Backup Projection | WP-5 | Recovery / Security Reviewer | 含 pending 状态的 Fixture DB；磁盘故障注入 | 白名单 Export Schema、Crypto Profile、篡改/截断/明文扫描 | 只开放 Cloud 重建，不发布本地备份 | Open |
| R0-09 Tenant Job | WP-4 | Cloud Platform / Security Reviewer | 双租户同 ID、连接池复用、Quarantine | 可信 TenantJobEnvelope、逐租户 Fan-out、对象 Key/重放负向矩阵 | 禁用周期 Job，保留显式逐租户操作 | Open |
| R0-10 Cross-language Contract | WP-0 | Engineering Baseline / Architecture Reviewer | TypeScript/Rust/Cloud 共用 Corpus | 唯一 Connector 注册边；unknown/missing/enum/version/error 正负 Corpus | 不冻结 IPC/Auth Wire | Closed |
| R0-11 Toolchain/OS | WP-0 | Release Engineering / Architecture Reviewer | Windows 11 24H2 x64；macOS 15 arm64/x64 | 版本文件、lockfile、native CI、可重现构建、制品与签名责任 | Spike 只能标记为单平台/不可发布 | In Progress |
| R0-12 Device Credential | WP-2 | Client Connections / Product Reviewer | 首配、切回、撤销、Keychain 丢失、Session 过期 | 五场景状态机和契约测试；重新 Active 后执行 Active-only 本机健康检查，只有通过的保留凭据可复用 | 本机凭据不存在、检查失败或无法验证时要求重新录入/登录 | Open |
| R0-13 Live Write Safety | WP-3/WP-6 | Connector + Security Reviewer / 非实现者批准 | 专用测试账号与可丢弃资产 | 资产清单、显式批准、执行前后证据、清理、紧急停用 | Fake Provider/Read-only | Open |
| R0-14 Operation Retry Safety | WP-6 | Connector + Operations / Security Reviewer | 同一连接器混合安全等级 | 逐 operation/endpoint retrySafety、超时/重复 Contract Test | 写操作统一 `never`，转人工确认 | Open |

## 3. WP-0 当前证据

WP-0 的版本和支持范围由 [PHASE0_ENGINEERING_BASELINE.md](PHASE0_ENGINEERING_BASELINE.md) 管理，决策理由见 [ADR-0008](adr/0008-phase-0-engineering-baseline.md)。

R0-10 已由以下可重跑证据关闭：

- 具体 Connector 只允许从 Desktop Composition Root 注册；4 个结构负向测试证明 Feature、Cloud、Admin、Account、client-core 和 Rust 安全核心的禁止边会失败。
- TypeScript protocol 运行 6 个共享正负向量，Cloud 独立运行同一 Corpus，Rust Secure Host 镜像再次运行同一 Corpus。
- unknown field、missing field、unknown enum、unsupported version 和错误 Envelope 均有确定结果。

R0-11 当前本地证据为 macOS 15 arm64 上的锁定 Node/pnpm/Rust、16 个 TypeScript workspace 类型检查、8 个 TypeScript/Cloud 协议测试、4 个结构负向测试、3 个 Rust 测试、全 workspace Clippy，以及 Tauri Release 无 Bundle 构建。`native.yml` 已覆盖 Windows 11 x64、macOS 15 arm64 与 macOS 15 Intel，但远端 Job 尚未执行并留存制品，因此 R0-11 保持 `In Progress`。

## 4. Secure Host 决策包当前证据

R0-02、R0-03 与 R0-06 的当前事实源、已完成证据和剩余平台证据见 [PHASE0_SECURE_HOST_BASELINE.md](PHASE0_SECURE_HOST_BASELINE.md)。对应决策为 [ADR-0009](adr/0009-endpoint-capability-registry.md)、[ADR-0010](adr/0010-host-owned-secret-path.md) 和 [ADR-0011](adr/0011-device-identity-lifecycle.md)。

三项状态均为 `In Progress`：设计落档与可移植 Contract 证据不能替代 Windows/macOS 原生网络与秘密输入验证，也不能替代 Cloud 事务、并发和经审查密码学库的联合证据。在这些证据齐全前，Fallback 继续生效。

当前可重跑证据包括：

- 4 个生产 Connector 使用空 Endpoint Manifest，生成注册表为 deny-all；生成 Hash 和 TS/Rust 生成物由 `check:generated` 做差异门禁。
- EndpointManifest 的 JSON Schema 与跨字段校验、版本化 Credential Profile/Slot/SecretKind、封闭请求/公开响应 AST、固定幂等 Header、Origin 规范化与单向生成负向测试；Rust Fixture Executor 覆盖生产 deny-all、非 Active 零资源访问、完整作用域绑定、参数/总量限制、凭据值与凭据/幂等 Header 累计上限、DNS 混合与特殊用途地址、固定地址集合、秘密延迟加载、代理策略、重定向、响应上限及未知/畸形公开 JSON 拒绝。该证据不代表 Windows/macOS 原生 Socket/TLS/系统代理或流式解压路径已经通过。
- 9 个 Rust Host-owned Secret/Executor 测试，覆盖秘密类型与原始 Transport Body 的 Debug 脱敏、强类型完整作用域、不透明整批提交回执、公开状态重建、Manifest/私有绑定表双向一致性，以及非 2xx、重定向、超限、畸形、缺失、未知、错类型或不安全响应和 Store 失败的失败关闭；生产 Registry 与执行入口仍为 deny-all。该证据不声称覆盖真实 Keychain、原生输入面、平台 Transport、解析器内部 scratch buffer 清零或进程外泄漏扫描。
- `protocol/devices`、`apps/cloud` 包级契约测试与 Rust 按凭证类型解析器运行 Device Identity 共享正负向量，并证明合法 Entitlement 不能被 ActiveDeviceLease 消费点接受；Rust 另验证域分离、长度定界 Transcript。该证据不代表 Cloud Route/Handler 已接线，也不声称已经执行 Ed25519 验签或 Cloud 并发事务。
