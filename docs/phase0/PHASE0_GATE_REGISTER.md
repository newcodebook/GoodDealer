# GoodDealer Phase 0 Gate 台账

状态：Active

更新日期：2026-08-05

## 1. 使用规则

本台账是 Phase 0 当前执行状态、范围和关闭条件的唯一入口。2026-08-01 审查报告只保留 R0-01～R0-14 在当时基线上的原始证据；其旧执行顺序和“最终准入”已由本台账取代。R0-15/R0-16 是后续复审新增 Finding，其来源与失败路径见下方 §2.2。每个 Gate 必须同时具备权威设计落档和可重现证据，才可以标记为 `Closed`。

状态只使用：

- `Open`：关闭方法、责任分配或验收边界尚未被接受，或该 Gate 已明确排期但工作尚未启动。
- `In Progress`：关闭方法、责任边界与权威设计已接受，且实现、Fixture 或可执行证据至少一项正在形成，但关闭条件尚未全部满足。
- `Blocked`：存在明确外部阻塞，已记录 fallback。
- `Closed`：关闭条件全部满足，证据可重跑。

台账使用角色与模块责任域。技术 Evidence Manifest 记录责任角色、模块、可用时的稳定 Evidence Producer 身份和精确技术输入，但它在评审发生前生成，不承载或推断事后批准。每次关闭 Gate 必须另存不可变 `GateClosureAttestation`；每份 Attestation 只能包含一个 `gate_id` 并只关闭该 Gate，多 Gate 必须分别生成，不能让一组 owner/reviews/approval 跨责任域复用。Attestation 通过 `evidence_sets[]` 为每个必需 Profile/平台/Job 分别绑定最终 Manifest SHA-256、CI Artifact ID/digest/run/job URL 和同内容的长期不可变归档 ref/digest/retention policy；多个 Job 不得压成单一 Manifest 或 Artifact 引用。Attestation 使用结构化 `owner{role,ref}`、`reviews[{role,ref,reviewed_at,independence_assertion}]` 与 `approval{role,ref,approved_at}`；Validator 必须按该 `gate_id` 对照关闭条件和 §2.1 验证完整 evidence set 集合与全部 Required Reviewer 角色，复合 Reviewer 必须形成多个 reviews[] 项，不得压成单一字符串或由一人冒充多角色。Owner 交付实现和证据，Required Reviewer 执行独立技术复核，Approver 对关闭决定负责。一个人可以同时是 Reviewer 与 Approver，但实现者不能作为唯一 Reviewer 或自批；涉及安全、租户隔离、秘密或真实外部写入的 Gate 必须由未参与对应实现的 Security Reviewer 独立验收。缺少任一必需 Job、长期归档、角色、稳定身份、时间或独立性验证时不得接受 Attestation、不得关闭 Gate。

## 2. 当前 Gate

主表的 `Responsibility Summary` 只是便于浏览的非权威缩写；`Owner Role`、`Owning Modules`、`Required Reviewer` 与 `Approver` 的权威拆分见 §2.1，四者不能互相替代。Evidence Manifest 记录责任角色与技术证据；GateClosureAttestation 记录稳定身份、Manifest 摘要、独立复核与批准。命令成功只形成技术证据，不自动关闭 Gate。

