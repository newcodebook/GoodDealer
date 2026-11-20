# GoodDealer v1 能力路线图

## 读法

本路线图只使用 [Phase 0 执行计划](phase0/PHASE0_EXECUTION_PLAN.md) 定义的正式工作包：
`S0`、`L1`、`H1`、`A1`、`D1`、`S1`、`C1`、`V1`。不得在源码、迁移或文档中引入其他临时任务编号来
增加或宣称 Roadmap 阶段；历史审查记录中的 `P0-*` 编号只属于该历史时点。

状态必须分层理解：

- **源码已实现**：生产入口中存在对应实现，不代表已完成整体验收。
- **局部已验证**：拥有模块的测试或开发环境纵向已有证据；后续改动会使旧结果失效。
- **V1 已验收**：所有依赖汇合后完成新鲜的集成检查、文档一致性检查和独立复审。
- **外部已资格化**：真实环境、真实 Provider 或最终构件取得对应证据；本地测试不能替代。

## 正式工作包与依赖

```text
S0 --> L1 --> D1 --> V1
 |      |      ^
 |      `--> S1
 +--> H1 --> D1
 +--> A1 --> D1
 `--> C1 --> L1
```

## 当前状态

源码入口与可执行状态以 [当前实现](CURRENT_IMPLEMENTATION.md)为准；下表仅跟踪工作包和验收责任。

