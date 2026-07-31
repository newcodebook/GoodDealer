# 架构审查问题处理记录

首次记录：2026-07-30  
最近更新：2026-07-31

状态说明：

- Resolved：已形成默认技术决策并写入正式文档。
- Gate：必须由技术原型或跨引擎测试验证，失败则更换方案。
- Open：尚未形成正式产品或技术决策；新一轮用户旅程发现统一在 [USER_JOURNEYS.md](USER_JOURNEYS.md) 跟踪。

## 一、浏览器自动化

| 问题 | 处理 | 状态 |
| --- | --- | --- |
| 命令投递与回传 | 使用 `eval_with_callback`/初始化脚本、导航事件与窄 IPC；ActionReport 只算 Observation | Resolved |
| 页面伪造成功 | 引入 EXECUTED、OBSERVED、PAGE/API/USER_CONFIRMED 可信度；写操作不得以首次回传结束 | Resolved |
| 注入运行时篡改 | 一次性 Probe、无密钥、Nonce/Sequence、Origin/页面指纹、`outcome_unknown` 失败关闭 | Resolved |
| Cookie 落盘风险 | 明确依赖 OS 隔离的残余风险；默认持久会话，提供私密会话和忘记平台 | Resolved |
| 弹窗/SSO/下载 | `on_new_window` 子 Remote WebView、NavigationPolicy、`on_download` 私有目录和 Artifact | Resolved |
| 双引擎差异 | WebView2/WKWebView 的 Profile、注入、回调、OAuth、下载/上传作为 Phase 0 退出闸门 | Gate |

对应文档：[BROWSER_AUTOMATION.md](BROWSER_AUTOMATION.md)、[ADR-0002](adr/0002-isolated-browser-automation.md)。

## 二、同步与对账

| 问题 | 处理 | 状态 |
| --- | --- | --- |
| 冲突规则 | `base/local/remote` 字段级三方合并；按价格、状态、DNS、NS 定义默认规则 | Resolved |
| 读配额 | 每账户令牌桶、P0～P4 读优先级、保留令牌、增量/全量能力与退避 | Resolved |
| Webhook 矛盾 | 删除 `supportsWebhook`；改为 `pushMode: none/optional_relay`，首版固定 none | Resolved |

对应文档：[SYNC_SEMANTICS.md](SYNC_SEMANTICS.md)、[CONNECTORS.md](CONNECTORS.md)。

## 三、操作执行

| 问题 | 处理 | 状态 |
| --- | --- | --- |
| 优先级与抢占 | P0 资产保护至 P4 维护；只抢占未开始任务，原子外部请求不强杀 | Resolved |
| 任务依赖 | Workflow DAG、depends_on、run_if、资源锁和 Afternic Replace 账户互斥 | Resolved |
| 取消语义 | 为 queued/running/waiting_remote/waiting_dns/manual/succeeded 分别定义行为 | Resolved |

对应文档：[OPERATIONS.md](OPERATIONS.md)。

## 四、数据生命周期

| 问题 | 处理 | 状态 |
| --- | --- | --- |
| Keychain 丢失 | Master Key 使用 Keychain + Recovery Secret 双封装，并要求首次恢复演练 | Resolved |
| 域名身份 | DomainAsset、OwnershipEpisode、RegistrarBinding；转移、售出、失而复得独立建模 | Resolved |
| 同平台多账户 | ProviderConnection 一等实体，绑定 Account Alias、凭证、Profile、限流和队列 | Resolved |
| 快照/审计增长 | Hash 去重、日/周/月/年度降采样、诊断 30 天、Artifact 引用保护 | Resolved |
| Schema 迁移 | 迁移前加密快照、版本 Manifest、事务/两阶段迁移、失败恢复、禁止旧版写新 Schema | Resolved |

对应文档：[DATA_LIFECYCLE.md](DATA_LIFECYCLE.md)。

## 五、License