| Finding | Roadmap Requirement / Journey | WP | Responsibility Summary | 假设、Fixture 与 OS | 可重跑证据 / 关闭条件 | Fallback | 状态 |
| --- | --- | --- | --- | --- | --- | --- | --- |
| R0-01 Phase 0 执行计划 | Phase 0 全部退出条件；J-01/J-03/J-05/J-08 | WP-0～WP-6 | Engineering Baseline / Architecture Reviewer | 各 WP 可独立验收；跨平台要求由对应 Gate 明示 | [执行计划](PHASE0_EXECUTION_PLAN.md) 已为 32 条 Requirement 分配 ID、Gate、Journey、稳定 Owner、环境、证据入口与 Fallback；P0-05 typed IPC 已形成 Portable 实现与门禁，P0-15/19 已形成 account-gate Portable/Cloud Fixture 纵切与 `pnpm evidence:wp2`，关闭前仍须补齐对应 native/生产证据，并实现 P0-22 Public/Admin runtime 隔离和 P0-23 Active/Standby Query Contract 的待建证据生产器 | 单个 WP 阻塞时不拖住无依赖 WP；未映射 Requirement 不得实现为生产能力 | In Progress |
| R0-02 Endpoint Capability | 安全 HTTP Gateway 与五类连接器原型；J-01/J-02/J-03/J-04/J-05 | WP-1/WP-6 | Secure Host / Security Reviewer | Fixture + Fake Provider；Windows 11 24H2 x64、macOS 15 arm64/x64 | EndpointManifest 生成物及 `healthy_only \| health_reverification` 封闭策略/跨字段负向矩阵；Host-only `ActivePlatformAccessContext \| SunsetAuthorization(platform_access,host_binding)` 判别联合及跨模式拒绝；Active device / Sunset installation Binding scope 与 Namespace 隔离；健康复验只允许 `retained_unverified \| healthy`，`invalid` 失败关闭并要求重录，Host-owned 裁决原子推进 generation；URL、重定向、DNS/IP、Cloud↔平台注册表/请求类型/Token Injector/Keychain Namespace、跨连接凭据绑定负向矩阵 | 生产连接器保持 Manual/Disabled；仅逐 Endpoint 通过本 Gate 后才可 Read-only | In Progress |
| R0-03 Host-owned Secret | Token/Secret Host-owned 路径；J-01/J-03/J-05 | WP-1/WP-6 | Secure Host / Security Reviewer | Canary Secret；Windows 11 24H2 x64、macOS 15 arm64/x64 | DOM、TS Heap、IPC、DB/WAL、日志、Crash、Outbox、对象存储与全部 Cloud 服务扫描；Cloud/平台秘密命名空间混淆测试 | 禁止真实凭据流程 | In Progress |
| R0-04 Sync Projection / Candidate CAS | Sync Mutation/Workspace Projection；J-01/J-02/J-05/J-07 | WP-2 | Local Storage + Workspace Protocol + Recovery / Security Reviewer | 属性测试 + Fixture DB；Portable + native DB | 封闭 Projection；未知字段和 DEVICE_SECRET 失败关闭；切换事务原子退休旧 DeviceCursor，ReaderCursor TTL/压缩竞态转 rebootstrap、设备移除转 none；Checkpoint 先验证/发布再压缩、Bootstrap pin 与至少一条完整重建链；设备只提交“一字段一 Proposal”的域分离签名 StaleChangeProposal 封闭 Payload，Candidate/RestoreCandidate Envelope 字段由 Cloud 派生，重复/乱序/跨设备或 Epoch 重放幂等且一份 Proposal 只生成一个单字段 Candidate，伪造服务端字段失败关闭；Cloud Candidate CAS、`rebase_required` 与重复 Apply 幂等测试 | 只允许本地、不可上传 Fixture；恢复 Apply 禁用 | Open |
| R0-05 Three-stream Drain | 正常/强制切换与 Draining；J-05 | WP-2 | Client Sync + Cloud Devices / Data + Security Reviewer | 乱序、缺口、重复、并发切换；Portable + Cloud transaction Fixture | `(workspace,device,epoch,stream)` 序列域；只覆盖设备提交 Envelope 的 canonical/sha256-chain-v1 Golden Corpus，证明 Cloud 富化不改变 digest；Workspace DeviceAudit chain 唯一登记且不可分叉，Account DeviceAudit pending 不阻塞 handoff；进入 Draining 的事务屏障必须证明零可提交平台请求、已完成/`outcome_unknown` Attempt 的 Fact/Audit Envelope 与序列均已持久化、Sequencer 已封口；进入后分配新序列/落账新 Envelope 的负向测试；逐流连续水位、Gap、摘要与设备签名的本地尾部声明；本地完整性异常拒签 Proof，并明确该协议不提供 Byzantine 客户端尾部证明；DrainProof purpose 隔离、旧 Proof 重放拒绝；只有 handoff DrainManifest 可释放 Lease/推进 Epoch；域分离签名与事务释放测试 | 禁止正常 handoff，保留 Standby | Open |
| R0-06 Device Identity | 账号认证、Bootstrap、设备绑定、单 Active、离线窗口；J-01/J-05/J-06/J-07 | WP-1/WP-2 | Cloud Devices + Account Access + Secure Host / Security Reviewer | 签名 Golden Vector + 并发 Fixture；Portable + Cloud transaction Fixture | 消费级密码登录、Refresh Token 轮换/会话管理/可选 Passkey 原型；Nonce/PoP（Transcript 显式编码 schemaVersion/algorithm）、轮换、账号 Security Epoch、撤销、强类型 Envelope、全部凭证的有效 Corpus 与按类型重放矩阵；OfflineDeviceLease `issuedAt < renewAfter < accessUntil=expiresAt`；JTI 全局唯一、Challenge 单次消费；Bootstrap/Recovery strict 判别 step request/result 携带实际 payload，摘要覆盖除 nonce/自身外完整请求，分页、step nonce/number + CAS、相同请求逐字节幂等与完成时整体消费，Recovery Envelope/Key Purpose 与 Bootstrap 双向拒绝；独立 evidence-spool 先写与崩溃对账；RemovedDeviceTombstone 固定 `removed_at + offline_execute_until`，一次性 RemovedEvidenceChallenge 固定 iss/aud、Tombstone digest、removal-observed anchor，strict lowerCamelCase Wire、Tombstone/Challenge/PoP Transcript、按 `(stream,workspace,epoch,sequence,id)` 排序的长度定界 SHA-256 batch、精确 multi-stream Range DTO 和每 Key Version 单独 Challenge/PoP 的 Golden Corpus；覆盖过期/JTI 重放、跨 Tombstone/Key、Range/排序/摘要不一致、同 ID 异内容、Cloud `removed_at` 后但本机尚未获知且仍在原 offline window 内的合法记录、本机确认撤销后新签普通 Fact/Audit 拒绝、私钥转 `removed_evidence_pop_only` 后只允许 PoP、Key 缺失失败关闭、Spool/旧私钥保留与全部回执后的原子擦除、大小/速率和并发消费，且 evidence-only Ingest 只接收 eligible 的已持久化原始签名 Fact/Audit、不能恢复 Scope；`T-1` 移除 Active 并绑定 B 时拒签新执行权、`T` 后并发只成功一个的事务序列；RuntimeMode + Lease/Epoch/可信时间联合负向测试 | 账号入口保持 Fixture；设备保持未绑定，不签发 Lease | In Progress |
| R0-07 Recipe/Ticket | 浏览器自动化批准链；J-01/J-03/J-04 | WP-3 | Browser Host / Security Reviewer | 无副作用页面 Fixture；Windows WebView2 + macOS WKWebView | 受限 AST、Host 复验；不要求健康凭据且只允许登录导航的 BrowserSessionAccessContext；业务执行 Guard 与 Consent Context 不可互换；根 Ticket 兑换、递增 Step、崩溃失效 | Manual 模式或系统浏览器 | Open |
| R0-08 Backup Projection | 本地加密备份/恢复；J-07 | WP-5 | Recovery / Security Reviewer | 含 pending 状态的 Fixture DB；native DB + 磁盘故障注入 | `BackupExportSchema`、Synchronized/Emergency 分类与 `backup_id + manifest_digest`；Proof、短写门禁与 SQLite 读取源同一冻结边界，Manifest 绑定 `proof_id + proof_digest`，旧 Proof/竞态重放拒绝；`PendingSignedEvidenceArchive` 携带原签名 Envelope 与域分离 ExecutionAuthorizationEvidence，只有同一设备身份且原 Key 仍存在时才走原 Epoch/RemovedEvidenceSpool Ingest，覆盖跨设备代提交与无 PoP 降级拒绝，且不可恢复权限；`InternalRecoveryPoint` 不可导出/迁移，撤销后回滚不得复活 Session/Lease/Epoch/批准/Worker/可信时间；`gd.recovery-capability.v1` Envelope/Key Purpose 与 Bootstrap 域分离，strict step union 实际携带基线、完整有界 Manifest diff 或 Candidate receipt，摘要/step CAS/重复呈交 Corpus；RestoreCandidate ID/比较 Revision/当前值 Hash/状态/时间由 Cloud 派生；Candidate CAS、Crypto Profile、换包/篡改/截断/明文扫描 | 只开放 Cloud 重建，不发布本地备份 | Open |
| R0-09 Tenant Job / Public-Admin Runtime Isolation | Public/Admin/Jobs 与租户隔离；J-06/J-08/J-09/J-10 | WP-4 | Cloud Platform / Security Reviewer | 双租户同 ID、连接池复用、Quarantine；Cloud integration | 独立 Public/Admin Session、Scope、Route 与 Composition Root；Public Session 拒绝 Admin Route；Audit `kind + event_type`、variant/actor/authorization source/Key Purpose 矩阵、真实 tenant scope、唯一 chain domain 与 head CAS，覆盖无 Workspace 的登录、设备、License、DataRightsRequest 和 global Service 事件；短期 AdminReadAuthorization 与 AdminActionAuthorization 不可互换；可信 TenantJobEnvelope、逐租户 Fan-out、对象 Key/重放负向矩阵 | Admin 与周期 Job 保持未注册；只保留无业务 Route 的边界骨架 | Open |
| R0-10 Shared Wire Corpus | protocol 兼容骨架；J-01/J-03/J-05/J-08 | WP-0 | Engineering Baseline / Architecture Reviewer | TypeScript/Rust/Cloud 共用 Corpus；Portable | TypeScript/Cloud 与 Rust 分别运行同一 Wire Envelope unknown/missing/enum/version/error 正负 Corpus；根 `pnpm check` 必须显式编排 Rust Corpus，锁定工具链与 native CI 证据可追溯。Connector 注册边归 R0-15；真实 typed IPC/Auth DTO 与 Adapter/Handler 接线分别归 R0-01/R0-06/R0-16 | 若 Corpus 回归则不冻结或接入对应 Wire | In Progress |
| R0-11 Toolchain/OS | 版本、最低 OS、原生构建与发布责任；Phase 0 全部 | WP-0 | Release Engineering / Architecture Reviewer | Windows 11 24H2 x64；macOS 15 arm64/x64 | Evidence Manifest 绑定 commit/dirty/changed paths、命令退出码与 Hash；native CI Job URL、可重现构建、制品与签名责任 | Spike 只能标记为单平台/不可发布 | In Progress |
| R0-12 Device Credential | 首配、切回与本机凭据恢复；J-01/J-03/J-05 | WP-2 | Client Connections / Product + Security Reviewer | 首配、切回、撤销、Keychain 丢失、Session 过期；Windows/macOS | 五场景语义已冻结；仍需状态机和契约测试，重新 Active 后执行 Active-only 本机健康检查，只有通过的保留凭据可复用 | 本机凭据不存在、检查失败或无法验证时要求重新录入/登录 | In Progress |
| R0-13 Live Write Safety | 首个真实外部写入；J-02/J-03/J-04/J-10 | WP-3/WP-6 | Connector + Operations / Security Reviewer（批准者须为非实现者） | 专用测试账号与可丢弃资产；目标 Provider | 资产清单、显式批准、执行前后证据、清理、紧急停用 | Fake Provider/Read-only | Open |
| R0-14 Operation Retry Safety | 写操作重试与结果未知；J-02/J-03/J-04 | WP-6 | Connector + Operations / Security Reviewer | 同一连接器混合安全等级；Fixture + 目标 Provider | 逐 operation/endpoint retrySafety、超时/重复 Contract Test | 写操作统一 `never`，转人工确认 | Open |
| R0-15 Trust-domain Dependency Enforcement | Phase 0 全部模块边界；J-01/J-03/J-05/J-08 | WP-0 | Engineering Baseline / Architecture + Security Reviewer | 全仓 Package/TS/Rust/Tauri 扫描；Portable + native | 精确“调用方路径 × 允许 protocol 子路径/依赖/能力”矩阵；Composition Root 的真实静态导入/注册；admin-web、admin-http、connectors、connector-sdk、client-core、cloud、secure-host-core 的正负 Fixture；拒绝计算型动态 import、泛化 HTTP/Shell/Tauri Command 与越权 Rust 依赖；自定义 Command 的 `AppManifest::commands`、`generate_handler!` 与逐命令 Capability Permission 三集合完全一致；Local/Remote 使用不重叠的明确 WebView label，同 Window 时禁止窗口级 Capability 合并权限 | 自动检查保持生产 Registry deny-all；Local Capability 仅为 `core:default + allow-runtime-status`，其余业务 Command deny-all；其余未覆盖边执行强制 Architecture + Security Review，属于过程控制而非完整机器证明 | In Progress |
| R0-16 RuntimeMode Command Admission / Query Contract | RuntimeMode 状态转换、恢复与平台访问；J-01/J-02/J-03/J-05/J-06/J-07 | WP-1/WP-2 | Secure Host + Local Storage / Security Reviewer | 命令级状态机 Fixture；Portable + Windows/macOS 存储 | Host-owned 状态来源与转换；typed Port DTO 到最小 IPC/Command Handler 的接线；Active/Standby Query Adapter 等价契约与 DataFreshness；Active/Standby/LocalContinuation/evidence-spool 四个长期持久化域及临时 Staging 的独立文件/WAL/连接/Key/Migration Runner；逐命令覆盖 Query、SyncMutation/Outbox 仅 Active、LocalContinuation 独立 platform-sync 与本地写不生成 Mutation、Active Attempt 结果落账、Draining 只上传既有 Envelope、三流上传、RemovedEvidenceSpool、Late/Proposal/Candidate Ingest、备份、秘密/业务恢复、Migration、崩溃对账、凭据健康、Worker 领取；进入 Draining 前停止签发 Context、已提交请求完成/隔离，Draining 平台零准入；验证 mint Context 后推进 Mode/Epoch/可信时间再 consume 必须零资源拒绝；验证 `Active -> Draining(suspend) -> Activating(purpose=local_recovery)`、Bootstrap/Recovery strict step DTO/purpose 隔离、同设备/Workspace/Epoch/`backup_id + manifest_digest` Capability、换包/换 Manifest 拒绝、Staging 只生成 Candidate、按 Cloud 当前基线恢复 Active 后才允许 Apply；Host-only Active/Sunset 平台授权联合、Active device/Sunset installation Binding/Profile scope 隔离；日常 ActiveLease/Browser 授权与 `SunsetAuthorization`/`SunsetApprovedOperation`/`SunsetBrowserSessionAccessContext`/`SunsetAutomationExecutionTicket`、`SunsetExecutionFact`/`SunsetDeviceAuditEvent` 的 Key Purpose、Schema、Transcript、Nonce/序列、解析器域分离且跨模式重放失败；Sunset 类型不含账号/Lease/Epoch、不进入 Cloud Ingest/三流 Drain；RuntimeMode + Lease/Epoch/可信时间联合零资源负向矩阵 | 自动检查只允许只读 `runtime_status` Command；账号、存储、平台访问和其他生产业务 Command 均不注册 | In Progress |

