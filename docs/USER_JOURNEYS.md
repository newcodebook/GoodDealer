# GoodDealer 用户旅程审理基线

状态：Review Baseline / Open Findings  
更新日期：2026-08-01

## 1. 目的与适用范围

本文档用于从真实角色完成目标的角度审理 GoodDealer。它不替代 PRD、专题设计或 ADR，也不把审查建议自动升级为正式决策。

本文档承担四项职责：

- 维护需要端到端成立的权威角色旅程。
- 用统一维度检查入口、权限、数据、执行、异常、交接、审计和完成证据。
- 将跨文档的重复症状归并为少数根因，防止以局部补丁掩盖系统断链。
- 为每个开发阶段提供 Journey Gate 和端到端验收范围。

状态语义：

- `Covered`：主路径、关键异常、完成证据和 E2E 验收均有权威设计。
- `Partial`：已有正确的模块或原则，但仍存在跨模块断链。
- `Missing`：缺少入口、权威状态机、执行协议或明确完成条件。
- `Decision Required`：实现方式取决于尚未确认的产品、安全或运营选择。
- `Open Finding`：审查发现，尚未写入正式专题文档或 ADR，不代表方案已被接受。
- `Design Resolved / Gate`：权威设计已经落档，仍需在标注 Phase 通过原型或 E2E Gate 才算实现完成。

## 2. 系统性审理方法

### 2.1 八个固定维度

每条旅程必须逐项回答：

1. **入口可达性**：角色从哪里进入，未登录、Locked、Standby、离线或服务故障时是否仍有正确入口。
2. **RuntimeMode 与权限准入**：谁可读、可改、可批准、可执行；门禁是否由 Rust Host 和 Cloud 共同强制，而非只隐藏 UI。
3. **数据来源与新鲜度**：使用本地 Active Workspace、Standby Cache、Cloud State 还是平台实读；完整性、Revision 和读取时间是否可见。
4. **操作反馈与完成定义**：区分已计划、已批准、请求已发出、页面观察、平台确认和用户确认；不能把“无报错”当作完成。
5. **异常、中断与恢复**：覆盖崩溃、休眠、断网、限流、凭据失效、页面变化、设备切换、License 失效及结果未知。
6. **跨角色与模块交接**：明确交接对象、持久化实体、幂等键、版本、期限和唯一所有者，禁止只依赖内存调用或人工口头流程。
7. **审计、安全与合规**：明确秘密边界、租户上下文、用户同意、Staff Scope、证据等级、保留和删除例外。
8. **退出条件与验收**：定义用户目标何时真正完成、残余风险由谁接受，以及可自动执行的端到端验收。

### 2.2 严重级别

| 级别 | 定义 | 处理要求 |
| --- | --- | --- |
| J0 | 权限、执行事实或数据权威性存在断链，继续实现容易形成不可修补的安全/正确性缺陷 | 在实现受影响主链前关闭 |
| J1 | 旅程无法稳定完成、恢复或运营 | 在对应 Phase 退出前关闭 |
| J2 | 旅程可走通，但诊断、效率、说明或边界不完整 | 正式发布前关闭或明确接受 |
| J3 | 体验优化或未来扩展 | 进入普通产品 Backlog |

严重度是相对于受影响旅程的实现阶段，不表示所有 J0 都阻塞整个项目启动。

### 2.3 Journey Gate

一项能力需要依次通过三层 Gate，才能从“模块已设计”升级为“旅程已覆盖”。

**Gate A：设计可实现**

- 有稳定的 Journey ID、Persona、触发条件、前置条件、目标和业务完成定义。
- Happy Path 每一步都有唯一责任模块和持久化归属。
- RuntimeMode、账号 Scope、Staff Scope、设备 Epoch、数据去向和秘密边界明确。
- 外部副作用有批准依据、幂等策略、提交边界和结果确认等级。
- 中断、重试、取消、切换、权限过期和外部人工修改均有确定语义。
- 跨模块交接使用版本化协议或持久实体，明确超时、重复和乱序。
- 未接受的商业选择仍标为 `Decision Required`，不写成既定事实。

