# GoodDealer Phase 0 执行计划

状态：Active / Gate-driven Delivery
更新日期：2026-08-14

## 1. 执行规则

本文件把 [ROADMAP.md](../ROADMAP.md) 的 Phase 0 要求映射为可领取的交付项；Gate 的关闭条件和状态仍只以 [PHASE0_GATE_REGISTER.md](PHASE0_GATE_REGISTER.md) 为准。

- 每项进入实现前必须填写稳定的 `owner_ref`，并确认表中 Gate、Journey、环境、证据和 Fallback。角色名不是实际责任人身份。
- 一个交付项可以形成多个 Gate 的证据，但一份 GateClosureAttestation 只能关闭一个 Gate，且必须满足该 Gate 的全部 Required Reviewer 和 Approver 约束。
- `现有` 表示命令或证据生产器已在仓库中；`待建` 表示该交付项的第一部分就是建立对应生产器。待建命令不存在、失败或只产生 Fixture 证据时，相关 Gate 保持 Open/In Progress。
- 生产 Endpoint Registry、真实凭据、真实用户数据和真实外部写入继续默认禁止；只有对应 Gate 明确允许的专用环境可以解除该项 Fallback。
- 所有实现都必须通过根 `pnpm check`；原生或 Cloud 事务结论还必须通过表中专用 Profile，不能用 Portable 单元测试代替。
- 开发阶段仓库临时公开以取得 Hosted Runner 证据，正式运营前计划恢复为封闭项目；当前未配置 Branch Protection/Ruleset，恢复封闭后再按届时套餐确认平台治理能力。日常变更仍使用 PR，Owner 按 PR 模板核对最终 Commit 的四个 CI Check。该人工软门禁不允许绕过 Gate-specific 独立 Reviewer、长期证据归档或 Attestation。

## 2. 推荐执行波次

| 波次 | 范围 | 目标 |
| --- | --- | --- |
| W0 | P0-01～P0-06 | 收口工程、Wire、边界与 native CI 基线 |
| W1 | P0-07～P0-10、P0-15、P0-19、P0-24 | Secure Host、Auth、Keychain、RuntimeMode 最小纵切 |
| W2 | P0-16～P0-18、P0-20～P0-23 | Bootstrap、设备、同步、Query 与 Cloud Boundary |
| W3 | P0-25、P0-31 | Backup/Recovery 与 Tenant Job 独立闭环 |
| W4 | P0-26～P0-30 | 双引擎 Browser、Consent、Recipe 与 Ticket |
| W5 | P0-11～P0-14、P0-32 | Connector 模式、政策、Retry 与受控真实写入 |

后续波次可以对无共享契约的工作并行，但不得越过前置 Gate：W2 不得自行重定义 W1 的身份/Runtime 契约；W4/W5 不得在 R0-02/03/06/16 未形成消费点证据时启用真实能力。

W5 内部顺序固定为：FP Contract/Policy → 为每个 operation/endpoint 完成 R0-14 `retrySafety` 分类与超时/重复测试 → 由非实现者批准该 Provider 的 R0-13 Safety Envelope → TP 真实写入 → 清理、远端确认和对账。P0-32 Policy Record 未完成时不得进入 TP；同一波次不表示这些步骤可以并发或倒序。

## 3. 责任身份登记

矩阵通过 Owner Role 引用本表。`owner_ref` 必须是可审计的稳定人员或团队身份；`UNASSIGNED` 明确阻止对应交付项进入正式实现，但不阻止无副作用的只读诊断。

| Owner Role | owner_ref | 当前状态 |
| --- | --- | --- |
| Engineering Baseline / Architecture Enforcement | `github:user:246009252:newcodebook` | Assigned |
| Runtime Security / Secure Host | `github:user:246009252:newcodebook` | Assigned |
| Account Access / Cloud Devices / Device Sync | `github:user:246009252:newcodebook` | Assigned |
| Workspace / Recovery / Local Storage | `github:user:246009252:newcodebook` | Assigned |
| Cloud Platform | `github:user:246009252:newcodebook` | Assigned |
| Client Query / Client Connections | `github:user:246009252:newcodebook` | Assigned |
| Browser Host / Browser Security | `github:user:246009252:newcodebook` | Assigned |
| Connector Operations / Product | `github:user:246009252:newcodebook` | Assigned |
| Release Engineering | `github:user:246009252:newcodebook` | Assigned |