### 2.1 Gate 责任矩阵

| Gate | Owner Role | Owning Modules | Required `reviews[].role` set | Approver |
| --- | --- | --- | --- | --- |
| R0-01 | Engineering Lead | Engineering Baseline | `["Architecture Reviewer"]` | Phase 0 Gate Approver |
| R0-02 | Secure Host Lead | `secure-host-core`、`connector-sdk` | `["Security Reviewer"]` | Security Gate Approver |
| R0-03 | Secure Host Lead | `secure-host-core`、原生秘密输入 | `["Security Reviewer"]` | Security Gate Approver |
| R0-04 | Sync & Recovery Lead | `local-storage`、Workspace Protocol、Recovery | `["Security Reviewer"]` | Security Gate Approver |
| R0-05 | Device Sync Lead | Client Sync、Cloud Devices | `["Data Reviewer", "Security Reviewer"]` | Security Gate Approver |
| R0-06 | Device Identity Lead | Cloud Devices、Account Access、`secure-host-core` | `["Security Reviewer"]` | Security Gate Approver |
| R0-07 | Browser Security Lead | Browser Host、Automation Host | `["Security Reviewer"]` | Security Gate Approver |
| R0-08 | Recovery Lead | Recovery、`local-storage` | `["Security Reviewer"]` | Security Gate Approver |
| R0-09 | Cloud Platform Lead | Public HTTP、Admin HTTP、Jobs | `["Security Reviewer"]` | Security Gate Approver |
| R0-10 | Engineering Baseline Lead | Protocol、Workspace Tooling | `["Architecture Reviewer"]` | Phase 0 Gate Approver |
| R0-11 | Release Engineering Lead | Release Engineering、CI | `["Architecture Reviewer"]` | Phase 0 Gate Approver |
| R0-12 | Client Connections Lead | Client Connections、Secure Host Credential Binding | `["Product Reviewer", "Security Reviewer"]` | Security Gate Approver |
| R0-13 | Connector Operations Lead | Connectors、Operations | `["Security Reviewer"]` | Security Gate Approver（非实现者） |
| R0-14 | Connector Operations Lead | Connectors、Operations | `["Security Reviewer"]` | Security Gate Approver |
| R0-15 | Architecture Enforcement Lead | Boundary Tooling、全仓信任域 | `["Architecture Reviewer", "Security Reviewer"]` | Security Gate Approver |
| R0-16 | Runtime Security Lead | `secure-host-core`、`local-storage`、Client Runtime | `["Security Reviewer"]` | Security Gate Approver |