**Gate B：实现可验证**

- DTO、状态转换、错误码、版本、幂等键和 Migration 已定义。
- 用户能看到进度、阻塞原因、数据新鲜度和准确的完成证据。
- 有结构测试防止秘密上传、Scope 绕过、跨租户访问和模块越界。
- 副作用可在每个提交边界注入崩溃，并得到确定的恢复结果。
- 异步任务有 Lease、重试、隔离和人工处置。
- 至少通过 Happy Path、权限拒绝、中断恢复和结果未知四类 E2E 场景。

**Gate C：发布可运营**

- Windows/macOS 真实产物通过端到端旅程，而非只通过模块单测。
- Cloud 有指标、告警、责任人、Runbook 和恢复演练。
- Staff/Support/Compliance 流程可关闭，临时权限会自动撤销。
- Connector/Recipe 有兼容矩阵、灰度、吊销、回滚和离线规则。
- Lifetime、合规导出、删除等商业承诺经过真实演练。
- 没有影响本阶段交付的 J0；相关产品决策已确认或明确排除在本阶段之外。

## 3. 角色与权威旅程目录

| Journey ID | 主要角色 | 目标 | 主要界面/运行时 | 当前覆盖 |
| --- | --- | --- | --- | --- |
| J-01 | 新用户、首次购买用户 | 注册、购买、绑定首设备、连接首个平台并完成首次导入 | account-web、Desktop Locked/Activating/Active | Missing |
| J-02 | 专业域名投资人 | 搜索、跨分页选择、批量预览、批准、执行、部分失败重试和对账 | Desktop Active | Partial |
| J-03 | 域名验证操作者 | 获取挑战、识别权威 DNS、写入 TXT/NS、等待传播并完成平台验证 | Desktop Active、Remote WebView | Partial |
| J-04 | 已售域名处置者 | 发现售出、跨平台紧急下架、确认风险收敛 | Desktop Active；Standby 人工兜底 | Missing |
| J-05 | 双设备/移动端用户 | Standby 查询、正常或强制切换、凭据准备和离线接管 | Desktop/Mobile Standby、Activating、Active | Partial |
| J-06 | 月付、年付、终身及过期用户 | 购买、授权、续签、离线、退款/过期、续费恢复和停服延续 | account-web、Desktop Gate | Partial |
| J-07 | 故障与恢复用户 | 崩溃恢复、Keychain 恢复、备份恢复、升级迁移、设备遗失和 Sunset 导入 | Desktop Recovery/Activating/LocalContinuation | Partial |
| J-08 | 首版 Owner；未来 Staff 角色 | 在最小权限下诊断、执行受控管理动作并关闭案件 | admin-web、Admin HTTP、Jobs | Partial |
| J-09 | 求助、合规或安全事件中的用户 | 身份核验、授权支持、导出/删除、被盗/接管遏制和争议处理 | account-web、Help、admin-web | Missing |
| J-10 | Cloud Ops、发布负责人、连接器/Recipe 维护者 | 安全部署、迁移、运行 Jobs、恢复事故、发布和撤销连接器能力 | CI/CD、Admin、Jobs、Runbooks | Missing |

## 4. 十条旅程的端到端完成定义

### J-01 首次使用

主链：注册/登录 → 购买或恢复购买 → 原子创建 Workspace 与首设备身份 → 两阶段激活 → 建立 ProviderConnection → 设备本地录入凭据或浏览器登录 → 分页导入 → 初始化 Observed/Base/Desired → 上传 Outbox → Anti-Entropy 通过。

完成不是“首页出现了域名”，而是同时满足：平台分页快照完整、本地实体与 Outbox 已提交到 Server Revision、Cloud Checkpoint/摘要可验证、首个连接的凭据健康状态只存在本设备。

