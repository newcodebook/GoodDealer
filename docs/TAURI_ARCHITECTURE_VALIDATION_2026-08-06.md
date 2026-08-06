# GoodDealer Tauri 架构对照验证

状态：Architecture Review Artifact
验证日期：2026-08-06

## 1. 验证问题与结论

本次验证只回答一个问题：GoodDealer 已接受的架构是否与成熟 Tauri 项目的生产实践和 Tauri 2 的真实安全机制一致。它不提出替代架构，也不把参考项目的目录或实现移植为 GoodDealer 规范。

结论为 **Conditionally Validated**：现有总体架构科学合理，不需要重构或扩张。运行时/信任域拆分、薄 Tauri Adapter、Rust Secure Host、编译期连接器、模块化单体、Desired/Observed 分离、Transactional Outbox 和持久任务方向均成立。参考源码同时确认两项必须在首次生产 Command 和 Remote WebView 接线前补入硬门禁的 Tauri 细节：

1. 所有自定义 Tauri Command 必须进入 `tauri_build::AppManifest::commands`，由逐命令 Permission 显式授予；仅注册 `invoke_handler` 不构成最小权限。
2. Local App 与 Remote Browser 必须按明确 WebView label 分配 Capability；窗口级 Capability 会覆盖匹配窗口内的全部 WebView，不能用于承载不可信 Remote WebView 的同一窗口。

当前构建只注册 P0-05 的只读 `runtime_status` app Command；其 AppManifest、Handler、逐命令 Permission 与 TypeScript Adapter 集合由结构门禁强制一致，且 Handler 只读取 Host-owned `RuntimeGate`，不接收秘密、运行时权限或副作用参数。当前仍没有生产业务 Command 或 Remote Browser WebView，因此 AV-02 和后续业务 Command 的 AV-01 要求仍是接线前约束，不是当前可利用漏洞。

## 2. 固定参考版本

| 项目 | 本地来源 | 固定 Commit | 许可证/用途边界 |
| --- | --- | --- | --- |
| Tauri | `.ref/tauri` | `0aeadb6b2674ecd43f15b5dd6fcace3232f74b8a` | MIT/Apache-2.0；框架行为与 ACL 事实源 |
| Tauri plugins-workspace | `.ref/plugins-workspace` | `f8053e659e4ccd85c1f52833411ff8417cbc5e69` | MIT/Apache-2.0；插件 Command/Permission 组织参考 |
| Yaak | `.ref/yaak` | `784a3d3a324f9a657d032cdf75db624047df5bf1` | MIT；工程拆分、SQLite/同步和 API 客户端对照 |
| GitButler | `.ref/gitbutler` | `e52b631574b093fffc0af1499cbd865d76c30748` | FSL-1.1-MIT；只作设计/测试参考，不复制到商业产品 |

参考 Commit 只固定本次结论的可复查输入，不使其成为 GoodDealer 构建依赖。未来采用代码或依赖仍按 [开源实现参考登记表](OPEN_SOURCE_REFERENCES.md) 重新核验。

关键源码证据入口：

- Tauri：`crates/tauri-build/src/acl.rs` 的 `AppManifest` 与权限生成、`crates/tauri/src/webview/mod.rs` 的本地/远程 Invoke ACL 分支、`crates/tests/acl` 的 Capability 解析快照。
- plugins-workspace：`shared/template/build.rs` 的 Command Permission 生成、`plugins/store/permissions/default.toml`、`plugins/sql/permissions/default.toml`。
- Yaak：根 `Cargo.toml` 的 shared/Tauri crate 分层、`crates-tauri/yaak-app-client/capabilities/default.json`、`src/commands.rs`、`crates/yaak-sync/src/sync.rs`、`crates/yaak-models/src/query_manager.rs`。
- GitButler：根 `Cargo.toml` 的 Crate 成熟度/Legacy 分类、`crates/AGENTS.md` 的 API/窄依赖规则、`crates/gitbutler-tauri/capabilities/main.json`、`crates/but-db` 的事务与锁竞争测试。

## 3. 验证准则

一个设计点只有同时满足以下条件，才标记为“已验证”：

- 必要性可追溯到当前产品约束或威胁模型，而不是未来想象。
- 边界能由编译、ACL、运行时类型、事务或自动测试执行，而不只依赖团队自律。
- 失败模式可被正负用例证伪，并有 Gate/Fallback。
- 引入的复杂度与隔离、恢复或可替换收益相称。
- 上游行为与 GoodDealer 的秘密仅本地、单 Active、批准和结果未知语义没有被混同。