| 工作包 | 当前实现 | 验收状态 | 仍需完成 |
| --- | --- | --- | --- |
| **S0 架构与数据治理** | 本地 SQLCipher 权威、Cloud 控制面/脱敏副本、秘密隔离、同步白名单和 v1 排除项已有 ADR 与协议约束。 | 核心决策已建立；源码、测试、脚本与当前态文档中的临时 `P0-*` 任务编号已改写为所表达的不变量，四类状态的区分已完成一次全仓扫描（阶段 1）。例外：已应用且受校验和固定的本地迁移（`sync_v3.sql`、`sync_v4.sql` 注释中的 `P0-04`）和已持久化的 schema epoch/错误码（`P0_07_CREDENTIAL_SCHEMA*`）是冻结标识，改写会破坏已有数据库，只能随新的 schema epoch 一并淘汰。这不是 V1 验收。 | 在阶段 4 的冻结候选上重新做全仓术语、边界和依赖扫描。 |
| **L1 local-storage** | `DesktopLocalHost` 已拥有 SQLCipher 路径/密钥/数据库身份、完整业务 schema、本地资产读写、字段版本、Inbox/Outbox、冲突、墓碑、Provider 本地状态及恢复协议底座。 | 源码已实现并有广泛局部测试；最新跨模块改动之后尚无一次新鲜 V1 验收。 | 完成与 D1/S1/C1 的客户纵向回归、规模/故障回归；按 ADR-0023 实施独立备份、换机云恢复和 Windows/macOS 原生路径，现有测试协议不作为生产实现。 |
| **H1 Native Host** | Native 已组合 PKCE、device/refresh custody、Grant/Lease 双重验签、运行时授权门禁、Sync/Projection/Provider lanes、Cloudflare Keychain v3 发布和窄 IPC。 | Host 核心授权、调度及 Windows 原生存储已组合，目标平台实机和恢复验收仍待完成；尚未随最终 Renderer 组合做新鲜 V1 验收。 | 验证最终 command/manifest/capability/adapter 精确一致；完成目标平台 Keychain 与最终构件资格；Linux 的 Provider 原生录入及托管持续接入。独立备份已接入创建、离线查看/导出及授权导入，支持新增域名与预览后补齐已有资产的空字段，继续双系统实机验收。 |
| **A1 Cloud identity/devices** | 当前源码含注册、邮箱验证/重发、密码登录/恢复、Session discovery、登录轮换、服务端退出、默认工作区、设备 PoP、access/refresh、v5 角色交换（Active Grant v4/Lease v1、独立 Standby Grant v1）、商业权威及 Stripe test-mode 商业链路；开发组合保留 loopback Mailpit，staging 组合通过已验证 `gooddealer.com` 域名的 Resend 发件地址发送事务邮件。 | Account access 的本地、PostgreSQL 与 staging 浏览器证据覆盖原子回滚、并发、expiry/replay、邮件 retry/dead-letter、reset epoch、rotation、刷新恢复和 logout；真实测试用户已在无数据库/开发工具权限下完成完整旅程。 | 公开注册和生产邮件资格、Stripe live、税务范围、生产 OpenBao、生产 worker、HA 与灾难恢复继续归入各自外部资格；staging 仍运行在当前共享 VPS/开发数据库上。 |
| **D1 Desktop** | 已按 `brand/` 重建：生产根组件只依据 Host 事实裁决页面（`app/desktop-presentation.ts`），未就绪、Host 不可用、浏览器 PKCE 登录与锁定状态均为 route-free 页面；Active 且尚无域名的工作区在本次会话首次进入时显示引导（kit 接入向导：设备门只显示 `local_device_lease_read` 校验过的 Lease Epoch，Host 无设备名故不显示；Cloudflare 卡片只在工作区可写、Host 报告已认证且本构建可采集凭据（`capturable`，macOS、Windows 与 Linux 已有原生录入实现）时准入连接（`cloudflare_connection_create` 后经 `cloudflare_connection_activate` 由 Host 打开原生 Token 采集，激活时导入该 Zone 的域名）或断开（`cloudflare_connection_revoke`），运行中不准入任何操作，资格认证前显示不可用；连接后首次导入步骤说明 Zone 已在连接时导入，没有单独的观察导入；手动添加复用 `local_domain_asset_create`；完成页取 Host 的域名数与已应用的服务器 revision；可跳过）；工作区只组合有 Host 读取的资产库（手动添加经 `local_domain_asset_create`，域名为去重键，已有域名被 Host 拒绝且如实提示）、域名详情（目标价编辑）、DNS 健康（任一 ADR-0027 平台的 Zone 绑定与只读 Zone 观察事实；目前只有 Cloudflare Zone 有观察，其他平台的绑定显示为未观察，不借用别的平台的观察；搜索由 Host 按资产库前缀规则执行，按 Host 页读取，观察数、未观察数与告警数取 Host 的全量计数；所有权验证与委派判断显示为未接入；未绑定且有本资产同名 Zone 的已确认 Cloudflare 观察时，可在可写界面经 `local_domain_asset_provider_bind` 绑定该 Zone；Zone 只经已认证的 Cloudflare 连接观察，资格认证前连接不可用，所以目前不会出现）、续费（从资产库「60 天内到期」进入，`local_renewals_read` 中仍需续费（未售出、未放弃、未归档）的到期资产，与资产库到期计数同一口径，按 Host 页读取，到期数与自动续费覆盖取 Host 的全量计数；自动续费与最近确认的注册商；续费价格、预算与计划没有已认证的注册商能力，显示为不可用，不提供选择、年限或续费操作）、批量任务（`local_batch_operations_read` 的操作计划列表：阶段、目标数、平台、计划与执行计数，不含计划或操作标识；原通用列表行不可打开；另有 Afternic 下架专用连接/域名选择、持久预览、整批批准、历史与详情，动作须满足当前权限、资格和 Native 执行门禁）、销售（`local_sales_read` 中已完成运行确认的最新挂牌观察，由 Host 将同一域名的各市场合并为一行并按 Host 页读取，在售数与挂牌估值取 Host 的全量计数，两个市场的确定状态不同时显示“市场间不一致”（与同步冲突中心区分），有市场未确认时显示未确认，价格不一致时显示未观察价格且不计入挂牌估值，均不代为择一；报价、成交、浏览量与上架日期没有已认证能力，显示为不可用，不提供任何挂牌或报价操作）、冲突中心、人工任务（`local_manual_tasks_read` 中等待用户在平台官方控制台完成的计划项，按操作、平台连接与能力归并；打开平台、标记完成、重新检查与接受风险在能力资格认证前不可用，没有浏览器会话或授权执行控件）、操作历史（`local_history_read` 的本地 Revision 账本：最新 500 条资产编辑/删除、同步状态与字段差异，今日变更由 Host 按本地日界对全账本计数，同一次读取的各窗口使用同一本地日，本地日结束时自动重新读取；仅当上一个本地 Revision 未冲突/被拒且其间未应用任何服务端 Revision 时才显示前值，否则前值显示未知；回滚与导出在撤销能力资格认证前不可用，所有 Revision 只读）与设置（`local_settings_read` 中 ADR-0027 任一平台的脱敏连接与角色，Cloudflare、Afternic、Spaceship 和阿里云 Registrar 有具名接入路径，其余平台按当前证据显示，每项能力在资格认证前显示不可用；“关于”报告其他读取会拒绝的旧数据行数及受影响的读取，修复尚不可用；设备目录已有 Native/Cloud 来源（Standby 只读、本机命名仅 Active）；许可、拉取频率与构建信息尚无 Host 来源，显示为不可用），写入仅在 Active 且持有 mutate 能力时可达。Cloudflare 的连接与撤销经引导进入生产组合（设置在可写时提供“重新运行接入向导”，连接行本身不带操作）；单独的 Zone 观察仍无生产入口；Host 的 ADR-0027 资格登记为空，激活、凭据准备、观察与新建连接（`cloudflare_connection_create`）在 Host 内被拒绝（撤销与恢复不受限）；激活经手动添加的同一创建路径把 Zone 导入为资产。Linux 构件按 ADR-0025 可启动。商业只读/Standby 可进入同步只读视图但没有 resolve admission；locked、retryable、security、recovery surface 均 route-free。冲突解决后只会一次性发布同一 Host generation 的业务状态、资产列表、冲突与同步快照。 | D1+C1 客户路径已有独立评估证据；D1+S1 六项标准及 mutation controls 也已独立复审通过。两者都是有界局部结论，不是全系统 V1 acceptance，且针对的是已移除的旧界面组合；新界面已组合，证据必须在真实构件上重新取得。 | 在冻结候选快照上完成账号、商业授权、本地业务、同步和 Connector 的全系统旅程；Host 原子撤销（准备即停用、墓碑替换 custody）已存在，生产界面的撤销入口随 Cloudflare 能力资格认证提供。 |
| **S1 Sync** | tenant-neutral Push/ACK/Pull/Checkpoint 合同、Cloud ledger、local materializer、Native fixed-origin transport、SyncLane、ProjectionLane、冲突/墓碑底座和退出 drain 已有实现；客户使用持久化 `SyncSnapshot`（pending/open-conflict/rejected counts、applied revision、last activity）和 `checking`/`reachable`/`offline`/`blocked` transport 状态，冲突查看与单候选本地 resolve 已接入。Host 对已提交的可见 Pull/ACK/reject/recovery 变化线性推进 `readGeneration`，精确重放不重复推进；resolve 首次成功严格返回 `expected + 1`。Push/Pull/Checkpoint 按 fail-closed 固定优先级聚合，取消后的迟到成功不能发布。Native 启动/重启从 `checking` 开始，不复用上次成功状态。内部复制诊断不属于客户状态模型。 | D1+S1 范围曾通过独立 evaluator（针对已被 `brand/` 重建替换的旧界面组合，对当前界面只是历史仓库证据）：六项标准无 blocker，ACK generation、冲突重放、严格 IPC、聚合优先级和 generation-stable publication 五项 mutation control 均被杀死。该证据不覆盖 live PostgreSQL 或全系统 V1。 | 完成受控环境离线、重启、空副本 no-op、Pull 合并、ACK、容量与并发集成验收；补充 live PostgreSQL 并发/RLS 资格。 |
| **C1 Local Connector** | Cloudflare Zone/DNS 只读 Service、固定官方 origin HTTPS、Host-local Token custody、durable prewrite deny fence、ProviderLane、activation/observation Tauri 命令、bounded status/read 和本地优先结果已存在；现有资产本地资源绑定已持久化，域名能力目录和资金确认协议已定义但不可执行。 | Host 原子撤销已存在（`cloudflare_connection_revoke`：准备即拒绝凭据使用，Secure Host 以无 Token 墓碑替换 exact Active 信封）。真实受控 Zone 验证、撤销和 post-marker remediation 仍未取得生产资格；Cloudflare、Spaceship 和阿里云 Registrar 已组合完整归集。DNS 写入、DNSSEC 和监控仍待实现。 | 资产创建、绑定 UI、Grant/Lease 门禁和凭据维护入口已组合；按 ADR-0032 优先推进统一归集、交易上下架和所有权验证，逐项实现其余能力及真实资格。减少凭据持有的维护入口不以 Provider 执行资格为前置。 |
| **V1 集成所有者** | 各底层模块已有大量局部测试和策略检查。`pnpm check:candidate` 在干净提交上分别以 umask `002` 与 `022` 运行根 `pnpm check`，生成可归因的冻结候选记录（[`docs/phase0/candidates/`](phase0/candidates/)）。 | **未完成。** 候选记录只是该提交的本地实现证据；D1+S1 的独立 PASS 是旧界面组合上的局部证据；域名合同尚未形成完整 Provider manifest 或生产执行链，全系统独立验收尚未进行。 | 阶段 2–3 完成后在新的冻结候选上执行账号/商业授权、Desktop 授权、本地业务、同步、Cloudflare、Cloud/PostgreSQL、Tauri/Rust 的全系统验收与独立复审。 |

