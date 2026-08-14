# GoodDealer Phase 0 工程基线

状态：Active Baseline

更新日期：2026-08-03

## 1. 锁定版本

| 组件 | 版本 | 锁定位置 |
| --- | --- | --- |
| Node.js LTS | 24.18.1 | `.node-version`、`package.json#engines`、CI |
| pnpm | 11.18.0 | `package.json#packageManager`、CI |
| Rust | 1.97.1 + rustfmt + clippy | `rust-toolchain.toml`、CI |
| TypeScript | 7.0.2 | `package.json`、`pnpm-lock.yaml` |
| Vitest | 4.1.10 | `package.json`、`pnpm-lock.yaml` |
| React / React DOM | 19.2.8 | Desktop `package.json`、`pnpm-lock.yaml` |
| Vite | 8.2.0 | Desktop `package.json`、`pnpm-lock.yaml` |
| Zod | 4.4.3 | protocol `package.json`、`pnpm-lock.yaml` |
| Fastify | 5.11.0 | Cloud `package.json`、`pnpm-lock.yaml` |
| Tauri CLI / JS API | 2.11.4 / 2.11.1 | Desktop `package.json`、`pnpm-lock.yaml` |
| Tauri Rust / tauri-build | 2.11.5 / 2.6.3 | `Cargo.toml`、`Cargo.lock` |
| Wry | 0.55.1（与 Tauri 2.11.5 的 runtime-wry 对齐） | `Cargo.toml`、`Cargo.lock` |
| SQLCipher | 4.17.0（SQLite 3.53.3 基线） | `rusqlite` Git revision、`Cargo.lock`、local-storage Fixture Spike |
| PostgreSQL | 18.4 | ADR、Cloud CI/开发容器 |

应用依赖禁止使用浮动的 `latest`、`*` 或未受 lockfile 约束的范围。版本升级必须在一个独立变更中同步更新版本文件、Lockfile、SBOM/Third-Party Notice、支持矩阵证据和相关上游 Commit。

每个组件的版本声明只允许存在于上表"锁定位置"列出的文件；禁止在仓库中另建平行的版本声明文件（例如 `.nvmrc`、独立的版本常量或脚本内硬编码版本）。CI 与本地工具一律从锁定位置读取（Node 用 `.node-version`，pnpm 用 `package.json#packageManager` 经 Corepack，Rust 用 `rust-toolchain.toml`），新增锁定位置必须同步更新本表。

## 2. 支持矩阵

| 平台 | 最低版本 | 架构 | 浏览器运行时 | Phase 0 证据 |
| --- | --- | --- | --- | --- |
| Windows | Windows 11 24H2 | x86_64 | WebView2 Evergreen；安装器检测并在缺失时使用 Microsoft Evergreen Bootstrapper | `windows-server-2025-x64-compile`（runner: `windows-2025`）native compile-check；专用 Windows 11 24H2 设备完成打包/WebView2 Gate |
| macOS | macOS 15 | arm64 | 系统 WKWebView | `macos-15` native CI；Apple Silicon 完整双 WebView Gate |
| macOS | macOS 15 | x86_64 | 系统 WKWebView | `macos-15-intel` native CI；Intel 完整双 WebView Gate |

Windows ARM64、macOS 14 及更低版本、Linux、iOS 和 Android 不属于首发支持范围。某一架构通过不能推断另一架构通过。

## 3. CI 与制品