### J-02 日常批量管理

主链：形成稳定查询快照 → 跨分页选择 → 固化实体集合 → 生成差异计划 → 检查数据新鲜度和连接器能力 → 批准 → 按优先级/资源锁执行 → 记录 Attempt 提交阶段 → 平台确认 → 部分失败重试或重新规划。

完成不是“批次进度 100%”，而是每个目标项都有平台确认、明确的人工完成、可继续对账的等待状态，或用户接受的剩余失败。

### J-03 DNS 与所有权验证

主链：获取挑战 → 识别当前权威委派和 Zone → 保存 RRset 前置条件 → 生成验证 DAG → 用户批准 → 安全写入 → 权威和递归传播证据 → 触发平台验证 → 达到要求的证据等级 → 保留或另行批准清理。

敏感挑战值、Cookie 和登录信息不得进入 Cloud；设备切换后缺少本地挑战时必须重新获取、重新规划和重新批准。

### J-04 已售域名紧急下架

主链：接收 SaleSignal → 建立 EmergencyDelistingIncident → 枚举所有已知 Listing → 生成继承 P0 的下架 DAG → 批准或由未来明确授权策略触发 → 执行与确认 → 吸收手工平台官网结果 → 所有 Listing 确认关闭或用户明确接受风险。

取消某个 Operation 不等于关闭 Incident；手工下架不得被冲突合并策略建议自动重新上架。

### J-05 双设备与移动端

主链：绑定第二设备 → Standby 云端只读 → 展示缓存新鲜度、宿主能力和凭据准备度 → 申请正常/强制切换 → 排空或等待旧离线许可 → 取得短期只读 Bootstrap Capability → 重建和校验 → 原子签发 ActiveDeviceLease → 执行能力开放。

强制切换期间继续提供平台官网人工兜底；旧 Epoch 的执行事实进入 LateExecutionEvent，旧编辑进入 Candidate，两者不得混合。

### J-06 账号、支付与 License

主链：Checkout/恢复购买 → 支付事实幂等入库 → AccountEntitlement 派生 → 设备凭证签发 → 在线刷新/离线进入 → 取消、退款、拒付或过期 → 确定性锁定 → 续费后按恢复闸门重新对账。

账号网页端的合规导出、删除和安全管理不受客户端 License 锁定影响。

### J-07 崩溃、备份、更新与灾难恢复

主链：启动恢复扫描 → 按提交边界分类非终态任务 → 冻结结果未知项并对账 → 恢复 Keychain/设备身份/平台凭据 → 在隔离 Staging 验证和迁移备份 → 以当前 Cloud 为基线生成 RestoreCandidate → 用户选择后形成新 Mutation。

更新失败必须保留旧版或 Recovery Shell；Sunset 导出必须能在没有 GoodDealer 服务时初始化 LocalContinuation Workspace。

### J-08 内部管理员

主链：Owner 使用 Passkey 强认证 → 建立 StaffSession 和 Scope → 绑定外部 CaseReference/内部 Incident → 只读诊断 → Repair dry-run → 高风险动作重新认证 → 持久化 AdminActionAuthorization/AdministrativeActionContext → 异步执行 → 通知 → 结案 → 审计复核。

首版不建设多角色协作和多人审批；Role/Scope 保留为结构约束，只签发 Owner 身份。未来增加 Staff 时再启用细分角色、职责分离与审批流。

管理员不能获取平台秘密、冒充用户、创建用户 ApprovedOperation、直接修改 Desired State 或把隔离事件手工标记为成功。

### J-09 Support、合规和安全事件

主链：用户通过外部 Helpdesk 建立 SupportCase，或系统建立 DataRightsRequest/SecurityIncident → 身份核验 → 保存可信 CaseReference 并分流 → Owner 按 Scope/理由进入目的限定上下文 → 处置/导出/删除/证据保全 → 通知与投递确认 → 用户确认或申诉 → 关闭并完成审计。

