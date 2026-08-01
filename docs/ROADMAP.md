# GoodDealer 开发路线图

状态：Draft  
更新日期：2026-08-01

## 全阶段 Journey Gate

Roadmap 的 Phase 退出条件除功能和技术原型外，还必须通过 [用户旅程审理基线](USER_JOURNEYS.md) 定义的 Journey Gate。模块、页面或 API 已完成，不等于对应用户目标已能端到端完成。

| Phase | 重点 Journey | Finding/Gate 边界 |
| --- | --- | --- |
| Phase 0 | J-01 Bootstrap/Activation 骨架；J-03 自动化批准链；J-05 设备切换；J-08 管理入口隔离 | JF-02、JF-04、JF-07、JF-15；JF-01 只做最小幂等原型，不展开完整 Onboarding |
| Phase 1 | J-01 首次连接与导入；J-02 只读资产；J-05 Standby/重建；J-07 备份/迁移 | JF-01、JF-03、JF-08、JF-12 的备份内容部分；外部 Alpha 前关闭 JF-18/JD-11 |
| Phase 2 | J-02 批量计划、批准、执行和崩溃恢复；J-03 浏览器写入安全 | JF-05、JF-06；JF-17 的签名/兼容/撤销最小发布链必须在首个正式网页写连接器前完成 |
| Phase 3 | J-03 所有权验证；J-04 紧急下架 | JF-09、JF-10；JD-01 在承诺紧急能力前确认 |
| Phase 4 | J-06 商业授权；J-08 Owner 后台；J-09 Support/合规/安全；J-10 生产运营 | JF-11、JF-13、JF-14、JF-16、JF-17、JF-18 完整运营；JD-03/05/06/09/11 |
| Phase 5 | J-02/J-03 新连接器一致性；J-10 连接器扩展 | 复用已建立的 Connector/Recipe Lifecycle，不在此阶段才补首次安全发布链 |
| Phase 6 | J-05 移动端 Standby、切换、凭据准备和 Active 能力 | D-011 保持 Standby 只审阅；RemoteApprovalToken 另立决策 |

每个 Phase 开始前应确认本阶段 Journey 范围、责任人和 `Decision Required`；退出前不得遗留影响该阶段交付的 J0，并至少通过 Happy Path、权限拒绝、中断恢复和结果未知四类 E2E 场景。未确认的旅程审查建议仍保持 Open Finding，不得由实现者自行视为产品决策。

## 交付容量与范围预算

Phase 是证据边界，不要求所有能力同时成熟。单个 Gate 阻塞时，使用 Gate 台账中的 Fallback 隔离该能力，不能把未关闭风险扩散成全局停工，也不能为了形成演示绕过安全边界。

| 可观察里程碑 | 允许范围 | 不得冒充的状态 |
| --- | --- | --- |
| Phase 0 Contract Alpha | Fixture、Fake Provider、无副作用页面和本地/CI 负向矩阵；生产 Registry deny-all | 不代表真实凭据、真实平台网络、Cloud 并发事务或外部写入可用 |
| 内部 Read-only Alpha | 只开放已通过平台 Transport、Host-owned Secret、设备身份、Sync Projection 和租户隔离 Gate 的只读连接；未通过的 Provider 保持 Manual/Disabled | 不承诺浏览器写入、批量副作用、紧急自动下架或商业可用性 |
| 首个可售 Desktop 版本 | Phase 1～4 对应 Journey、生产运营和商业 Gate 已关闭；每个连接器能力按独立证据启用 | 单个未通过的连接器或执行模式不得由全局 Feature Flag 扩权 |
| 扩展版本 | Phase 5/6 的新连接器、公开展示、移动端与可选自动化能力 | 不得在扩展阶段才补 Secure Host、Recipe 发布或生产运营的首次安全链 |

任何对首个可售范围的缩减都必须保留以下不变量：平台秘密只在设备、业务数据按产品承诺同步到 Cloud、账号/License 门禁、最多两台绑定且单 Active、Cloud Desired State 不能直接产生平台副作用、生产网络能力由编译期 Registry 授权、Public/Admin/Jobs 信任域隔离。可以按 Gate 延后某个 Provider、写 Endpoint、浏览器自动化模式、移动端、公开展示、多 Staff 与多区部署；不能把这些延后项对应的失败关闭规则删除。