Owner 身份解析为 [GitHub `newcodebook`](https://github.com/newcodebook)，不可变 GitHub numeric ID 为 `246009252`。用户名变更时仍以 numeric ID 识别同一 Owner；账号所有权或组织责任变化时必须更新本表并重新审查尚未关闭的 Attestation。

## 4. Phase 0 Requirement 矩阵

环境缩写：`P`=Portable；`C`=Cloud transaction Fixture；`W`=Windows 11 24H2 x64；`MA`=macOS 15 arm64；`MI`=macOS 15 x64；`FP`=Fake Provider；`TP`=专用测试 Provider 账号与可丢弃资产。

| ID | Roadmap Requirement | Journey | Gate | Owner Role | 环境 | 证据命令/工件 | Fallback |
| --- | --- | --- | --- | --- | --- | --- | --- |
| P0-01 | Tauri/TS/Rust monorepo 与模块边界 | J-01/J-08 | R0-11/R0-15 | Engineering Baseline | P/W/MA/MI | 现有 `pnpm check`、`pnpm evidence:wp0`；native CI Manifest | 不创建业务 Command，保持骨架 |
| P0-02 | Admin/Public Composition Root 与接口复用 | J-08/J-10 | R0-09/R0-15 | Cloud Platform | P/C | 待建 `evidence:wp4`：独立 runtime/route/auth 集成包 | Admin Route 不注册 |
| P0-03 | protocol 子路径、TS/Rust 依赖边界 | J-01/J-03/J-05/J-08 | R0-10/R0-15 | Engineering Baseline | P | 现有根 `pnpm check` 编排 TS/Cloud/Rust Corpus 与 `test:structure` | 生产 Registry deny-all |
| P0-04 | `protocol/admin` 信任域限制 | J-08 | R0-15 | Architecture Enforcement | P | 现有 boundary policy 正负 Fixture | Admin 协议只留骨架 |
| P0-05 | Port DTO → Tauri Adapter → Rust Handler | J-01/J-05 | R0-01/R0-10/R0-15/R0-16 | Runtime Security | P/W/MA/MI | 现有根 `pnpm check`、RuntimeStatus 跨语言 Corpus、Command/Adapter 同集结构证据；native evidence 由 P0-06 的逐平台 `evidence:wp0 --profile native` 收集 | 只注册无参数、只读 `runtime_status`；其他业务 Command 不注册 |
| P0-06 | Windows/macOS 构建、签名流水线试验 | J-01/J-07 | R0-11 | Release Engineering | W/MA/MI | `evidence:wp0 --profile native`、签名/公证制品清单 | 标记单平台、不可发布 |
| P0-07 | SQLCipher 跨平台打包 | J-01/J-07 | R0-08/R0-16 | Local Storage/Recovery | W/MA/MI | `pnpm evidence:wp5 --slice sqlcipher` 的结构化明文/故障扫描包；`pnpm evidence:wp5:bundle` 的 opt-in Tauri `.app`/`.msi` Spike 与包内运行探针；两组三平台 Workflow | 只用临时 Fixture DB；默认桌面不链接 SQLCipher |
| P0-08 | OS Keychain/Credential Manager | J-01/J-05/J-07 | R0-03/R0-06/R0-12 | Secure Host | W/MA/MI | 待建 `evidence:wp1 --slice keychain`、Canary 扫描 | 禁止真实凭据流程 |
| P0-09 | Cloud Token Host-owned 注入与命名空间隔离 | J-01/J-05 | R0-03/R0-16 | Secure Host/Account Access | P/W/MA/MI | 待建 `evidence:wp1 --slice cloud-session` | 账号入口保持 Fixture |
| P0-10 | Secure HTTP Gateway | J-01/J-02/J-03 | R0-02/R0-03/R0-16 | Secure Host | P/W/MA/MI/FP | Endpoint Registry Corpus + 待建 native Transport 证据 | 生产 Registry deny-all |
| P0-11 | Spaceship 认证、分页、异步操作 | J-01/J-02 | R0-02/R0-13/R0-14 | Connector Operations | FP/TP | Connector Contract 包；TP Safety Envelope | Read-only/Fake/Manual |
| P0-12 | Cloudflare DNS 最小读写 | J-03 | R0-02/R0-13/R0-14 | Connector Operations | FP/TP | RRset Contract、前后证据、清理回执 | Fake Provider/Read-only |
| P0-13 | Atom Token 脱敏 | J-01/J-02/J-03 | R0-02/R0-03 | Secure Host/Connector | FP/W/MA/MI | Canary Secret 与 Query/URL/日志扫描 | Query Token Endpoint 禁用 |
| P0-14 | Afternic CSV Golden File | J-02/J-03 | R0-01/R0-14 | Connector Operations | P/FP | Connector Test Kit Golden File、公式注入 Corpus | 只生成本地人工文件 |
| P0-15 | 账号门禁、Auth/Entitlement 与设备原型 | J-01/J-05/J-06 | R0-06/R0-16 | Account Access/Devices | P/C/W/MA/MI | 现有 `pnpm evidence:wp2`（`account-gate` Portable/Cloud Fixture）与协议正负 Corpus；native/生产证据仍待建 | 账号入口保持 Fixture |
| P0-16 | DeviceSwitch、Bootstrap、Lease 与 Key 生命周期 | J-01/J-05/J-07 | R0-05/R0-06/R0-16 | Cloud Devices | P/C | Bootstrap/Recovery strict-step Corpus、并发事务包 | 不签发 Lease |
| P0-17 | Draining、正常/强制切换、24h 窗口 | J-05/J-07 | R0-05/R0-16 | Device Sync/Runtime Security | P/C | Three-stream Drain Golden Corpus 与事务故障注入 | 禁止正常 handoff |
| P0-18 | Standby Read-only、Reader Cursor、越权拒绝 | J-05 | R0-04/R0-06/R0-16 | Workspace/Devices | P/C | Active/Standby Query Contract、Mutation 拒绝包 | 只保留无写实现的 View |
| P0-19 | 消费级登录、Refresh 轮换、会话/设备管理 | J-01/J-06 | R0-06/R0-16 | Account Access | P/C/W/MA/MI | Auth Corpus、JTI/重放/轮换/恢复事务包 | 仅内部不可售账号 Fixture |
| P0-20 | Mutation/Revision/Cursor/重建/租户隔离 | J-01/J-02/J-05/J-07 | R0-04/R0-05 | Workspace/Recovery | P/C | Projection 属性测试、Checkpoint/Gap/Candidate CAS 包 | 只允许本地 Fixture |
| P0-21 | Workspace 表/Repository/Migration 所有权 | J-01/J-05/J-08 | R0-04/R0-09/R0-15 | Workspace/Cloud Platform | P/C | Schema ownership、双租户同 ID、Migration 顺序包 | Cloud 业务 Route 不注册 |
| P0-22 | Public/Admin Fastify 与 Jobs 分离 | J-08/J-09/J-10 | R0-09/R0-15 | Cloud Platform | P/C | `evidence:wp4` runtime isolation 与错误身份矩阵 | Admin/周期 Job 不注册 |
| P0-23 | Active/Standby Query Adapter 等价契约 | J-01/J-02/J-05 | R0-01/R0-04/R0-10/R0-16 | Client Query/Workspace | P/C | 待建共享 Query Contract Suite 与 digest Corpus | Standby 只展示固定 Fixture |
| P0-24 | CredentialBinding/credentialRef 泄漏测试 | J-01/J-03/J-05 | R0-03/R0-12/R0-16 | Secure Host/Client Connections | P/W/MA/MI | Canary 扫描 DOM/Heap/IPC/DB/WAL/日志/Crash | 禁止真实凭据 |
| P0-25 | 加密备份导出、校验、恢复 | J-07 | R0-08/R0-16 | Recovery | P/W/MA/MI | `evidence:wp5`、篡改/截断/换包/明文扫描 | 只开放 Cloud 重建 |
| P0-26 | Local/Remote WebView Capability 隔离 | J-01/J-03 | R0-07/R0-15/R0-16 | Browser Security | W/MA/MI | 待建 `evidence:wp3 --slice webview-isolation`：明确且不重叠的 WebView label、同 Window 禁止窗口级 Local Capability、Remote 主页面/iframe/弹窗/导航后全 Command 零权限负向矩阵 | 系统浏览器/Manual |
| P0-27 | 登录、暂停/接管、一次性授权原型 | J-01/J-03/J-04 | R0-07/R0-12 | Browser Host/Connections | W/MA/MI | 无副作用页面 Fixture、Consent/健康状态机包 | Manual 登录 |
| P0-28 | WebView2/WKWebView Profile/弹窗/下载/上传 | J-01/J-03 | R0-07/R0-11 | Browser Host/Release | W/MA/MI | 双引擎制品、Profile/导航/文件策略矩阵 | 未通过引擎保持 Disabled |
| P0-29 | Rust automation-host 双引擎封装 | J-01/J-03/J-04 | R0-07/R0-15 | Browser Host | W/MA/MI | AST/Selector/导航/回调负向 Corpus | 不注入 Recipe |
| P0-30 | Consent/Grant/Ticket 分层与防重放 | J-02/J-03/J-04 | R0-07/R0-16 | Browser Security/Secure Host | P/W/MA/MI | Ticket 根兑换、递增 Step、崩溃失效包 | Manual/System Browser |
| P0-31 | Tenant Job、Lease、幂等、Quarantine | J-06/J-08/J-09/J-10 | R0-09 | Cloud Platform | P/C | `evidence:wp4 --slice jobs`、跨租户/重放矩阵 | 周期 Job 不注册 |
| P0-32 | 平台 ToS/账户政策/自动化风险登记 | J-02/J-03/J-04/J-10 | R0-13 | Connector Operations/Product | P/TP | 每 Provider Policy Record、批准人和复核日期 | 未知 Manual，禁止则 Disabled |

## 5. 当前入口与下一动作

当前可重跑入口：

```text
pnpm check
pnpm evidence:wp0
pnpm evidence:wp2
pnpm evidence:wp5 --slice sqlcipher
pnpm evidence:wp5:bundle
node scripts/collect-wp0-evidence.mjs --profile quality
node scripts/collect-wp0-evidence.mjs --profile native
```

P0-05 的 Portable 实现已经完成：`client-core Port DTO -> Desktop Tauri Adapter -> Rust Command Handler` 最小链不含秘密和外部副作用，TypeScript/Rust 共享 Corpus、`AppManifest::commands`/`generate_handler!`/`#[tauri::command]`/逐命令 Permission/Adapter 同集、未声明命令拒绝和显式 Local WebView Capability 均进入根门禁。该切片只为 R0-01/R0-10/R0-15/R0-16 形成证据，不启用账号、平台或生产网络能力。

P0-15 已建立 `pnpm evidence:wp2`：它在 Ubuntu Portable/Cloud Fixture 环境运行 account/device/bootstrap/workspace 协议类型检查和全部正负向量、Cloud `identity/licensing/devices` Fixture、client-core RuntimeMode 只读投影及依赖边界检查，并生成关键输入 SHA-256 报告。报告失败关闭地确认这些模块没有注册生产 Route、没有 Lease 签发或 raw credential 字段且内部账号不可售。该入口不证明原生密码输入、OS Keychain、生产网络/Route、持久化 Cloud 事务并发完整性或 Windows/macOS 行为，也不关闭 R0-06/R0-16；账号入口、真实凭据和外部副作用继续保持 Fixture/禁用。

P0-20 已开始交付 Bootstrap 前置的最小 Workspace V1 契约：`protocol/workspace` 当前冻结 safe Revision、Checkpoint Descriptor、`domain_asset` 四字段的封闭 SyncMutation、字段隐私/合并元数据、连续 Mutation Page，以及页/实体摘要的域分离长度定界 Transcript。TS Corpus 覆盖未知/DEVICE_SECRET 字段、排序、重复、Safe Integer、跨 Workspace 与 Revision Gap。该切片尚不包含完整业务实体、Projection Repository、Cursor 持久化、Checkpoint 发布/压缩、Candidate CAS 或生产 Route，因此 P0-20/R0-04/R0-05 保持 In Progress，Fallback 仍是本地 Fixture。

P0-16 已在上述契约上交付 Bootstrap strict step DTO、request/result digest Transcript 与 Cloud Fixture-only 状态机，覆盖 Checkpoint pin、连续分页、服务端绑定 nonce、step number + workflow Revision CAS、相同呈交逐字节幂等、冲突重放拒绝和最终重建摘要校验。当前状态机明确不返回 ActiveDeviceLease且未注册生产 Route；真实 Capability 验签、持久化并发事务、取消/过期清理、Rust/客户端重建、Recovery 域和跨语言 Corpus 仍待完成，P0-16/R0-06/R0-16 保持 In Progress。

P0-06 的当前最终提交 compile-check 技术集合已在 `0253e71bd468c9fd1d8f99f735bea562eaac98d4` 完成：Quality Run `31781220581` 与 Native Run `31781220582` 均为 `success`。Native 三个 Manifest 均为 `passed`、`technicalEligibility.eligible=true`、`reasons=[]`，初末仓库状态都绑定同一干净稳定提交和精确 Job URL：Windows Server 2025 x64 Job `94708749801` / Artifact `9212269792` / digest `sha256:50ffdf3cc0ffb7dd22666e07d56e081bb2f9d59f673a15e087eb6bb16bcf446c`，macOS 15 arm64 Job `94708749799` / Artifact `9212359436` / digest `sha256:649b9e8018b5390e20e7273b93bec953f0d555a78339c098126ebc0fa93ad87d`，macOS 15 Intel Job `94708749738` / Artifact `9212429493` / digest `sha256:157ae5ad1a88b134447d770260fe603fa9f37a1b5f9cc29bf2058ec3dd6dda47`；当前 Artifact 约于 2026-11-12 到期。该集合不包含 Windows 11 24H2 真机打包、签名、公证、长期不可变归档或独立 Attestation，因此 R0-11 与 P0-06 仍保持 In Progress，不能声称可发布。

P0-07 已建立测试专用 SQLCipher 4.17.0/SQLite 3.53.3 Fixture 和 `evidence:wp5 --slice sqlcipher`。结构化报告失败关闭地验证 DB、WAL 与 rollback journal 无 Canary/SQLite 明文头，错误 Key、截断和篡改均拒绝，模拟进程在已提交 WAL 后退出可由正确 Key 恢复，并拒绝遗留未知临时文件。提交 `0f98a091a42fa9077c92414fc67756cadacbcc44` 的专用 Run `31088044992` 已取得 Windows Server 2025 x64 Artifact `8962898576`、macOS 15 Intel Artifact `8962521305`、macOS 15 arm64 Artifact `8962334154`；三份 Manifest 均为 `passed`、`technicalEligibility.eligible=true`，绑定干净稳定仓库、正确平台架构、精确 Job URL、固定运行时版本、七份文件 Hash/明文扫描和全部零退出码。

SQLCipher 的默认 feature 为空；普通桌面构建仍不链接它。只有 `sqlcipher-bundle-spike` feature 与独立 `tauri.bundle-spike.conf.json` 会把它链接进明确命名的可丢弃 Tauri release bundle。`pnpm evidence:wp5:bundle` 已在本机 macOS arm64 生成 `.app` 并从包内执行 SQLCipher 探针，验证临时 DB 加密、正确/错误 Key 和清理，同时记录 release executable、bundled executable 与 bundle tree SHA-256；dirty 本地结果只作诊断，不具技术资格。`wp5-sqlcipher-bundle` 三平台 CI 已在提交 `51b68c7967e59d4328306737e0a82d93153e5ff2` 的 Run `31682478022`（2026-08-13 完成，conclusion `success`）取得干净证据：Windows Server 2025 x64 Artifact `9174755555`（`.msi`，MSI administrative extraction 执行包内程序）、macOS 15 arm64 Artifact `9175612139`（`.app`）、macOS 15 x64 Artifact `9174478411`（`.app`）。三份 Manifest 均为 `passed`、`technicalEligibility.eligible=true`（`reasons: []`），绑定干净稳定仓库、匹配平台架构、精确 Job URL、固定工具链（node v24.18.1、pnpm 11.18.0、rustc/cargo 1.97.1）与 SQLCipher 4.17.0/SQLite 3.53.3；三平台探针 `databaseEncrypted`/`correctKeyReadable`/`wrongKeyRejected`/`temporaryDatabaseRemoved` 均为真。macOS 两个平台 `bundledExecutableMatchesReleaseExecutable=true`；Windows 该字段为 `false`（release exe SHA-256 `f665f7b3…21a1268` 对比 MSI 提取 exe SHA-256 `69ddba41…78f2df`，字节大小同为 14,616,576，差异原因本次未证实），须由独立 Security Review 裁决该差异是否可作为 Windows 平台的可接受 Gate 证据。三份 Artifact 均为 90 天保留期（2026-08-13 创建，约 2026-11-11 到期），关闭前必须整体提升为长期不可变归档。

上述三平台技术证据取得后，P0-07 的下一动作是完成剩余人工动作：Windows 11 24H2 真机安装/运行（当前 CI 只覆盖 Windows Server 2025，非真机）、release 制品签名/公证、在约 2026-11-11 保留期到期前把三份 Artifact 与 Manifest 提升为长期不可变归档、由未参与实现的 Security Reviewer 独立复核并裁决上述 Windows 可执行文件哈希差异、以及包含全部 `closureAttestationRequirements` 字段（含 `manifest_sha256`、`artifact_id`、`artifact_digest`、`run_url`、`job_url`、归档字段与 owner/review/approval 引用）的 GateClosureAttestation。Spike 不接 Keychain、真实数据、生产 Repository、业务 IPC 或网络，也不是签名/公证发布制品。完成这些条件前 P0-07、R0-08、R0-16 保持 In Progress，不进入 P0-08。