三类案件可以互相关联，但不能共用万能状态机；关闭 SupportCase 不得提前终止合规或安全义务。

### J-10 云端运营与连接器生命周期

主链：兼容性和政策检查 → Migration/制品/签名预检 → Staging 恢复演练 → expand/contract 部署 → Public/Admin/Jobs 灰度 → 一致性与租户隔离冒烟 → SLI 观察 → 完成或前滚/回滚。

连接器和 Recipe 还必须经历 Capability/Data Classification Diff、Contract Test、双引擎证据、签名、灰度、撤销和 Anti-Rollback；远程政策只能收窄客户端已编译能力。

## 5. 去重后的跨旅程根因

下表中的“建议归属”是审查建议，不是已经接受的工程决策。

| Finding | 根因 | 影响旅程 | 级别 | 类型 | 建议唯一所有者 | 状态 |
| --- | --- | --- | --- | --- | --- | --- |
| JF-01 | Workspace Bootstrap 与首设备激活没有原子、幂等且可恢复的协议 | J-01、J-05、J-06、J-07 | J1 | 设计补全 | Cloud `identity/devices/workspace` 的 Bootstrap Application Service | Open Finding |
| JF-02 | Activating 过早取得 ActiveDeviceLease；DeviceBinding 又缺可信签名密钥生命周期 | J-01、J-05、J-07 | J0 | 设计补全 | Cloud `devices` + `secure-host-core/device-identity` | Design Resolved / Phase 0 Gate |
| JF-03 | ProviderConnection 建立、凭据输入、健康检查和浏览器登录同意没有统一状态机 | J-01、J-03、J-05 | J1 | 设计补全 | `client-core/connections` | Open Finding |
| JF-04 | 用户批准无法在浏览器自动化的 Rust 执行边界被强制证明 | J-03、J-04 | J0 | 设计补全 | `secure-host-core/operation-signing` 签发 Ticket，`automation-host` 验证 | Design Resolved / Phase 0 Gate |
| JF-05 | 批量选择不稳定，计划批准后缺少失效与重新规划协议 | J-02、J-03、J-04 | J1 | 设计补全 | `client-core/operations` Planner | Design Resolved / Phase 2 Gate |
| JF-06 | Operation、Attempt、副作用提交边界、证据和崩溃恢复没有一套权威状态机 | J-02、J-03、J-04、J-06、J-07、J-09 | J0 | 设计补全 | `client-core/operations` + active-workspace operations Repository | Design Resolved / Phase 2 Gate |
| JF-07 | RuntimeMode 把设备交接、普通暂停/退出和恢复准入混为一类 | J-02、J-05、J-06、J-07 | J1 | 设计补全 | `secure-host-core/runtime-gate` | Design Resolved / Phase 0 Gate |
| JF-08 | 首次导入/平台刷新缺少基线初始化、完整性、新鲜度与所有权证据规则 | J-01、J-02、J-03、J-05 | J1 | 设计补全 | `client-core/sync` | Open Finding |
| JF-09 | Verification 没有权威聚合；DNS 委派识别、RRset 条件写和秘密 Sync Projection 未闭合 | J-03 | J0 | 设计补全 | `client-core/verification` 编排，`dns/registration/operations` 执行 | Design Resolved / Phase 3 Gate |
| JF-10 | 售出发现、紧急事件和逐次批准之间没有统一产品语义 | J-02、J-04、J-05 | J1 | 产品决策 + 设计 | `client-core/marketplace` 的 SaleSignal 与 `operations` Incident 编排 | Decision Required |
| JF-11 | 支付、订阅、Entitlement、账号安全 Epoch、删除和续费恢复只是规则集合，不是权威生命周期 | J-01、J-05、J-06、J-09 | J1 | 设计补全 | Cloud `licensing/identity/compliance` 的分立聚合与编排服务 | Open Finding |
| JF-12 | 备份内容、离线灾难快照、Keychain 全丢、更新回退和 Sunset 导入缺少统一恢复契约 | J-05、J-06、J-07 | J1 | 产品决策 + 设计 | `client-core/recovery` + `local-storage/backup/migrations` | Decision Required |
| JF-13 | 外部 Support CaseReference、DataRightsRequest、SecurityIncident 和内部关闭语义没有闭环 | J-08、J-09 | J1 | 设计补全 + 政策参数 | Cloud `compliance/security-incidents/admin-access` + Helpdesk Adapter | Open Finding |
| JF-14 | 单 Owner 的 AdminActionAuthorization、身份恢复和异步 AdministrativeActionContext 尚未完整定义 | J-08、J-09、J-10 | J1 | 设计补全 + 政策参数 | Cloud `admin-access` | Partially Resolved / Phase 4 Gate |
| JF-15 | Cloud Job 缺少 Lease、幂等、TenantContext、隔离和安全重放协议 | J-06、J-08、J-09、J-10 | J0 | 设计补全 | 窄 `job-runtime` 基础设施 + 各业务模块拥有 Payload/结果 | Design Resolved / Phase 0 Gate |
| JF-16 | Migration、Checkpoint 压缩、可观测性、灾备、密钥轮换和事故 Runbook 缺少运营事实源 | J-06、J-08、J-09、J-10 | J2 | 运营设计 + 产品指标 | Cloud 各业务模块 + 独立 Platform/Operations 责任 | Open Finding |
| JF-17 | 连接器/Recipe 的灰度、撤销、双引擎持续门禁、Feature Policy 和退役流程未定义 | J-03、J-04、J-10 | J1 | 设计补全 + 平台政策 | Connector/Recipe Release Pipeline | Open Finding |