## Phase 0：技术验证

目标：验证安全边界和五类连接器执行模式。

- 按 ADR-0006 初始化 Tauri 2 + TypeScript monorepo、Rust Crate 和模块边界；不创建 mobile 空应用。
- 按 ADR-0007 固化 admin-web、Public/Admin API 独立 Composition Root 与本地/Cloud 接口复用边界。
- 建立 protocol 子路径导出、TypeScript/Rust 依赖边界测试和禁止 Cloud 引入连接器的结构检查。
- 建立 `protocol/admin` 导入限制，禁止 desktop、account-web、client-core、cloud-client 与连接器依赖管理员协议。
- 建立 client-core Port DTO、Desktop TypeScript Tauri Adapter、Rust Command Handler 三层契约测试。
- Windows/macOS 构建和签名流水线试验。
- SQLCipher 跨平台打包验证。
- OS Keychain/Credential Manager 验证。
- 验证 cloud-client 与普通 TypeScript 无法读取账号 Token，Token-bearing 登录/刷新响应只由 Host 解析，Desktop Cloud 请求只能由 Rust secure-http 注入认证头，并与平台凭据命名空间隔离。
- 安全 HTTP Gateway 原型。
- Spaceship API 认证、分页和异步操作验证。
- Cloudflare DNS 最小读写验证。
- Atom Token 脱敏验证。
- Afternic CSV Golden File 验证。
- 账号门禁、签名 Auth/Entitlement Token、两台绑定与单执行设备的 Staging 原型。
- 账号级互斥 DeviceSwitchRequest、短期只读 Bootstrap Capability、摘要校验后原子签发 ActiveDeviceLease，以及设备签名公钥轮换/撤销原型。
- `Draining(reason: handoff | suspend)`、正常切换、强制切换倒计时和 24 小时离线执行许可原型。
- Standby Cloud Read-Only Scope、只读 API、可丢弃 Reader Cursor 和越权 Mutation 测试。
- 消费级账号密码、Refresh Token 轮换、会话/设备管理与可选 Passkey 原型。
- Sync Mutation、Revision、Cursor、快照重建和租户隔离原型。
- Cloud workspace/state 按 capability 的表/Repository/Migration 所有权、Mutation 物化和全局 Migration 排序验证。
- Fastify Public/Admin 两套实例、独立 Session/Scope/Route 注册和 Staff Audit 原型；Jobs 入口验证为 HTTP 框架无关。
- Active Local Query Adapter 与 Standby Cloud Query Adapter 的同一 Query Port 契约测试，以及 protocol/workspace 确定性摘要 Golden Vector。
- DeviceCredentialBinding 不进入云端的自动化泄漏测试。
- 本地加密备份导出、校验和恢复验证。
- 本地 UI WebView 与远程平台 WebView 的 Tauri Capability 隔离验证。
- 用户登录、暂停/接管和一次性自动化授权原型。
- Windows WebView2 与 macOS WKWebView 的独立 Profile、脚本回调、弹窗/OAuth、下载拦截和上传验证。
- Rust automation-host 对 WebView 会话、注入、导航/弹窗/下载策略的双引擎封装验证。
- BrowserSessionConsent 与 BrowserAutomationGrant 分离；Secure Host 签发、automation-host 消费一次性 AutomationExecutionTicket 的越权/重放测试。
- Job Runtime 的 TenantContext 强制传播、幂等、Lease、Quarantine 和跨租户负向测试。
- 记录 Afternic、Atom、Spaceship、Cloudflare 的 ToS、账户政策和自动化风险，作为持续评估项而非发布硬门槛。

退出条件：平台 API 密钥不进入普通 WebView、日志或 Sync Service，远程平台页面无法调用高权限 Tauri Command，两个桌面引擎通过浏览器自动化可行性闸门；Bootstrap 完成前无法取得 Mutation/平台/批准 Scope，并发 Standby 不能竞争激活；自动化没有一次性 Ticket 时拒绝执行；handoff/suspend 退出条件不会混用；Job 缺失或伪造 TenantContext 时拒绝执行。单执行设备、Standby 只读隔离、正常/强制切换和 24 小时云故障执行通过原型验证，云同步能处理重复 Mutation、LateExecutionEvent 和恢复候选，Public Session 无法访问 Admin Route、Owner 管理操作不能绕过模块 Port，Active/Standby Query Adapter 通过同一契约测试，五种执行模式均能通过原型演示。平台政策风险必须被记录和展示，但不作为统一硬门槛。