| 问题 | 处理 | 状态 |
| --- | --- | --- |
| 时钟回拨 | 服务端签名可信时间、本地单调时间与回拨检测 | Resolved |
| Token 刷新 | 刷新窗口、指数退避、撤销传导和 Lifetime 离线策略 | Resolved |
| 过期后的紧急下架 | 决定不设例外；过期且宽限结束后锁定主界面，续费后恢复，本地数据不删除 | Resolved |
| 账号登录门禁 | 新增账号系统；账号会话、设备绑定和 Entitlement 通过后才打开业务主界面 | Resolved |
| 终身大版本 | 终身 License 包含所有未来大版本 | Resolved |

对应文档：[LICENSING.md](LICENSING.md)、[OPEN_DECISIONS.md](OPEN_DECISIONS.md)。

## 六、产品与合规

| 问题 | 处理 | 状态 |
| --- | --- | --- |
| 平台 ToS | 保留逐平台评估和风险记录，但不设统一发布硬门槛；明确高风险流程逐项处置 | Resolved |
| 多设备一致性 | 2026-07-31 修订：每账号最多两台绑定、一次一台活动；域名业务数据强制云同步，平台凭据按设备本地保存 | Superseded by ADR-0004/0005 |
| UX 缺失 | 新增批量差异预览、冲突中心、人工任务收件箱和部分失败流程 | Resolved |
| 语言与市场 | P0 i18n，正式版中英文双语首发，ISO 4217 定点金额 | Resolved |

对应文档：[UX_FLOWS.md](UX_FLOWS.md)、[PRODUCT_REQUIREMENTS.md](PRODUCT_REQUIREMENTS.md)、[ROADMAP.md](ROADMAP.md)。

## 七、其他问题

| 问题 | 处理 | 状态 |
| --- | --- | --- |
| CSV 公式注入 | 人类查看型 CSV 转义危险前缀；平台模板限制用户字段 | Resolved |
| 单实例 | 同一数据目录单 Writer，第二实例转发后退出，Worker Lease 恢复 | Resolved |
| PostgreSQL 残留表述 | 已改为“SQLite/SQLCipher 本地数据库” | Resolved |
| 审计“不可变” | 改为“应用层只追加 + Hash/HMAC 完整性校验”，不做绝对承诺 | Resolved |

## 决策关闭汇总

六项产品决策已于 2026-07-30 全部确认：默认持久浏览器会话、License 过期无业务访问例外、账号登录门禁与最多两台设备、当时采用的手动备份迁移、终身授权覆盖所有大版本、正式版中英文双语首发，以及 ToS 评估不设统一硬门槛。其中手动备份作为主要多设备方案的决定已于 2026-07-31 被 ADR-0004 取代。

2026-07-31 后续修订：域名资产和非秘密业务数据改为强制同步到 GoodDealer 服务端且不做端到端加密；平台凭据保持设备本地；只提供本地加密备份文件导出/恢复；未来公开展示必须显式发布。详见 [ADR-0004](adr/0004-cloud-business-data-sync.md)。

正式记录见 [OPEN_DECISIONS.md](OPEN_DECISIONS.md)、[ACCOUNT_AND_SYNC.md](ACCOUNT_AND_SYNC.md) 与现行 [ADR-0004](adr/0004-cloud-business-data-sync.md)。

## 2026-07-31 单活动设备后续修订

在云同步方案基础上，进一步关闭以下设计问题：

