# ADR-0008：冻结 Phase 0 工具链、支持矩阵与契约验证基线

状态：Accepted

日期：2026-08-01

修订：2026-08-03（R0-10 证据范围与 Evidence Manifest）

## 背景

Phase 0 审查中的 R0-10 与 R0-11 指出：目录和依赖方向虽然已经设计，但具体 Connector 注册边、共享 Wire Envelope 兼容行为、工具版本、最低 OS、原生 CI 和制品责任尚未成为可执行事实。正式 typed IPC/Auth DTO、Adapter/Handler 接线与安全 Host 业务实现是后续独立证据边界，不能由通用 Corpus 的通过状态代替。

## 决策

### 工具链

采用 [Phase 0 工程基线](../PHASE0_ENGINEERING_BASELINE.md) 中的精确版本：Node 24 LTS、pnpm 11、Rust 1.97.1、TypeScript 7、Tauri 2.11、与 Tauri runtime 对齐的 Wry 0.55.1、SQLCipher 4.17 和 PostgreSQL 18.4。版本文件和 Lockfile 是构建输入，不依赖开发者机器上的隐式全局版本。

### 平台范围

首发支持 Windows 11 24H2 x86_64，以及 macOS 15 arm64/x86_64。Windows 使用 WebView2 Evergreen，并由安装器处理缺失 Runtime；macOS 使用系统 WKWebView。Windows ARM64、macOS 14 及更低版本不属于首发承诺。

macOS 15 同时存在 GitHub-hosted arm64 与 Intel GA Runner，可以让最低支持版本、架构承诺和 CI 证据保持一致。旧 macOS Runner 已进入弃用，因此不建立无法持续重跑的首发 Gate。

### 工程与契约

- 具体 Connector 只能由 `apps/desktop/src/composition-root.ts` 注册；其他 Desktop Feature、client-core、Cloud、account-web 和 admin-web 均不得导入。
- Cloud Workspace/Public/Admin Protocol 继续由 `packages/protocol` 的 Zod Schema 拥有。TypeScript、Cloud 和 Rust 使用同一组正负 Golden Corpus，明确 unknown/missing field、enum、版本和错误 Envelope 行为。
- Rust-owned 普通 Tauri IPC 只能单向生成或维护一份 Rust 镜像 DTO，并用同一 Corpus 验证；不得形成 TS↔Rust 双向生成环。
- Host-owned Secret/Auth Response 保持 Rust 私有 Wire Contract，只把 `credential_binding_id`、fingerprint 或脱敏状态暴露给普通 TypeScript；Keychain Ref 不离开 Host。
- 结构测试扫描 Package Manifest、TypeScript import 和 Rust 依赖，拒绝禁止边和泛化 HTTP/Shell 能力。

### CI 与发布责任

使用固定版本 Runner 标签，不使用会漂移的 `*-latest`。Workflow 在 PR、`main` Push 与人工触发时运行且不使用路径过滤；仅取消相同 PR 的过期运行，不取消 `main` 或人工证据运行。权限固定为 `contents: read` 与解析精确 Job URL 所需的 `actions: read`，Checkout 不持久化凭据，Action 引用固定到完整 Commit SHA。质量 Profile 执行 pnpm 与锁定版本 `cargo-audit` 的依赖漏洞门禁；Dependabot 每周检查 npm、Cargo 与 GitHub Actions 更新。当前私有仓库套餐不提供 Branch Protection、Ruleset 或 Secret Scanning，因此不把平台强制合并控制作为 Phase 0 前置；日常变更由 Owner 使用 PR 模板确认最终 Commit 的四个 CI Check，缺失、失败、取消或 Commit 不匹配均不得人工放行。普通 PR 只执行无生产秘密的质量和原生编译门禁；签名、公证及生产证书只允许 Release Engineering 在专用环境执行。每个 Job 失败关闭校验预期/实际平台，记录 Runner Image，并以 Run ID/Attempt 区分 Manifest 与日志传输制品，保留 90 天；Gate 关闭前必须把 Attestation `evidence_sets[]` 引用的逐字节相同证据包提升到覆盖 Gate 与项目审计期的长期不可变归档。软门禁不改变独立 Reviewer、Approver 或 GateClosureAttestation 的约束。

## 后果

- 工程初始化可以独立于业务协议推进，并通过机器检查维持模块边界。
- Node 26、Windows ARM64 和旧 macOS 开发环境可以用于探索，但其结果不构成发布证据。
- 扩大 OS/架构支持或改变契约生成方向必须更新本 ADR、工程基线、CI、结构测试和所有相关专题文档。
- Tauri 在 Windows 编译时派生的 `windows-schema.json` 不作为版本化构建输入；可移植 Capability 契约由版本化的 Desktop Schema、Capability、Permission 与结构门禁共同定义，Evidence Manifest 将该忽略规则本身纳入关键输入 Hash。
- R0-10 只在 TypeScript/Cloud/Rust 的共享 Wire Envelope Corpus 均被根可重跑门禁编排，并取得锁定工具链/native CI 证据后关闭；根 `pnpm check` 已显式调用 Cargo，Evidence Profile 则使用 `check:platform-neutral` 后按平台追加 Portable 或 Native Rust 门禁，防止跨 Profile 重复或扩大平台声明。Connector 唯一注册边及其防绕过属于 R0-15；R0-10 也不关闭 typed IPC/Auth DTO、Adapter/Handler 接线或业务 Command。R0-11 只有在完整支持矩阵的 native CI、Manifest 和制品证据完成后才能关闭。本 ADR 本身不等于任一 Gate 已通过。