## Phase 1：资产、云同步与只读连接

- Portfolio、Connections、Observed Snapshot 数据模型。
- DomainAsset、OwnershipEpisode、ProviderConnection 与多账户模型。
- Connection Setup 状态机、Secure Host 凭据输入、BrowserSessionConsent 和凭据健康检查。
- Recovery Secret、备份恢复和 Schema 迁移框架。
- 账号登录门禁、记住设备会话和最多两台设备绑定。
- 云端 Workspace、业务数据 Schema、Mutation Log、Revision 和 Device Cursor。
- Spaceship 域名列表和详情。
- Cloudflare Zone 与 DNS Record 读取。
- Atom Portfolio 读取。
- Afternic CSV/Portfolio 导入。
- 本地搜索、筛选、标签和到期提醒。
- 批量差异预览、冲突中心和人工任务收件箱低保真流程。
- 审计日志原型。
- 单执行设备增量同步、切换后本地重建、共享限流摘要和恢复候选。
- 同步时机触发器、排空验收、一致性校验（Anti-Entropy）和 Mutation Log Checkpoint 重建。
- Standby Cloud Read-Only View、资产/告警/任务进度查询和可丢弃只读缓存。
- 内部运营后台的账号、设备、License、Lease、Mutation/Cursor/Checkpoint 和 Jobs 只读诊断。
- 用户触发的本地加密备份导出和恢复。
- Backup Content Manifest、默认关闭的平台凭据开关和永不包含清单。
- 首次完整分页导入的 Observed/Base/Desired 初始化、快照完整性和新鲜度规则。

退出条件：已登录且授权有效的用户可以在本地统一查看首批平台状态；Offline Device Lease 与 Entitlement 均有效时断网仍可查询。

## Phase 2：安全写操作

- Operation Planner 和差异预览。
- 跨分页 BulkSelectionSpec、物化目标集合、逐相关字段/前置条件 Plan Invalidation。
- Durable Queue、Outbox、重试和账户限流。
- 持久 Attempt 提交阶段、启动恢复扫描、结果未知确认和 ProviderConnection 熔断。
- Cloudflare DNS Record 写操作。
- Atom 价格更新。
- Spaceship Nameserver、自动续费和 DNS 写操作。
- Afternic CSV 生成和人工任务。
- 用户授权的 Afternic CSV 上传和处理状态读取。
- 签名 Recipe 发布、兼容 Manifest、双引擎门禁、灰度/撤销、Anti-Rollback 和离线旧 Recipe 规则。
- 高风险操作确认。
- 优先级队列、Workflow DAG、资源锁和完整取消语义。
- ActiveDeviceLease、Lease Epoch、24 小时离线许可和重复提交测试。
- 旧 Epoch LateExecutionEvent 验证、追加审计、`outcome_unknown` 延续和 StaleDeviceCandidate 分流测试。
- 设备本地 ApprovedOperation 签名、Epoch 校验和云端伪造/重放防护。

退出条件：批量写入可恢复、可审计，部分失败不会重复执行成功项。

## Phase 3：销售与验证工作流

- Spaceship SellerHub。
- Atom Listing、Sales 和 Analytics。
- Afternic 上传结果导入。
- TXT 所有权验证工作流。
- VerificationAttempt、DnsAuthoritySnapshot、RRset 条件写、权威/递归传播证据和秘密 Sync Projection。
- Desired/Observed 对账。
- 外部修改冲突处理。
- 已售域名跨平台紧急下架。

退出条件：VerificationAttempt、DNS 条件写和 Operations 结果交接可在重复、超时和崩溃后幂等恢复；同名 RRset 不被整组覆盖，挑战值不进入普通 TypeScript、Outbox 或 Cloud；权威与递归证据能够区分写入确认和传播完成。售出发现、人工/自动紧急处置与逐次批准语义已按 JD-01 冻结，外部修改不会被静默覆盖，J-03/J-04 的权限拒绝、中断恢复和 `outcome_unknown` 场景通过。