| 问题 | 最终处理 | 状态 |
| --- | --- | --- |
| 云同步能否关闭 | 强制启用，不提供永久纯本地模式；停服时的 LocalContinuationMode 是独立 Sunset 机制 | Resolved |
| 并行设备风险 | 所有平台合计最多绑定两台，但一次只有一台 Active；另一台为 Standby | Resolved by ADR-0005 |
| 云故障绑架平台操作 | 活动设备获得最长 24 小时签名离线执行许可，到期后暂停新的平台读写 | Resolved |
| 设备切换 | 正常切换先暂停任务并上传 Outbox；强制切换等待旧许可到期后递增 Epoch | Resolved |
| 操作协调 | 移除逐 Operation 云端租约，改为 ActiveDeviceLease + Epoch + 本机签名 ApprovedOperation | Resolved |
| 双设备读配额 | 只有活动设备读取平台；切换时继承共享的非秘密限流摘要 | Resolved |
| 过期用户数据权利 | 客户端继续锁定；账号网页端保留服务端数据导出、删除和安全管理 | Resolved |
| 备份恢复回滚云端 | 备份先进入 Staging，云端为基线，差异成为 RestoreCandidate | Resolved |
| 旧设备未同步修改 | 旧 Epoch 可变修改成为 StaleDeviceCandidate，不直接写入当前 Workspace | Resolved |
| 终身授权停服风险 | 独立 Sunset Signing Key、本地延续版本或永久离线凭证、云端全量下载 | Resolved |
| GoodDealer 账号安全 | 消费级账号安全和可选 Passkey；不提供强制 2FA/TOTP | Resolved |
| 移动端设备额度 | 桌面与移动端共享“两台绑定、一台活动”的总额度 | Resolved |

本次修订由 [ADR-0005](adr/0005-single-active-device-and-continuity.md) 记录，并同步更新产品需求、架构、操作、同步、安全、数据生命周期、License、UX 和路线图。

## 2026-07-31 Standby 只读与旧 Epoch 事实分流修订

| 问题 | 最终处理 | 状态 |
| --- | --- | --- |
| 移动端与单活动设备冲突 | 将“单活动”明确为“单执行”；Standby 可使用 Cloud Read-Only View，但不能 Mutation、访问平台、批准或执行 | Resolved by D-011 / ADR-0005 |
| 移动端审批承诺 | Standby 仅审阅；正式批准和自动紧急下架必须切换 Active，RemoteApprovalToken 留作未来独立决策 | Resolved |
| 强制切换期间紧急处置 | 等待界面提供平台官网手工操作和域名清单，接管后按外部修改重新对账 | Resolved |
| 旧 Epoch 事实与意图混合 | Operation 结果和审计写入不可丢弃 LateExecutionEvent；可变修改才进入 StaleDeviceCandidate | Resolved |
| quotaScope 契约缺失 | ConnectorCapabilities 增加 rateLimit.quotaScope，并定义 credential/provider_account/provider_global/unknown | Resolved |
| 审查记录文件名 | 以 REVIEW_RESOLUTIONS.md 作为持续维护入口，旧日期文件保留兼容索引 | Resolved |

Phase 0 的账号、同步、ActiveDeviceLease 和双引擎浏览器验证范围保持不变；实施排期时按客户端安全边界、浏览器双引擎、账号/设备协调、云同步与恢复四条轨道拆分管理。

## 2026-07-31 同步时机与日志化同步修订

针对“非实时同步的设备间偏移”专题讨论，关闭以下设计问题：

| 问题 | 最终处理 | 状态 |
| --- | --- | --- |
| 同步时机未定义 | 新增“同步时机与触发器”：事件驱动上传（2～5 秒去抖批量）、阻塞型/尽力型两级强制冲刷点、上传优先级通道、不对称拉取策略 | Resolved |
| 未同步增量丢失窗口 | 冲刷节奏 + 活动设备常驻未同步计数；活动设备在上传前永久损失导致增量不可恢复列为已接受残余风险并进入威胁模型 | Resolved |
| 切换排空可信度 | 释放 Lease 时附带最后 `client_sequence`，服务端排空验收通过后才递增 Epoch | Resolved |
| Standby 数据新鲜度 | 只读视图双时间戳（云端数据截至时间/Revision + 最后平台读取时间）与活动设备未同步计数；Lease 续签搭载同步进度 | Resolved |
| 静默物化不一致 | 按实体类型的 Revision 摘要一致性校验（Anti-Entropy）：激活后强制、P4 周期执行，差异定向重拉并记录审计 | Resolved |
| Mutation Log 无界增长 | 服务端周期 Checkpoint + 压缩保留策略；重建 = 最近 Checkpoint + 后续 Mutation；压缩不越过最慢 Cursor 与未解决 Candidate | Resolved |
| 日志语义混用风险 | 明确三类追加式记录的分类与回放边界：SyncMutation 可回放，执行事实与审计不回放为状态 | Resolved |
| 激活 Schema 门禁 | 应用版本不支持 Workspace `schema_version` 时禁止激活并提示升级 | Resolved |
| Standby 缓存加密 | 只读缓存使用 SQLCipher 或等效静态加密，独立密钥存 OS Keychain | Resolved |
| 第二设备凭据预配置 | 设备绑定流程引导在 Active 期间预配置常用平台凭据，便于紧急接管 | Resolved |