### 2.2 后续新增 Finding 的来源与失败路径

- **R0-15 / High**：复审发现包级边界仍可被 protocol 子路径、计算型 dynamic import、文本伪注册、泛化 HTTP/Shell/Tauri Command 或 Rust 依赖绕过；2026-08-06 对照 Tauri 源码进一步确认，本地自定义 Command 若未进入 AppManifest ACL，以及窗口级 Capability 覆盖同 Window 的 Remote WebView，也会绕过预期边界。失败路径是非授权信任域直接获得 Connector、Admin DTO、网络或本地高权限能力。关闭必须依赖可重跑的 deny-by-default 矩阵、Command 三集合一致性和 WebView label 负向矩阵；人工审查只能作为 Gate 未关闭期间的临时过程控制。
- **R0-16 / High**：2026-08-03 复审发现仅有 RuntimeMode 名称或 UI 状态不能证明命令准入，存储、恢复、凭据健康、三流 Ingest 与平台访问可能各自绕过状态机。失败路径是 Standby/Activating/Draining 获得超出矩阵的资源或副作用能力。关闭必须由 Host-owned 状态、逐命令资源绑定、消费点时钟/Epoch 复验和零资源负向测试共同证明。

## 3. Roadmap、Journey 与工作包映射

| WP | Phase 0 Roadmap Requirement | Journey | Gate / 当前证据入口 |
| --- | --- | --- | --- |
| WP-0 Engineering Baseline | 工具链、目录、CI、协议 Corpus、唯一 Connector 注册边、完整信任域依赖执行 | J-01/J-03/J-05/J-08 的共同工程底座 | R0-01、R0-10、R0-11、R0-15；本文件 §3.1、[PHASE0_ENGINEERING_BASELINE.md](PHASE0_ENGINEERING_BASELINE.md)、Evidence Manifest |
| WP-1 Secure Local Host | SQLCipher/Keychain/签名/安全 HTTP/Host-owned Secret/Runtime Gate | J-01/J-03/J-05/J-06/J-07 | R0-02、R0-03、R0-06、R0-16；[PHASE0_SECURE_HOST_BASELINE.md](PHASE0_SECURE_HOST_BASELINE.md) |
| WP-2 Account, Device & Sync | Bootstrap、Lease/Mutation/Query、Standby、排空、凭据切回与命令准入 | J-01/J-05/J-06/J-07 | R0-04、R0-05、R0-06、R0-12、R0-16、JF-01；对应 Gate 行的测试/工件 |
| WP-3 Browser Dual Engine | Profile、窗口、导航、批准 Ticket 与无副作用双引擎 Spike | J-03/J-04 | R0-07、R0-13；双引擎证据与 Safety Envelope |
| WP-4 Cloud Boundary & Jobs | Public/Admin/Jobs 分入口、独立 Session/Scope/Route/Staff Audit、TenantContext、Job Runtime | J-06/J-08/J-09/J-10 | R0-09；Cloud integration、Public→Admin 拒绝与跨租户负向矩阵 |
| WP-5 Backup & Recovery | 两类备份、白名单 Projection、加密容器、故障恢复 | J-05/J-06/J-07 | R0-08、D-015；备份 Fixture、篡改/截断/明文扫描 |
| WP-6 Connector Modes | Fake Provider 五类模式、逐 Endpoint 重试与真实写安全边界 | J-02/J-03/J-04/J-10 | R0-02、R0-03、R0-13、R0-14；Fixture Contract 与逐 Provider Safety Envelope |