## Phase 4：商业发布

- 月付、年付和终身 License。
- 生产账号服务、登录恢复、两台绑定/单执行设备管理、可选 Passkey 和离线宽限。
- 订阅过期后的主界面锁定、续费恢复和未确认任务对账。
- 终身 License 覆盖所有未来大版本的签发与更新验证。
- 自动更新与签名验证。
- 隐私政策、最终用户协议和数据处理说明。
- 中英文 UI、帮助文档和支付渠道覆盖确认。
- 云端数据保留/删除政策、租户隔离测试、员工访问审计和泄露响应流程。
- 账号网页端在 License 过期后的合规导出、删除和会话/设备管理。
- 生产 Admin Web、Owner Passkey、Scope、管理 Port、跨账号访问理由/CaseReference、重新认证与 Staff 审计；多人角色与审批留到增加 Staff 后。
- 外部 Helpdesk 接入及内部可信 CaseReference；DataRightsRequest/SecurityIncident 仍由内部模块拥有。
- License/订单/设备/同步/合规/版本通道运营功能，以及 Public/Admin Route 隔离渗透测试。
- Sunset Signing Key 隔离演练、最终本地延续版本和永久离线凭证流程。
- Windows 安装包与 macOS 公证。
- 崩溃恢复、迁移和备份恢复测试。

退出条件：支付事件在重复、乱序、退款和拒付下可确定性重建 Entitlement，账号恢复、License、设备撤销和续费恢复通过端到端测试；Windows 签名安装包与 macOS 公证制品可由锁定流水线重建并验证更新、回滚和撤销。JD-03/05/06/09/11 已在各自最迟决策点关闭，生产区域、数据驻留、KMS、PITR、RPO/RTO/SLO、备份恢复和删除传播完成演练；Public/Admin/Jobs、租户隔离、Owner 高风险动作、外部 Helpdesk CaseReference 和数据权利流程通过权限拒绝与审计复核。未通过平台安全或运营 Gate 的连接器能力保持 Disabled/Manual，不以商业发布日期豁免。

## Phase 5：扩展平台

- 根据用户需求增加注册商和销售平台。
- 建立连接器开发模板和 Contract Test Kit。
- 价格策略和续费成本分析。
- 可选的本地自动化规则。
- 扩展已在 Phase 2 建立的签名 Recipe 生命周期、回滚和页面兼容矩阵。
- 用户显式发布的域名资产展示、Publication Projection 和公开页面。

退出条件：至少一个新增连接器只通过模板、版本化 Manifest/Recipe 和 Contract Test Kit 接入，不新增普通 TypeScript 任意网络、秘密或脚本能力；Capability/Data Classification Diff、灰度、撤销、Anti-Rollback、兼容矩阵和 Provider 退役路径均可重跑。Publication Projection 只包含用户显式选择的公开字段，私人 Workspace、成本、账号、操作和冲突数据不能通过公开接口读取。

## Phase 6：iOS 与 Android

- Tauri Mobile 构建验证。
- Keychain/Keystore 适配。
- 移动端账号登录，与桌面端共享每账号两台绑定、一台活动的总额度。
- Standby 移动端查询、告警、计划审阅、任务进度、设备切换和紧急平台官网人工处置引导。
- 移动端切换为 Active 后的正式批准、平台刷新、少量编辑和自动紧急下架。
- 后台任务受限时的安全暂停和恢复。
- 文件分享和生物识别解锁。

移动端 Standby 的“审阅”不形成 ApprovedOperation，也不能远程指令桌面执行。是否引入独立 RemoteApprovalToken，以及是否完整支持大规模 CSV 和批量表格操作，在桌面版真实使用数据出来后另行决策。

退出条件：iOS/Android 在受支持系统矩阵上完成账号、Keychain/Keystore、设备总额度、Standby 只读、切换/重建和后台暂停恢复测试；Standby 无法形成 ApprovedOperation、读取平台秘密或远程命令桌面执行，移动端 Active 只能使用已通过对应平台 Gate 的能力。生物识别、文件分享、深链和后台唤醒不能绕过 RuntimeMode、License、DeviceBinding 或 ActiveDeviceLease；若 RemoteApprovalToken 尚无独立决策，产品中不得出现等价远程批准通道。