- `quality` 在固定 Ubuntu 24.04 Runner 上执行 Lockfile 安装、pnpm/Cargo 依赖漏洞检查、平台无关的生成物检查、TypeScript 类型检查、单元/契约测试、结构测试、Rust 格式检查，以及不依赖桌面 WebView 的安全核心/存储 Crate Clippy 与测试。`cargo-audit` 在 Workflow 中锁定精确版本；npm、Cargo 与 GitHub Actions 依赖由 Dependabot 每周提出独立升级 PR。
- `native` 在 `windows-2025`、`macos-15`、`macos-15-intel` 上执行 TypeScript/结构检查、Rust 格式检查、Desktop 前端 Build 和完整 Rust Workspace 的 Clippy/Test；它是 native compile-check Profile，不执行 Tauri release build、bundle、签名或公证，也不产生可发布应用制品。依赖漏洞门禁由同一提交的 `quality` Job 统一执行。
- 两个 Workflow 均支持 PR、`main` Push 和人工重跑，不使用路径过滤。相同 PR 的旧运行会被取消；`main` 与人工运行保留完整执行，避免 Gate 证据被后续 Push 静默中断。PR 明确检出 Head SHA，Push/人工运行检出触发 SHA，使 Manifest 直接绑定待评审最终提交而不是 GitHub 合成 Merge Commit。Workflow 仅授予 `contents: read` 与用于解析精确 Job URL 的 `actions: read`，Checkout 不持久化 GitHub 凭据；Action 引用必须固定到完整 Commit SHA。
- 开发阶段仓库临时公开以使用 GitHub Hosted Runner，正式运营前仍计划恢复为封闭项目。当前公开窗口未配置 Branch Protection 或 Ruleset；仓库恢复封闭后可用的平台治理能力还需按届时套餐重新确认。因此本项目不把平台强制合并控制作为 Phase 0 开工或日常合并的永久前置，也不声称四个 CI Check 当前受到平台强制。日常变更使用 PR，Owner 在合并前通过 PR 模板人工确认最终 Commit 的 `quality`、`windows-server-2025-x64-compile`、`macos-15-arm64`、`macos-15-intel` 均成功；失败、缺失、取消或对应其他 Commit 的运行不得视为通过。该软门禁只替代合并控制，不替代 Evidence Manifest、长期不可变归档、独立 Reviewer 或 GateClosureAttestation。
- 每个 Job 使用对应的 `quality` 或 `native` Profile 生成 WP-0 Evidence Manifest，记录预期/实际 OS 与架构、GitHub Runner Image 标识、工具版本、提交 SHA、工作区 dirty 状态与变更路径、关键输入文件 Hash、CI Job URL，以及每条验证命令的退出码和 stdout/stderr Hash；预期平台与 Node 实际平台不一致时失败关闭。Manifest 还固定声明 `tauriReleaseBuild/bundle/signedApplication/applicationArtifact=false`，防止把 compile-check 证据解释成发布制品。Artifact 名包含 Run ID 与 Attempt；命令日志和 Manifest 一并作为 CI 传输制品保留 90 天，Gate 关闭前另行提升到长期不可变归档。采集器在依赖安装前先生成预备 Manifest，验证失败时仍上传现有证据，不能把缺失证据解释为 Gate 通过。
- GitHub Runner 镜像偶尔包含相同固定版本的残缺 rustup 组件集合；Workflow 在临时 Runner 上先尝试卸载该版本，再以 `--force` 和明确的 minimal/rustfmt/clippy 组件集合重新安装，避免把镜像残留误当作项目回归。最终工具版本仍必须由 Manifest 探针证明为锁定值。
- Phase 0 普通 PR 不读取生产签名、Apple Notarization 或 Windows Code Signing 秘密。Release Engineering 负责受保护环境中的签名、公证、证书轮换和制品 Hash 登记。
- 当前工程骨架通过不等于打包 Gate 通过。签名/公证、SQLCipher、WebView2/WKWebView 与真实安装包证据仍按 Phase 0 Gate 台账验收。

## 4. 本地命令

```text
pnpm install --frozen-lockfile
pnpm evidence:wp0
pnpm evidence:wp2
pnpm evidence:wp5 --slice sqlcipher
pnpm evidence:wp5:bundle
```

`pnpm check:platform-neutral` 只编排生成物、TypeScript/Cloud/Package 测试与结构门禁；根 `pnpm check` 在其完整语义之外继续显式编排 Rust Workspace 测试。Evidence Profile 使用前者再按平台添加 Portable 或 Native Rust 门禁，避免 Ubuntu 意外承担桌面 Workspace 编译，也避免 Native 重复运行 Rust 测试。`pnpm evidence:wp0` 默认使用 `local` Profile：macOS/Windows 执行 Desktop Build 与完整 Rust Workspace Gate；Linux 不属于受支持桌面目标，因此只执行平台无关检查和 `gooddealer-secure-host-core`、`gooddealer-local-storage` 两个可移植 Crate 的 Clippy/Test。需要复现 CI 语义时可直接执行 `node scripts/collect-wp0-evidence.mjs --profile quality` 或 `--profile native`。Evidence Manifest 写入 `.artifacts/wp0/evidence.json`，记录责任角色、Evidence Producer、命令证据和精确仓库输入摘要。dirty 本地运行可保留诊断结果但 `technicalEligibility.eligible=false`；CI 还要求前后 clean、输入摘要一致、Runner 平台匹配且精确 CI Job URL 可解析，否则整体失败。技术 `passed` 或 `technicalEligibility.eligible=true` 不能替代独立 GateClosureAttestation；每份 Attestation 只绑定一个 `gate_id`，以结构化 owner/reviews[]/approval 覆盖该 Gate-specific 全部角色，并用 `evidence_sets[]` 为每个必需 Job 分别引用最终 Manifest SHA-256、CI Artifact ID/digest/run/job URL 和逐字节相同证据包的长期不可变归档。多 Gate 必须分别生成 Attestation。Workflow 90 天 Artifact 仅用于传输，不能充当项目审计期归档。