Roadmap 的每一项 Phase 0 工作必须在进入实现前归入上述一个 WP，并引用至少一个 Gate；新增工作若无法归入，不得仅依赖本表的 `Closed` 状态推进。Phase 0 最终退出仍需联合通过 J-01/J-03/J-05/J-08 的 Happy Path、权限拒绝、中断恢复和结果未知场景。

当前 Requirement ID、波次、Owner Role、环境、证据入口和 Fallback 统一见 [PHASE0_EXECUTION_PLAN.md](PHASE0_EXECUTION_PLAN.md)。该矩阵是 R0-01 的执行输入，不替代本台账的关闭条件或 GateClosureAttestation。

### 3.1 WP-0 当前证据

WP-0 的版本和支持范围由 [PHASE0_ENGINEERING_BASELINE.md](PHASE0_ENGINEERING_BASELINE.md) 管理，决策理由见 [ADR-0008](../adr/0008-phase-0-engineering-baseline.md)。

R0-10 的共享 Wire Envelope 语义已冻结，但证据仍在执行中：

- 根 `pnpm check` 已显式编排 TypeScript protocol、Cloud、Rust workspace 与结构门禁；RuntimeStatus、Wire Envelope 和 Device Identity 的共享/镜像正负 Corpus 可由同一总入口运行。该本地结果仍不是 native CI、长期归档或 GateClosureAttestation。
- P0-05 已建立 `RuntimeStatus(schemaVersion/mode/activationPurpose)` 的 TypeScript/Rust 共享 Golden Corpus、client-core 只读 Port、固定命令名的 Desktop Adapter，以及读取 Host-owned `RuntimeGate` 的 Rust Command Handler。`AppManifest::commands`、`generate_handler!`、`#[tauri::command]`、逐命令 Capability Permission 与 Adapter 命令名由结构门禁强制同集；未知字段、mode/purpose 非法组合、单边注册、缺失 Permission、窗口级 Capability 和插件扩权均有负向证据。该命令不接收参数、不读取秘密、不取得存储或网络资源。
- P0-05 的 Portable 实现与总门禁已完成，并已取得提交 `901dfd44a1bb8c9d007bb16a1d9f3c143d70188a` 的锁定 Rust 工具链/native CI 成功 evidence set；关闭相关 Gate 前仍缺长期不可变归档与独立 Attestation。Connector 唯一注册边和其余信任域扫描仍属于 R0-15；只读 RuntimeStatus IPC 不等于 Auth DTO、业务 Command 或完整 RuntimeMode 资源准入已经交付。