“参考项目没有实现”不等于 GoodDealer 设计错误；涉及 GoodDealer 独有商业规则时，结论必须依赖本项目威胁模型和可重跑证据。

## 4. 逐项验证结果

| 设计点 | 上游源码观察 | GoodDealer 判断 | 状态 |
| --- | --- | --- | --- |
| 按运行时/信任域拆 App、Package、Crate | Yaak 明确分开无 Tauri 的 shared crates 与 `crates-tauri`；GitButler 用 `but-api` 服务多个宿主，并要求底层接收窄依赖 | `client-core`、Connector、Tauri Adapter、Secure Host、Local Storage 的方向一致，且安全边界更清楚 | 已验证 |
| `src-tauri` 保持组合层 | GitButler/Yaak 都有专用 Tauri crate，但 Yaak 的 Tauri `lib.rs` 已承载大量请求、数据库和插件编排，显示该层容易膨胀 | GoodDealer 把业务规则留在 client-core/Rust crates、Handler 只做 DTO 与组装，是合理的预防性边界 | 已验证，需结构门禁 |
| TypeScript/Rust 类型化 IPC | Yaak 使用 `ts-rs`；GitButler 把传输 DTO 留在 API 边界并转为领域类型 | Zod + Rust strict serde + 共享正负 Corpus 比直接暴露内部类型更符合 GoodDealer 安全模型 | 已验证，真实 Command 证据待补 |
| Tauri 自定义 Command ACL | Tauri 只有在 `AppManifest::commands` 生成 app Permission 后，Capability 才能对自定义 Command 做逐命令授权；普通 `invoke_handler` 注册不是该清单的替代品 | 现有文档此前只要求“最小 Command”，缺少 Manifest/Capability/Handler 三集合一致性约束 | 必须修正，R0-15/R0-16 |
| Local/Remote WebView 隔离 | Tauri Capability 的 `windows` 匹配会把权限授予该窗口内全部 WebView；多个 Capability 的权限会合并 | Remote Browser 必须使用独立 WebView label 且不匹配 Local Capability；弹窗子 WebView同样保持零高权限 IPC | 必须修正，R0-07/R0-15 |
| 秘密只由 Host 拥有 | Yaak 存在向前端返回 Workspace Key 的 `cmd_reveal_workspace_key`，证明通用应用的便利接口不适合 GoodDealer 威胁模型 | 原生秘密输入、Host-owned response extractor、TypeScript 只见脱敏状态的设计必要且更严格 | 已验证 |
| EndpointManifest + Secure HTTP | Yaak 作为 API 客户端允许用户定义 URL、证书、代理和请求；GitButler 各 Provider 直接拥有 HTTP Client，均不满足 GoodDealer 的平台凭据隔离 | 编译期 Endpoint Registry、封闭字段、DNS/IP/Redirect/Response 上限和延迟取密是产品所需，不是无依据的复杂化 | 已验证，native Transport 证据待补 |
| 编译期连接器而非运行时插件 | Yaak 的 Node sidecar + WebSocket 插件运行时适合可扩展 API 客户端，但扩大进程、脚本、网络和供应链边界 | 首版连接器编译进客户端、只经稳定 SDK 和 Host 请求 Port 是更合适的选择 | 已验证 |
| 多持久化域 | GitButler 分开业务 DB 与 Cache，并对事务、WAL、迁移和锁竞争做专门测试；Yaak 对迁移和写事务使用 Immediate Transaction | Active、Standby、LocalContinuation、evidence-spool 的授权语义和恢复规则确实不同，物理分库分钥有充分理由 | 条件验证，R0-16 |
| RuntimeMode + 资源准入 | 参考项目没有 GoodDealer 的单 Active/Standby/Sunset 业务规则，不能直接证明状态机 | Host-owned 模式、消费点 Epoch/可信时间复验和零资源拒绝逻辑内部一致；粗粒度 `ReadWrite` 不能替代 capability-specific Handle | 条件验证，R0-16 |
| Desired/Observed、Outbox、Cursor 和冲突 | Yaak 的 DB/文件同步维护 SyncState、Checksum、Cursor 和冲突分支；但没有 GoodDealer 的 Cloud Revision/单 Active 模型 | 分离用户意图、平台观察和 GoodDealer Revision 是避免错误覆盖的必要模型；三条日志不能被简化成单一最大序号 | 条件验证，R0-04/R0-05 |
| 持久 Operation/DAG/结果未知 | GitButler 的 transaction/oplog 强调成功后才发布恢复点；参考项目没有覆盖跨平台外部副作用 | 持久任务、逐项结果、批准、资源锁、重试分类和 `outcome_unknown` 是不可事务化外部写入的正确处理 | 条件验证，R0-13/R0-14 |
| Desktop/Cloud 模块化单体 | 四个参考仓库主要验证桌面工程，不能直接验证 GoodDealer Cloud 租户/设备设计 | 当前规模采用模块化单体并以 Port/Repository 所有权隔离，比微服务更低风险；Cloud 结论仍由本项目 R0-09 证明 | 内部合理，外部参考不充分 |

