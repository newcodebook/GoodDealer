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

| 工作包 | 当前实现 | 验收状态 | 仍需完成 |
| --- | --- | --- | --- |
| **S0 架构与数据治理** | 本地 SQLCipher 权威、Cloud 控制面/脱敏副本、秘密隔离、同步白名单和 v1 排除项已有 ADR 与协议约束。 | 核心决策已建立；源码、测试、脚本与当前态文档中的临时 `P0-*` 任务编号已改写为所表达的不变量，四类状态的区分已完成一次全仓扫描（阶段 1）。例外：已应用且受校验和固定的本地迁移（`sync_v3.sql`、`sync_v4.sql` 注释中的 `P0-04`）和已持久化的 schema epoch/错误码（`P0_07_CREDENTIAL_SCHEMA*`）是冻结标识，改写会破坏已有数据库，只能随新的 schema epoch 一并淘汰。这不是 V1 验收。 | 在阶段 4 的冻结候选上重新做全仓术语、边界和依赖扫描。 |
| **L1 local-storage** | `DesktopLocalHost` 已拥有 SQLCipher 路径/密钥/数据库身份、完整业务 schema、本地资产读写、字段版本、Inbox/Outbox、冲突、墓碑、Provider 本地状态及恢复协议底座。 | 源码已实现并有广泛局部测试；最新跨模块改动之后尚无一次新鲜 V1 验收。 | 完成与 D1/S1/C1 的客户纵向回归、规模/故障回归；生产备份与 rebootstrap 继续保持不可用，直到其独立原生前提成立。 |
| **H1 Native Host** | Native 已组合 PKCE、device/refresh custody、Grant/Lease 双重验签、运行时授权门禁、Sync/Projection/Provider lanes、Cloudflare Keychain v3 发布和窄 IPC。 | Host 源码基本完整，局部负向测试存在；尚未随最终 Renderer 组合做新鲜 V1 验收。 | 验证最终 command/manifest/capability/adapter 精确一致；完成目标平台 Keychain 与最终构件资格；Linux 启动与登录 custody 已按 ADR-0025 接入 Secret Service，Provider 凭据与备份在 Linux 仍不可用。 |
| **A1 Cloud identity/devices** | 当前源码含注册、邮箱验证/重发、密码登录/恢复、Session discovery、登录轮换、服务端退出、默认工作区、设备 PoP、access/refresh、Grant v3、ActiveDeviceLease、商业权威及 Stripe test-mode 商业链路；开发组合保留 loopback Mailpit，staging 组合通过已验证 `gooddealer.com` 域名的 Resend 发件地址发送事务邮件。 | Account access 的本地、PostgreSQL 与 staging 浏览器证据覆盖原子回滚、并发、expiry/replay、邮件 retry/dead-letter、reset epoch、rotation、刷新恢复和 logout；真实测试用户已在无数据库/开发工具权限下完成完整旅程。 | 公开注册和生产邮件资格、Stripe live、税务范围、生产 OpenBao、生产 worker、HA 与灾难恢复继续归入各自外部资格；staging 仍运行在当前共享 VPS/开发数据库上。 |
| **D1 Desktop** | 已按 `brand/` 重建：生产根组件只依据 Host 事实裁决页面（`app/desktop-presentation.ts`），未就绪、Host 不可用、浏览器 PKCE 登录与锁定状态均为 route-free 页面；Active 且尚无域名的工作区在本次会话首次进入时显示引导（kit 接入向导：设备门只显示 `local_device_lease_read` 校验过的 Lease Epoch，Host 无设备名故不显示；Cloudflare 在资格认证前显示不可用且无连接路径，观察导入同样不可用；手动添加复用 `local_domain_asset_create`；完成页取 Host 的域名数与已应用的服务器 revision；可跳过）；工作区只组合有 Host 读取的资产库（手动添加经 `local_domain_asset_create`，域名为去重键，已有域名被 Host 拒绝且如实提示）、域名详情（目标价编辑）、DNS 健康（任一 ADR-0027 平台的 Zone 绑定与只读 Zone 观察事实；目前只有 Cloudflare Zone 有观察，其他平台的绑定显示为未观察，不借用别的平台的观察；搜索由 Host 按资产库前缀规则执行，按 Host 页读取，观察数、未观察数与告警数取 Host 的全量计数；所有权验证与委派判断显示为未接入；未绑定且有本资产同名 Zone 的已确认 Cloudflare 观察时，可在可写界面经 `local_domain_asset_provider_bind` 绑定该 Zone；生产导航尚无建立连接或观察的入口，所以目前不会出现）、续费（从资产库「60 天内到期」进入，`local_renewals_read` 中仍需续费（未售出、未放弃、未归档）的到期资产，与资产库到期计数同一口径，按 Host 页读取，到期数与自动续费覆盖取 Host 的全量计数；自动续费与最近确认的注册商；续费价格、预算与计划没有已认证的注册商能力，显示为不可用，不提供选择、年限或续费操作）、批量任务（`local_batch_operations_read` 的操作计划列表：阶段、目标数、平台、计划与执行计数，不含计划或操作标识；新建、审批与执行在操作能力资格认证前显示不可用，行不可打开）、销售（`local_sales_read` 中已完成运行确认的最新挂牌观察，由 Host 将同一域名的各市场合并为一行并按 Host 页读取，在售数与挂牌估值取 Host 的全量计数，两个市场的确定状态不同时显示“市场间不一致”（与同步冲突中心区分），有市场未确认时显示未确认，价格不一致时显示未观察价格且不计入挂牌估值，均不代为择一；报价、成交、浏览量与上架日期没有已认证能力，显示为不可用，不提供任何挂牌或报价操作）、冲突中心、人工任务（`local_manual_tasks_read` 中等待用户在平台官方控制台完成的计划项，按操作、平台连接与能力归并；打开平台、标记完成、重新检查与接受风险在能力资格认证前不可用，没有浏览器会话或授权执行控件）、操作历史（`local_history_read` 的本地 Revision 账本：最新 500 条资产编辑/删除、同步状态与字段差异，今日变更由 Host 按本地日界对全账本计数，同一次读取的各窗口使用同一本地日，本地日结束时自动重新读取；仅当上一个本地 Revision 未冲突/被拒且其间未应用任何服务端 Revision 时才显示前值，否则前值显示未知；回滚与导出在撤销能力资格认证前不可用，所有 Revision 只读）与设置（`local_settings_read` 中 ADR-0027 任一平台的脱敏连接与角色，非 Cloudflare 平台的接入方式在其平台阶段核实前显示为未知，每项能力在资格认证前显示不可用；“关于”报告其他读取会拒绝的旧数据行数及受影响的读取，修复尚不可用；设备、许可、拉取频率与构建信息尚无 Host 来源，显示为不可用），写入仅在 Active 且持有 mutate 能力时可达。Cloudflare 流程的 generation/auth fences 仍在 `features/connections`，尚未进入生产导航；Host 的 ADR-0024 资格登记为空，激活、凭据准备、观察与新建连接（`cloudflare_connection_create`）在 Host 内被拒绝（撤销与恢复不受限）。Linux 构件按 ADR-0025 可启动。商业只读/Standby 可进入同步只读视图但没有 resolve admission；locked、retryable、security、recovery surface 均 route-free。冲突解决后只会一次性发布同一 Host generation 的业务状态、资产列表、冲突与同步快照。 | D1+C1 客户路径已有独立评估证据；D1+S1 六项标准及 mutation controls 也已独立复审通过。两者都是有界局部结论，不是全系统 V1 acceptance，且针对的是已移除的旧界面组合；新界面已组合，证据必须在真实构件上重新取得。 | 在冻结候选快照上完成账号、商业授权、本地业务、同步和 Connector 的全系统旅程；Host 原子撤销（准备即停用、墓碑替换 custody）已存在，生产界面的撤销入口随 Cloudflare 能力资格认证提供。 |
| **S1 Sync** | tenant-neutral Push/ACK/Pull/Checkpoint 合同、Cloud ledger、local materializer、Native fixed-origin transport、SyncLane、ProjectionLane、冲突/墓碑底座和退出 drain 已有实现；客户使用持久化 `SyncSnapshot`（pending/open-conflict/rejected counts、applied revision、last activity）和 `checking`/`reachable`/`offline`/`blocked` transport 状态，冲突查看与单候选本地 resolve 已接入。Host 对已提交的可见 Pull/ACK/reject/recovery 变化线性推进 `readGeneration`，精确重放不重复推进；resolve 首次成功严格返回 `expected + 1`。Push/Pull/Checkpoint 按 fail-closed 固定优先级聚合，取消后的迟到成功不能发布。Native 启动/重启从 `checking` 开始，不复用上次成功状态。内部复制诊断不属于客户状态模型。 | D1+S1 范围曾通过独立 evaluator（针对已被 `brand/` 重建替换的旧界面组合，对当前界面只是历史仓库证据）：六项标准无 blocker，ACK generation、冲突重放、严格 IPC、聚合优先级和 generation-stable publication 五项 mutation control 均被杀死。该证据不覆盖 live PostgreSQL 或全系统 V1。 | 完成受控环境离线、重启、空副本 no-op、Pull 合并、ACK、容量与并发集成验收；补充 live PostgreSQL 并发/RLS 资格。 |
| **C1 Local Connector** | Cloudflare Zone/DNS 只读 Service、固定官方 origin HTTPS、Host-local Token custody、durable prewrite deny fence、ProviderLane、activation/observation Tauri 命令、bounded status/read 和本地优先结果已存在；现有资产本地资源绑定已持久化，域名能力目录和资金确认协议已定义但不可执行。 | Host 原子撤销已存在（`cloudflare_connection_revoke`：准备即拒绝凭据使用，Secure Host 以无 Token 墓碑替换 exact Active 信封）。真实受控 Zone 验证、撤销和 post-marker remediation 仍未取得生产资格；DNS 写入、DNSSEC、Registrar 和监控尚无生产执行链。 | 资产创建、绑定 UI、Grant/Lease 能力门禁和原子凭据撤销已交付，接着以 Cloudflare 全部域名能力抽象多平台共用框架，按 ADR-0027 顺序逐平台实现注册商、DNS/DNSSEC、交易市场、获取与监控以及真实能力资格；撤销入口在能力资格认证前不进入生产界面。 |
| **V1 集成所有者** | 各底层模块已有大量局部测试和策略检查。`pnpm check:candidate` 在干净提交上分别以 umask `002` 与 `022` 运行根 `pnpm check`，生成可归因的冻结候选记录（[`docs/phase0/candidates/`](phase0/candidates/)）。 | **未完成。** 候选记录只是该提交的本地实现证据；D1+S1 的独立 PASS 是旧界面组合上的局部证据；域名合同尚未形成完整 Provider manifest 或生产执行链，全系统独立验收尚未进行。 | 阶段 2–3 完成后在新的冻结候选上执行账号/商业授权、Desktop 授权、本地业务、同步、Cloudflare、Cloud/PostgreSQL、Tauri/Rust 的全系统验收与独立复审。 |