### 5.1 文档内部冲突处理状态

| 冲突 | 最终语义 | 状态 |
| --- | --- | --- |
| Activating 与 ActiveDeviceLease 时序 | 账号级互斥 Bootstrap Capability 完成重建/摘要校验后才签发 ActiveDeviceLease | Resolved |
| Draining 同时表示交接与普通暂停 | 保留一个 `Draining(reason: handoff \| suspend)`；权限相同、退出条件分叉 | Resolved |
| 旧 Epoch 重连进入 Locked 还是 Standby | 仍绑定且 License 有效则 Standby，否则 Locked；事实/候选使用独立 Ingest | Resolved |
| Browser Profile 只按平台隔离 | 改为 `device_id + provider_connection_id + session_mode` | Resolved |
| 登录辅助与业务 Grant 混用 | 分离 BrowserSessionConsent 与 BrowserAutomationGrant | Resolved |
| Auth Session 失效即 Locked | Access Token 到期只刷新；仅权威授权/绑定/完整性失败触发 Locked | Resolved |
| 备份凭据与不可移植内容不清 | 单一版本化备份包 + 默认关闭的凭据开关 + 永不包含清单 | Resolved by D-013 |
| Staff 明细访问规则冲突 | 单 Owner，不要求用户逐次授权；Scope + 理由/CaseReference + 重新认证 + Audit | Resolved by D-012 |

## 6. 高优先级根因的最低闭环

### 6.1 Bootstrap 与两阶段激活

最低协议应保证：

- 空账号的 Workspace、Revision 0、首个 DeviceBinding、初始 Epoch 和激活流程可由同一个幂等请求创建或安全重试。
- 同一账号最多存在一个未完成的 DeviceSwitchRequest/Bootstrap Capability，并绑定目标设备与幂等键；并发 Standby 不能竞争激活。
- 短期、单用途的 Bootstrap Capability 只允许下载 Checkpoint、重建、迁移和摘要校验，不授予 Mutation、平台访问或批准权限；首版无需再建立一种长期续签 Lease。
- 校验通过后，Cloud 原子签发 `ActiveDeviceLease`；失败或超时可重试，不遗留“服务端认为 Active、本地尚未就绪”的幽灵设备。
- DeviceBinding 保存可验证签名公钥、`key_id`、版本、轮换、撤销和 Tombstone；私钥只在设备 Secure Host。