设计原则汇总：本地事务落库是正确性来源，上传是异步传播而非一致性依赖；周期同步保证最终一致，事件驱动同步保证关键时刻；可阻塞的不可逆状态迁移（切换、Schema 迁移、备份创建）以冲刷成功为前置；回放负责重建、摘要负责校验、Checkpoint 负责让日志有限。

对应文档：[ACCOUNT_AND_SYNC.md](ACCOUNT_AND_SYNC.md) §6、[SYNC_SEMANTICS.md](SYNC_SEMANTICS.md) §9–10、[DATA_LIFECYCLE.md](DATA_LIFECYCLE.md) §8、[UX_FLOWS.md](UX_FLOWS.md)、[SECURITY.md](SECURITY.md)、[LICENSING.md](LICENSING.md)、[PRODUCT_REQUIREMENTS.md](PRODUCT_REQUIREMENTS.md)、[ROADMAP.md](ROADMAP.md)。

## 2026-07-31 工程结构复审

| 问题 | 最终处理 | 状态 |
| --- | --- | --- |
| 工程结构未固化 RuntimeMode | Locked/Standby/Activating/Active/Draining 成为 Rust runtime-gate 权威状态，预留 Sunset LocalContinuation | Resolved by ADR-0006 |
| mobile 空包提前创建 | Phase 0 不创建 `apps/mobile`；以宿主无关核心保证可复用，Phase 6 再建宿主 | Resolved |
| protocol 过度拆包 | 使用单个 `@gooddealer/protocol` + 子路径导出和 lint 边界，真实独立版本压力出现后再拆 | Resolved |
| account-web 无工程归属 | 新增独立 account-web，只依赖 cloud-client/protocol，不受客户端 License 门禁约束 | Resolved |
| Cloud 异步任务无入口 | 原决议建立 http/jobs；现由 ADR-0007 扩展为 Public HTTP/Admin HTTP/Jobs 三入口模块化单体 | Revised by ADR-0007 |
| Rust 浏览器宿主缺失 | 新增 automation-host，拥有 WebView/Profile/注入/IPC/导航/弹窗/下载策略 | Resolved |
| Checkpoint 与摘要无模块归属 | cloud/workspace/checkpoints 负责 Checkpoint、压缩水位和服务端一致性摘要；client-core/sync 负责 Anti-Entropy | Resolved |
| 排空验收跨模块耦合 | devices 通过 workspace/mutations 的公开 Drain Verification Port 核对 `client_sequence`，不直接读表 | Resolved |
| capability-gate 命名冲突 | 改名 runtime-gate，避免与 Tauri 声明式 Capability 混淆 | Resolved |
| Rust Crate 依赖未定义 | local-storage 与 automation-host 均依赖 secure-host-core；secure-host-core 不反向依赖 Tauri/Wry 或其他 Crate | Resolved |
| 公共 test-kit 杂物化 | 不创建泛化 packages/test-kit；Fixture 和 Helper 归属具体模块或命名明确的专用 test-kit | Resolved |

完整结构见 [ENGINEERING_STRUCTURE.md](ENGINEERING_STRUCTURE.md)，正式决策见 [ADR-0006](adr/0006-runtime-and-security-boundaries.md)。

## 2026-07-31 工程结构清晰化修订

针对“三套模块词汇未对齐”的清晰度复审，关闭以下问题：

