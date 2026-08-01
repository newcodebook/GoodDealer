# GoodDealer Phase 0 工程基线

状态：Active Baseline

更新日期：2026-08-01

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
| SQLCipher | 4.17.0（SQLite 3.53.3 基线） | ADR、后续 local-storage Spike lock |
| PostgreSQL | 18.4 | ADR、Cloud CI/开发容器 |

应用依赖禁止使用浮动的 `latest`、`*` 或未受 lockfile 约束的范围。版本升级必须在一个独立变更中同步更新版本文件、Lockfile、SBOM/Third-Party Notice、支持矩阵证据和相关上游 Commit。

## 2. 支持矩阵

| 平台 | 最低版本 | 架构 | 浏览器运行时 | Phase 0 证据 |
| --- | --- | --- | --- | --- |
| Windows | Windows 11 24H2 | x86_64 | WebView2 Evergreen；安装器检测并在缺失时使用 Microsoft Evergreen Bootstrapper | `windows-2025` native CI；专用 Windows 11 24H2 设备完成打包/WebView2 Gate |
| macOS | macOS 15 | arm64 | 系统 WKWebView | `macos-15` native CI；Apple Silicon 完整双 WebView Gate |
| macOS | macOS 15 | x86_64 | 系统 WKWebView | `macos-15-intel` native CI；Intel 完整双 WebView Gate |

Windows ARM64、macOS 14 及更低版本、Linux、iOS 和 Android 不属于首发支持范围。某一架构通过不能推断另一架构通过。

## 3. CI 与制品

- `quality` 在固定 Ubuntu 24.04 Runner 上执行 Lockfile 安装、TypeScript 类型检查、单元/契约测试、结构测试、Rust 格式检查，以及不依赖桌面 WebView 的安全核心/存储 Crate Clippy 与测试。
- `native` 在 `windows-2025`、`macos-15`、`macos-15-intel` 上执行同一质量门禁和 Desktop/Rust 原生检查。
- 每个 Job 生成环境证据 Manifest，记录 OS、架构、Node、pnpm、Rust、Cargo 和提交 SHA；CI 制品保留 30 天。
- Phase 0 普通 PR 不读取生产签名、Apple Notarization 或 Windows Code Signing 秘密。Release Engineering 负责受保护环境中的签名、公证、证书轮换和制品 Hash 登记。
- 当前工程骨架通过不等于打包 Gate 通过。签名/公证、SQLCipher、WebView2/WKWebView 与真实安装包证据仍按 Phase 0 Gate 台账验收。

## 4. 本地命令

```text
pnpm install --frozen-lockfile
pnpm check
pnpm evidence:wp0
cargo fmt --all --check
cargo clippy --workspace --all-targets -- -D warnings
cargo test --workspace --all-targets
```

本机版本与本基线不一致时可以阅读或编辑文档，但产生的构建结果不能作为 Gate 证据。