Afternic 设置已组合连接、完整市场库存扫描、原子资产归集和按连接代次的 Listing 观察。Linux debug 使用 Native 托管的真实账号凭据首次导入 188 个域名，重开后再次读取 188 个，新增 0，用户已在界面确认数据正确。上架、改价、下架及官方 `OWNERSHIP_REVIEW` 复核共用原 ProviderLane，整批预览批准一次，持久记录唯一尝试并以精确 GET 对账。`wecin.com` 三项 Listing 变更的真实验收仍需共享开发 Cloud 接收对应签名执行证据；私有验证、DNS、换机后的复核、双系统实机及发行资格继续实施。

Cloudflare Registrar 已接通账户注册列表、设置页持久刷新、SQLCipher 原子提交和重开续读。Cloudflare、Spaceship、阿里云的当前注册资料已接入资产和续费读取。真实接口验收需要 Native 凭据中可读的 Zone、账户注册列表权限及受控 GoodDealer 授权。无可用 Zone 的独立账户接入及逐笔确认的续费交易继续实施。

Spaceship 的 Registrar 已接通独立原生凭据、账户完整读取、持久资产归集和重开续读。具名开发验收与真实只读账户仍待落实。SellerHub 按市场实施顺序推进。

普通交接来源现已组合真实签名执行证据、三流封链、持久原请求对账、崩溃续作与设置确认入口；无已初始化副本的目标已可发现、一次确认后安装最后成功同步的资产/代次/墓碑并激活，或安全终止该次引导；未知结果及重开按持久原身份对账，Active 身份早于激活回执到达时保持受限，回执与新上下文齐备后开放业务。精确终止且可证明未写库的安装现可保留原始终态后重新确认接收；可能已写库仍保留并要求恢复。强制接管已组合专用重新认证、一次预览批准、持久等待/取消、期限后首次云恢复与激活；已有副本替换及无来源 Lease 云恢复仍未交付；首次安装的最终源码证据见执行台账，真实双设备验收仍待取得。Windows custody/录入与真实依赖目标编译已完成，双系统实机资格和恢复发布继续取证；平台线继续 Afternic 上架、改价与自动验证。