R0-11 由 `pnpm evidence:wp0`（本地默认 Profile）或 `node scripts/collect-wp0-evidence.mjs --profile quality|native` 生成 Evidence Manifest。Manifest 记录责任角色/模块、Evidence Producer 稳定身份（环境可提供时）、当前 commit/tree、dirty path、staged/unstaged diff Hash、逐个未跟踪文件内容 Hash、预期/实际 OS 与架构、Runner Image、工具版本、命令退出码、输出 Hash、关键输入 Hash 和 CI Job URL。CI 中无法解析精确 Job URL 或 Runner 上下文不匹配时必须分别产生 `ci-job-url-unavailable` 或 `runner-context-mismatch`，技术资格和结果均失败；`runUrl + jobName` 不能静默替代精确 Job provenance。初始或最终 dirty 的本地运行可以作为诊断记录，但必须标记 `technicalEligibility.eligible=false`；CI 技术证据还强制初始/最终工作树干净且 commit/tree/输入内容摘要完全一致，否则即使命令退出码全为零也判定失败。`technicalEligibility` 永远不表示 Gate 关闭。关闭时为 R0-11 单独建立 schema v1 GateClosureAttestation，至少绑定 `gate_id/evidence_sets[{profile,platform,job_name,manifest_sha256,artifact{artifact_id,artifact_digest,run_url,job_url},archive{archive_ref,archive_sha256,retention_policy}}]/owner{role,ref}/reviews[{role,ref,reviewed_at,independence_assertion}]/approval{role,ref,approved_at}`，并由 Gate-specific Validator 按 §1/§2.1 校验完整 Job 集合、全部角色与独立性；Validator 尚未实现或未通过时 R0-11 不得 Closed。R0-11 的集合至少包含 `quality` 和 native 的 `windows-server-2025-x64-compile`、`macos-15-arm64`、`macos-15-intel` 四个独立 evidence set；Windows 11 24H2 真机打包/WebView2 仍是另一个独立 Gate evidence set，不能由 compile set 替代。Workflow Artifact 名包含 Run ID/Attempt，90 天 Artifact 只作为评审传输与短期复跑材料，关闭前必须把每份逐字节相同证据包提升到覆盖 Gate 与项目审计期的不可变归档。在完整集合、长期归档、独立 Attestation 与制品可追溯前，R0-11 保持 `In Progress`。

