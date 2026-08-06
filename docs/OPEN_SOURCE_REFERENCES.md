# GoodDealer 开源实现参考登记表

状态：Living Reference

首次核验日期：2026-08-01

当前状态复核日期：2026-08-06

## 1. 目的与权威性

本文选择性登记用于 GoodDealer 协议/Fixture/语义迁移、技术 Spike、安全关键实现依据、测试设计和产品体验对照的开源项目；它不是全部依赖清单。所有直接/传递构建依赖由 Lockfile、SBOM、许可证清单和漏洞 Gate 穷举管理。

本文是**实现参考索引，不是规范事实源**：

- 产品、安全、同步、操作和工程约束仍以对应专题文档、ADR 与已关闭 Decision 为准。
- 上游项目的默认行为不得覆盖 GoodDealer 的 RuntimeMode、单 Active 设备、秘密仅本地、批准、租户隔离、结果未知和恢复边界。
- 引入依赖、移植代码或 Fixture 前必须固定上游版本/Commit，记录许可证、来源文件、局部修改、威胁模型与退出方案。
- GitHub Star、Commit 数和维护活跃度只用于说明 2026-08-01 的调研依据，不构成长期选型承诺；正式采用时必须重新核验。

专题文档中的“开源实现参考”小节定义该模块允许借鉴什么、禁止照搬什么；本表负责跨模块检索、许可证提示和 Phase 0 Finding 映射。

## 2. 使用级别

| 级别 | 含义 | 实现要求 |
| --- | --- | --- |
| A：依赖候选 | 可进入 Spike，并在安全、许可证和打包验证通过后成为直接依赖 | 锁版本、生成 SBOM、保留许可证与升级策略 |
| B：语义/Fixture 迁移 | 迁移协议语义、接口形状、测试向量或 Fixture，不继承上游运行时 | 记录来源 Commit；按 GoodDealer 边界重写执行路径 |
| C：对照 Spike | 用相同验收用例比较可行性、复杂度和退出成本 | Spike 可丢弃；通过 Gate 前不得冻结正式契约 |
| D：设计/测试参考 | 只借鉴状态机、失败模型、SDK 组织或 UX | 不直接复制实现；转化为本项目测试或 ADR |
| X：禁止默认嵌入 | 许可证、部署形态或安全模型与首版不匹配 | 未经法律/安全/架构审查不得复制或链接代码 |

### 2.1 当前采用状态

“使用级别”表示允许如何评估或借鉴，不表示已经采用。当前实现状态只使用以下分类：

| 状态 | 当前项目含义 | 当前条目 |
| --- | --- | --- |
| Adopted | 已进入受 Lockfile 约束的构建输入，仍须通过对应 Gate | Tauri 2.11.5、Wry 0.55.1；P0-07 测试专用 SQLCipher 4.17.0/SQLite 3.53.3 与 rusqlite 0.40.1（上游 revision `62648175c23f84b45238f4a1fbb0133b75ce68f1`） |
| Baseline Selected | 版本/方向已由 Accepted ADR 或工程基线选定，但生产依赖和完整原生证据尚未接入 | SQLCipher 生产 Repository/Tauri release bundle 接线方向；P0-07 dev-only Fixture 与 `wp5-sqlcipher` 证据生产器不等于生产采用或 Gate 通过 |
| Candidate | 允许进入 Spike，尚不能作为当前架构已实现事实 | 本表除上述 Adopted/Baseline Selected 与 Reference Only/Prohibited 条目外的 A/C 候选 |
| Reference Only | 仅迁移语义、Fixture、测试场景或 UX，不进入运行时依赖 | B/D 条目，除非后续 ADR 明确升级 |
| Prohibited by Default | 当前许可证或部署/安全模型不允许默认引入 | 所有含 X 的条目 |

实现者判断“当前是否已采用”时必须先看本节，再核对 `Cargo.lock`/`pnpm-lock.yaml` 和对应 Gate Evidence；A 级本身不等于 Adopted。新增或移除直接依赖时必须同步更新本节，不能只改专题末尾的参考表。

## 3. 连接器、DNS 与 HTTP 契约