### 6.2 稳定选择、计划失效和批准链

最低协议应保证：

- `BulkSelectionSpec` 绑定查询条件、`query_snapshot_revision`、排除项和 `selection_hash`；Planner 在批准前固化实体 ID。
- 只有计划实际读取/修改的字段、目标资源前置条件、影响动作语义的 Capability/Recipe 或声明的新鲜度阈值发生变化时，受影响项才进入 `needs_replan`；无关字段刷新只提示。
- ApprovedOperation 绑定实体集合、计划 Hash、设备、Epoch、期限和连接器版本。
- 浏览器执行时由本地存储原子消费 Grant/批准，Secure Host 签发短期一次性 `AutomationExecutionTicket`，automation-host 只接受该 Ticket。它是本机防重放 Capability，不是跨设备或跨 Cloud 的通用 JWT。

### 6.3 Operation 与 Attempt

最低协议应区分：

```text
prepared
→ request_started
→ request_sent
→ response_received
→ remote_confirmation_pending
→ confirmed | failed | outcome_unknown
```

- 崩溃发生在可能跨过副作用边界之后时，只能进入确认路径，不能普通重试。
- 启动恢复扫描完成前 Worker 不领取新任务。
- ProviderConnection 级认证或平台故障触发熔断，避免为同一根因制造大量失败项。

### 6.4 RuntimeMode 与恢复准入

最低协议应保证：

- 保留一个 `Draining(reason: handoff | suspend)`：两种原因权限相同，均不领新任务并只完成当前原子步骤；`handoff` 必须 Cloud 排空验收，`suspend` 只尽力冲刷且失败不阻塞退出。
- Cloud Lease/Scope 是远端授权，Rust `runtime-gate` 是本机命令准入，两者分别校验且不能互相代替。
- 创建/检查备份、恢复秘密、恢复业务数据、Schema Migration、崩溃对账和 LocalContinuation 均进入命令准入矩阵。
- 启动恢复扫描、Outbox 上传和结果未知对账完成前，不开放领取新任务。

### 6.5 Verification 与 DNS

最低协议应包含 `VerificationAttempt`、`DnsAuthoritySnapshot`、`RecordSetPrecondition` 和 `VerificationEvidence`：

- 无法唯一识别权威 DNS 时禁止写入。
- Connector 声明单记录或整 RRset 写语义；副作用前重新读取并比较规范化 Hash。
- 写后确认新增值存在且同名原记录未丢失；传播证据同时覆盖权威 NS 和约定递归解析器。
- TXT 走 DNS，NS Challenge 走 Registration 高风险流程。
- 原始挑战使用 opaque 本地引用；Cloud 只保存指纹、脱敏预览、状态和证据摘要。

### 6.6 案件与管理员权限

最低协议应保证：

- 首版 SupportCase 使用外部 Helpdesk；GoodDealer 内部只保存可信 CaseReference、账号关联和审计，不同步平台秘密或不必要的资产明细。
- 单 Owner 跨账号访问不要求用户逐次授权或多人审批，但必须绑定 Scope、理由/CaseReference、重新认证新鲜度和 Staff AuditEvent。
- 异步 Repair/Job 持久化 Owner actor、Scope 快照、CaseReference、重新认证时间、幂等键、目标 Revision 和前后摘要。`admin-access` 只签发授权上下文，具体 Repair Command 仍由目标业务模块拥有，禁止万能 Admin Command。
- 外部工单关闭不删除审计，也不关闭独立 DataRightsRequest/SecurityIncident；临时 Artifact 权限必须按内部生命周期到期。
- 被盗设备处置明确显示离线许可残余窗口，并引导用户在各平台撤销设备持有的 API/OAuth/浏览器会话。