| 问题 | 最终处理 | 状态 |
| --- | --- | --- |
| 领域模块与工程目录无映射 | ENGINEERING_STRUCTURE 新增“领域模块到工程归属”映射表；新增领域能力必须先登记归属 | Resolved |
| client-core 缺 Verification/Connections/Browser Automation 归属 | 补 `verification/`、`connections/`、`browser-automation/`（编排与 Grant）三个模块目录 | Resolved |
| 目录树与所有权说明分居两份文档 | 完整目录树移入 ENGINEERING_STRUCTURE 作为唯一事实源；ARCHITECTURE §9 只保留 RuntimeMode 表与三行摘要 | Resolved |
| §2 架构图沿用旧词汇 | Mermaid 节点标注工程名（client-core、secure-host-core、automation-host、apps/cloud 模块），Application/Domain Core 合并为 Client Core，补 account-web 节点 | Resolved |
| IPC 契约无归属 | 原决定把 IPC Schema 与 Port 混合，并误写为 src-tauri 实现 TypeScript Port | Superseded by implementation-level review below |
| cloud `src/db` 角色不明 | 仅连接池、事务基础设施与 Migration Runner；表、Migration、Repository 归各模块 | Resolved |
| desktop/src 无组织约定 | 按 `features/<capability>` 镜像 client-core 模块名，三层同名 | Resolved |

## 2026-07-31 工程边界实施级复审

本节修正并取代上一节中“IPC 契约无归属”的原表述，其余结论继续有效。

| 问题 | 最终处理 | 状态 |
| --- | --- | --- |
| TypeScript Port 被误写为由 Rust 实现 | client-core 拥有 Port 与 Port DTO；desktop TypeScript Tauri Adapter 实现 Port 和 IPC Envelope；src-tauri 实现 Rust Command Handler 与镜像校验 | Resolved |
| cloud-client 可能接触账号 Token | cloud-client 只处理不含原始 Token 的请求/响应；Desktop 经 Tauri Transport 调用 Rust secure-http，由 Host 注入 Token并独立解析登录/刷新响应，只返回脱敏 AuthSessionStatus；account-web 使用同源 HttpOnly/SameSite 会话 | Resolved |
| 本地持久化归属不完整 | 映射表新增“本地持久化”列；active-workspace 的 Repository/Schema 按 capability 归属，SQLite Migration 保持全局单一有序序列 | Resolved |
| Cloud 当前物化状态无 owner | 新增 workspace/state/&lt;capability&gt;，拥有业务表、Repository 与模块 Migration；mutations/read/checkpoints 只能通过公开 Port 访问 | Resolved |
| Cloud Migration 跨模块顺序 | Migration 按模块存放，但文件名使用全局 UTC 时间戳或等价序号排序，Runner 检测重复与依赖顺序 | Resolved |
| Verification 与平台对账被整体判为不同步 | 敏感挑战值仅本地；脱敏验证状态、三方基线和冲突分别进入 workspace/state/verification 与 workspace/state/platform-sync | Resolved |
| Operation 事实与 Audit 所有权重叠 | execution-ledger 只拥有 LateExecutionEvent，audit 只拥有 AuditEvent；审计时间线通过只读投影组合 | Resolved |
| 架构图绕过编排和适配层 | 调用链改为 client-core → Desktop Adapter/cloud-client → Tauri Handler → secure-host-core/local-storage/automation-host；自动化不再绕过 client-core | Resolved |
| Activating 双库语义冲突 | 允许 Standby Cache 只读挂载并在独立 Staging 构建 Active Workspace；禁止跨库写入，进入 Active 前关闭 Cache | Resolved |

## 2026-07-31 管理员后台与接口复用决议