| 项目 | 核验信号与许可证 | 使用级别 | GoodDealer 可借鉴内容 | 禁止照搬/必须补齐 |
| --- | --- | --- | --- | --- |
| [go-acme/lego](https://github.com/go-acme/lego) | 约 9.8k★、200+ DNS Provider，MIT | B | `providers/dns/spaceship` 的 Base URL、Header、DTO、Zone 发现、TXT Present/Cleanup、传播参数、错误与 Fixture | 普通 Go HTTP Client；凭据、Allowlist、脱敏和网络执行必须进入 Rust Secure Host |
| [libdns/libdns](https://github.com/libdns/libdns) | 80+ Provider，MIT | B | 小而可组合的 RecordGetter/Appender/Setter/Deleter/ZoneLister Port | 需补条件写、RRset Hash、资源锁、审计、同步分类和执行门禁 |
| [kubernetes-sigs/external-dns](https://github.com/kubernetes-sigs/external-dns) | 约 9.1k★、5,000+ commits，Apache-2.0 | B/D | Desired Records → Plan → Provider、dry-run、所有权标记、Fake Provider、Provider 生命周期 | Kubernetes Controller 运行形态；所有权 TXT 只能作为语义参考，不能擅自增加远端记录 |
| [DNSControl/dnscontrol](https://github.com/DNSControl/dnscontrol) | 约 3.9k★、约 64 个 Provider，MIT | B/D | 规范化 IR、Preview/Push、Provider 集成测试矩阵 | 整区声明可能删除未声明记录；不得用于 GoodDealer 增量 TXT/RRset 写入 |
| [smithy-lang/smithy](https://github.com/smithy-lang/smithy) | 约 2.3k★、3,000+ commits，Apache-2.0 | D | `@http`、`@readonly`、`@idempotent`、`@sensitive` 等操作级 Trait；模型校验与生成思路 | 不在 Phase 0 引入完整 Java/Smithy 工具链替换既定 Zod 事实源；只迁移到 EndpointManifest 语义 |
| [airbytehq/airbyte](https://github.com/airbytehq/airbyte) | 600+ Connector，Elastic License 2.0 | D/X | Spec/Check/Discover/Read、Registry、兼容等级和 Connector CI | ELv2 代码不得默认迁入商业闭源产品；其读取模型不覆盖批准和外部写结果未知 |
| [meltano/sdk](https://github.com/meltano/sdk) | 生产使用多年，Apache-2.0 | D | Connector 脚手架、标准消息、状态 Cursor、Fixture/E2E | Singer 面向数据抽取/加载，不定义外部副作用、批准和逐操作重试安全 |

连接器的规范性边界见 [CONNECTORS.md](CONNECTORS.md)，DNS 验证的 RRset 安全规则见 [VERIFICATION.md](VERIFICATION.md)。

## 4. Tauri、浏览器隔离与 Recipe

| 项目 | 核验信号与许可证 | 使用级别 | GoodDealer 可借鉴内容 | 禁止照搬/必须补齐 |
| --- | --- | --- | --- | --- |
| [tauri-apps/tauri](https://github.com/tauri-apps/tauri) | 本次对照 Commit `0aeadb6b2674ecd43f15b5dd6fcace3232f74b8a`；约 110k★，MIT/Apache-2.0 | A/B | Capability、Permission、Allow/Deny Scope、`AppManifest::commands`、按 Window/WebView 限定 IPC、Single Instance、Updater | 静态 ACL 不替代 RuntimeMode、ActiveDeviceLease、ApprovedOperation 和一次性 Ticket；自定义 Command 必须进入 AppManifest/Handler/Permission 三集合；窗口级 Capability 会覆盖窗口内全部 WebView |
| [tauri-apps/wry](https://github.com/tauri-apps/wry) | 约 4.9k★，MIT/Apache-2.0 | A/C | WKWebView/WebView2 统一底座、Navigation/New Window/Download/IPC/Initialization Script、WebContext/Profile | 平台能力不对称；首发 Windows 11 24H2 x86_64、macOS 15 arm64/x86_64 必须分别以原生矩阵验证隔离 |
| [tauri-apps/plugins-workspace](https://github.com/tauri-apps/plugins-workspace) | 本次对照 Commit `f8053e659e4ccd85c1f52833411ff8417cbc5e69`；官方插件仓库，MIT/Apache-2.0 | A/C | 插件 Command/Permission 生成、Stronghold、Single Instance、Updater 等插件的打包和权限模型 | `store:default` 会开放全部 KV 操作，SQL 默认仍把查询交给 Guest；不向普通 WebView 开放 Stronghold vault key、业务 SQL、通用 HTTP/Shell 或高权限 Updater Command |
| [mountain-loop/yaak](https://github.com/mountain-loop/yaak) | 本次对照 Commit `784a3d3a324f9a657d032cdf75db624047df5bf1`；MIT | D | 无 Tauri/shared crates 分层、`ts-rs` 边界、SQLite Immediate Transaction、迁移与同步冲突测试 | 不复制返回 Workspace Key 的 Command、APPDATA/Clipboard/Shell/Open 广权限、通用 HTTP 或 Node/WebSocket 运行时插件边界 |
| [gitbutlerapp/gitbutler](https://github.com/gitbutlerapp/gitbutler) | 本次对照 Commit `e52b631574b093fffc0af1499cbd865d76c30748`；FSL-1.1-MIT | D/X | 多宿主 `but-api` 边界、窄依赖、事务/锁竞争测试、领域 import fitness rule、显式 Legacy 分类 | 当前版本为 source-available 且限制竞争性使用；不复制代码，不照搬 `windows:["*"]` 和广泛 FS/Process/Shell/Store/Updater Capability，也不照搬 Crate 数量 |
| [puppeteer/replay](https://github.com/puppeteer/replay) | 约 1.4k★、600+ commits，Apache-2.0 | B/D | JSON User Flow、Step/Selector/Timeout Schema、Canonical Fixture、Runner Extension 测试 | 不引入任意脚本生成、字符串化执行或开放 Extension；GoodDealer Recipe 只允许 Host 复验的 opcode |
| [theupdateframework/python-tuf](https://github.com/theupdateframework/python-tuf) | 约 1.7k★、6,000+ commits，MIT/Apache-2.0 | D | Root/Targets/Snapshot/Timestamp、过期、阈值签名、密钥轮换和 Anti-Rollback | TUF 是发布元数据模型，不是 AutomationExecutionTicket；不得把远程 Recipe 签名等同于本机执行授权 |
| [awslabs/tough](https://github.com/awslabs/tough) | Rust TUF 实现，MIT/Apache-2.0 | A/C | Rust 侧 TUF 仓库读取/生成与签名元数据验证 | 采用前验证维护状态、格式兼容和包体；Ticket 仍使用独立域分离签名/MAC |
| [ebarti/JobCtrl](https://github.com/ebarti/JobCtrl) | 本地 SQLite、审计自动化，AGPL-3.0-only | D/X | 批准绑定精确制品、最终提交 fail-closed、Review Queue、人工接管、Privacy Release Gate | 生态规模较小且 AGPL；不复制代码，不采用其 Temporal/Node/Python 桌面部署组合 |

规范性授权、Recipe 和双引擎 Gate 见 [BROWSER_AUTOMATION.md](BROWSER_AUTOMATION.md)。

## 5. 本地秘密、数据库与账号身份

| 项目 | 核验信号与许可证 | 使用级别 | GoodDealer 可借鉴内容 | 禁止照搬/必须补齐 |
| --- | --- | --- | --- | --- |
| [open-source-cooperative/keyring-rs](https://github.com/open-source-cooperative/keyring-rs) | 约 761★、700 commits，MIT/Apache-2.0 | A | macOS/Windows/*nix 原生秘密存储统一接口、平台测试和 Heap 泄漏测试 | Keychain 只保存小型解锁材料、设备私钥和 Token，不作为业务数据库或通用 KV |
| [sqlcipher/sqlcipher](https://github.com/sqlcipher/sqlcipher) | 约 7.2k★，BSD-3-Clause | A | SQLite 文件级 AES 加密、兼容 SQLite 的数据库能力 | 不保护运行时内存、日志、WAL 误配置或错误 Projection；必须配合 Keychain 和秘密测试 |
| [rusqlite/rusqlite](https://github.com/rusqlite/rusqlite) | 约 4.3k★、2,900+ commits，MIT | A | Rust SQLite 访问、`sqlcipher`/`bundled-sqlcipher` 构建特性 | 不通过 Tauri SQL Guest API 暴露业务库；Repository 留在 `local-storage` Crate |
| [iotaledger/stronghold.rs](https://github.com/iotaledger/stronghold.rs) | 约 660★、安全审计，Apache-2.0 | C | 加密 Vault、秘密生命周期、内存与快照保护 | Tauri Guest 示例会让 vault key 进入 JS；若采用必须由 Rust Host 包装，普通 TypeScript 只返回 `credential_binding_id`/fingerprint/脱敏状态，Keychain Ref 不离开 Host |
| [MasterKale/SimpleWebAuthn](https://github.com/MasterKale/SimpleWebAuthn) | 约 2.3k★、2,500+ commits，MIT | A/C | Account Web 的 Passkey 注册、认证和重新认证 Ceremony | 不负责设备签名私钥、Device PoP、轮换、撤销、ActiveDeviceLease 或离线执行协议 |
| [better-auth/better-auth](https://github.com/better-auth/better-auth) | 约 29k★、快速演进，MIT | C | Session、Passkey、2FA、Organization 等账号层 Adapter 对照 | 快速变化，未通过迁移/撤销/安全 Spike 前不锁定为身份事实源 |

规范性秘密、设备和账号边界见 [SECURITY.md](SECURITY.md) 与 [ACCOUNT_AND_SYNC.md](ACCOUNT_AND_SYNC.md)。

## 6. 云同步、持久任务与租户 Job

| 项目 | 核验信号与许可证 | 使用级别 | GoodDealer 可借鉴内容 | 禁止照搬/必须补齐 |
| --- | --- | --- | --- | --- |
| [livestorejs/livestore](https://github.com/livestorejs/livestore) | 约 3.7k★，Apache-2.0 | C/D | Reactive SQLite、事件 Schema、Materializer、确定性重建、跨平台 Adapter | 通用多写者同步不等价于单 Active、Lease Epoch、三类日志和秘密 Projection |
| [powersync-ja/powersync-js](https://github.com/powersync-ja/powersync-js) | 约 701★，Apache-2.0 | C/D | SQLite 上传队列、Streaming Bucket、Reactive Query、诊断工具 | 服务端授权与部署边界不同；不能替代 Drain Manifest、LateExecutionEvent 和 Active Lease |
| [temporalio/temporal](https://github.com/temporalio/temporal) | 约 22k★，MIT | D/X | Workflow/Activity 分离、持久历史、Timer、取消、重试、版本演进和测试场景 | 不在桌面端嵌入 Temporal Server；只迁移 operations conformance 语义 |
| [timgit/pg-boss](https://github.com/timgit/pg-boss) | 约 3.8k★、1,600+ commits，MIT | A | PostgreSQL 事务内入队、SKIP LOCKED、优先级、Retry、DLQ、Cron 和依赖工作流 | Queue 的 exactly-once claim 不代表平台副作用 exactly-once；TenantContext 必须由 GoodDealer Envelope 强制 |

规范性同步与执行语义见 [SYNC_SEMANTICS.md](SYNC_SEMANTICS.md)、[OPERATIONS.md](OPERATIONS.md) 和 [ENGINEERING_STRUCTURE.md](ENGINEERING_STRUCTURE.md)。

## 7. 备份、恢复与文件加密

| 项目 | 核验信号与许可证 | 使用级别 | GoodDealer 可借鉴内容 | 禁止照搬/必须补齐 |
| --- | --- | --- | --- | --- |
| [FiloSottile/age](https://github.com/FiloSottile/age) | 约 23k★，BSD-3-Clause | B/D | 稳定文件格式、recipient/passphrase、流式加密和互操作测试 | Go 实现不是桌面 Rust 依赖；文件加密不定义 Backup Export Schema 或恢复语义 |
| [str4d/rage](https://github.com/str4d/rage) | 约 3.6k★、1,500+ commits，MIT/Apache-2.0 | A/C | age 格式的 Rust Library、passphrase/recipient 与流式读写 | 采用前冻结 Crypto Profile；不得直接加密完整 Active DB/WAL 作为最终备份 |
| [rclone/rclone](https://github.com/rclone/rclone) | 约 59k★，MIT | D | 加密配置分层、远端存储适配和完整性操作经验 | GoodDealer 首版不集成远程备份，不迁移 rclone 配置格式或凭据模型 |

规范性 Backup Content Manifest、Staging 和 RestoreCandidate 语义见 [DATA_LIFECYCLE.md](DATA_LIFECYCLE.md)。

## 8. 跨语言契约与生成工具

| 项目 | 核验信号与许可证 | 使用级别 | GoodDealer 可借鉴内容 | 禁止照搬/必须补齐 |
| --- | --- | --- | --- | --- |
| [Aleph-Alpha/ts-rs](https://github.com/Aleph-Alpha/ts-rs) | 约 1.9k★，MIT | A/C | Rust-owned DTO 到 TypeScript 声明、Serde 兼容和导出测试 | 只适合 Rust-owned IPC；Cloud Workspace Protocol 仍由既定 Zod 事实源拥有 |
| [GREsau/schemars](https://github.com/GREsau/schemars) | 约 1.4k★，MIT | A/C | Rust 类型生成 JSON Schema、Serde 兼容 | 不能单独证明 TS/Rust 行为一致；仍需正负 Golden Corpus 和版本协商测试 |
| [specta-rs/specta](https://github.com/specta-rs/specta) | 约 621★，MIT | C | 多语言类型导出、函数类型和 Rust 生态集成 | 未经稳定性验证不替换 protocol 构建链 |
| [specta-rs/tauri-specta](https://github.com/specta-rs/tauri-specta) | 约 768★，MIT；v2 为 RC 路线 | C | 类型安全 Tauri Command/Event 绑定 | RC 不进入 Phase 0 固定基线；不得导出 Host-owned Secret Response 私有 Wire Contract |
| [1Password/typeshare](https://github.com/1Password/typeshare) | 约 3k★，MIT/Apache-2.0 | C/D | Rust 到 TypeScript/Swift/Kotlin/Go/Python 类型共享 | 首版只需 Rust/TypeScript；多语言能力不足以证明值得增加工具链 |

规范性生成方向、未知字段、版本策略和导入边界见 [ENGINEERING_STRUCTURE.md](ENGINEERING_STRUCTURE.md)。

## 9. 商业授权与产品体验对照

| 项目 | 核验信号与许可证 | 使用级别 | GoodDealer 可借鉴内容 | 禁止照搬/必须补齐 |
| --- | --- | --- | --- | --- |
| [keygen-sh/keygen-api](https://github.com/keygen-sh/keygen-api) | 约 1.5k★、5,500+ commits，FCL-1.0-ALv2 | D/X | License/Policy/Machine/Fingerprint、设备激活、Proof、Entitlement 和离线许可的领域词汇/测试组织 | 当前版本是带竞业限制的 Fair Source；每个版本两年后才转 Apache-2.0，未经法律审查不得复制或部署 |
| [domainmod/domainmod](https://github.com/domainmod/domainmod) | 约 594★、2,300+ commits，GPL-3.0 | D/X | 域名资产字段、筛选、报表、批量操作和任务 UX | 中心化 Web 与凭据存储模型不符合 GoodDealer；GPL 代码不得默认迁入闭源产品 |
| [ebarti/JobCtrl](https://github.com/ebarti/JobCtrl) | 约 119★，AGPL-3.0-only | D/X | Review Queue、批准绑定精确制品、人工接管和审计 UX | 只作新鲜设计参考，不复制代码或部署其服务组件 |

商业授权的规范性语义见 [LICENSING.md](LICENSING.md)，产品 UX 决策仍以 [UX_FLOWS.md](UX_FLOWS.md) 为准。

## 10. Phase 0 Finding 路由

| Finding | 首要参考 | 应形成的本项目证据 |
| --- | --- | --- |
| R0-02 Secure HTTP | lego Spaceship、Smithy、Tauri Capability | EndpointManifest 生成物；URL/重定向/DNS/IP/跨 credentialRef 负向测试 |
| R0-03 Host-owned Secret | keyring-rs、SQLCipher/rusqlite、Stronghold | Canary Secret 对 DOM、TS Heap、IPC、DB/WAL、日志、Crash、Outbox、Cloud 的扫描 |
| R0-04 Sync Projection | LiveStore Materializer、Schemars/Golden Corpus | 只允许封闭 Projection；未知字段和 DEVICE_SECRET 失败关闭 |
| R0-05 Outbox Drain | PowerSync 上传队列、Temporal 历史语义 | 乱序、缺口、重复、跨流 Drain Manifest 测试，不采用单一最大序号证明排空 |
| R0-06 设备身份 | SimpleWebAuthn 重新认证、keyring-rs、Keygen 领域测试 | Nonce + 设备私钥 PoP、轮换、撤销、强类型 Envelope 与重放矩阵 |
| R0-07 Recipe/Ticket | Puppeteer Replay、TUF/tough、Wry | 受限 AST、Host 二次校验、根 Ticket 兑换、递增单步 Capability 和崩溃失效测试 |
| R0-08 备份投影 | age/rage | 白名单 Export Schema、版本化 Crypto Profile、篡改/截断/崩溃/磁盘明文测试 |
| R0-09 Tenant Job | pg-boss | 可信 TenantJobEnvelope、逐租户 Fan-out、连接池/对象 Key/重放负向矩阵 |
| R0-10 共享 Wire Corpus | ts-rs、Schemars、Specta、Typeshare、Smithy | TypeScript/Cloud Corpus 已可重跑，Rust 镜像仍需纳入根门禁并取得锁定工具链证据；Connector 注册边归 R0-15，typed IPC/Auth DTO 和 Adapter/Handler 接线另行验收 |
| R0-11 工具链/OS | Tauri/Wry、SQLCipher/rusqlite | Windows/macOS 原生矩阵、最低版本、WebView/Profile、签名/公证与可复现打包证据 |
| R0-12 设备凭据 | keyring-rs | 首配、切回、撤销、Keychain 丢失和 Browser Session 过期五场景 |
| R0-13 Live Write Safety | ExternalDNS dry-run、JobCtrl 批准/Review UX | 专用测试资产、显式批准、前后证据、清理和紧急停用记录 |
| R0-14 逐操作重试 | Smithy Trait、Temporal Activity 语义、lego Provider 测试 | `safe/provider_idempotency_key/confirm_before_retry/never` 混合等级 Contract Test |
| R0-15 信任域依赖执行 | 无可替代本项目策略的上游；可借鉴 Tauri Capability 与语言模块图工具 | deny-by-default 路径×子路径/依赖/能力矩阵、真实静态注册、计算型动态 import 与 Tauri/Rust 越权负向测试 |
| R0-16 RuntimeMode 命令准入 | 无可替代本项目状态机的上游；可借鉴 Tauri Command/Capability 测试组织 | Host-owned 状态、逐命令资源准入、消费点 Epoch/时间复验、Active/Standby Query Contract 与零资源负向矩阵 |

R0-01～R0-14 的原始证据和初始关闭条件见 [PHASE0_READINESS_REVIEW_2026-08-01.md](PHASE0_READINESS_REVIEW_2026-08-01.md)；R0-15/R0-16 的来源和失败路径只见当前 Gate 台账。当前状态、范围和可重跑证据的唯一入口是 [PHASE0_GATE_REGISTER.md](PHASE0_GATE_REGISTER.md)。

## 11. 引入检查清单

任何实现 PR 若使用本表来源，至少回答：

1. 使用级别是 A/B/C/D/X 中哪一类？是否改变规范契约？
2. 上游 Repository、版本/Commit、来源文件和许可证是什么？
3. 采用的是代码、依赖、Fixture、协议语义、测试场景还是 UX？
4. 上游默认行为与 GoodDealer 安全边界有哪些冲突，代码在哪里失败关闭？
5. 是否进入 Desktop/Cloud 制品、SBOM、Third-Party Notice 或再分发包？
6. 是否有替换 Adapter、数据迁移和回退方案？
7. 哪个 Contract/Integration/E2E 测试证明它满足本项目语义，而不仅是上游测试通过？

GPL-3.0、AGPL-3.0、Elastic License 2.0 和 Fair Core License 来源默认只允许 D/X 级参考。例外必须先完成法律审查并形成 ADR；不得通过复制少量代码、改写文件名或只保留 Fixture 来规避许可证义务。