## 当前执行顺序

v1 按以下阶段推进。阶段编号只表示顺序，不是新的工作包；每个阶段写明所属的正式工作包。
各阶段的验收标准见 [VERIFICATION.md](VERIFICATION.md#多平台交付阶段验收)，任务清单见
[执行计划](phase0/PHASE0_EXECUTION_PLAN.md#v1-阶段任务清单)，执行与评估流程见
[ORCHESTRATION.md](ORCHESTRATION.md)。

| 阶段 | 工作包 | 目标 | 进入条件 |
| --- | --- | --- | --- |
| **1. 当前态收口与冻结候选** | S0、V1 | 路线图、验收矩阵、迁移目录、模块 README 与执行台账准确区分源码实现、局部验证、V1 验收与外部资格；建立可归因、可审查的冻结候选快照。 | 无。 |
| **2. Desktop 设计页面生产组合** | D1、H1 | DNS 健康、设置、销售、续费、批量、历史与人工任务从 `visual-fixtures` 设计稿变为 Host 投影驱动的生产页面；人工任务只表达“在平台页面完成、回到 Desktop 对账”；没有 Host 能力的控件显示不可用及原因。 | 阶段 1。 |
| **3. Cloudflare 路径稳定** | C1、L1、H1、D1 | 引导流程（欢迎 → 设备门 → 连接 Cloudflare（可跳过）→ 从观察导入或手动添加 → 完成）、资产创建、绑定 UI、Grant/Lease 能力门禁和原子凭据撤销进入生产导航；Cloudflare 流程的 generation/auth fences 接入生产组合。 | 阶段 2 的页面骨架。 |
| **4. 当前范围全系统 V1 汇合验收** | V1 | 在同一候选快照上覆盖账号/商业授权、Desktop OAuth/Grant/Lease、本地业务、同步/Conflict Center、Cloudflare、Cloud/PostgreSQL 和 Tauri/Rust，并完成独立复审。通过即为 ADR-0027 所说的“Cloudflare 路径稳定”。 | 阶段 3。 |
| **5. 多平台共用框架与 Cloudflare 全能力** | C1、L1、H1、D1 | 平台连接与角色模型（registrar、dns、marketplace、acquisition）、binding 的 `listing` 资源类型、每平台私有 Service 骨架、能力 manifest 与资格登记、跨平台所有权验证的本地操作计划、对账任务、逐笔资金确认；同时补齐 Cloudflare 的 Registrar、DNS/DNSSEC 写入与监控。 | 阶段 4。 |
| **6. Porkbun** | C1、D1 | 第一个非 Cloudflare 平台，验证框架无需改动核心模型。 | 阶段 5。 |
| **7. Spaceship（含 SellerHub）** | C1、D1 | 第一个多角色平台：一个平台连接同时承担 registrar、dns、marketplace 角色，凭据范围与资格按角色隔离。 | 阶段 6。 |
| **8. Dynadot、Namecheap** | C1、D1 | Dynadot HMAC 签名密钥只在 Host custody；Namecheap IP 白名单不满足时失败关闭并给出修复说明。 | 阶段 6；可与阶段 7 并行。 |
| **9. GoDaddy、Afternic** | C1、D1 | 注册商、DNS 与 Afternic Portfolio API 的 Listing/改价；批量改价先生成计划再逐项确认。 | 阶段 6。 |
| **10. Atom（含 AtomRegistrar）** | C1、D1 | Listing、逐笔确认的出价与 AtomRegistrar；query-string token 不进入日志、错误或任何 URL 记录。 | 阶段 6；Atom 准入门槛（见 ADR-0027）。 |
| **11. 1.0 资格与发行** | V1 与外部资格 | 关闭 Q-CF、Q-PROV 及下方其余外部资格，取得 `1.0.0` / `stable` 批准（ADR-0018）。 | 阶段 5–10 全部达到终止条件。 |

每个平台阶段（5–10）使用同一模板，且该平台的全部域名能力在同一阶段完成，不拆到以后：

1. 从当次查到的官方文档或 SDK 核对平台事实，更新 ADR-0027 的事实快照（日期与链接）；仓库旧文档和设计稿不作依据。
2. 列出能力清单并映射到四种角色；平台不提供的能力在 manifest 中带原因标记为不可执行。
3. 实现私有 Service、严格合同与负向测试。
4. 取得逐项能力资格证据；资格前 UI 显示不可用。
5. 同步当前态文档。

以下两条与平台阶段并行，不互相替代：

- **同步、持久化与外部资格补强。** live PostgreSQL 并发/RLS、容量、崩溃恢复和长时间运行验证，以及
  Q-OPS/Q-AUDIT、Q-CF、Q-PROV、payment/live sales、Q-NATIVE 和 Q-REL 各自的证据。
- **生产备份/rebootstrap。** 不属于 V1 主路径。native picker/稳定 handle、真实 KEK custody、独立
  non-rollbackable anchor、true create-only slot custody、safe active-DB move detection 和目标平台故障验证缺一
  不可；`backup/source.rs` 中按进程 umask 创建的快照临时目录必须先改为仅属主可访问。此前能力保持 `unavailable`。

### 终止条件

- **v1 完成：** 8 个平台的每项域名能力要么取得资格，要么在 manifest 中带原因标记为不可执行；阶段 4 的 V1
  验收在最终候选上重新通过；Q-CF、Q-PROV 与其余外部资格关闭，`1.0.0` / `stable` 获得批准。
- **单项能力降级（不阻塞其他平台）：** 平台没有官方 API、API 准入门槛无法满足、条款禁止这种用法，或不提供
  满足最小权限的授权方式时，该能力保持不可执行，改为对账任务（如适用），原因记入 ADR-0027 事实快照，随后进入下一平台。
- **暂停并升级给产品负责人：** 能力只能靠浏览器自动化或代理/自动出价实现；框架需要架构级改动（需新 ADR）；
  平台没有沙箱且资格需要真实资金或付费资产；官方文档无法访问导致平台事实无法核实。
- **范围冻结：** 不新增清单外平台、CSV import、内嵌浏览器或凭据迁移；这些变化必须先有新的 ADR。

## 外部资格与发行轨道

以下项目全部仍为开放状态，并由 [Phase 0 外部资格台账](phase0/PHASE0_GATE_REGISTER.md) 管理。它们不会阻止本地功能开发，也不能替代本地功能完成：

| 资格 | 当前边界 |
| --- | --- |
| **Q-AUDIT** 生产 OpenBao custody | 开发 Transit 已用于功能验证；生产集群、不可导出 key、workload identity、seal/轮换和独立审查未取得。 |
| **Q-CF** Cloudflare 真实资格 | Host-local 只读实现存在；真实受控 Zone、最小 Token、限流/移除行为和独立安全审查未取得。 |
| **Q-PROV** 其余 7 个平台逐项资格 | 尚无实现；每项能力需要条款审查、平台准入（Atom、AtomRegistrar、Namecheap 有账户门槛）、受控资产或沙箱、限流/错误、未知结果对账和独立安全审查。 |
| **Q-OPS** 生产运行 | 共享 VPS 开发组合不等于生产；生产 PostgreSQL、邮件、scheduler/worker、监控、灾备和环境隔离未资格化。 |
| **支付与销售资格** | Stripe test mode 已验证；Stripe live、生产商户值、税务/销售地区尚未启用。PayPal 保持可选且不阻断首发。 |
| **Q-NATIVE / Q-REL** 原生与发行 | 最终构件签名/公证、目标平台验证、归档、独立审查和 `1.0.0` / `stable` 批准均未取得。 |

## v1 范围边界

首发目标包含个人默认工作区、本地域名资产、secret-free 同步、商业授权，以及 8 个平台（Cloudflare、
Spaceship、Atom、Afternic、Namecheap、Dynadot、GoDaddy、Porkbun）各自全部的域名相关能力：注册商生命周期、
DNS/DNSSEC/Nameserver、交易市场、获取与监控（[ADR-0027](adr/0027-multi-platform-domain-providers-and-marketplaces.md)）。
每项 Provider 能力必须单独实现和资格化。所有资金操作（含每一次出价）逐笔用户确认，没有 API 的操作由
Provider 页面完成后在 Desktop 对账。接入顺序为 Cloudflare（同时抽象共用框架）→ Porkbun → Spaceship →
Dynadot/Namecheap → GoDaddy/Afternic → Atom；交易市场能力在 Cloudflare 路径稳定后开始。
浏览器自动化、非域名 Provider 产品、清单外平台、团队/多工作区、凭据迁移和 CSV import 仍是排除项。
当前生产源码仍只组合 Cloudflare Zone/DNS 只读观察，不得把目标范围当作已完成能力。
完整验收定义见 [VERIFICATION.md](VERIFICATION.md)。