Evidence Collector 在 Windows 通过 `cmd.exe /d /s /c` 启动 pnpm shim，并在 Desktop Build 成功产出 `frontendDist` 后才执行完整 Rust Workspace Gate。dirty 判定直接取自 staged/unstaged 原始 diff 与 untracked 路径集合，任一材料无法采集时状态为 unknown 并失败关闭；对应内容 Hash 继续作为完整输入稳定性证据。生成注册表由 `.gitattributes` 强制 LF，保证 Windows/macOS 逐字节检查一致。Tauri 按 Windows 宿主派生的 `windows-schema.json` 不属于仓库输入；Capability 的可移植契约以受版本控制的 `desktop-schema.json`、Capability JSON、Permission TOML 和结构门禁为准。

`pnpm evidence:wp2` 复用同一 provenance、仓库稳定性和精确 CI Job URL 语义，写入 `.artifacts/wp2/account-gate`。它只验证 account/device 协议正负 Corpus、Cloud `identity/licensing/devices` 内部不可售 Fixture、client-core RuntimeMode 只读投影和依赖边界，并记录关键输入 SHA-256；报告还失败关闭地检查责任模块未注册生产 Route、未声明 raw credential 字段且 Fixture 账号不可售。该切片不接密码输入、Keychain、生产 Route、外部网络、真实凭据或用户数据，也不证明 Cloud 事务并发、Windows/macOS 原生行为或 R0-06/R0-16 Gate 关闭。

`pnpm evidence:wp5 --slice sqlcipher` 复用同一 provenance、仓库稳定性和 GateClosureAttestation 语义，但写入 `.artifacts/wp5/sqlcipher`，且只以 release 模式编译/运行 `gooddealer-local-storage` 的测试专用 SQLCipher Fixture。报告固定核对 SQLCipher 4.17.0 community 与 SQLite 3.53.3，记录每个扫描文件的大小和 SHA-256，扫描数据库、WAL、rollback journal、崩溃恢复文件及故障副本，并验证错误 Key、截断、篡改、崩溃重开和未知临时文件路径。`wp5-sqlcipher` Workflow 在 Windows Server 2025 x64、macOS 15 arm64 和 macOS 15 x64 生成独立 90 天传输 Artifact。该切片显式声明不是 Tauri release build/bundle、签名应用、生产存储或用户数据；通过它不能替代安装包、长期归档、独立审查或 R0-08/R0-16 Attestation。

`pnpm evidence:wp5:bundle` 是与默认桌面隔离的第二切片。`gooddealer-local-storage` 和桌面 Crate 的 default feature 均为空；只有显式 `sqlcipher-bundle-spike` feature 才启用 optional `rusqlite`/SQLCipher 链接，且只与独立 `tauri.bundle-spike.conf.json` 配合。切片执行 feature Clippy/Test、Tauri release build、macOS `.app` 或 Windows `.msi` bundle，并从 `.app` 内或 MSI administrative extraction 内实际运行被打包程序；运行时只创建随机命名的临时 DB，固定核验 SQLCipher/SQLite 版本、磁盘无 Canary/SQLite 明文头、正确 Key 可读、错误 Key 拒绝和清理，再记录 release executable、bundled executable 与 bundle 的大小/SHA-256。`wp5-sqlcipher-bundle` 在 Windows Server 2025 x64、macOS 15 arm64/x64 上传证据和 bundle；它无签名身份，不接生产 Repository、Keychain、IPC、网络或用户数据。该证据仍不能替代 Windows 11 24H2 实际安装、签名/公证、长期不可变归档、独立 Security Review 或 GateClosureAttestation。

本机版本与本基线不一致时可以阅读或编辑文档，但产生的构建结果不能作为 Gate 证据。