当前技术集合已绑定提交 `901dfd44a1bb8c9d007bb16a1d9f3c143d70188a`：Quality Run `31079370330`/Artifact `8958846274`，Native Run `31079370262` 的 Windows Artifact `8959073076`、macOS Intel Artifact `8958954823`、macOS arm64 Artifact `8958885325`。四份 Manifest 均为 `passed`、`technicalEligibility.eligible=true`、前后 clean/稳定且解析到精确 Job URL。它们仍是 90 天传输 Artifact，不包含长期归档、独立 Attestation、Windows 11 24H2 真机打包、签名或公证证据，故 R0-11 不得 Closed。

P0-07 的 `pnpm evidence:wp5 --slice sqlcipher` 已建立测试专用结构化证据：固定核验 SQLCipher 4.17.0 community/SQLite 3.53.3；数据库、WAL、rollback journal、崩溃恢复文件、截断和篡改副本均扫描 Canary 与 SQLite 明文头并记录文件 SHA-256；错误 Key、截断和篡改读取必须失败；已提交 WAL 在模拟进程退出后必须由正确 Key 恢复；Fixture 目录不得遗留未知临时文件。提交 `0f98a091a42fa9077c92414fc67756cadacbcc44` 的 Run `31088044992` 已取得 Windows Server 2025 x64 Artifact `8962898576`、macOS 15 Intel Artifact `8962521305`、macOS 15 arm64 Artifact `8962334154`；三份 Manifest 均为 `passed`、`technicalEligibility.eligible=true`、clean/stable，且绑定正确平台架构、精确 Job URL、固定版本、七份扫描记录和全部零退出码。

第二入口 `pnpm evidence:wp5:bundle` 仅通过默认关闭的 `sqlcipher-bundle-spike` feature 链接 optional SQLCipher，并使用独立命名/identifier 的可丢弃 Tauri 配置；普通桌面仍不链接 SQLCipher。它生成 macOS `.app` 或 Windows `.msi`，从包内程序运行随机临时 DB 探针并记录包内 executable/bundle SHA-256。本机 macOS arm64 已通过完整构建和包内运行，但 dirty 诊断 Manifest 不具技术资格。三平台 `wp5-sqlcipher-bundle` CI 已在提交 `51b68c7967e59d4328306737e0a82d93153e5ff2` 的 Run `31682478022`（2026-08-13 完成，conclusion `success`）取得：Windows Server 2025 x64 Artifact `9174755555`（`.msi`）、macOS 15 arm64 Artifact `9175612139`（`.app`）、macOS 15 x64 Artifact `9174478411`（`.app`）；三份 Manifest 均为 `passed`、`technicalEligibility.eligible=true`（`reasons: []`），绑定干净稳定仓库、匹配平台架构、精确 Job URL、固定工具链（node v24.18.1、pnpm 11.18.0、rustc/cargo 1.97.1）与 SQLCipher 4.17.0/SQLite 3.53.3，三平台探针 `databaseEncrypted`/`correctKeyReadable`/`wrongKeyRejected`/`temporaryDatabaseRemoved` 均为真。macOS 两个平台 `bundledExecutableMatchesReleaseExecutable=true`；Windows 该字段为 `false`（release exe 与 MSI 提取 exe 字节大小相同但 SHA-256 不同，差异原因本次未证实），须由独立 Security Review 明确裁决该差异是否可接受。三份 Artifact 为 90 天保留期（2026-08-13 创建，约 2026-11-11 到期），关闭前必须提升为长期不可变归档。即使该 CI 已通过，也仍缺 Windows 11 24H2 实际安装/运行、签名/公证、长期不可变归档、独立 Security Review（含对上述哈希差异的裁决）和 GateClosureAttestation；Spike 无签名身份、不接生产存储、Keychain、业务 IPC、网络或用户数据。因此 P0-07、R0-08、R0-16 继续保持 In Progress。