### 6.7 Cloud Job 与租户上下文

最低协议应保证：

- Job Runtime 只拥有 Lease、心跳、幂等、超时、退避、隔离和安全重放；业务 Payload、结果与取消语义仍由 Compliance、Notifications、Checkpoints 等模块拥有。
- `TenantContext` 从认证、Job 创建、事务、Repository 到对象存储 Key 全程强制传播；后台任务不得先无租户扫描再靠业务代码过滤。
- 管理员跨租户入口与普通业务入口分离；Public Session、错误 Staff Scope 或不匹配的 Tenant Context 在模块 Port 前被拒绝。
- Job 版本升级保留旧 Payload 解码策略；毒任务进入 Quarantine，人工重放仍使用原幂等键和授权上下文。

## 7. 产品决策状态

| Decision | 问题 | 当前方向 | 状态/门槛 |
| --- | --- | --- | --- |
| JD-01 | 首版“紧急下架”是否承诺无人值守发现和执行 | 首版只承诺应用运行且平台可读取时发现；自动生成 P0 计划仍需批准。无人值守 Standing Emergency Policy/Relay 独立立项 | Open / Phase 3 前确认 |
| JD-02 | Cloud 故障时能否创建未冲刷的灾难备份 | 同时提供 Synchronized Backup 与明确标识的 Emergency Local Snapshot；后者恢复时只生成 Candidate，不回放旧 Outbox | Open / Phase 1 前确认 |
| JD-03 | 突发停服如何兑现终身授权 | Sunset Key 离线硬件保存、商业条款披露和无生产服务演练为务实底线；是否外部托管另议 | Open / 仅阻塞 Phase 4 终身 SKU 开售 |
| JD-04 | Staff 在用户无法授权时能否 Break Glass | D-012 已决定首版单 Owner、跨账号不要求用户逐次授权，不存在独立 Break Glass 通道；使用 Scope + 理由/CaseReference + 重新认证 + Audit | Resolved by D-012 |
| JD-05 | 合规删除冷静期、证据保留例外和下载保留时长 | 由目标市场法律与支付/安全需求分别制定，不用一个全局数字覆盖所有对象 | Open / Phase 4 前确认 |
| JD-06 | 正式销售前的 RPO、RTO、SLO 和旧备份支持窗口 | 在 Phase 4 前形成可公开/可运营目标，不由代码默认值反向形成承诺 | Open / Phase 4 前确认 |
| JD-07 | 移动端是否允许远程批准 | Standby 只审阅；RemoteApprovalToken 有真实需求后另立决策 | Resolved by D-011 |
| JD-08 | 本地备份是否包含平台 API Key 等设备秘密 | 单一备份包；凭据开关默认关闭；Browser Profile、设备私钥、Auth/Lease 等永不包含 | Resolved by D-013 |
| JD-09 | 支付失败宽限、部分退款、升降级、拒付和 Lifetime 退款规则 | Provider Payment Event 是支付事实，AccountEntitlement 是派生结果；具体商业状态表待定 | Open / 支付接入前确认 |
| JD-10 | 首版 SupportCase 自建还是接入外部 Helpdesk | 首版接入外部 Helpdesk；内部只保留可信 CaseReference、账号关联和审计 | Resolved by D-014 |

## 8. 最小端到端验收矩阵

### 8.1 账号、设备与首次使用

1. 支付回调重复、乱序或延迟时，Entitlement 只建立一次，并可恢复购买。
2. 首设备 Bootstrap 在每个事务边界失败后均可幂等重试，不产生两个 Workspace 或两个 Active Epoch。
3. Activating 设备在摘要校验完成前无法 Mutation、访问平台、批准或执行。
4. 删除或轮换设备签名密钥后，旧批准、旧 Ticket 和 LateExecutionEvent 分别按正确规则拒绝或隔离。
5. 首次导入遇到分页中断、重复项和平台中途变化时，不会把不完整快照标记为完成。

