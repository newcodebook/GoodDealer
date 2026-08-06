# GoodDealer Phase 0 执行计划

状态：Active / Gate-driven Delivery
更新日期：2026-08-06

## 1. 执行规则

本文件把 [ROADMAP.md](ROADMAP.md) 的 Phase 0 要求映射为可领取的交付项；Gate 的关闭条件和状态仍只以 [PHASE0_GATE_REGISTER.md](PHASE0_GATE_REGISTER.md) 为准。

- 每项进入实现前必须填写稳定的 `owner_ref`，并确认表中 Gate、Journey、环境、证据和 Fallback。角色名不是实际责任人身份。
- 一个交付项可以形成多个 Gate 的证据，但一份 GateClosureAttestation 只能关闭一个 Gate，且必须满足该 Gate 的全部 Required Reviewer 和 Approver 约束。
- `现有` 表示命令或证据生产器已在仓库中；`待建` 表示该交付项的第一部分就是建立对应生产器。待建命令不存在、失败或只产生 Fixture 证据时，相关 Gate 保持 Open/In Progress。
- 生产 Endpoint Registry、真实凭据、真实用户数据和真实外部写入继续默认禁止；只有对应 Gate 明确允许的专用环境可以解除该项 Fallback。
- 所有实现都必须通过根 `pnpm check`；原生或 Cloud 事务结论还必须通过表中专用 Profile，不能用 Portable 单元测试代替。
- 当前私有仓库套餐不提供 Branch Protection/Ruleset；日常变更仍使用 PR，Owner 按 PR 模板核对最终 Commit 的四个 CI Check。该人工软门禁不允许绕过 Gate-specific 独立 Reviewer、长期证据归档或 Attestation。

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
| P0-07 | SQLCipher 跨平台打包 | J-01/J-07 | R0-08/R0-16 | Local Storage/Recovery | W/MA/MI | 待建 `evidence:wp5 --slice sqlcipher`、明文/故障扫描包 | 只用临时 Fixture DB |
| P0-08 | OS Keychain/Credential Manager | J-01/J-05/J-07 | R0-03/R0-06/R0-12 | Secure Host | W/MA/MI | 待建 `evidence:wp1 --slice keychain`、Canary 扫描 | 禁止真实凭据流程 |
| P0-09 | Cloud Token Host-owned 注入与命名空间隔离 | J-01/J-05 | R0-03/R0-16 | Secure Host/Account Access | P/W/MA/MI | 待建 `evidence:wp1 --slice cloud-session` | 账号入口保持 Fixture |
| P0-10 | Secure HTTP Gateway | J-01/J-02/J-03 | R0-02/R0-03/R0-16 | Secure Host | P/W/MA/MI/FP | Endpoint Registry Corpus + 待建 native Transport 证据 | 生产 Registry deny-all |
| P0-11 | Spaceship 认证、分页、异步操作 | J-01/J-02 | R0-02/R0-13/R0-14 | Connector Operations | FP/TP | Connector Contract 包；TP Safety Envelope | Read-only/Fake/Manual |
| P0-12 | Cloudflare DNS 最小读写 | J-03 | R0-02/R0-13/R0-14 | Connector Operations | FP/TP | RRset Contract、前后证据、清理回执 | Fake Provider/Read-only |
| P0-13 | Atom Token 脱敏 | J-01/J-02/J-03 | R0-02/R0-03 | Secure Host/Connector | FP/W/MA/MI | Canary Secret 与 Query/URL/日志扫描 | Query Token Endpoint 禁用 |
| P0-14 | Afternic CSV Golden File | J-02/J-03 | R0-01/R0-14 | Connector Operations | P/FP | Connector Test Kit Golden File、公式注入 Corpus | 只生成本地人工文件 |
| P0-15 | 账号门禁、Auth/Entitlement 与设备原型 | J-01/J-05/J-06 | R0-06/R0-16 | Account Access/Devices | P/C/W/MA/MI | 待建 `evidence:wp2 --slice account-gate` | 账号入口保持 Fixture |
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
node scripts/collect-wp0-evidence.mjs --profile quality
node scripts/collect-wp0-evidence.mjs --profile native
```

P0-05 的 Portable 实现已经完成：`client-core Port DTO -> Desktop Tauri Adapter -> Rust Command Handler` 最小链不含秘密和外部副作用，TypeScript/Rust 共享 Corpus、`AppManifest::commands`/`generate_handler!`/`#[tauri::command]`/逐命令 Permission/Adapter 同集、未声明命令拒绝和显式 Local WebView Capability 均进入根门禁。该切片只为 R0-01/R0-10/R0-15/R0-16 形成证据，不启用账号、平台或生产网络能力。

P0-06 的 compile-check 技术集合已在提交 `901dfd44a1bb8c9d007bb16a1d9f3c143d70188a` 完成：Quality Run `31079370330` 与 Native Run `31079370262` 的 Linux x64、Windows Server 2025 x64、macOS 15 arm64/x64 四份 Manifest 均为 `passed` 且 `technicalEligibility.eligible=true`，绑定干净稳定的同一提交和精确 Job URL。该集合不包含 Windows 11 24H2 真机打包、签名、公证、长期不可变归档或独立 Attestation，因此 R0-11 与 P0-06 仍保持 In Progress，不能声称可发布。

当前下一动作进入 W1，按编号先执行 P0-07 SQLCipher 临时 Fixture DB 与跨平台打包证据；未通过 R0-08/R0-16 前不接真实业务数据、Keychain 或生产存储 Command。