P0-15/P0-19 的首个 `account-gate` 纵切已建立 `pnpm evidence:wp2`：Ubuntu Hosted Workflow 运行 account/device Wire 正负 Corpus、Cloud `identity/licensing/devices` 内部不可售 Fixture、client-core RuntimeMode 只读投影与依赖边界检查，并生成输入 Hash 和失败关闭的 Fixture 范围报告。该证据不包含密码输入、raw credential、Keychain、生产 Route/网络、Cloud 事务并发或 Windows/macOS 原生行为；在这些缺口、独立 Security Review 与 GateClosureAttestation 完成前，R0-06/R0-16 保持 In Progress，账号入口仍为 Fixture。

开发阶段仓库临时公开以取得 Hosted Runner 证据，正式运营前计划恢复为封闭项目；当前公开窗口没有配置 Branch Protection/Ruleset，恢复封闭后可用的平台治理能力需按届时套餐重验。因此上述四个 Check 仍通过 PR 模板和 Owner 合并前复核执行，不属于 GitHub 平台强制的 Required Checks。该可见性策略不降低 R0-11 关闭标准：人工勾选、直接 Push 或 Owner 自审均不能替代与最终 Commit 一致的四份 CI Evidence、长期不可变归档和独立 Attestation。

## 4. Secure Host 决策包当前证据

R0-02、R0-03 与 R0-06 的当前事实源、已完成证据和剩余平台证据见 [PHASE0_SECURE_HOST_BASELINE.md](PHASE0_SECURE_HOST_BASELINE.md)。对应决策为 [ADR-0009](../adr/0009-endpoint-capability-registry.md)、[ADR-0010](../adr/0010-host-owned-secret-path.md) 和 [ADR-0011](../adr/0011-device-identity-lifecycle.md)。

三项状态均为 `In Progress`：设计落档与可移植 Contract 证据不能替代 Windows/macOS 原生网络与秘密输入验证，也不能替代 Cloud 事务、并发和经审查密码学库的联合证据。在这些证据齐全前，Fallback 继续生效。

当前可重跑证据由 `pnpm check`、`cargo test -p gooddealer-secure-host-core --all-targets` 和对应 native Gate 提供，范围包括：

- 所有当前生产 Connector 使用空 Endpoint Manifest，生成注册表为 deny-all；生成 Hash 和 TS/Rust 生成物由 `check:generated` 做差异门禁。
- EndpointManifest 的 JSON Schema 与跨字段校验、版本化 Credential Profile/Slot/SecretKind、封闭请求/公开响应 AST、固定幂等 Header、Origin 规范化与单向生成负向测试；Rust Fixture Executor 覆盖生产 deny-all、非 Active 零资源访问、完整作用域绑定、参数/总量限制、凭据值与凭据/幂等 Header 累计上限、DNS 混合与特殊用途地址、固定地址集合、秘密延迟加载、代理策略、重定向、响应上限及未知/畸形公开 JSON 拒绝。该证据不代表 Windows/macOS 原生 Socket/TLS/系统代理或流式解压路径已经通过。
- Rust Host-owned Secret/Executor Fixture 合同覆盖秘密类型与原始 Transport Body 的 Debug 脱敏、单 Slot 作用域、不透明整批提交回执、公开状态重建、Manifest/私有绑定表双向一致性，以及非 2xx、重定向、超限、畸形、缺失、未知、错类型或不安全响应和 Store 失败的失败关闭；完整 Namespace + 强类型 SlotId/SecretKind 的多 Slot HostCredentialBinding 尚待实现，生产 Registry 与执行入口仍为 deny-all。该证据不声称覆盖真实 Keychain、原生输入面、平台 Transport、解析器内部 scratch buffer 清零或进程外泄漏扫描。
- `protocol/devices`、`apps/cloud` 包级契约测试与 Rust 按凭证类型解析器运行 Device Identity 共享正负向量，并证明合法 Entitlement 不能被 ActiveDeviceLease 消费点接受；Rust 另验证域分离、长度定界 Transcript。该证据不代表 Cloud Route/Handler 已接线，也不声称已经执行 Ed25519 验签或 Cloud 并发事务。