### 8.2 批量操作与自动化

6. 跨 10,000 个结果分页选择后修改筛选条件，已批准计划的实体集合保持可复现或明确失效。
7. 批准后 Observed State、Credential、Capability 或 RRset 改变，计划必须 `needs_replan`。
8. 在每个 Attempt 提交边界注入崩溃；已确认项不重提，结果未知项只确认。
9. 自动化 Ticket 过期、重放、Recipe Hash 不同、Epoch 改变、Origin 越界时，automation-host 全部拒绝。
10. 用户在最终点击期间接管或窗口崩溃，任务进入 `outcome_unknown` 而不是自动重试。

### 8.3 DNS、验证与紧急处置

11. 权威 NS 与已连接 Zone 不一致时零写入，并给出可执行修复入口。
12. 同名 TXT 被外部修改时不覆盖；写后能证明目标值和原有值都存在。
13. 敏感挑战值不出现在 Mutation、Cloud DB、日志、Crash Report 或 Staff 诊断包。
14. 两个同 Provider 账户的 Browser Profile 完全隔离。
15. 一个售出 Incident 同时包含 API 成功、人工下架、平台不可达和结果未知时，只有全部确认或用户接受风险后才能关闭。

### 8.4 切换、恢复与授权

16. 强制切换期间旧设备重新上线、超时或已被移除时，DeviceSwitchRequest 进入唯一确定状态。
17. 没有预先绑定 Standby、名额已满且 Active 丢失时，仍能安全解绑、等待离线窗口、重建并重配凭据。
18. 分别丢失 Master Key、Auth Token、Lease、设备签名密钥、平台凭据和全部 Keychain，进入对应恢复流程。
19. License 过期时存在 waiting_remote、waiting_dns 和 outcome_unknown；续费后按恢复闸门分类处理，不直接领取新任务。
20. 旧备份恢复期间 Cloud Revision 推进后，Candidate 必须 Rebase；旧 Operation、批准和 Outbox 不回放。

### 8.5 Staff、合规和云端运营

21. Owner 缺少目标 Scope、理由/CaseReference 或有效重新认证时不能读取 Workspace 明细或执行高风险动作；Public Session、错误 TenantContext 和绕过模块 Port 的请求均被拒绝。
22. 被盗设备事件能撤销在线 Session、冻结破坏性账号动作、显示剩余离线窗口并生成平台凭据撤销清单。
23. 导出、删除和安全事件分别完成身份核验、异步执行、通知、部分失败、证据保留和最终回执。
24. Public/Admin/Jobs 联合部署经过 Migration、旧新版本并存、失败前滚/回滚和租户隔离检查。
25. 所有 Job 具备幂等、Lease、心跳、超时、重试、隔离和人工处置；重放不会重复产生业务效果。
26. Recipe 灰度版本可撤销，旧离线客户端不能通过回滚或远程 Flag 获得更大能力。
27. 关闭日常 Account/License/Sync 服务后，合格用户仍能通过演练材料初始化 LocalContinuation Workspace。

## 9. 评审与维护规则

- PRD 新增角色目标时，必须先登记 Journey ID；不得只增加模块能力。
- ADR 改变 RuntimeMode、信任边界、数据权威性或设备模型时，必须重新审理所有受影响 Journey。
- Connector/Recipe 新增副作用能力时，必须补充 J-02/J-03/J-04 的计划、批准、结果未知和回滚场景。
- 每个 Roadmap Phase 进入实现前确定本阶段 Journey 范围；退出时逐条通过 Journey Gate。
- 发现问题先登记为 Open Finding。只有产品决策或专题设计落档并补齐验收后，才可标为 Resolved。
- Journey 文档拥有端到端目标和覆盖状态；专题文档拥有具体状态机与协议；`ENGINEERING_STRUCTURE.md` 拥有工程归属；ADR 拥有不可轻易改变的决策。