## 5. 参考项目中明确不应照搬的做法

### GitButler

- 当前主 Capability 对 `windows: ["*"]` 授予较宽的 core、filesystem、process、shell、store 和 updater 权限，适合其自身信任模型，不适合 Remote WebView 与秘密边界更严格的 GoodDealer。
- Workspace 同时包含新旧两代 Crate，并在根清单中显式标注 Legacy/Needs Work；这证明成熟项目也会积累迁移成本，不能用其 Crate 数量衡量架构成熟度。
- FSL-1.1-MIT 不是当前版本可无条件用于竞争性商业产品的 OSI 开源许可。

### Yaak

- `cmd_reveal_workspace_key` 会把密钥返回 WebView；GoodDealer 禁止该接口形态。
- 默认 Capability 包含 APPDATA 文件读取、Shell/Open、剪贴板等广泛能力；不能作为 GoodDealer 最小权限模板。
- Node 插件 Sidecar 和本地 WebSocket 带来额外运行时与供应链边界；GoodDealer 首版连接器不需要该扩展性。
- Yaak 的通用 HTTP 客户端必须支持用户自定义目标、证书和代理，这与 GoodDealer 固定平台 Endpoint 的安全目标不同。

### Tauri 官方插件

- `store:default` 默认开放全部 KV 操作；不能存放 GoodDealer 业务状态或秘密。
- SQL 插件即使默认只开放查询，也把数据库连接和查询能力交给 Guest；GoodDealer 业务 SQL 应继续留在 `local-storage` Rust crate。
- 官方 Permission/Scope 是静态准入，不验证 ActiveDeviceLease、RuntimeMode、批准、资源所有权或消费点 Epoch。

## 6. 必须落实的验证约束

### AV-01：自定义 Command 三集合一致

首次注册任何生产 Command 前，构建和测试必须证明以下集合完全一致：

```text
tauri_build::AppManifest::commands
= tauri::generate_handler! 注册集合
= Capability 中显式允许的 app Command 集合
```

每个 Command 还必须在 Handler 内从 Host-owned `RuntimeGate` 取得资源限定 Context；静态 ACL 不能替代运行时准入。未知、未声明或只注册在其中一个集合的 Command 必须让构建/结构测试失败。

### AV-02：WebView label 与 Capability 不合并

- Local App Capability 使用明确的 Local WebView label，不使用 `*`。
- Remote Browser 及其弹窗子 WebView 使用不同 label，并且不匹配任何 Local App 高权限 Capability。
- 若 Local 与 Remote 位于同一 Window，不得通过 `windows` 字段授予 Local 权限，必须改用 `webviews` 精确匹配。
- Remote Origin 不配置 Tauri Remote API Access；专用 Wry 回报桥只能接收封闭 Observation DTO。
- Packaged E2E 必须从 Remote 主页面、iframe、弹窗和导航后页面分别尝试调用全部 app/plugin Command，并证明零高权限访问。

### AV-03：多存储域以 Handle 而非枚举作为最终边界

`storage_access(mode, kind) -> ReadOnly/ReadWrite` 只能作为第一层分类。Composition Root 必须按 RuntimeMode 构造不可互换的、能力限定的 Repository/Handle；下层不能接收通用数据库连接后自行选择表。Mode、Epoch 或可信时间在 Handle 创建后变化时，副作用消费点仍需重新验证并返回零资源拒绝。

## 7. 最终判定

没有发现要求替换 Tauri、改成 Electron、引入微服务、引入运行时插件系统、合并 TypeScript/Rust 核心，或重新划分现有顶层模块的证据。

本次验证后的准确结论是：

- **总体架构：通过。**
- **分层与信任域：通过。**
- **Secure Host 与连接器方向：通过。**
- **Tauri ACL：设计方向通过，但 AV-01/AV-02 必须在接线前关闭。**
- **多存储域、RuntimeMode、Cloud Sync、持久任务：逻辑成立，但只能在对应 Gate 证据完成后从“条件验证”升级为“已验证”。**
- **无需新增更宏大的架构。**

后续实现应优先关闭现有 Gate，不再把“参考项目更成熟”作为增加层级、包或运行时的理由。