## 当前执行顺序

v1 按以下阶段推进。阶段编号只表示顺序，不是新的工作包；每个阶段写明所属的正式工作包。
具体工作包和真实依赖按 [落地策略](IMPLEMENTATION_STRATEGY.md)推进；编号不作为跨工作流的全局阻塞条件。
各阶段的验收标准见 [VERIFICATION.md](VERIFICATION.md#多平台交付阶段验收)，任务清单见
[执行计划](phase0/PHASE0_EXECUTION_PLAN.md#v1-阶段任务清单)，执行与评估流程见
[ORCHESTRATION.md](ORCHESTRATION.md)。

| 阶段 | 工作包 | 目标 | 进入条件 |
| --- | --- | --- | --- |
| **1. 当前态收口与冻结候选** | S0、V1 | 路线图、验收矩阵、迁移目录、模块 README 与执行台账准确区分源码实现、局部验证、V1 验收与外部资格；建立可归因、可审查的冻结候选快照。 | 无。 |
| **2. Desktop 设计页面生产组合** | D1、H1 | DNS 健康、设置、销售、续费、批量、历史与人工任务从 `visual-fixtures` 设计稿变为 Host 投影驱动的生产页面；人工任务只表达“在平台页面完成、回到 Desktop 对账”；没有 Host 能力的控件显示不可用及原因。 | 阶段 1。 |
| **3. Cloudflare 路径稳定** | C1、L1、H1、D1 | 引导流程（欢迎 → 设备门 → 连接 Cloudflare（可跳过）→ 从观察导入或手动添加 → 完成）、资产创建、绑定 UI、Grant/Lease 能力门禁和原子凭据撤销进入生产导航；Cloudflare 流程的 generation/auth fences 接入生产组合。 | 阶段 2 的页面骨架。 |
| **4. 当前范围全系统 V1 汇合验收** | V1 | 在同一候选快照上覆盖账号/商业授权、Desktop OAuth/Grant/Lease、本地业务、同步/Conflict Center、Cloudflare、Cloud/PostgreSQL 和 Tauri/Rust，并完成独立复审。通过即为 ADR-0027 所说的“Cloudflare 路径稳定”。 | 阶段 3。 |
| **5. 两平台实际能力与必要共用合同** | C1、L1、H1、D1 | 复用已完成连接/角色/Listing 绑定结构，以 Cloudflare 与 Afternic 真实客户步骤验证共用面；实现具名权限、持久计划/对账、必要 DNS 与所有权验证，资金逐笔确认。Cloudflare 其余能力按依赖接续。 | 所需授权、连接与已核实协议就绪；不以前一阶段全量验收或全部 Cloudflare 写能力为 Afternic 前置，不预铺十二个空 Service。 |
| **6. Afternic 与统一资产归集** | C1、L1、H1、D1 | 优先完成现有资产来源归集、Afternic Listing 与整批一次确认、结果对账。 | 所需连接/计划/授权基础就绪；不要求先完成所有 Cloudflare 写能力。 |
| **7. Atom（含 AtomRegistrar）** | C1、D1 | 官方卖家库存已组合，继续真实读取验收、上下架、验证闭环和其余能力。query-string token 留在 Host。 | 具名开发准入和获 Seller API 访问的账号，验证结果以当前真实账户观察为准。 |
| **8. Spaceship（含 SellerHub）** | C1、D1 | 统一 registrar/dns/marketplace 连接；验证记录获取、DNS 发布与平台复核。 | 所需框架与 DNS Service 就绪，可与其他平台实现交叠。 |
| **9. Sedo** | C1、D1 | SOAP 卖家组合管理、有限批次与异步检查；核实认证、parking 副作用和验证流程。 | 官方合同和账户准入完成。 |
| **10. 易名、阿里云、22.cn 与其余注册商** | C1、L1、H1、D1 | 按易名 → 阿里云 → 22.cn 的市场优先级交付资产归集及上下架；继续完成 GoDaddy、Porkbun、Dynadot、Namecheap 和 Cloudflare 全部目标能力。 | 各平台所需依赖就绪；注册商/DNS 读取优先服务实际资产来源，可先于对应市场写入。 |
| **11. 1.0 资格与发行** | V1 与外部资格 | 关闭 Q-CF、Q-PROV 及下方其余外部资格，取得 `1.0.0` / `stable` 批准（ADR-0018）。 | 阶段 5–10 全部达到终止条件。 |

每个平台阶段（5–10）使用同一模板；按 ADR-0027 的用户工作流纵向推进，完整能力目录持续追踪，不把尚未实现记作已完成：

1. 已确认官方能力按官方合同实现，其余缺口直接调查并实现当前账户的私有 HTTP 协议；事实与脱敏合同证据更新到 [API 核查](PROVIDER_API_REVIEW.md)，不写回 ADR。旧文档和设计稿不作接口证据。
2. 列出能力清单并映射到四种角色；平台不提供的能力在 manifest 中带原因标记为不可执行。
3. 实现私有 Service、严格合同与负向测试。
4. 取得逐项能力资格证据；资格前 UI 显示不可用。
5. 同步当前态文档。

以下两条与平台阶段并行，不互相替代：

- **同步、持久化与外部资格补强。** workspace mutation ingest 路径已在 CI 的 PostgreSQL 18.6 上取得容量、
  600 s 混合负载与容器 SIGKILL 崩溃恢复证据（`wp2-workspace-sync-durability`，已确认写入无丢失）；完整 RLS
  资格、超过 10 分钟的长稳与操作系统级故障仍未取得。另需 Q-OPS/Q-AUDIT、Q-CF、Q-PROV、payment/live sales、
  Q-NATIVE 和 Q-REL 各自的证据。
- **可恢复性交付。** 产品负责人于 2026-11-18 明确要求换机云恢复与独立业务备份；两者都是待交付能力，不能以“不属于主路径”取消。已接受恢复架构见 [ADR-0023](adr/0023-business-backup-and-recovery.md)。旧 GDBK v1 的实现前提包括 native picker/稳定 handle、真实 KEK custody、独立
  non-rollbackable anchor、true create-only slot custody、safe active-DB move detection 和目标平台故障验证缺一
  不可（`desktop_local_host/source.rs` 的快照临时目录已改为仅属主可访问）。此前能力保持 `unavailable`。

### 终止条件

- **v1 完成：** 十二个平台的每项域名能力要么取得资格，要么在 manifest 中带原因标记为不可执行；阶段 4 的 V1
  验收在最终候选上重新通过，ADR-0027 的关键用户旅程与 ADR-0023 的两条恢复路径实际完成；Q-CF、Q-PROV 与其余外部资格关闭，`1.0.0` / `stable` 获得批准。
- **接入方式调整（不阻塞其他平台）：** 缺少官方 API 或公开 API 准入暂不满足时，按
  [ADR-0027](adr/0027-multi-platform-domain-providers-and-marketplaces.md)进入自研私有 API 开发；当前未找到官方支持的能力缺口
  全部采用此路径，协议调查属于开发工作包，社区成品与更多官方搜索不再作为前置条件。
  具体账号权限、条款或未取得当前协议证据导致暂不可执行时，保留原因、后续实现任务与人工恢复，不能视为自动化目标完成。
- **暂停并升级给产品负责人：** 能力只能靠浏览器自动化或代理/自动出价实现；框架需要架构级改动（需新 ADR）；
  平台没有沙箱且资格需要真实资金或付费资产；全部可调查接入来源仍无法形成必要平台事实。
- **范围冻结：** 不新增清单外平台、CSV import、内嵌浏览器或凭据迁移；这些变化必须先有新的 ADR。

## 外部资格与发行轨道

以下项目全部仍为开放状态，并由 [Phase 0 外部资格台账](phase0/PHASE0_GATE_REGISTER.md) 管理。它们不会阻止本地功能开发，也不能替代本地功能完成：

| 资格 | 当前边界 |
| --- | --- |
| **Q-AUDIT** 生产 OpenBao custody | 开发 Transit 已用于功能验证；生产集群、不可导出 key、workload identity、seal/轮换和独立审查未取得。 |
| **Q-CF** Cloudflare 真实资格 | Host-local 只读实现存在；真实受控 Zone、最小 Token、限流/移除行为和独立安全审查未取得。 |
| **Q-PROV** Cloudflare 之外首发平台逐项资格 | Afternic 库存及上架/改价/下架客户流程已有源码组合，Linux 已完成 Afternic 真实库存归集；Spaceship Registrar 已组合账户读取。生产资格待取得，每项能力需要条款审查、平台准入（Atom、AtomRegistrar、Namecheap 有账户门槛）、受控资产或沙箱、限流/错误、未知结果对账和独立安全审查。 |
| **Q-OPS** 生产运行 | 共享 VPS 开发组合不等于生产；生产 PostgreSQL、邮件、scheduler/worker、监控、灾备和环境隔离未资格化。 |
| **支付与销售资格** | Stripe test mode 已验证；Stripe live、生产商户值、税务/销售地区尚未启用。PayPal 保持可选且不阻断首发。 |
| **Q-NATIVE / Q-REL** 原生与发行 | 最终构件签名/公证、目标平台验证、归档、独立审查和 `1.0.0` / `stable` 批准均未取得。 |

## v1 范围边界

首发目标包含个人默认工作区、本地域名资产、secret-free 同步、商业授权，以及十二个平台（Cloudflare、
Spaceship、Atom、Afternic、Namecheap、Dynadot、GoDaddy、Porkbun、Sedo、易名、阿里云、22.cn）各自全部的域名相关能力：注册商生命周期、
DNS/DNSSEC/Nameserver、交易市场、获取与监控（[ADR-0027](adr/0027-multi-platform-domain-providers-and-marketplaces.md)）。
每项 Provider 能力必须单独实现和资格化。所有资金操作（含每一次出价）逐笔用户确认；官方缺口继续采用
ADR-0027 的自研私有 API 开发路径，人工页面交接用于尚不可执行步骤及登录挑战，返回后在 Desktop 对账。
市场顺序按 [ADR-0027](adr/0027-multi-platform-domain-providers-and-marketplaces.md)：Afternic → Atom → SellerHub →
Sedo → 易名 → 阿里云 → 22.cn，资产来源与 DNS 依赖同步推进。
浏览器自动化、非域名 Provider 产品、清单外平台、团队/多工作区、凭据迁移和 CSV import 仍是排除项。
当前生产源码已组合 Cloudflare Zone/DNS 只读观察及 Afternic 连接、库存、持久上架/改价/下架和官方审核复核。真实账号接口和自动所有权验证闭环仍待交付。
完整验收定义见 [VERIFICATION.md](VERIFICATION.md)。
