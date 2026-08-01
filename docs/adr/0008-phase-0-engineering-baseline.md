# ADR-0008：冻结 Phase 0 工具链、支持矩阵与契约验证基线

状态：Accepted

日期：2026-08-01

## 背景

Phase 0 审查中的 R0-10 与 R0-11 指出：目录和依赖方向虽然已经设计，但具体 Connector 注册边、跨语言兼容行为、工具版本、最低 OS、原生 CI 和制品责任尚未成为可执行事实。直接开始正式 IPC、连接器或安全 Host 实现会让生成方向、未知字段和平台支持范围被实现细节偶然决定。

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
- Host-owned Secret/Auth Response 保持 Rust 私有 Wire Contract，只把 opaque ref、fingerprint 或脱敏状态暴露给普通 TypeScript。
- 结构测试扫描 Package Manifest、TypeScript import 和 Rust 依赖，拒绝禁止边和泛化 HTTP/Shell 能力。

### CI 与发布责任

使用固定版本 Runner 标签，不使用会漂移的 `*-latest`。普通 PR 只执行无生产秘密的质量和原生编译门禁；签名、公证及生产证书只允许 Release Engineering 在受保护环境执行。环境 Manifest 作为可重现证据保存 30 天。

## 后果

- 工程初始化可以独立于业务协议推进，并通过机器检查维持模块边界。
- Node 26、Windows ARM64 和旧 macOS 开发环境可以用于探索，但其结果不构成发布证据。
- 扩大 OS/架构支持或改变契约生成方向必须更新本 ADR、工程基线、CI、结构测试和所有相关专题文档。
- R0-10/R0-11 只有在实现和 native CI 证据完成后才能关闭；本 ADR 本身不等于 Gate 已通过。