| 问题 | 最终处理 | 状态 |
| --- | --- | --- |
| 缺少平台管理员后台 | 新增独立 admin-web、admin-http Composition Root 和 admin-access；不作为 account-web 隐藏路由 | Resolved by ADR-0007 |
| Staff 与用户会话混用风险 | StaffIdentity、Session、Passkey/企业 SSO、Role/Scope、Cookie、CSP 和 CSRF 独立；Public Session 不能访问 Admin API | Resolved |
| 管理员可能绕过模块边界 | Admin API 只调用显式 Admin Application Port；禁止直接 Repository、任意 SQL、创建用户 Mutation/ApprovedOperation 或代表用户访问平台 | Resolved |
| 管理员跨账号数据访问 | 最小 Scope、理由/工单标识、重新认证与 Staff AuditEvent；平台秘密和设备本地秘密始终不可见 | Resolved |
| Cloud HTTP 框架未定 | Public/Admin HTTP 首版统一使用 Fastify 的独立实例；Jobs 框架无关；没有边缘运行时需求前不采用 Hono 或双框架 | Resolved |
| 本地与 Cloud 相似接口能否复用 | 共享 protocol DTO/Schema/版本转换/确定性 Codec 与只读 Query Port；Local/Cloud Adapter 分开 | Resolved |
| 通用 CRUD 破坏运行时语义 | Repository、ORM、Migration、事务和写接口不共享；Active 先写本地+Outbox，Standby 没有写实现 | Resolved |
| Active/Standby 页面复用 | client-core 定义同一只读 Query Port，Composition Root 按 RuntimeMode 注入 Local 或 Cloud Adapter；返回 DataFreshness | Resolved |
| Admin 协议是否拆包 | 首版使用 protocol/admin 子路径并以 import-boundary 限制消费者；出现独立版本压力后再拆包 | Resolved |

正式决策见 [ADR-0007](adr/0007-admin-boundary-and-interface-reuse.md)，工程规则见 [ENGINEERING_STRUCTURE.md](ENGINEERING_STRUCTURE.md)。

## 2026-07-31 用户旅程审理机制

本轮不把新增建议直接写成 Resolved 决策，而是建立持续使用的 [用户旅程审理基线](USER_JOURNEYS.md)：

- 以首次使用、日常批量、DNS/验证、紧急下架、双设备/移动端、账号/License、恢复/升级、管理员、Support/合规和云端运营十条旅程覆盖主要角色。
- 每条旅程统一审查入口、RuntimeMode/Scope、数据新鲜度、完成证据、异常恢复、跨模块交接、安全合规和 E2E 验收。
- 使用 Journey Gate 区分“模块已存在”与“用户目标已端到端成立”。
- 将重复症状归并为 Bootstrap/Activation、设备身份、稳定选择与计划失效、批准到执行、Operation/Attempt、Verification、紧急 Incident、授权生命周期、恢复、案件管理和云端运营等 Open Finding。
- Open Finding 只有在产品确认、专题设计落档并补充验收后才转为 Resolved；本轮未改写既有 D-001～D-012 或 ADR 决策。

## 2026-07-31 单管理员与接口复用收尾修订

| 问题 | 最终处理 | 状态 |
| --- | --- | --- |
| SECURITY §7/§10 用户授权矛盾 | 按产品决策取消用户逐次授权：跨账号业务数据访问统一为 Scope + 理由/工单 + Staff AuditEvent；§7 与 §10 表述对齐 | Resolved by D-012 补充 |
| 多角色 Staff 与单人现实不符 | 首版仅一名管理员（Owner）+ 强制 Passkey；Role/Scope 结构保留、仅签发 Owner；多人审批改为重新认证 + 前后摘要 + 审计 | Resolved |
| canonical 规范化悬空 | 域名规范化与金额精度确认为第一天双端需求，抽入 protocol/workspace 命名能力模块；云端 Mutation 校验与一致性摘要消费同一实现 | Resolved |
| 合并策略两端漂移风险 | protocol 字段元数据新增 `mergeClass: auto/manual/safety_priority`；服务端合并与客户端对账单源消费，SYNC_SEMANTICS 默认策略表为其具体化 | Resolved |
| Zod/JSON Schema 双源风险 | Zod 为唯一契约事实源，Fastify Route 的 JSON Schema 构建期派生（fastify-type-provider-zod 或等价），禁止手写平行 Schema | Resolved |
| Jobs 调度器未定 | 采用基于 PostgreSQL 的任务队列（建议 pg-boss），延续不依赖 Redis 作为正确性来源的基线 | Resolved |
| 无版本基线 | 初始化 Git 仓库并提交全量文档基线 | Resolved |
