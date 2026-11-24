# Phase 0 执行计划

2026-11-18 产品决策：按 [ADR-0027](../adr/0027-multi-platform-domain-providers-and-marketplaces.md) 与 [ADR-0023](../adr/0023-business-backup-and-recovery.md)
交付十二平台、非资金整批一次确认、Windows/macOS 完整能力与两条恢复旅程。
下文已勾选的八平台与逐项确认项保留当时证据，不代表新目标完成；后续待办按新决策执行。
实施顺序以 [落地策略](../IMPLEMENTATION_STRATEGY.md) 的实际依赖为准；旧阶段 4 的汇合验收不再阻止市场、设备和恢复实现。

## 2026-11-18 工程结构整合

- 已完成 BusinessDatabase 私有能力与测试拆分、WorkspaceAuthority 与备份工件状态归属、
  Native Cloudflare 适配归属及 Unix OS 密钥库后端提取。数据库 writer、锁顺序和提交栅栏保持。
- 新增 Listing 绑定前向迁移 `202611180001`，支持多市场/多账户及 detached incarnation 历史，
  保留 Registrar/DNS 单资源约束；迁移兼容、身份冲突、跨工作区、平台错配和回滚列入数据库测试。
- 已更新 [工程结构结果](../ENGINEERING_STRUCTURE_REVIEW.md)、[当前实现](../CURRENT_IMPLEMENTATION.md)
  与 [下一轮提示词](../IMPLEMENTATION_PROMPT.md)。真实平台写入、Windows custody、Standby 和双恢复旅程继续按最终 ADR 交付。
- 验证：根 `pnpm check`、local-storage Clippy 与 28 项公开边界编译测试通过；详情见工程结构结果，
  不将 Linux 源码测试作为 Windows/macOS 或真实 Provider 资格。

## 目标

### 2026-11-19 终止安装后接收新交接（源码切片完成）

- 工作包：[重新接收 Task Frame](TARGET_INSTALLATION_RETRY_TASK_FRAME.md)。Cloud 精确 cancelled/failed 终态、可信未写库事实和新确认全部满足后，目标可接收另一交接，原始加密终态与请求证据保留。单 writer、最终提交栅栏和 Native 秘密所有权不变；无 Cloud 合同或 SQL 迁移变更。
- Head v2 原子保存最多 8 个历史引用；文件 AAD 保持 v1，v1 journal 仅在可证明未打开数据库时升级 not_started，否则 legacy_unknown。首次 SQL open 前先落盘 started，实际 SQL 阶段再次检查原工作流终态。可能已写入/截断/授权变化/历史满全部拒绝重新接收，不删除证据或重标 Fresh。
- 客户入口明确展示旧工作流的五类后续资格。新工作流必须新预览、勾选和确认；allowed 轮询保留合法预览但不开始，资格变化撤回预览，开始丢 ACK 仅读状态。Native 只对 Running 结果唤醒安装。
- 独立 UI/adapter 41/41；Storage 独立安装 16、custody 11、控制 14，以及最终并发/跨租户/预算各 1，共 44 项通过。Native 独立安装及 IPC 16、终止 10，共 26 项通过。构建者 Storage 47 targeted/public 2/doc 28，Native 147/Core 84/public 3/doc 4 通过；Linux/Windows 三包全目标严格 Clippy 通过。审查修复 terminal receipt 清掉原 pending 请求和 started 落盘到 SQL 之间取消的两个缺口；详见 [审查记录](../reviews/2026-11-19-target-installation-retry-review.md)，根 `pnpm check` 最终通过：TypeScript 2378、结构策略 214、Rust 861（Storage 572；6 项规模基准 ignored），日志 `target/root-target-installation-retry-check.log`。首轮结构检查拒绝遗漏的新枚举导出，已精确补入公共清单并独立复核，未放宽规则；全仓 fmt、生成 schema 一致性、链接与 diff 检查通过。
- Windows/macOS 实机、真实双设备、部署第五签名用途与发行资格仍待取得。后续继续强制接管、已有副本保留恢复、Afternic 上架/改价/验证及独立跨机恢复，不缩减总任务。

### 2026-11-19 目标设备首次安装与激活（源码切片）

- 工作包：[目标首次安装 Task Frame](TARGET_INSTALLATION_TASK_FRAME.md)。Cloud claim/step/checkpoint/activate/receipt、第五签名用途、真实 checkpoint 与完整代次/墓碑摘要、本地 Host/SQLCipher 首次安装、Native 协调器、IPC 与客户确认入口已实现。仅准入可信 custody 证明尚未初始化的固定本机库；已有副本替换仍拒绝。首次安装到激活的源码与独立验证已通过；后续终止再接收的实施见上节。
- 实际数据库暴露 v3 checkpoint 墓碑表缺少 account capability 权限，追加 023/024 修复。原 022 和先前已应用迁移保持不变。
- 独立审查修正 capability/Lease 的独立注册表验证、journal 正常及崩溃恢复路径同步后才发布 custody head、legacy 空文件不能仅凭长度追认为 fresh，以及未知 activation 下先持久取消意图再对账的顺序。激活丢 ACK 后重开先收到 Active 时仅准入 receipt/status/cancel；原回执与新 execution context 齐备后才展示资产并持久完成。详见 [审查记录](../reviews/2026-11-19-target-installation-review.md)。
- 真实 PostgreSQL：Cloud 完整 OAuth 99/99，root 独立目标回归 29/29（70 项未选择），checkpoint 31/31、bootstrap 14/14 另有通过证据。最终 Native 144、Core 84、public surface 3、doc 4 全过；独立最新二进制安装 13、会话 32、终止 10、verifier 7 全过。Linux/Windows 三包全目标 strict Clippy 通过。
- UI/adapter/状态投影相关 46/46、i18n 19/19；最终 Cloud HTTP/role 15/15。根检查已通过 TypeScript 2370 项、结构策略 214 项及依赖/拓扑检查，Rust 844 项通过（Storage 558，6 项规模基准 ignored），根 `pnpm check` 完整通过，日志 `target/root-target-installation-check-final.log`。此前品牌规则把本地 confirm 函数误认作原生弹窗，已按业务语义重命名；格式、文档链接与 diff 检查通过。Windows/macOS 实机、OpenBao 第五用途部署与真实双设备仍无资格证据。

- 接续核查确认一个未交付旅程：安装 journal 建立后，即使取消/过期且尚未写库，在该提交时仍不能接受另一个工作流。此发现推动上节重新接收切片；已写库不得重标 Fresh，已有副本保留恢复仍需后续交付。

### 2026-11-19 执行证据与目标引导终结（源码切片完成）

- 总任务全文见 [实施目标](../IMPLEMENTATION_GOAL.md)，工作包见 [执行证据 Task Frame](EXECUTION_EVIDENCE_TASK_FRAME.md) 与 [目标引导终结 Task Frame](BOOTSTRAP_TERMINATION_TASK_FRAME.md)。十二平台、双系统和双恢复范围不变。
- 已组合真实签名 context、批准/claim/结果审计、Cloud 精确历史核验与回执、本地三流冻结/封链、初始请求持久化与 resolve-before-POST、后台来源交接及客户确认入口。
- 已组合 Windows 本机 custody、原子私有 ACL、SQLCipher 启动/关闭重开、受限掩码录入；真实 Core/Storage/Tauri Windows GNU 全目标严格 Clippy 通过。恢复 reservation、实机权限/窗口/休眠与发行资格仍未完成。
- 执行证据基线根 `pnpm check` exit 0（结构 213、Protocol 501、Cloud 828、Desktop 357、client-core 425、Storage 521/6 项既有 ignored、Native 106、Core 82）。此后接续目标取消和 context 分阶段发布，最终完整根检查 exit 0（结构 213、Protocol 503、Cloud 833、Desktop 366、client-core 425、Storage 539/6 项既有 ignored、Native 127、Core 82），日志 `target/root-handoff-termination-final-check.log`。
- 目标专用 status/cancel 已贯通 Cloud、无业务库 Host custody、固定 Native 网络与后台、设置/无副本 Standby 客户入口；取消精确原工作流且不授 Active。真实 OAuth 发现 mutation seal 对 login allocation 的错误限制，追加 021 而不改旧迁移；真实 PG 175/175、root 独立目标终结 16/16。
- 独立审查发现并修复首次 marker 前缀、security epoch 变化后永久 pending、后台过期定时器自旋、context 在 power 锁内 custody，以及最终 credential_instance 缺失。证据和限制见 [执行证据审查](../reviews/2026-11-19-execution-evidence-review.md) 与 [目标终结审查](../reviews/2026-11-19-bootstrap-termination-review.md)。
- Native/Storage 最终回归、根检查、格式/文档链接检查和独立审查已通过；最终格式化快照 Windows Storage/Tauri 全目标严格 Clippy 通过，独立 Native session/coordinator/lane 48/48。按本节完整范围提交；目标安装/激活、强制接管、云恢复、独立跨机离线备份与其他市场按原目标继续。

### Phase 0 基础目标

Phase 0 建立“Cloud 控制面授权、本地 SQLCipher 执行业务、Cloud 保存脱敏同步副本”的可验证
纵向，不以部署、Provider 资格或发行证据替代本地实现。

## 已接受 ADR 的落地安排

ADR-0028 → ADR-0019 → ADR-0029 的批次、所有者、前置与验收条件见
[专项落地计划](ADR_0028_0030_0029_IMPLEMENTATION_PLAN.md)。A0–A3 已实现，仅 macOS 实机资格待外部证据；ADR-0019 B1、B2 已实现，
下一批为 B3。

## 工作包

| ID | 所有者 | 结果 | 验收 |
| --- | --- | --- | --- |
| S0 | 架构与数据治理 | ADR-0016、数据分类、同步白名单和禁止字段统一。 | 全仓术语和边界扫描无冲突。 |
| L1 | local-storage | 生产 SQLCipher 迁移、业务事务、本地 Provider 账号、Inbox/Outbox。 | 原子提交、空副本 no-op、秘密 canary、恢复前本地重建测试。 |
| H1 | Native Host | `local-storage` 拥有 SQLCipher key/路径/数据库身份，`secure-host-core` 拥有 OAuth/device/Provider 凭据生命周期。 | Renderer 无路径/密钥/账号/凭据权威；两个拥有边界均有原生负向测试。 |
| A1 | Cloud identity/devices | 账号、Session、Subscription/Entitlement、Device、Lease/Epoch。 | 签发、验证、续期、吊销和离线期限测试。 |
| D1 | Desktop | 授权门禁后组合本地 Repository 和业务 UI；独立 `sync.conflicts` 路由只在 Active/Standby workspace surface 暴露。 | Cloud transport 全失败时，有效授权下本地读写成功；商业只读/Standby 仅查看且 resolve 不可用；locked、retryable、security、recovery surface route-free。 |
| S1 | Sync | secret-free Push/Pull、ACK/Cursor、冲突和恢复副本；客户状态由持久化 `SyncSnapshot` 与 Native transport observation 组成。 | 不同步 Provider 账号；Pull 先本地合并；Cloud 空副本不删除；snapshot 暴露 durable pending/open-conflict/rejected counts 和 applied revision，transport 仅为 `checking`、`reachable`、`offline`、`blocked`。重启从 `checking` 开始；内部复制诊断不属于客户状态。 |
| C1 | Local Connector | 按 ADR-0027 接入十二平台，先交付资产归集与 Afternic，再由两个平台的真实需求验证复用面；当前只有最小 Token 的 Cloudflare Host-local Zone/DNS API read 与现有资产本地绑定，其余写入、Registrar、交易市场、获取与其他平台仍不可执行。 | Provider 账号与凭据只本地；每项新能力具名授权、计划/确认、对账和本地优先结果通过负向测试，真实执行另需对应 Q-CF 或 Q-PROV 资格。 |
| V1 | 集成所有者 | 本地业务、授权、同步和秘密边界汇合。 | 聚焦测试、根 `pnpm check`、术语扫描和 `git diff --check`。 |

## 依赖

```text
S0 --> L1 --> D1 --> V1
 |      |      ^
 |      `--> S1
 +--> H1 --> D1
 +--> A1 --> D1
 `--> C1 --> L1
```

Cloud 的迁移顺序与校验和由 `apps/cloud/src/db/migrations.ts` 的唯一字面目录维护，
包含身份、商业授权、同步、观察副本、域名生命周期和设备交接的追加迁移。源码组合入口见
[当前实现](../CURRENT_IMPLEMENTATION.md)。Cloud 只持有允许字段的业务与观察副本，
Desktop 正常 Query 仍读取本地 SQLCipher。

部署、真实 Provider、生产 OpenBao custody、原生签名/公证和发行是各自外部资格，只授权对应公开主张。

## v1 阶段任务清单

本清单是 [路线图阶段](../ROADMAP.md#当前执行顺序) 的执行台账。阶段目标与顺序以路线图为准，验收标准以
[VERIFICATION.md](../VERIFICATION.md#多平台交付阶段验收) 为准，本清单不重新定义它们。

维护规则：

- 只有满足对应验收标准且经过独立评估 PASS 时，才把任务勾选为完成，并在行尾写上 PR 链接。
- 单项能力降级时，把任务勾选为完成，并在行尾写“降级：<原因>”，原因同时记入 ADR-0027 的事实快照。
- 暂停待决时，任务保持未勾选，在行尾写“暂停：<待决事项>”。
- 执行中新发现的任务，追加到所属阶段，不另建清单。

### 1. 当前态收口与冻结候选

- [x] 扫描全仓当前态文档，确保源码实现、局部验证、V1 验收和外部资格四类状态没有混写 https://github.com/newcodebook/GoodDealer/pull/53
- [x] 清理临时 `P0-*` 任务语义和过时的当前态描述 https://github.com/newcodebook/GoodDealer/pull/53
- [x] 建立冻结候选快照，附提交引用和可复现的检查输出 https://github.com/newcodebook/GoodDealer/pull/53

### 2. Desktop 设计页面生产组合

- [x] DNS 健康页接入 Host 投影 https://github.com/newcodebook/GoodDealer/pull/53
- [x] 设置页接入 Host 投影（平台连接、角色与能力可用性） https://github.com/newcodebook/GoodDealer/pull/53
- [x] 销售页接入 Host 投影（资格前显示不可用） https://github.com/newcodebook/GoodDealer/pull/53
- [x] 续费页接入 Host 投影 https://github.com/newcodebook/GoodDealer/pull/53
- [x] 批量页接入 Host 投影（先生成计划，再逐项确认） https://github.com/newcodebook/GoodDealer/pull/53
- [x] 历史页接入 Host 投影 https://github.com/newcodebook/GoodDealer/pull/53
- [x] 人工任务收件箱接入 Host 投影（交给平台页面完成，再回到 Desktop 对账） https://github.com/newcodebook/GoodDealer/pull/53
- [x] 每个页面与 `brand/ui_kits/desktop` 对照，生产依赖图中不含 `visual-fixtures` https://github.com/newcodebook/GoodDealer/pull/53
- [x] DNS 健康读取按 ADR-0027 支持多平台 Zone 绑定 https://github.com/newcodebook/GoodDealer/pull/53
- [x] DNS 页引导文案与真实能力对齐（移除未接入的 TXT 所有权与修复流程描述） https://github.com/newcodebook/GoodDealer/pull/53
- [x] DNS 健康路由补 generation 过期与重试路径测试 https://github.com/newcodebook/GoodDealer/pull/53
- [x] DNS 页区分 Zone 分配的 nameserver 与注册商委派，并展示 DNSSEC 状态 https://github.com/newcodebook/GoodDealer/pull/53
- [x] 设置页逐角色展示能力可用性与原因；未声明角色的连接不得被隐藏（随阶段 5 角色模型）（Host 逐角色报告 `unavailable`/`qualification_pending`；连接在其声明的每个角色组各列一行，说明按该行角色选择；未声明角色的连接列在末尾“未声明角色”组，不提供任何操作，view-model 拒绝该组的可用操作与错放的类别；该组沿用 `brand/ui_kits/desktop` 设置页角色分组的同一面板形式，设计稿本身没有此组；当前没有已认证角色，可执行状态随首个能力资格扩展设置合同） https://github.com/newcodebook/GoodDealer/pull/53
- [x] 连接标签长度限制在写入与各读取之间对齐：统一为 1–120 个 UTF-16 单元、拒绝 Cc/Cf 字符，写入与设置、DNS 健康、人工任务读取共用同一规则（此前写入 512 字节、设置读取 120 字节；开发库中超出新规则的已存标签会使这些读取失败关闭） https://github.com/newcodebook/GoodDealer/pull/53
- [x] 设置读取补 65 条上限、未知 Provider 与已删除连接排除的 Rust 负向测试 https://github.com/newcodebook/GoodDealer/pull/53
- [x] 设置读取（Rust 与 Zod）接受 ADR-0027 的 8 个平台，须在首个非 Cloudflare 连接写入之前完成（当前非 Cloudflare 连接会使整个设置读取失败关闭）（8 个平台均列出、每个角色仍不可用；清单外平台使读取失败关闭；非 Cloudflare 的接入方式为未知，不臆测） https://github.com/newcodebook/GoodDealer/pull/53
- [x] 设置面板补非 Cloudflare 连接的渲染测试（平台名、无接入方式标签、各角色不可用）；各模块的 8 平台清单（Rust 与 TS 各一组）补一致性测试（每个运行时只保留一份：Host `launch_platforms::LAUNCH_PLATFORMS`、Renderer `launchPlatformKindSchema` 与平台名；桌面测试把两者钉在一起并拒绝 Host 读取再复制清单） https://github.com/newcodebook/GoodDealer/pull/53
- [x] 销售页同一域名多市场合并为一行（与 brand 一致），而非每市场一行 https://github.com/newcodebook/GoodDealer/pull/53
- [x] 销售页“冲突”状态说明为市场间状态不一致，与同步冲突中心区分（文案或提示）（徽章文案改为“市场间不一致 / Markets disagree”；brand 销售台无此状态文案） https://github.com/newcodebook/GoodDealer/pull/53
- [x] 在设计宿主中以两种语言核对“市场间不一致”徽章对 88px 状态列的影响，必要时改为短标签加完整说明（不改：表格为自动布局，徽章不换行时状态列扩为 106px（zh-CN）/130px（en-US）；在 716px 宽的销售台（窄于 960px 最小窗口下约 750px 的生产宽度）上两种语言都不产生横向滚动，设计宿主自带的 240px 屏幕列表使其在 960px 视口下才出现 9/34px 溢出） https://github.com/newcodebook/GoodDealer/pull/53
- [x] 销售读取的最新观察需确认所属运行已完成，避免未完成运行遮蔽已确认挂牌 https://github.com/newcodebook/GoodDealer/pull/53
- [x] 续费、资产库与域名详情的观察读取（最近注册商、在售计数）与销售读取共用“已完成运行且目标成功”的规则（当前取最新可用观察，不论运行是否完成；补 partial 包含与 failed 排除的测试）（`observation_runs::confirmed` 为唯一规则；测试覆盖 succeeded 与 partial 包含、运行中排除且不遮蔽已确认观察；failed 目标按 schema 不能携带证据，无法构造） https://github.com/newcodebook/GoodDealer/pull/53
- [x] 100k 规模分页落地时对资产库聚合查询做 `EXPLAIN QUERY PLAN` 检查；若放宽“每运行每资产一条挂牌观察”的唯一约束，重新审视按资产而非按市场判定目标成功的规则（已检查：总数、到期、冲突、在售、估值、页查询与销售扫描的每个关联查找都走索引，没有未用索引的基表扫描；唯一约束未放宽。新增被忽略的 100k 基准 `scale_reads_at_100k_assets`，本机 release 下资产库每页约 0.6–0.7 s、销售约 0.55 s、续费与 DNS 约 0.13 s、域名详情 < 1 ms；这是计划检查，不是 DATABASE_SCHEMA 的正式规模声明） https://github.com/newcodebook/GoodDealer/pull/53
- [x] 资产库与销售每页读取都对全工作区做 O(N) 聚合（在售计数每条挂牌两次已完成运行判定、估值读取全部目标价、销售窗口函数加临时排序）；预算须在阶段 4 V1 验收前确定并满足（本机 release 基准全部读取在 1 s 预算内；这是本机基准，不是阶段 4 V1 验收或正式规模声明） https://github.com/newcodebook/GoodDealer/pull/53
  - [x] 提议每页延迟预算（DATABASE_SCHEMA：release 下 1 万资产 ≤ 150 ms、10 万资产 2 市场 ≤ 1 s）并给 1 万与 10 万基准加上限；补 1 万、100 万与 10 万 8 市场基准（本机：10 万最慢约 0.71 s；8 市场销售约 2.0 s、资产库约 0.9 s；100 万资产库约 7.3 s、销售约 5.4 s，只记录） https://github.com/newcodebook/GoodDealer/pull/53
  - [x] 到期谓词改为可走 `domain_assets_by_status_expiry` 的 `lifecycle_status IN ('active', 'expired')` 并带表别名（续费首页 0.14 s → 0.12 s）；续费先切页再查注册商名称（末页 0.52 s → 0.19 s） https://github.com/newcodebook/GoodDealer/pull/53
  - [x] 查询计划固定为被忽略的 `paged_reads_never_scan_a_base_table`：记录各分页读取实际执行的语句，断言没有任何基表扫描（含覆盖索引扫描） https://github.com/newcodebook/GoodDealer/pull/53
  - [x] 8 市场最坏情况：按数据 generation（连接 `total_changes()` 与 `data_version`，读取前后一致才存取）缓存销售合并结果，同一数据的后续页约 0.1 ms；8 市场基准除首次合并外以 1 s 为上限；资产库 8 市场约 0.89 s 在预算内，未缓存 https://github.com/newcodebook/GoodDealer/pull/53
  - [x] 销售合并缓存的内存：100 万资产约 33 万个挂牌域名时估计 2 市场约 60–80 MB、8 市场约 170–200 MB；用 100 万基准测峰值 RSS，并考虑以平台索引与状态枚举代替字符串或按行数设上限（每行改为平台位集、单字节状态枚举与原样金额，行大小与市场数无关；100 万基准中缓存向分配器请求约 21 MiB、10 万约 2 MiB——这是下限，不含分配器开销（约 66 万个小块，实际堆估计约 30–35 MiB）与合并期间的瞬时峰值；未测得峰值 RSS：种子数据释放的堆被合并复用，RSS 增量读数为 0，不能反映缓存；不设行数上限） https://github.com/newcodebook/GoodDealer/pull/53
  - [x] 每次写入后的首次销售读取仍需全量合并（10 万 8 市场约 2 s，超出 1 s 预算）：确定该首读是否计入预算，或改为增量维护合并结果（写入后、销售读取前的首次设置读取扫描同一批挂牌，8 市场约 2.1 s，随同处理）（已做：缓存键改为迁移 `sales_listing_generation` 的触发器计数与 `data_version`，只有挂牌观察、确认它们的 marketplace 运行与目标状态及资产删除才推进，备注、目标价、DNS 与注册商/DNS 观察运行等写入后销售约 0.08 ms、设置约 0.22 s；合并改为按新索引顺序的连接查询，10 万 8 市场首读 2 s → 1.1 s、设置扫描 → 1.3 s；2 市场 10 万全部读取 ≤ 0.73 s 仍断言 ≤ 1 s。随后迁移 `sales_listing_confirmation` 为挂牌观察加触发器维护、拒绝直接写入的 `confirmed` 派生列，合并去掉逐行的运行与目标连接，10 万 8 市场首读 1.1 s → 0.51 s、设置扫描 1.3 s → 0.67 s，基准对全部读取断言 ≤ 1 s，无需再定预算口径） https://github.com/newcodebook/GoodDealer/pull/53
  - [x] 由用户确认分页读取延迟预算（含 100 万资产目标），确认后才作为阶段 4 V1 验收条件（用户于 2026-11-06 确认：10 万资产每次分页读取 ≤ 1 s 作为阶段 4 V1 验收条件；100 万资产只记录、不设 V1 预算；8 市场写入后首读仍超预算，见上一项） https://github.com/newcodebook/GoodDealer/pull/53
  - [x] 100 万资产的全量计数随资产线性增长（约 7 s）：正式规模声明前确定 100 万预算与做法（缓存或增量计数）（已由用户 2026-11-06 的预算决定确定：100 万资产只记录、不设 V1 预算，见 VERIFICATION 阶段 4 与 DATABASE_SCHEMA；v1 不作 100 万规模声明，所以不做缓存或增量计数，基准继续只记录约 7 s；将来要作 100 万规模声明时须先另定预算并追加任务） https://github.com/newcodebook/GoodDealer/pull/53
- [x] 销售视图模型上限（100,000）与 Host 窗口上限（1,000,000）对齐或改为分页（对齐：`salesListingLimit` 同时约束视图模型与投影，域名超限时投影失败而不截断；Host 行上限按每域名多市场保留） https://github.com/newcodebook/GoodDealer/pull/53
- [x] 销售、续费与 DNS 读取在 100k 规模下改为 Host 侧分页与聚合指标，遵守 DATABASE_SCHEMA 的 keyset/窗口分页规则，不在 Renderer 汇总全部窗口（拆为以下三项，三项完成后勾选） https://github.com/newcodebook/GoodDealer/pull/53
  - [x] 续费：Host 页读取，到期数与自动续费开/关计数由 Host 全量返回，续费台使用 kit `Pagination`；页越界时回到末页，后页读取失败时回到首页 https://github.com/newcodebook/GoodDealer/pull/53
  - [x] DNS 健康：Host 页读取与全量指标（搜索交给 Host） https://github.com/newcodebook/GoodDealer/pull/53
  - [x] 销售：Host 按域名分页（多市场合并在 Host 侧完成）与全量指标（在售数、单一价格规则下的挂牌估值） https://github.com/newcodebook/GoodDealer/pull/53
- [x] DNS 健康与续费只读一页后（销售仍每次全表校验），页外坏行（平台不一致的绑定、非法标签）不再让每次读取失败关闭，但仍计入全量计数；补一次全表完整性检查或在设置/诊断中报告（已改为每次读取全量校验并失败关闭：DNS 对每个有绑定或适用观察的资产复用逐行校验；续费先校验全部可用注册商观察的去重名称，仅在有非法名称时再逐资产解析实际显示的名称；100k 基准下续费约 0.20 s、DNS 约 0.21 s） https://github.com/newcodebook/GoodDealer/pull/53
- [x] 续费 Host 投影校验 `domain_assets.expires_on` 的日期格式并纳入全量校验（该列无 schema CHECK，当前只由 Renderer 逐页校验；页外格式错误但按字符串比较落入窗口的日期会被计入而不被拒绝），或在后续迁移中加 CHECK；若续费精确名称扫描因历史非法名称而常态触发，记录非法名称计数以便发现（已完成：续费计数查询把 `expires_on IS NOT date(expires_on)` 计为异常并让整次读取失败） https://github.com/newcodebook/GoodDealer/pull/53
- [x] 为让读取失败关闭的存储坏行（非法到期日期、平台不一致的绑定、非法注册商名称与挂牌观察、迁移前写入的非规范 Outbox `created_at` 等）提供修复，避免单行坏数据让整页长期不可读；读取侧的全表校验（DNS 绑定、续费名称与到期日期、资产库到期日期、销售挂牌、历史的 Outbox 时间）只能在修复步骤清理完迁移前的旧行之后移除（决策已接受：产品负责人于 2026-11-16 采用建议方案，见 [ADR-0019](../adr/0019-complete-local-business-schema-and-cloud-replica-model.md)——复制的业务数据只经新的本地编辑修复，已确认的 Outbox 历史与不可变观察只标记或隔离、不改写，本地不复制的到期日期置为未知，无效 Zone 绑定隔离；修复由用户在设置中按类别发起，写不可变修复回执。R1 已实现：本地迁移 `202611160002` 的修复回执兼读取标记，到期日期、注册商观察、DNS 绑定/观察与挂牌四类修复及 Host 命令 `repair_stored_rows`；R2 已实现：本地迁移 `202611160003` 的 Outbox 提交时间标记（只标记、不改写，历史显示“时间无效”）、Tauri 命令 `local_storage_repair`、client-core 合同与设置“关于”的按类别修复确认；读取侧全表校验按 ADR-0019“校验移除”条款保留，移除须迁移确认该类未修复行数为 0 后另作变更；设置中的报告已完成，见本阶段末项） https://github.com/newcodebook/GoodDealer/pull/53
- [x] 到期日期的 `date()` 往返校验同样用于资产库：资产库每次读取统计全工作区非法到期日期并失败关闭，资产行与域名详情逐行校验 `YYYY-MM-DD` 日历日期（与 `validate_timestamp`、Renderer `z.iso.date()` 同规则）；测试覆盖闰日、2 月 30 日等不可能日期与后缀；100k 基准资产库末页约 0.78 s（新增一次全表扫描，计入 O(N) 预算项） https://github.com/newcodebook/GoodDealer/pull/53
- [x] `domain_assets.expires_on` 写入时校验：存储完整性迁移以插入/更新触发器要求 `NULL` 或 `date()` 原样往返的 `YYYY-MM-DD` 日期（SQLite 不能为已有表追加 CHECK，触发器等效）；迁移前的旧行不改写，资产库与续费读取的全表日期校验保留并继续失败关闭（两侧差异：资产库拒绝全工作区非法日期，续费只拒绝窗口内的） https://github.com/newcodebook/GoodDealer/pull/53
- [x] 分页/搜索读取进行中时，旧页只以 `aria-busy` 标记；按 `brand/ui_kits/desktop` 是否有加载态核实视觉忙碌提示；搜索后读取失败时考虑保留上一视图并内联显示失败，而不是整页替换（kit 的进行中提示是 Settings/Sign-in 中缓慢旋转的弱化 RefreshCw，复用在 Pagination 备注位并尊重减少动效；同一来源的读取失败保留上一结果和搜索框，失败横幅与重试内联在台面上方，换端口或代际不沿用旧值） https://github.com/newcodebook/GoodDealer/pull/53
- [x] 非首页读取失败时 `recoverHostPage` 一律回到第 1 页，使内联失败横幅一闪而过；把回退限定在起点越界，或保留横幅直到用户操作（Renderer 无法区分越界失败，故仍显示上一结果的失败页留在原页并保留横幅，可重试或换页；无可显示结果时才回到第 1 页） https://github.com/newcodebook/GoodDealer/pull/53
- [x] 搜索读取失败后，保留的行与计数属于上一查询而搜索框显示新查询；在失败横幅中经 i18n 说明当前显示的是上一次成功读取的结果（三个分页台面的 `staleResult`，en-US/zh-CN） https://github.com/newcodebook/GoodDealer/pull/53
- [x] 为续费与销售台面补一项翻页读取失败的 DOM 测试，固定 `busy={false}` 与旧页加横幅的状态 https://github.com/newcodebook/GoodDealer/pull/53
- [x] 翻页读取失败后分页器高亮上一结果的页码，再次点击失败页会设回同一页而不读取；失败时点击当前请求页改为重试 https://github.com/newcodebook/GoodDealer/pull/53
- [ ] 分页台面读取失败横幅放在台面头部上方（kit 无台面内错误示例）；在打包构件逐屏对照 `brand/ui_kits/desktop` 时确认或调整该位置（暂停：随下方打包构件逐屏对照一并进行，见该项待决事项）
- [x] 销售每次翻页都全表扫描并合并已确认挂牌（100k 域名 × 8 市场时约 80 万行，含已完成运行 `EXISTS` 与窗口函数）：在 100k 规模验证中计时并做 `EXPLAIN QUERY PLAN`，过慢时按读取 generation 缓存合并结果（已计时与检查：3.3 万个双市场域名每页约 0.55 s，查找均走索引；是否缓存并入资产库与销售 O(N) 聚合一项） https://github.com/newcodebook/GoodDealer/pull/53
- [x] 销售页行价格保留首个市场的原始写法（如 `1000.50`），挂牌估值为规范化写法；核实销售台金额格式化后两者显示一致（一致：两者都经 `formatAssetMoney`，销售台测试固定） https://github.com/newcodebook/GoodDealer/pull/53
- [x] `formatAssetMoney` 经 `Number` 转换，超过 15 位有效数字的金额（合同允许 16 位整数加 8 位小数）显示会失真；改为按十进制字符串格式化（`formatMoney` 接受经校验的十进制字符串并原样交给 Intl） https://github.com/newcodebook/GoodDealer/pull/53
- [x] 精确金额格式化（`formatMoney` 与 `formatNumber` 的十进制字符串）依赖各 Tauri WebView（WebKitGTK、WKWebView、WebView2）支持 ECMA-402 NumberFormat v3 的字符串格式化，不支持时会静默退回双精度舍入；在打包构件中验证或在 VERIFICATION 写明最低 WebView 版本（格式化先以 BigInt 精确舍入到显示位数，再交给 Intl；运行时探测 v3，不支持时只把不超过 15 位有效数字的已舍入值以双精度交给 Intl，超过则显示“—”，不再静默舍入，也不因抛错让整页空白；会以其他方式舍入的格式选项（有效数字、非标准记数、舍入模式或增量）对十进制字符串拒绝；VERIFICATION 记录 MDN 兼容数据的最低引擎版本：Chromium 106、Safari 15.4，WebKitGTK 无对应数据、靠运行时探测；各 WebView 实测随打包构件验收） https://github.com/newcodebook/GoodDealer/pull/53
- [x] 其余金额显示与求和仍经 `Number`：kit `Money` 组件（资产库目标价、域名详情挂牌价）、资产库本页估值、域名详情利润、批量编辑示例与合计、续费金额、报价中间价；改为十进制字符串格式化与精确求和（`client-core` `pricing/decimal-amount` 以 10⁻⁸ 单位的 BigInt 做求和、相减、乘年限、按百分比调整到分（四舍五入）、中间价与相对百分比，运算接受任意整数位以容纳超过 16 位的合计，16 位上限仍由合同 schema 把关；`registration` 改用同一模块；i18n `formatNumber` 与 `formatMoney` 一样精确格式化十进制字符串，`Money` 收到已格式化的金额文本；资产库本页估值只在单一币种时求和，混合币种显示“—”；各页面测试覆盖超出双精度与半分进位的情形） https://github.com/newcodebook/GoodDealer/pull/53
- [x] 续费、DNS 健康与销售的分页标签改为共享分页文案组而非借用资产库文案（分页标签移入 `shell` 文案组，其清单同时以品牌 `controls.jsx` 对账；资产库、续费、DNS 健康与销售共用） https://github.com/newcodebook/GoodDealer/pull/53
- [x] 分页路由（续费、DNS 健康、销售）补翻页接线测试（`onPageChange` → 页起点 → Host 读取）；与 `useHostRouteRead` 的 hook 级重试测试一起需要渲染环境（桌面测试新增 `happy-dom` 开发依赖；`app/paged-routes.test.tsx` 在 DOM 中渲染真实工作区，从导航或资产库进入三个分页路由并点击页码；后页读取失败回到首页、DNS 搜索在读取进行中保持输入框挂载与焦点（对去掉保留上一视图的变体失败）；桩读取经真实读取解析器；`happy-dom` 已登记到仓库拓扑依赖目录） https://github.com/newcodebook/GoodDealer/pull/53
- [x] 销售域名超限在分页前改为提前停止读取（读到超过上限的不同域名即失败），并以“超出本视图容量”文案替代可重试的读取失败（由分页取代：销售按域名分页后不再有视图域名上限，`salesListingLimit` 已移除） https://github.com/newcodebook/GoodDealer/pull/53
- [x] 续费与资产库到期计数排除已售（sold）资产，或在续费页展示生命周期（排除：已售、已放弃与已归档资产不再需要续费，续费列表与资产库计数共用同一 Host 谓词） https://github.com/newcodebook/GoodDealer/pull/53
- [x] 资产库行与域名详情的“即将到期”高亮改用 Host 的同一到期谓词与日期（当前只按 Renderer 日期判断，已售、已放弃、已归档与已过期资产仍会高亮）（Host 在资产库行与域名详情中返回 `expiring`，由续费页与到期计数共用的 `expiring_asset` 谓词和 SQLite 日期计算；读取契约拒绝不可能为真的组合（未保留或无到期日）；Renderer 不再按本地日期判断） https://github.com/newcodebook/GoodDealer/pull/53
- [x] 续费页自动续费覆盖指标区分“未记录”与“已关闭”（覆盖值仍为已开启/全部，指标说明行分别列出已关闭与未记录数量；英文文案更正为 coverage） https://github.com/newcodebook/GoodDealer/pull/53
- [x] 续费页自动续费覆盖值使用 `formatNumber`，并补 en-US 的“Off / Not recorded”断言（已由 7cff6bc 的整页指标测试覆盖：`600 / 1,234`、`Off 34 · Not recorded 600`） https://github.com/newcodebook/GoodDealer/pull/53
- [x] 注册商名称校验在 Rust（字符数、控制字符）与 Zod（UTF-16 长度、格式字符）之间对齐（Host `valid_registrar_name` 与 Renderer `registrarNameSchema` 共用资产行的安全文本规则：1–128 个码点，拒绝控制、双向与不可见格式字符；两侧测试使用同一矩阵） https://github.com/newcodebook/GoodDealer/pull/53
- [x] 资产库读取只取一次 Host 日期，行 `expiring` 与到期计数共用（当前分属两条语句，跨 UTC 午夜的读取可能相差一天）（资产库与续费读取在事务开始时各读取一次 `HostDay`（SQLite `date('now')`，校验为规范日期），计数、名称校验、行标记与 `asOfDate` 全部使用它；谓词测试固定日期并跨年） https://github.com/newcodebook/GoodDealer/pull/53
- [x] 决定到期窗口的“今天”采用 UTC 还是本地日（当前 Host 用 UTC 日期，与续费页一致；历史页已改用本地日），并在 V1 前记录决定（决定：到期窗口保持 UTC。`expires_on` 是注册局 UTC 到期时刻的日期部分，注册局按该时刻到期；按本地日会让 UTC 以西/以东的用户在午夜前后提前或推迟一天，并与续费页不一致。历史页的“今日变更”统计的是用户自己的操作，因此按本地日。决定写在 `renewals.rs` 的 `HostDay` 说明中） https://github.com/newcodebook/GoodDealer/pull/53
- [x] 记录两套显示文本规则的适用范围（连接标签：Cc+全部 Cf、120 个 UTF-16 单元；注册商名称与资产文本：安全文本集、128 个码点），并在两侧测试中固定安全文本集之外的 Cf 字符（如 U+0600）被接受（两种规则的适用范围与原因写在 Host `valid_registrar_name` 与 Renderer `registrarNameSchema` 的说明中；四组测试固定 U+0600：注册商名称两侧接受，连接标签两侧拒绝） https://github.com/newcodebook/GoodDealer/pull/53
- [x] 资产库到期计数在搜索过滤下与续费页列表口径一致（到期计数不随搜索前缀过滤，始终是续费页将列出的整个工作区行数；其余指标仍随搜索） https://github.com/newcodebook/GoodDealer/pull/53
- [x] 搜索生效时资产库到期指标标明为工作区范围（与随搜索的其余指标区分）；`EXPIRING_ASSET` 改为带表别名，避免在连接查询中绑定到其他表的同名列（别名部分已完成：`expiring_asset(alias)`；剩余 UI 标明范围）（UI 已完成：搜索生效时到期指标的说明行显示“全工作区”，与去续费入口按 kit 的“ · ”连接，并写入按钮的无障碍名称；en-US/zh-CN 文案与测试同步） https://github.com/newcodebook/GoodDealer/pull/53
- [x] 续费、销售、批量、历史、人工任务路由补 generation 过期与重试路径测试 https://github.com/newcodebook/GoodDealer/pull/53
- [ ] 批量父计划生成、计划详情读取、非资金整批一次确认及资金逐项确认（随首个批量操作能力资格认证；认证前新建与执行保持不可用）（随首个市场的持久计划、执行与对账切片实施；真实执行资格另行取证）
- [x] 历史页“今日变更”改为 Host 侧计数（当前只统计已加载的最新 500 条）（Renderer 在读取请求中给出本地日的规范 UTC 起止时刻（起含止不含，23–25 小时），Host 校验后与总数同一次扫描计数全账本；同一次读取的各窗口计数须一致） https://github.com/newcodebook/GoodDealer/pull/53
- [x] 历史页跨过本地午夜后自动重新读取“今日变更”（当前保留上次计数直到重新读取）（`useLocalHistoryDay` 持有本地日并在其结束时按时钟重新计算；本地日作为读取的重启键，因此同一次读取的各窗口不会跨两天，翻日或窗口在新的一天回到前台时重新读取，并保留上次结果直到新结果到达；DOM 测试用假时钟跨过午夜） https://github.com/newcodebook/GoodDealer/pull/53
- [x] Outbox 写入时校验 `created_at` 为规范 UTC 时刻（“今日变更”按字符串比较计数，依赖规范格式）（新迁移 `outbox_integrity.sql` 的插入与更新触发器只接受 `YYYY-MM-DDTHH:MM:SSZ` 且小时不超过 23，与 Host `validate_timestamp` 一致；历史读取在同一次聚合中发现任何迁移前的非规范时间即整体拒绝，而不是按错误的日期计数） https://github.com/newcodebook/GoodDealer/pull/53
- [x] `local-storage` 业务测试数据库随测试结束删除（原 `tempdir().keep()` 每次运行在临时目录残留上万个目录，耗尽配额；改为 `TestDatabase` 持有目录） https://github.com/newcodebook/GoodDealer/pull/53
- [ ] 历史回滚：撤销计划命令与高风险确认（随首个可撤销操作能力资格认证；认证前回滚与导出保持不可用）（随具体平台可撤销操作的合同与对账实施）
- [ ] 人工任务对账：打开平台、标记完成与重新检查后由 Host 重新观察平台状态完成对账（随对应能力资格认证；认证前保持不可用）（随首个平台客户旅程实施）
- [x] 人工任务等待时间改用 `manual_action_required` 结果的观察时间，而非尝试开始时间（每项取最新尝试最早的 `manual_action_required` 结果观察时间，结果尚未记录时退回尝试开始时间；任务按其中最早者排序） https://github.com/newcodebook/GoodDealer/pull/53
- [x] 人工任务读取每任务域名样本收窄（当前每任务最多 10,000 个，单窗口载荷过大）（Host 只发送收件箱显示的前 3 个域名（字节序），`domainCount` 仍精确；读取与视图合同共用 `manualTaskDomainSampleLimit` 并拒绝其他样本大小，Desktop 测试固定它与 Host 的 `DOMAIN_LIMIT` 相等；等待起点不早于尝试开始） https://github.com/newcodebook/GoodDealer/pull/53
- [ ] 打包的 Tauri 构件在真实 Host 与种子数据上逐页可达，并与 `brand/ui_kits/desktop` 逐屏对照，并记录各 WebView 的 NumberFormat v3 探测结果与超大金额的显示（当前只有源码与打包依赖图层面的证据）（暂停：待决事项——工作区页面只有在真实账号经浏览器 PKCE 登录、取得商业授权与 Active Lease 后才可达，登录须由用户本人输入凭据；三种 WebView 分别只在 macOS（WKWebView）、Windows（WebView2）与 Linux（WebKitGTK）上存在，当前执行环境只有 Linux 且不能操作原生窗口。影响：阶段 2 验收“每个设计页面在真实构件中可达”与阶段 4 的真实构件证据都依赖此项。可选方案：①用户在三种系统的打包构件上登录，按页面清单逐屏截图并运行内置 NumberFormat 探测，由执行方对照 kit 记录偏差并修复；②在 Linux 上经用户批准安装 `tauri-driver` 与 WebKitWebDriver 做 WebKitGTK 的自动逐屏对照（登录仍由用户完成），macOS 与 Windows 仍按①；③先只取 Linux 证据，macOS/Windows 推迟到阶段 11 的最终候选。推荐②+①：Linux 部分可重复，其余两种系统一次人工对照。2026-11-24 用户决定：功能验证阶段不做实机验收，基础功能完成后统一做 Windows/macOS 与第二台设备的跨平台验收，本项随之推迟到该统一验收）
- [x] 历史与人工任务等显示文本的长度口径在 Rust 与 Zod 之间对齐（核实：Zod 4 的 `max` 按码点计数，与 Rust 字符数一致，无需改动；需要 UTF-16 上限的 Zod 校验须显式比较 `length`） https://github.com/newcodebook/GoodDealer/pull/53
- [x] `client-core` 的 `dnsProviderSummarySchema` 平台集合与 ADR-0027 的 8 个平台对齐或退役（已对齐：`providerKind` 改用唯一的 `launchPlatformKindSchema`，移除 `registrar_dns`/`custom`；注册商自带 DNS 即该注册商平台；补每个首发平台接受与旧值拒绝测试） https://github.com/newcodebook/GoodDealer/pull/53
- [ ] Host 按平台报告支持的角色后，把 DNS 读取契约（`dnsProviderSummarySchema` 与 `dns-health.ts` 的 Zone 绑定）的 `providerKind` 收窄为支持 DNS 的平台（当前 Afternic、Atom 等纯市场平台也被接受为 Zone 托管方）（依赖平台事实：2026-11-24 核对，能力 manifest 中除 Cloudflare 与 Porkbun 外所有平台的 `zone.observe`/`dns.*` 均为 `platform_facts_pending`，即尚未核实平台是否提供 DNS，不能据此排除任何平台；2026-11-24 起 Porkbun 的 `zone.observe`/`dns.*` 已核实为 `implementation_pending`（官方提供 DNS），GoDaddy 的 DNS 记录端点已记入 API 核查，但 manifest 中仍为 `platform_facts_pending`，待 GoDaddy 全部能力核对后一并更新；随各平台阶段写入“平台不提供”的 manifest 原因后收窄，在此之前 Host 写入路径只建立 Cloudflare Zone 绑定）
- [x] Provider 绑定写入时强制绑定平台与连接平台一致（当前只在 DNS 健康读取时拒绝，单行坏数据会让整页不可读）（已完成：存储完整性迁移在写入时拒绝平台不一致的绑定，并禁止已绑定连接改变平台；业务写入路径本就只接受 Cloudflare 连接） https://github.com/newcodebook/GoodDealer/pull/53
- [x] DNS 健康 Rust 测试覆盖“非 Cloudflare 绑定 + 既有 Cloudflare 观察”同时存在的情况 https://github.com/newcodebook/GoodDealer/pull/53
- [x] Standby DNS 读取组合前改写 `readOnlyNotice`（当前暗示修复与重新验证在 Active 中可用）（改为说明 Standby 不做修改，且 DNS 修复与所有权重新验证尚未在任何设备上取得资格；en-US/zh-CN 与测试同步） https://github.com/newcodebook/GoodDealer/pull/53
- [ ] DNS 修复或所有权重新验证在 Cloudflare 阶段取得资格时，同步改写 DNS `readOnlyNotice`（届时说明这些操作只在 Active 设备上执行；Active 上 `canEdit: false` 时也显示只读说明，与续费按 `!canEdit` 判断一致）（随已批准范围的 DNS 写入与所有权验证切片实施）
- [x] Host 路由读取的重试接线测试：重试按钮已测试会调用 `retry`；`useHostRouteRead` 由 `attempt` 驱动重新读取仍缺 hook 级测试（需要渲染环境）（同一测试：首读失败后点击“重新读取”，从同一页起点重新读取） https://github.com/newcodebook/GoodDealer/pull/53
- [x] DNS 页 DNSSEC 各状态与 en-US 渲染测试（当前只覆盖 zh-CN 的“未知”）（四种状态 en-US 与 zh-CN 均有渲染测试；已观察的 Zone 读取契约必带状态，未观察的行不显示 DNSSEC 标签并有测试） https://github.com/newcodebook/GoodDealer/pull/53
- [x] `read_cloudflare_connection` 返回的连接标签改用统一标签规则（当前 Host 不校验，适配器允许 256 个单元且只拒绝 C0/DEL；随 `features/connections` 进入生产导航）（Host 读取对标签应用与其他读取相同的 `valid_connection_label`，不经创建路径写入的违规标签让读取失败关闭；适配器的状态、创建回执与创建输入都改用 client-core 的 `connectionLabelSchema`（至多 120 个 UTF-16 单元，拒绝控制与格式字符），违规输入在 IPC 之前拒绝；Host 与适配器测试覆盖零宽字符、控制字符与超长标签） — https://github.com/newcodebook/GoodDealer/pull/53
- [ ] 注册商委派观察接入后，与 Zone 分配的 nameserver 比对得出委派状态与 NS 异常计数（随注册商能力）（随资产来源平台的注册商观察接入；不限定 Cloudflare）
- [x] 设置“关于”报告让其他读取失败关闭或变慢的存储坏行计数：非法到期日期（资产库与续费）、非法注册商名称的可用观察（续费变慢，显示时失败）、DNS 绑定或观察无效的资产、无效挂牌观察（销售）、时间非规范的 Outbox 行（历史）；每项计数复用对应读取的校验谓词，设置读取本身不因坏行失败；修复尚不可用并如实说明 https://github.com/newcodebook/GoodDealer/pull/53
- [x] 设置读取每次全量运行完整性计数（含销售挂牌合并查询，10 万资产约 0.5–2 s）：改为复用销售按数据代缓存或仅在打开“关于”时计数，并纳入 10 万基准计时（同一数据代已有合并成功的销售台面时不再扫描挂牌，提交落在读取期间则不用缓存重读；10 万基准：2 市场冷读 0.72 s、缓存后 0.22 s，8 市场冷读 2.1 s、缓存后 0.23 s；8 市场写入后首次读取与销售首次合并同属下一项的预算问题） https://github.com/newcodebook/GoodDealer/pull/53

### 3. Cloudflare 路径稳定

- [x] 引导流程：欢迎 → 设备门 → 连接 Cloudflare（可跳过）→ 从观察结果导入或手动添加 → 完成（观察导入必须逐个经 `local_domain_asset_create` 新增，不得另开写入路径，否则去重失效）（生产组合：Active 且无域名的工作区每次会话首次进入时显示 kit 接入向导，可在欢迎页跳过；设备门显示新 Host 读取 `local_device_lease_read` 校验过的设备与 Lease Epoch（无签名信封与密钥，非 Active 时拒绝），Host 没有设备名，不显示也不编造；Cloudflare 在 Q-CF 关闭前显示不可用、无连接路径，观察导入同样不可用，手动添加复用 `local_domain_asset_create`，重复域名如实提示；完成页取 Host 的域名数与已应用的服务器 revision。连接与观察导入的可执行路径随下方 Cloudflare 进入生产组合与 Q-CF 一并交付） https://github.com/newcodebook/GoodDealer/pull/53
- [x] 资产创建，并对导入和手动添加去重（Host 经 `local_domain_asset_create` 在当前 Host 提交栅栏下以一个同步 upsert 新增资产；规范域名是去重键，工作区已有的域名返回 `DESKTOP_LOCAL_ASSET_EXISTS` 且不写入任何数据，已删除仍有墓碑的域名被拒绝；Host 与 Renderer 都拒绝非规范名称与 IP 字面量；资产库在 kit 的工具栏次按钮位提供“添加域名”，Standby/只读时不可用；kit 无加号图标，按钮不带图标。导入的去重依赖引导导入也走该命令，见上一项） https://github.com/newcodebook/GoodDealer/pull/53
- [x] 绑定 UI（DNS 页的 kit 行操作列：Host 读取显示无有效绑定、且有本资产同名 Zone 的已确认可用 Cloudflare 观察时，可写界面提供“绑定 Zone”，经 `local_domain_asset_provider_bind` 由 Host 复核证据与读取代后提交，提交后按回执代重新发布；kit 没有绑定专用画面，沿用 DNS 页行操作按钮；生产导航尚无建立连接或观察的入口，所以目前不会出现该操作） https://github.com/newcodebook/GoodDealer/pull/53
- [x] Grant/Lease 能力门禁接入生产导航（Host 只在 Grant v3 与嵌套 ActiveDeviceLease 验签通过、且商业能力为 `cloudflare:dns:observe` 时进入 Active；Renderer 只得到由此派生的 `local:read`/`workspace:mutate` 状态，`adjudicateDesktopPresentation` 据此决定锁定页、Standby/商业只读/受限与可用路由，写入口（添加域名、目标价、绑定 Zone、引导）只在 Active 且含 mutate 时组合；新增渲染测试逐个状态证明写入口的有无。Cloudflare 连接入口按同一能力门禁随下方 Cloudflare 进入生产组合一项交付） https://github.com/newcodebook/GoodDealer/pull/53
- [x] 凭据原子撤销，revoke/deactivate 的 Host capability（`cloudflare_connection_revoke` 经同一串行 ProviderLane 提交、不限速；Host 在准备撤销的同一提交中把连接置为 `revocation_pending` 并拒绝凭据使用，即停用先于 custody 生效；Secure Host 新增 `publish_cloudflare_tombstone_guarded`，在 Keychain 锁内只对 exact Active 基线写入下一 generation 的无 Token 墓碑（保留 scope 与 Zone），与 activation 同一 prewrite/marker/回读栅栏，基线矛盾进入 remediation 且凭据保持拒绝；确认后连接为 `revoked`，Token 在墓碑确认后才离开 custody，重放与并发撤销被拒绝。撤销只撤回 GoodDealer 的 custody 与使用，不会在 Cloudflare 吊销 API Token。凭据只在 macOS Keychain 中，其他平台的墓碑发布失败关闭；生产界面的撤销入口随下方 Cloudflare 进入生产组合与 Q-CF 提供。已在 `remediation_required` 状态的连接尚不能撤销，见新增项） https://github.com/newcodebook/GoodDealer/pull/53
- [x] Cloudflare generation/auth fences 从 `features/connections` 进入生产组合（含：全新安装没有 Cloudflare 连接行、凭据采集仅 macOS、观察表对 `domain_assets` 有外键，所以“连接后从观察导入”需要新建连接与按区域导入的 Host 能力；交付时让引导的连接与导入步骤改用它，导入仍逐个经 `local_domain_asset_create`；同时决定 DNS 页“绑定 Zone”在 Q-CF 关闭前是否可见，若不可见，把 `bind_zone` 绑定到连接或能力状态上；交付连接与导入入口时，它们须经同一 `readOnly === null` 门禁与 Host `qualified` 判定，并为之补写入口渲染测试——当前生产中没有 Cloudflare 写入口，所以已勾选的界面组合项的门禁条款只是因为不存在入口而成立）（拆分：门禁已由下一项交付；剩余为新建连接、按区域导入、生产界面组合三项，见下）（引导的 Cloudflare 卡片改用新建连接与激活（激活时按区域导入），已连接时准入撤销；准入只取 Host 事实：工作区可写（Active 且有 mutate，与其他写入口同一门禁）、Host 报告 `qualified`、Host 报告本构建可采集凭据（`capturable`，仅 macOS；其他系统卡片不可用并说明“目前仅 macOS 支持连接”）、无运行中/恢复/阻塞的操作且状态可读，Host 自身仍逐次核对；操作期间卡片为连接中且不准入；之后按有界轮询读取 Host 状态决定显示，失败或被拒也显示 Host 原因；连接后首次导入步骤说明 Zone 已在连接时导入；设置不在连接行上放操作，而在可写时提供 kit 的“重新运行接入向导”进入同一引导；DNS“绑定 Zone”维持由 Host 的 `bindable` 决定，Q-CF 关闭前没有已认证连接能观察 Zone，故不出现；写入口渲染测试覆盖引导 Cloudflare 卡片与设置“重新运行接入向导”在 Active+mutate、Active 无 mutate、Standby、商业只读四种状态下的门禁，以及认证与否、可否采集凭据） https://github.com/newcodebook/GoodDealer/pull/53
- [x] Host 的 ADR-0027 资格登记与执行门禁（`active_workspace/capability_qualification.rs`：已认证能力清单，当前为空；Cloudflare 激活准入、凭据准备与观察准入在 Host 内逐次核对，未认证时以 `DESKTOP_CAPABILITY_UNQUALIFIED` 拒绝，即使已有有效 Active 凭据也不执行；撤销与凭据写入恢复不核对，只减少 Host 持有的东西；设置读取的角色可用性取自同一清单，契约尚无可执行状态，所以某角色一旦认证会让读取失败关闭，直到契约扩展——认证任何角色前必须先为设置契约增加可执行状态；每个清单条目须指向 `docs/` 下的资格证据，测试拒绝无证据条目；测试经线程内的临时资格覆盖保留激活与观察成功路径的 Host 测试。由此 DNS 页“绑定 Zone”在 Q-CF 关闭前不会出现：它需要已确认的观察，而观察准入被拒绝） https://github.com/newcodebook/GoodDealer/pull/53
- [x] 新建 Cloudflare 连接的 Host 命令（`cloudflare_connection_create`：IPC 只带显示标签，连接与 incarnation 标识由 Host 生成；Host 在任何授权或存储工作之前核对资格登记，未认证时以 `DESKTOP_CAPABILITY_UNQUALIFIED` 拒绝；需要 Active 与 mutate；新行为 `inactive`/`invalid` 且无凭据，激活确认后才可用；已有从未激活的连接时返回它而不新增，重复请求不会堆积空行；回执只含不透明 `connectionRef`、标签、是否新建与读取代，设置读取不暴露 `connectionRef`。引导与设置的连接步骤改用它随下方生产界面组合一项交付） https://github.com/newcodebook/GoodDealer/pull/53
- [x] 按区域导入：激活时 Zone 的资产不存在则经 `local_domain_asset_create` 新增后再提交观察（观察表对 `domain_assets` 有外键），引导的导入步骤改用它（Host 在 Provider 观察 Zone 之后、准备凭据之前，在本次激活自己的准入下，经与 `local_domain_asset_create` 相同的 Host 创建路径（`DesktopBusinessRuntime::create_domain_asset_guarded`，不经 IPC）导入该 Zone：去重、删除墓碑规则与同步 Outbox 不变；准入复核与提交守卫把写入绑定到观察 Provider 时的工作区、设备、租约与授权，Provider 调用期间授权变化则不写入；工作区已有该域名时保持原样不写入；创建路径拒绝的 Zone 名称不导入也不准备凭据；导入核对资格登记，未认证时拒绝。之后步骤失败时域名保留为普通资产，可删除。引导导入步骤改用它随下方生产界面组合一项交付） https://github.com/newcodebook/GoodDealer/pull/53
- [x] 生产界面组合 `features/connections`：编排器把 `DESKTOP_CAPABILITY_UNQUALIFIED` 作为独立结果传出（当前并入通用 Host 失败），Zone 名称无法导入时显示为该原因而非通用激活失败，设置与引导显示 Host 报告的连接状态与资格原因，未认证时连接、激活、观察与撤销入口不可用；撤销界面提示用户到 Cloudflare 删除或轮换 Token；写入口经同一 `readOnly === null` 门禁并加入写入口渲染测试（拆分：Host 一半已由下一项交付；剩余界面组合见再下一项）（拆分各项均已完成，见下） — https://github.com/newcodebook/GoodDealer/pull/53
- [x] Cloudflare 连接状态由 Host 报告资格与最近一次 Provider 操作的封闭结果：编排器把 `DESKTOP_CAPABILITY_UNQUALIFIED` 作为独立的 `Unqualified` 传出而非并入通用 Host 失败；`cloudflare_connection_status` 增加 `qualified`（`cloudflare.dns.observe` 资格）与 `lastOperation`（`activate`/`revoke`/`observe` × `confirmed`/`unconfirmed`/`nothing_to_revoke`/`unqualified`/`failed`，取消后不报告），Renderer 适配器从 `unknown` 严格校验并拒绝未知键与只属于撤销的结果出现在其他操作上 — https://github.com/newcodebook/GoodDealer/pull/53
- [x] 生产界面组合 `features/connections`（剩余）（拆分：除 Zone 名称专门原因外已由下一项交付，Zone 名称原因见再下一项）：设置与引导显示 Host 报告的连接状态、`qualified` 与 `lastOperation` 原因（Zone 名称无法导入时显示为该专门原因而非通用激活失败：这需要 Host 先从激活中的创建拒绝给出独立的封闭结果，例如 `zone_unimportable`，当前它报告为 `activate`/`failed`，与 `unqualified` 无关；`busy` 优先于 `lastOperation` 呈现），`qualified: false` 时连接、激活、观察与撤销入口不可用；撤销界面提示用户到 Cloudflare 删除或轮换 Token；写入口经同一 `readOnly === null` 门禁并加入写入口渲染测试（拆分各项均已完成，见下） — https://github.com/newcodebook/GoodDealer/pull/53
- [x] 设置与引导按 Host 的 `cloudflare_connection_status` 显示 Cloudflare 原因：`cloudflareNotice` 只从 Host 状态决定（读取失败只说无法读取；`busy` 优先于 `lastOperation`；确认撤销后持续提示到 Cloudflare 删除或轮换 API Token，因为撤销只移除本设备托管；未认证优先于更早的操作结果）；设置中的 Cloudflare 连接行以该原因作摘要，引导中的 Cloudflare 卡片随状态显示但不准入连接或断开（生产连接路径尚未组合，`admittedActions` 恒为空），各状态下设置与引导都没有可执行的 Cloudflare 入口，写入口渲染测试覆盖 Active 与 Standby — https://github.com/newcodebook/GoodDealer/pull/53
- [x] Zone 名称无法导入时的专门原因：Host 从激活中的创建拒绝给出独立的封闭结果（导入的创建除 Zone 名称外的输入都由 Host 生成，所以创建路径的输入拒绝与删除墓碑拒绝只能来自该名称，映射为 `DESKTOP_CLOUDFLARE_ZONE_UNIMPORTABLE`，不写入也不准备凭据；编排器传出 `ZoneUnimportable`，经 `lastOperation` 读回为 `activate`/`zone_unimportable`，适配器拒绝它出现在激活以外的操作上；`cloudflareNotice` 与设置、引导显示“该 Zone 的名称不能作为域名添加：它不是规范域名，或该域名已被删除”，不再显示通用激活失败；Host 测试覆盖非规范名称与已删除域名两种拒绝且都不写入） — https://github.com/newcodebook/GoodDealer/pull/53
- [x] `lastOperation` 绑定到产生它的授权与连接：操作开始前记录 Host 的授权身份（账户、工作区、设备、租约纪元、账户安全纪元；不用已应用授权纪元，因为它在每次访问令牌刷新时都会推进）与 Host 的连接代数（Host 在每次新建 Cloudflare 连接与恢复备份的前后都推进，即使中途失败；这两条是生产中唯一会替换连接行的写入，恢复可能不经新建就替换连接行，与之并行的操作结果也随之隐藏），状态读取只在两者都与当前一致时报告；所以重新认证换了身份、新租约、换设备或新建连接后不再显示上一条结果，而撤销或激活失败让本连接离开 active 状态时结果仍然可见（撤销后的 Token 提示得以保留），同一身份下的令牌刷新或商业只读往返也保留结果，因为它描述的仍是同一授权下的同一连接；没有当前授权时不报告，操作期间身份或连接代数改变同样隐藏结果（失败关闭） — https://github.com/newcodebook/GoodDealer/pull/53
- [x] 断网、Token 失效、权限不足、撤销后，都失败关闭并给出可恢复提示（Provider 调用失败时不写入任何数据：激活的 Zone 观察在导入与凭据准备之前，观察失败不提交；Provider 客户端只把 401 与 403（RFC 9110 的认证与授权拒绝）归为新的 `CredentialRefused`，其他非重试状态（重定向、400、404 等）与格式不符的 200 仍为通用失败；编排器把传输失败、可重试拒绝（408、425、429 与服务端错误）与凭据拒绝分别传出为 `unreachable`、`retry_later`、`credential_rejected`，其余为 `failed`，经 `lastOperation` 读回，设置与引导分别提示检查网络后重试、几分钟后重试、在 Cloudflare 确认 Token 有效并具备所需权限后重新连接；Cloudflare 官方文档未写明 Token 失效与权限不足各自的状态码，所以 401 与 403 合为一个结果（事实快照见 ADR-0027，2026-11-08 核对），不按未记载的状态码或错误码推断哪一种；撤销在准备时即拒绝凭据使用，Host 测试证明之后不再准入观察，界面保留到 Cloudflare 删除或轮换 Token 的提示；适配器拒绝撤销带有只属于 Provider 调用的结果。这些是本地测试，不是外部资格） — https://github.com/newcodebook/GoodDealer/pull/53
- [x] 操作历史把新增显示为编辑（Outbox 只有 `upsert`/`delete`，新增无独立操作类型）：在历史中把资产的首个本地版本标为新增，或为同步协议增加新增操作类型（后者需先评估 Cloud 合同）（采用前者且不改同步协议：迁移 `outbox_local_creations` 新增仅 Host 的 `sync_outbox_local_creations` 标记，创建路径在同一事务中写入；触发器只允许标记资产的首个本地 upsert，标记不可修改并随 Outbox 行级联删除。首个本地版本本身不能作为依据——从云端拉取的资产被编辑时同样产生首个本地 upsert——所以历史只在有标记时报告 `create`（“添加资产”），其字段没有旧值；迁移前的新增没有标记，仍显示为编辑，不做推断。Renderer 契约接受 `create` 并拒绝带旧值的新增；恢复备份不携带标记，恢复后的工作区把早期新增显示为编辑，偏向安全，GDBK 恢复可用时再评估） https://github.com/newcodebook/GoodDealer/pull/53
- [x] 重新添加近期删除且仍有墓碑的域名时给出可恢复的说明（Host 把墓碑拒绝映射为独立的 `DESKTOP_LOCAL_ASSET_DELETED`，不写入任何数据；适配器只对确切代码具名，其余拒绝保持不透明；资产库与引导的添加对话框显示“该域名已删除，目前不能重新添加。”，不再显示通用失败。当前没有清除墓碑的路径，所以文案不承诺恢复，见新增项。对已删除资产的编辑与删除也返回该代码，界面仍按通用失败处理） https://github.com/newcodebook/GoodDealer/pull/53
- [x] `local_device_lease_read` 的负向测试补齐 Standby、授权过期与授权切换进行中三种拒绝（Host 测试先证明同一开发授权下租约可读，再分别进入已验证延续的商业只读、把已发布 Active 授权的执行期限置为过去、请求但未应用授权切换，三者都以 `DESKTOP_LOCAL_HOST_UNAVAILABLE` 拒绝且不显示设备或租约） https://github.com/newcodebook/GoodDealer/pull/53
- [x] 引导连接步骤的“不可连接”规则改为逐个平台判定（目前仅在全部平台不可用时拒绝 `connect_provider`）；第二个平台进入引导前完成（引导连接步骤的每个平台带自己的 `admittedActions`：`unavailable` 与 `connecting` 不允许任何操作，`connected` 只允许断开，`disconnected`/`failed` 只允许连接；步骤级 `connect_provider`/`disconnect_provider` 必须恰好等于有平台允许该操作，卡片只按自己平台的允许项启用，所以一个平台可用不会打开另一个未认证平台。契约测试覆盖未认证平台与可连接平台并存、未认证平台声称可连接、各状态的非法操作） https://github.com/newcodebook/GoodDealer/pull/53
- [x] DNS 健康读取逐行报告能否绑定（Host 为唯一依据：凭据撤销或失效、凭据代不符、Zone 暂停、资产已归档时不提供“绑定 Zone”），避免界面提供 Host 必然拒绝的操作（DNS 健康行新增 `bindable`：Host 用绑定本身的证据查询 `latest_bindable_zone`（绑定与读取共用同一定义）加绑定对已有绑定的身份规则（无绑定，或同一连接、Zone 与名称的 detached 绑定）计算；Renderer 只依据它提供“绑定 Zone”，并拒绝在活绑定之上或无本域名 Zone 观察时声称可绑定的行。Host 测试对每种证据拒绝逐一证明读取不提供且绑定拒绝，并覆盖已绑定、同身份 detached 与异身份 detached） https://github.com/newcodebook/GoodDealer/pull/53
- [ ] 清除已拒绝使用但未写成墓碑的 custody（[ADR-0028](../adr/0028-refused-cloudflare-custody-purge.md)，Accepted，2026-11-13）：已实现情况 1、2 的 Host 确切基线撤销重试。`revocation_pending` 必须有当前目标 generation 的撤销取消证据且没有未结束 intent；`revoked` 必须有头账本 `revoke/burned/target_not_observed` 证据且已知基线为 Active。准备在 IMMEDIATE 事务内重验，prewrite/marker/恢复扫描允许该已证实基线而不恢复使用权限。前向迁移 `202611130001` 保留取消尝试，目标 generation 唯一索引仅排除 `revoke/cancelled/cancelled_before_inspection` 尝试，schema guard 升为 V3。已实现情况 3、4 的持久退役事务与 V4 前向迁移、Host 不透明请求/重试/完成计划及 Secure Host 同锁删除/不存在回读原语。退役请求阻断后续准备、prewrite、观察、恢复与 DNS 发布，放弃恢复不推进账本。本批已接入 Native 生产适配、ProviderLane 串行清理、设置页首次确认/手动重试、每次可写打开的 Host 单次重试集合；旧备份业务白名单恢复保持退役状态已有回归覆盖。整体尚未完成：情况 1、2 的设置页已按 Host 给出的 `retry_revoke` 动作提供情况 1、2 的撤销重试入口；macOS 真实 custody 资格仍待完成（暂停：需用户在 macOS 实机取得外部资格证据）。首次清理执行前显式确认的产品要求保持。
- [x] `provider_credential_orchestrator::revoke` 返回区分“无凭据可撤销”与各非确认结果（remediated、burned、recovery required）的结果枚举，而不是同一个 `Ok(false)`（`RevocationOutcome`：`NothingToRevoke`、`Revoked`、`PrewriteRemediated`、`NotObservedBurned`、`AuthorityStaleBurned`、`RecoveryRequired`，逐一对应 Host 的解析结果；准备撤销即已提交拒绝使用，所以除 `NothingToRevoke` 外的结果都唤醒投影重读，此前只有确认才唤醒。结果经 `cloudflare_connection_status` 读回的界面随生产界面组合一项交付） https://github.com/newcodebook/GoodDealer/pull/53
- [ ] 墓碑清除与已删除域名的重新添加：C2c2 已实现本地重新添加的 Host/Renderer 路径与“正在同步重新添加”界面状态，但按 ADR-0029 完成条件，生产构建由 `LOCAL_RE_ADD_ENTRY_QUALIFIED` 关闭该入口，删除的域名在生产中仍不能重新添加；墓碑物理清除仍推迟。Cloud 已物化删除并带 generation 列，checkpoint 与 rebootstrap 版本 3 携带墓碑与 generation（C1b1、C1b2a、C1b2b，见下），本地已有 generation 列（C1c1），rebootstrap 安装 checkpoint 墓碑（C1c2a，仅测试编译），本地同步表记录 wire 版本 3（C1c2b），Cloud 接受并物化重新添加、变更流水存 generation（C2a），Desktop Inbox 应用其他设备的重新添加（C2b），本地重新添加的数据库语义（C2c1），C2c2 已接通 Desktop Host 与 Renderer 的本地重新添加入口（生产关闭，见上）；本地 `sync_outbox_local_creations` 已允许每代重新添加创建标记，备份恢复已按 generation 限定写入（C3a1/C3a2）（决策已接受：产品负责人于 2026-11-13 确认 [ADR-0029](../adr/0029-domain-tombstone-purge-and-re-adding.md)，端到端删除、generation 与重新添加纳入阶段 3，暂定期间冻结该实体，失败保留证据并允许修正后重试；墓碑物理清除推迟。先实现端到端删除与 generation；重新添加现由 ADR-0029 的 C2 路径实现。）C1a（mutation wire v3）已交付 5d3d499。C1b1（删除物化，软删除：产品负责人 2026-11-14 选择选项 A，ADR-0029 决策 2 已修订）已交付 https://github.com/newcodebook/GoodDealer/pull/53：Cloud ingest 接受活跃资产的 delete，同一事务内软删除副本行并写墓碑，已删除行由数据库保证与墓碑成对且不可再修改，所有读取、快照、checkpoint、恢复候选与 DNS 观察准入排除已删除行，迁移补做此前已被接受却留成活跃行的删除，新设备引导不再重现已删除域名；有 DNS 观察回执的域名可删除。C1b2a（Cloud `entity_generation` 列、ingest 精确匹配与 `MUTATION_GENERATION_MISMATCH` 回执，wire 不变）已交付 https://github.com/newcodebook/GoodDealer/pull/53。C1b2b（checkpoint/rebootstrap wire 版本 3：活跃资产带 generation、墓碑入摘要；迁移 `202611140004` 拒绝版本 1/2 checkpoint；Cloud 构建/校验/重建/rebootstrap、client-core 引导累加器与 Desktop 原生描述符同步升级）已交付 https://github.com/newcodebook/GoodDealer/pull/53。重建的 generation 检查在变更流水存 generation（C2 前置）之前只起防御作用。C1c1（本地迁移 `202611140001`：`domain_assets`、`sync_tombstones`、`sync_outbox` 加 `entity_generation`，触发器保证不变与同代；Outbox 导出冻结的 generation，Inbox 拒绝与本地行不同代的 mutation，复制删除写入同代墓碑）已交付 https://github.com/newcodebook/GoodDealer/pull/53。C1c2a（本地迁移 `202611140002` 给墓碑加 `order_provenance`，checkpoint 来源墓碑只带删除 revision；rebootstrap 把 checkpoint 墓碑安装为软删除，已有同代墓碑不变，已删除实体有未同步编辑时整个安装失败关闭）已交付 https://github.com/newcodebook/GoodDealer/pull/53。C1c2b（本地迁移 `202611140003` 重建 `sync_outbox`/`sync_inbox`，新认领与新收到的 mutation 记录 wire 版本 3，重建前的版本 2 行保留原摘要；迁移执行器只对表重建关闭外键并在提交前检查）已交付 https://github.com/newcodebook/GoodDealer/pull/53；此前记录为版本 2 的行由第 191 行设备切换项给出 Cloud 接受版本的判别。C2 拆为 C2a、C2b、C2c。C2a（Cloud 接受重新添加：revision 锁内按墓碑 generation 与删除 revision 判断，否则 `MUTATION_GENERATION_MISMATCH` 记回执；迁移 `202611140005` 变更流水存 generation 与被取代的删除 revision，`202611140006` 只放行重新添加这一种已删除行转换；删除物化写入行 generation；Cloud 与 client-core 重建物化重新添加）已交付 https://github.com/newcodebook/GoodDealer/pull/53。C2b（Desktop Inbox 应用其他设备的重新添加：仅当本地已确认状态是指名的墓碑，未确认、contested、未结束 Outbox 或冲突时整页拒绝并重试；本地迁移 `202611140004` 记录被取代的 generation，墓碑删除与 generation 改变都须有记录；本地 Outbox 与删除墓碑写资产当前 generation）已交付 https://github.com/newcodebook/GoodDealer/pull/53。C2c1（本地迁移 `202611140005`：暂定指针、实体冻结、ACK 确认与拒绝撤回，Outbox 带被取代的删除 revision）已交付 https://github.com/newcodebook/GoodDealer/pull/53。C3a1（备份恢复按已确认 generation 拒绝：无 generation 的备份资产视为第 1 代，本地有墓碑、软删除行或第 2 代以后的活跃行时拒绝；存在暂定重新添加时整次恢复拒绝）已交付 https://github.com/newcodebook/GoodDealer/pull/53。C3a2（备份投影版本 2 携带每个资产的 generation，版本 1 按第 1 代读取；恢复只写到同一 generation）已交付 https://github.com/newcodebook/GoodDealer/pull/53。C2c2（Host 在已确认墓碑且前置条件满足时创建 provisional re-add，Renderer 区分回执并显示“正在同步重新添加”；生产构建由 `LOCAL_RE_ADD_ENTRY_QUALIFIED` 关闭）与被拒绝的本地删除停在 `pending` 墓碑的退出路径（本地迁移 `202611140006`，见下一行）随同一提交交付；PostgreSQL 资格套件已加入并发删除与重新添加的生命周期测试，b161364 的 CI 运行在 18.6 上 qualified、5/5 通过（https://github.com/newcodebook/GoodDealer/actions/runs/43818308872）；C3b（rebootstrap/checkpoint 安装按已确认 generation 拒绝更旧数据、等待未结束本地状态、暂定期间只确认墓碑，C3b2 本地迁移 `202611160001` 让 Cloud 已越过本地 generation 时前进；安装入口仍只在测试中编译；被拒绝本地编辑留下的 `pending` 字段标记已有退出路径，见下一行）已实现；C3c（连续性恢复不写业务数据，晋升后的 Inbox、恢复与 rebootstrap 入口均已防护）已核对。生产入口开启的剩余条件：设备切换 drain 端到端（第 195 行，产品负责人 2026-11-16 纳入 v1）；C2b 待决事项已按回退解决（下一行）。
- [x] ADR-0029 C2b 提交 37d002b 中未经评估的改动（重新添加时把上一代 `pending` 字段写回 g + 1 并生成冲突候选）：与决策 3“旧字段不复活”不符，复核评估 FAIL。产品负责人 2026-11-16 选择回退并设计退出路径（ADR-0029 决策 4“上一代被拒绝写入留下的字段标记”）：Inbox 重新添加在该实体有 `pending`/`sending` Outbox 行、`conflicted` 字段或开放冲突时整页等待；只剩被 Cloud 拒绝的写入留下的 `pending` 字段标记时照常应用，标记随 g 的字段版本退役，不写回、不生成候选，终止的 Outbox 行保留为证据。rebootstrap 的 checkpoint generation 前进按同一规则不再因这类标记等待，生产 rebootstrap 的这一前置随之解除。测试：排队编辑等待、被拒绝后应用并退役（`a_re_add_waits_for_a_queued_edit_then_retires_the_marks_of_its_rejection`），rebootstrap 前进越过被拒绝编辑的标记（`rebootstrap_advances_over_the_field_marks_a_refused_edit_left`） https://github.com/newcodebook/GoodDealer/pull/53
- [x] 本设备回声导致拉取停滞（新发现，C1b1 起存在）：本设备新增并删除某资产且两者都已 ACK 后，拉取页中对该新增的回声因实体已有墓碑以 `MutationConflict` 整页拒绝，每个周期重复，拉取永久停滞（本地测试已复现）。须让 Inbox 识别本设备已 ACK 的 mutation（mutation id、revision 与 wire 摘要一致）而不再重放到更晚的本地状态上，并覆盖重新添加、删除与编辑的组合（Inbox 在投影前查找本设备 `acknowledged` 的 Outbox 行：mutation id、实体、ACK revision 与按该行记录 wire 版本计算的摘要都一致才算回声；若实体已有该回声未描述的墓碑（任何 upsert 的回声遇到墓碑，或删除回声遇到别代墓碑）或资产行已是别的 generation，回声记为已应用、不再投影，只推进已应用 revision；其余条目照旧投影并接受原有检查。Inbox 按 revision 顺序应用，所以这种更晚的本地状态只可能来自本设备之后的写入；重新添加要求 R ≤ base，删除的回声总在重新添加之前拉取。Rust 测试覆盖新增+删除、编辑+删除、本地重新添加+再删除（本设备删除与其他设备删除两种起点）的回声，改写内容或错位 revision 的同 id 条目仍被拒绝且不写入；C2c1 测试改为真实拉取回声而不再改写已应用 revision） https://github.com/newcodebook/GoodDealer/pull/53
- [x] 被拒绝的本地删除停在 `pending` 墓碑（C2c2 前置）：与 ADR-0029 决策 4 的拒绝撤回语义一致，确定性拒绝后原子撤回删除：只匹配该 mutation 的同代、同 local commit sequence pending 墓碑；保留终态 Outbox 作为证据，删除 tombstone 后恢复原软删除行的活跃状态与原本地版本，并移除本次 delete 创建的 lifecycle 字段版本。幂等键冲突不表明该 mutation 一定未生效，故不自动撤回；可重试/结果未知的 sending 行仍保持删除状态。新增 SQLite 迁移、正向收敛测试、Cloud 后续编辑可继续应用的回归测试与幂等冲突负向测试。C2c2 已实现；下一步推进 C3b。
- [x] 本设备较早编辑的回声可能对本设备尚未同步的较晚编辑生成冲突候选（本设备回声评估后续，C1b1 起存在，未验证）：同一字段编辑 A 已 ACK、编辑 B 仍待发送时，A 的回声照常投影；Cloud 以 `isOwnEarlierWrite` 豁免本设备较早的写入，本地 Inbox 无对应豁免。须先用测试确认是否发生，发生则按同一回声匹配豁免（已确认：A 的回声对 B 的四个字段各生成一条冲突、Inbox 行 `conflicted`。修正：回声匹配拆为 `is_own_acknowledged_echo` 并传入投影；本设备回声的某字段若有本设备在其后提交、仍为 `pending`/`sending` 且载荷含该字段的 upsert，则该字段保留本地值与待发送版本、不生成冲突，与 Cloud 一致；被 Cloud 拒绝而停在 `pending` 的字段仍按原路径生成冲突，避免隐藏分叉。Rust 测试覆盖两种情形与 B 之后的 ACK 与回声） https://github.com/newcodebook/GoodDealer/pull/53。后续修正（审查发现 P2）：B 已 ACK、其回声尚未拉取时，A 的回声曾经由普通投影把已 `clean` 的字段从 B 覆盖回 A，直到 B 的回声到达；现在已 ACK 且 revision 晚于回声的本设备写入同样视为持有该字段，测试覆盖“两者都已 ACK、A 的回声单独一页先到”。
- [x] 写入口门禁的渲染测试覆盖全部写入口：目前只逐状态证明“添加域名”，补上域名详情目标价、冲突中心解决、DNS“绑定 Zone”，Cloudflare 连接、激活与观察入口进入生产组合时一并加入；若 Host 将来产生 Active 但无 mutate 的“受限”状态，补一条说明写入口缺失原因的横幅（`apps/desktop/src/app/write-entries.test.tsx` 在 DOM 中渲染真实工作区，对 Active+mutate、Active 无 mutate、Standby 只读、商业只读四种状态逐一证明域名详情“编辑价格”、冲突中心“保留本地”/“接受平台”与 DNS“绑定 Zone”只在可写时出现；夹具的数据本身都允许写入（详情可编辑、冲突裁决可用、Zone 已观察），所以门禁是唯一能隐藏它们的条件。Cloudflare 连接、激活与观察入口的同类测试由生产界面组合一项交付。Host 的 Active 状态总是同时带 `workspace:mutate`，“受限”横幅随该状态出现时再加） https://github.com/newcodebook/GoodDealer/pull/53

- [x] 准备已提交后失败的 Provider 操作也唤醒投影：撤销在准备时已提交 `revocation_pending` 与拒绝使用，激活在准备时已提交 prewrite 状态，但其后 prewrite 检查、标记或解析返回 `Err` 时 `run_provider_operation` 只在 `Ok(true)` 时唤醒，投影保持旧状态直到下一次唤醒；让编排器区分“未准备”与“准备后失败”，后者同样唤醒（`run_provider_operation` 在每次 Provider 操作结束后无条件唤醒投影：激活在 Zone 导入与 prewrite 时、撤销在准备时已提交，非确认结果同样改变连接，所以不按结果判断；重读是幂等的，相对限速的 Provider 调用成本很小；源码策略测试防止唤醒再次依赖结果） https://github.com/newcodebook/GoodDealer/pull/53
- [x] 本地新增的域名同步到 Cloud：Cloud ingest 对副本中不存在的实体返回 `MUTATION_ENTITY_UNKNOWN`（`apps/cloud/src/modules/workspace/mutations/index.ts` 与 `postgres-ingest-service.ts`），副本行只来自 seed 或快照物化，所以经 `local_domain_asset_create` 新增的域名的首个 upsert 会被 Cloud 拒绝。需要 ingest 对副本中既无活跃行也无墓碑的实体接受首个 upsert 并创建活跃行（未提供字段取默认值），客户端处理该拒绝码的现状一并核对；PostgreSQL 资格证据覆盖新路径。ADR-0029 已接受；generation 实现后首次添加的实体 generation 为 1。审查 ADR-0029 时发现（Cloud ingest——PostgreSQL 与内存实现——在 tenant 事务与工作区 revision 锁内读取墓碑，只拒绝当前为墓碑的资产，其余未知资产由首个 upsert 以默认字段与 revision 0 创建副本行后应用字段，字段过期判定对新建资产从 0 起算；app role 只用已授予的列级 INSERT，`ON CONFLICT DO NOTHING` 不覆盖既有行。Cloud 与 client-core 的 checkpoint 重建对同一情形创建默认行，client-core 遇 delete 改为失败关闭。Desktop Inbox 本就为新实体建默认行，不需改动。测试：PostgreSQL 新增、同批次新增后编辑、重复提交为精确重复、本设备其后的编辑被接受（其他 epoch 或更旧 base 的写入过期由同字段规则的测试覆盖）、另一租户不可见；墓碑资产作为毒项整批拒绝；内存 ingest、端口、两处重建各有正向与负向用例；两个并发的首个 upsert 只创建一次。PostgreSQL 18.6 资格运行 https://github.com/newcodebook/GoodDealer/actions/runs/43435475601 在 abd7a30 上通过，报告 `qualified: true`、按名单逐项执行新测试） https://github.com/newcodebook/GoodDealer/pull/53
- [x] 同一字段连续未确认的编辑永久卡住同步：本地编辑以提交时的 `applied_through_server_revision` 作为 `baseServerRevision`，Outbox 的 wire 在提交时冻结；同一字段的第二次编辑若在第一次 ACK 前提交，其 base 小于第一次被分配的 revision，Cloud 按字段 revision 判为 `MUTATION_FIELD_STALE`，Desktop 把映射后的 `SYNC_STORAGE_REJECTED` 视为可重试，于是该项与其后的整条 Outbox 永久重试（已复现：PostgreSQL 测试中同一设备 base 均为 0 的两次编辑，第二次被判过期；Rust 测试证明 ACK 前的两次编辑带同一 base、设备序号递增。修复：Cloud 的过期判定——PostgreSQL 与内存实现共用 `stale-field-rule.ts`——把同一设备、同一 Lease epoch、更小设备序号且 base 不大于本次的已接受写入视为本设备的先前编辑而不是冲突；写入者从 `workspace_mutations` 读取，replay 已压缩时失败关闭为过期。负向测试：以更旧 base 提交的后续写入、另一 Lease epoch 的写入仍判过期；并发同字段测试改为两次互不知情的写入。`ACCOUNT_AND_SYNC` 写明该规则。CI `wp2-workspace-sync-persistence` 运行 43437306915 在 eb25634 上通过，报告 `qualified: true`，PostgreSQL 18.6） https://github.com/newcodebook/GoodDealer/pull/53
- [x] 确定性的推送拒绝不应无限重试：`sync/http-service.ts` 的 `mapPushCode` 把 `MUTATION_FIELD_STALE`、`MUTATION_BASE_REVISION_AHEAD` 与 `MUTATION_ENTITY_UNKNOWN` 都映射为 `SYNC_STORAGE_REJECTED`，Desktop 把它视为可重试，所以真正的冲突让 Outbox 头永久重试、阻塞其后全部同步（`mapPushCode` 改为对 ingest 拒绝码的穷举映射；新增推送拒绝码 `SYNC_MUTATION_CONFLICT`，覆盖字段过期与墓碑实体，协议 schema、wire 语料（生成）与 Rust 严格校验同时更新；Desktop 对多项批次先隔离，单项把 Outbox 行终止为 `conflicted`、`last_error_code='sync_mutation_conflict'`，保留行与字段，其后 Outbox 继续发送；字段 `sync_state` 不变，拉取到对方写入时进入冲突中心而不覆盖本地值。`MUTATION_BASE_REVISION_AHEAD` 只在 Cloud 状态回退时出现，与 `MUTATION_DRAIN_SEALED`、`MUTATION_WORKSPACE_MISMATCH` 一同保持可重试以保住本地编辑。Cloud 应用层逐码测试、Rust 业务层与推送处置测试。被拒绝序号在 drain 中的缺口拆为下一项） https://github.com/newcodebook/GoodDealer/pull/53
- [x] 被确定性拒绝的 mutation 序号在设备切换 drain 中留下缺口：Cloud ingest 接受序号缺口，但 drain 验证（`devices/drain-verification.ts`）要求 `mutation` 流连续接收水位等于最后分配序号、无缺失区间且 rolling digest 一致，否则 `DRAIN_STREAM_GAP`；本地 `sync_outbox_fields_v2_immutable_delete` 禁止删除已认领行，不能靠丢弃 Outbox 行解决；Desktop 目前尚不生成 drain proof，所以在设备切换交付前须解决。ADR-0029 的经同步重新添加以本项为前置（决策已接受：产品负责人于 2026-11-13 接受原子拒绝回执、全局设备序号身份及独立有版本的 drain 结果摘要，待实现与资格验证。见 [ADR-0019](../adr/0019-complete-local-business-schema-and-cloud-replica-model.md)（Accepted，2026-11-13；实现中：B1 的结果 envelope、drain proof v2 与 PostgreSQL v2 seal 重建，B2 的结果联合 ledger 与单项业务拒绝同事务记账，以及 B3 的客户端 v2 结果链合同与跨 Lease epoch 的全局 v2 seal 已交付；设备切换端到端串通见下一项））（已交付 Cloud 原子拒绝回执、v2 结果链与 seal 及客户端合同；设备切换端到端串通在第 191 行，暂停中） https://github.com/newcodebook/GoodDealer/pull/53
- [ ] 设备切换端到端串通 ADR-0019 v2 drain：Host 按序读取 Outbox 的持久 Cloud 结果（`acknowledged` 与 `conflicted`/`sync_mutation_conflict`），用 client-core `foldPersistedMutationResults` 与 `buildDrainProofClaims`（v2）生成声明并签名，Cloud 接收 proof 写入 `device_drain_proofs` 时保存 `proof.schemaVersion`；端到端覆盖拒绝后后续同步与 drain 成功、Lease 轮换后 drain 成功；跨 ADR-0029 C1a 升级的行须能确定 Cloud 记录的是 v2 还是 v3 提交 envelope（本地目前只记 v2 编码摘要，升级前认领、升级后 ACK 的行两者皆有可能），C1c2b 之后新记录的行以版本 3 记录、可判别，此前记录为版本 2 的行由本项给出 Cloud 接受版本的判别（产品负责人 2026-11-16 决定纳入 v1；仓库尚无 Desktop 设备切换流程与 Cloud proof 接收路径，须先写 Task Frame）（决策已接受：产品负责人于 2026-11-17 按建议接受 [ADR-0032](../adr/0032-desktop-device-switch-and-drain-handoff.md)——普通切换在 Active 设备发起、强制接管在目标设备发起并纳入 v1；`execution_fact`/`device_audit` 以空流声明，交付两条流是第一项 Provider 能力资格化的前置；drain proof 以 ADR-0011 设备签名密钥签名；跨 C1a 的版本 2 行以 Cloud 本设备回执查询判别；新设备不迁移本地专有数据。实施分 S1 Cloud 路由与回执查询、S2 Host 停写/折叠/签名与 rebootstrap 进入生产、S3 Desktop 界面、S4 端到端）。S1a（本设备回执查询：`/v1/workspace-sync/mutations/receipts`，设备由会话派生、不接受调用方指定，返回 Cloud 记录的 wire 版本与摘要；协议、应用、路由与 PostgreSQL 负向测试）已交付 831edd4（https://github.com/newcodebook/GoodDealer/pull/53；PostgreSQL 用例由 CI 18.6 运行）。S1b 普通部分（`/v1/device-switch/requests` 发起、状态、取消：仅当前 Lease 持有设备发起，进入 `draining`，绑定目标设备有效密钥，幂等重放、单一未结束切换、过期未引导的切换在下次发起时失败、跨租户隔离与并发 PostgreSQL 测试；强制接管返回 `FORCED_SWITCH_UNAVAILABLE`）已实现，随本 PR 提交（https://github.com/newcodebook/GoodDealer/pull/53；PostgreSQL 用例由 CI 18.6 运行）；S1c1（drain 交接与引导统一以目标设备有效密钥为工作流绑定密钥：迁移 `202611170001` 替换 `device_consume_drain_proof`，TypeScript 交接同步，夹具与漂移探针更新）已实现，随 https://github.com/newcodebook/GoodDealer/pull/53 提交（PostgreSQL 用例由 CI 18.6 运行）；S1c2（`/v1/device-switch/requests/drain`：以来源设备有效密钥验 drain proof 签名，所有者例程 `device_record_drain_proof`（迁移 `202611170002`）复核工作流、密钥、Lease 与时间窗后写入 `device_drain_proofs` 并保存 `proof.schemaVersion`，交接事务 seal 三条流、空流以创世摘要声明，失败整体回滚）已实现，随 https://github.com/newcodebook/GoodDealer/pull/53 提交（PostgreSQL 用例由 CI 18.6 运行）；S2a（Host 以 Rust 复现 v2 结果链折叠、提交 envelope 与 handoff proof 的 transcript/摘要输入，与协议测试钉住同一组金摘要）已实现，随 https://github.com/newcodebook/GoodDealer/pull/53 提交；S2b（本地迁移 `202611170001` 的持久停写栅栏：触发器在栅栏存在时拒绝推进设备序号与插入 Outbox，Cloud 结果照常落盘；Host 在一个快照中读取 Outbox 并折叠出可签名、等待或失败关闭的 drain 进度）已实现，随 https://github.com/newcodebook/GoodDealer/pull/53 提交；S2c 本地部分（本地迁移 `202611170002` 的不可变 Cloud 记录版本；版本 2 行在 Cloud 回执的 epoch、序号、结果与摘要等于本地按 v2 或 v3 重建的候选后才记录，任一不符整批不写，drain 进度在记录前报告需要回执）已实现，随 https://github.com/newcodebook/GoodDealer/pull/53 提交；回执查询的发送与解析随 S2d；S2d1（设备身份只签逐帧校验为本机 handoff drain proof 的 transcript，不暴露任意签名）已实现，随 https://github.com/newcodebook/GoodDealer/pull/53 提交；S2d2a（本地迁移 `202611170003`：停写栅栏记录所排空的 Lease epoch，本设备以更新 epoch 持有 Lease 时遗留栅栏可识别并清除）已实现，随 https://github.com/newcodebook/GoodDealer/pull/53 提交；S2d2b（Host 端栅栏、进度、回执查询与严格解码、proof 构建与 drain 请求体、切换响应严格解码）已实现，随 https://github.com/newcodebook/GoodDealer/pull/53 提交；S2d3a（Host 普通切换请求体与切换 id 只取自 Cloud 视图（须为本设备发往所请求目标的普通切换）、当前 epoch 栅栏读取；Tauri 协调器：Cloud 接受后同一提交内关闭写入，推送等待中唤醒同步、回执缺失失败关闭、仅在 mutation 流完全确认后以设备密钥签名并提交，Cloud 报告取消或失败才重新开放写入，未获答复的请求在获答复前以同一幂等键与原目标重试；发起切换与每次推送前清除更早 epoch 的遗留栅栏）已实现，随 https://github.com/newcodebook/GoodDealer/pull/53 提交；S2d3b（Tauri 命令 `device_switch_request`/`advance`/`status`/`cancel` 接入协调器，权限清单与生成的 schema、命令策略与适配器 `createDeviceSwitchPort`：Renderer 只发送目标设备 id，只接收封闭步骤码与 Cloud 状态或拒绝码，严格解析、未知字段与值一律拒绝）已实现，随 https://github.com/newcodebook/GoodDealer/pull/53 提交；设备界面入口随 S3。决定（产品负责人 2026-11-18）：采用下述方案 A。原待决事项——S3 Active 设备一侧（设置“设备”列表与移交确认）需要设备名称、平台与最近在线时间：brand 设计稿 `SettingsPanel.jsx` 的设备列表与移交对话框按名称显示设备（如“MacBook Pro（本机）”）并显示最近在线，协议 `deviceBindingSummarySchema` 也要求 `platform`、`displayName`、`lastSeenAt`，但 Cloud `device_bindings` 只存设备 id、状态、凭据纪元与绑定/移除时间，没有任何来源，也没有设备列表路由。影响：S3 Active 设备界面无法按设计稿交付；Host、Tauri 命令与协调器（S2d）不受影响。方案 A（推荐）：Desktop 在绑定与每次登录时报告平台（Host 从操作系统取得的封闭枚举）与用户可改的显示名称（默认取操作系统主机名、按 `displayLabel` 规则截断），Cloud 迁移为 `device_bindings` 加列并在会话活动时更新最近在线（按小时取整以减少精度），新增只读 `/v1/devices/list` 路由（仅本账户、脱敏）；方案 B：不收集名称，列表与对话框只显示平台与设备 id 的短后缀，偏离设计稿；方案 C：名称只存在每台设备本地，列表只能显示本机名称，另一台设备显示为“另一台设备”。S3a1（Cloud 设备列表与自报告：协议请求 schema 与可空的平台/名称/最近在线、迁移 `202611180001` 加列与整点约束、`/v1/devices/list` 与 `/v1/devices/self` 只认已绑定设备的有效 Desktop 会话且不要求 Lease、报告只写本设备并在名称或平台变化时推进列表修订、路由与 PostgreSQL 负向与跨租户测试）已实现，随 https://github.com/newcodebook/GoodDealer/pull/53 提交（PostgreSQL 用例由 CI 18.6 运行）；S3a2/S3a3 设备目录与本机命名已在本轮源码组合，验收记录见文末；Native 已支持 Standby 目录读取与 signed v4 role exchange。普通交接来源持久回执与 Inbox 续作已接入（见文末），目标引导、强制接管和完整移交界面继续实施；不再等待已交付的 Standby 会话。
- [ ] 实施 [ADR-0032](../adr/0032-desktop-device-switch-and-drain-handoff.md) 完整设备旅程：Standby 协议增量已独立提交 `981804d`，Cloud/Host 严格 v4、独立用途签名、角色准入、持久地板、无副本与只读界面由 `1218e18` 组合；普通交接回执、原签名请求重启续作与只读 Inbox 见文末。仍需目标引导/激活、强制接管重新认证与取消、云恢复和完整移交界面；真实第三用途 OpenBao、双系统设备与发行资格单独验收。

### 4. 当前范围全系统 V1 汇合验收

- [ ] 在同一冻结候选上，为 v1 详细垂直验收表的每一行取得新鲜证据（暂停：依赖阶段 2 的打包构件逐屏对照（真实账号登录由用户完成，三种 WebView 分属三种系统）与阶段 3 的 ADR-0028/0029 实现与 ADR-0019 实现（8 市场写入后首读已降到 1 s 内并纳入基准断言，不再待决）。该汇合验收不阻止后续实际能力实现，按当前落地策略推进）
- [ ] 独立复审 PASS（暂停：随上一项）

### 5. 多平台共用框架与 Cloudflare 全能力

按 [落地策略](../IMPLEMENTATION_STRATEGY.md) 的实际依赖推进具体能力；旧框架工作证据见 [阶段 5 框架 Task Frame](PHASE5_FRAMEWORK_PLAN.md)。资产归集与 Afternic 不等待完整 Cloudflare 写能力或阶段 4 汇合验收；资格限制真实执行声明，不替代本地实现。

- [x] 平台连接与角色模型（registrar、dns、marketplace、acquisition）（框架项，2026-11-16 起先行，见 [Task Frame](PHASE5_FRAMEWORK_PLAN.md)。F1：平台连接 = 平台 + 角色集合（`local_provider_connections.provider_kind` 与 `capabilities_json`），Host 设置读取接受四种角色、对其他角色或重复角色失败关闭、每个角色在资格认证前不可用；client-core 角色取自协议 `domainProviderRoleSchema`，设置界面始终列出四种角色。按 manifest 与凭据实际权限派生角色须平台事实，随第 6–10 阶段各平台交付） https://github.com/newcodebook/GoodDealer/pull/53
- [ ] binding 增加 `listing` 资源类型（框架项，2026-11-16 起先行，见 [Task Frame](PHASE5_FRAMEWORK_PLAN.md)）
- [x] 每平台私有 Service 骨架和能力 manifest（2026-11-24 用户决定预建骨架，ADR-0027“平台 Service 骨架”。`secure-host-core` 的 `provider_services` 为十二个首发平台各建一个私有 Service 模块，镜像协议能力目录与 manifest，唯一准入入口先按连接声明的角色拒绝、再按 manifest 拒绝，`ProviderAdmission` 无值因而不可能放行；协议测试 `domain-provider-host-mirror.test.ts` 固定目录、平台顺序与每个 Service 的已实现清单。既有平台 transport 仍由各自资格或受控验收开关管控，尚未经此准入；骨架不计为平台交付。未合并旧的 F2–F7 分支，其 8 平台版本已被取代） https://github.com/newcodebook/GoodDealer/pull/53
- [ ] 资格登记按 manifest 能力标识校验，并让首个取得资格的能力同时经 Service 准入与资格登记放行（F3 余项；随第一个取得资格的能力实施）
- [ ] 跨平台所有权验证的本地操作计划（框架项，2026-11-16 起先行，见 [Task Frame](PHASE5_FRAMEWORK_PLAN.md)）
- [ ] 对账任务模型（框架项，2026-11-16 起先行，见 [Task Frame](PHASE5_FRAMEWORK_PLAN.md)）
- [ ] 逐笔资金确认组件（含出价）（框架项，2026-11-16 起先行，见 [Task Frame](PHASE5_FRAMEWORK_PLAN.md)）
- [ ] 负向测试：越权、跨租户、伪造 grant/bid、角色串用凭据、批量部分失败（框架项，2026-11-16 起先行，见 [Task Frame](PHASE5_FRAMEWORK_PLAN.md)）
- [ ] Cloudflare Registrar 能力（账户级只读归集已接入原生设置和持久资产库；专用账户连接、真实资格、续费与其他写能力继续实施）
- [ ] 第一个写入 `domain_assets.expires_on` 的注册商观察必须写入注册局到期时刻的 UTC 日期，不能用本地日期或注册商显示日期（到期窗口按 UTC 日计算的前提；当前只有测试种子写入该列），并补写入侧测试（待实现；按当前策略的能力依赖推进）
- [ ] Cloudflare DNS 写入与 DNSSEC（待实现；按当前策略的能力依赖推进）
- [ ] Cloudflare 监控（待实现；按当前策略的能力依赖推进）
- [ ] 核对 Cloudflare 平台事实并更新快照（待实现；按当前策略的能力依赖推进）

### 6. Porkbun

- [x] 核对官方文档并更新平台事实快照（2026-11-24 读取官方 OpenAPI v3.112，记入 [API 核查](../PROVIDER_API_REVIEW.md) Porkbun Registrar 行；[Task Frame](PORKBUN_REGISTRAR_INVENTORY_TASK_FRAME.md)） https://github.com/newcodebook/GoodDealer/pull/53
- [x] 能力清单映射到四种角色（2026-11-24 按官方 v3.112 逐项核对：`registrar.domain.observe` 为 `qualification_pending`；注册、续费、转入、自动续费、联系人、nameserver、glue、DNS 记录与 DNSSEC、可用性查询、Closeout 购买与到账对账等为 `implementation_pending`；赎回、转出/授权码、锁、隐私开关、自有 Listing/销售/所有权验证、竞拍、预订及其监控为 `official_api_absent`，按 ADR-0027 列入私有适配器清单；manifest 新增这两种原因）https://github.com/newcodebook/GoodDealer/pull/53
- [ ] 私有 Service、合同与负向测试（账户归集已在源码组合：Native 只读 `/domain/listAll`、成对凭据 custody 与三系统掩码输入、Host 库存迁移 `202611240001`、`porkbun:registrar:observe` 授权能力、Tauri 命令与 ProviderLane、设置页面板。余项：资格登记与真实账户验收，以及 DNS/续费等其他能力）
- [ ] 逐项能力资格证据（使用沙箱或 `dryRun`）（待实现；按当前策略的能力依赖推进）
- [ ] 证明框架核心模型未改动（待实现；按当前策略的能力依赖推进）

### 7. Spaceship（含 SellerHub）

- [ ] 核对官方文档并更新平台事实快照（待实现；按当前策略的能力依赖推进）
- [ ] 能力清单映射到四种角色（待实现；按当前策略的能力依赖推进）
- [ ] 私有 Service、合同与负向测试（凭据 scope 和资格按角色隔离）（待实现；按当前策略的能力依赖推进）
- [ ] 逐项能力资格证据（待实现；按当前策略的能力依赖推进）

### 8. Dynadot、Namecheap

- [ ] Dynadot：核对事实、列出能力清单、实现 Service 与测试（HMAC 密钥只在 Host custody）、取得资格证据（2026-11-24 已读取官方 V1 文档并记入 [API 核查](../PROVIDER_API_REVIEW.md)。暂停：`DOMAIN_LIST` 的 schema 与官方示例在字段命名、`locked` 类型上互相矛盾，时间单位与分页终止条件未写明，无法写出失败关闭的严格解析。影响：Dynadot 资产归集无法实现。可选方案：（a）用户在 Dynadot API 设置页生成沙箱密钥并填入 `local.env`，以沙箱真实响应确定 wire 形态（推荐，免费、不动真实资金）；（b）改用 V2 Beta，但官方声明其可能无通知变更；（c）按示例猜测字段，违反只依官方事实的约束，不采用。）
- [ ] Namecheap：核对事实、列出能力清单、实现 Service 与测试（IP 白名单不满足时失败关闭并说明如何修复）、取得资格证据（暂停：2026-11-24 官方 API 文档 `namecheap.com/support/api/` 对自动化读取返回 403 与 Cloudflare 人机验证页，平台事实无法核实；不绕过人机验证。影响：Namecheap 资产归集无法开始。可选方案：（a）用户在应用内浏览器窗格打开该文档页并完成验证，之后由同一窗格读取（推荐）；（b）用户提供官方文档的离线副本及其来源；（c）凭记忆或社区代码实现，违反约束，不采用。）

### 9. GoDaddy、Afternic

- [ ] GoDaddy：官方 v3 账户归集已实现，真实生产账户与双系统实机待验收，其他能力按当前策略实施
- [ ] Afternic：核对事实、列出能力清单，实现 Portfolio API 的 Listing 与改价，取得资格证据（待实现；按当前策略的能力依赖推进）
- [ ] GoDaddy DNS 记录读取（`dns.records.observe`）：[Task Frame](GODADDY_DNS_RECORDS_OBSERVE_TASK_FRAME.md)；Native 只读客户端与严格分页解析已完成（9f9e124）。暂停：GoDaddy PAT 按 scope 授权，官方只列出 `domains.domain:read` 与写 scope `domains.dns:update`，未写明 `GET /zones/{zone}/dns-records` 需要哪个 scope，也没有只读 DNS scope（2026-11-24 [官方认证说明](https://developer.godaddy.com/docs/api-users/auth#pat-scopes)）。影响：无法判断只读 DNS 能否在最小权限下实现，组合需要把现有 GoDaddy 连接的角色从 registrar 扩为 dns+registrar，依据不足。可选方案：（a）用户用只勾选 `domains.domain:read` 的 PAT 先做一次账户归集（同时核实该 scope 覆盖 `GET /domain-names`），再对一个受控域名调用一次 DNS 读取（Linux 受控验收，`local.env` 的 `GODADDY_*`），成功即按同一连接扩展 DNS 角色并组合（推荐）；（b）若只有 `domains.dns:update` 可读，按“平台不提供最小权限授权”把 GoDaddy `dns.records.observe` 降级；（c）不验证直接要求用户授予写 scope，违反最小权限，不采用。

### 10. Atom（含 AtomRegistrar）

- [ ] 核对官方文档和准入门槛，更新平台事实快照（待实现；按当前策略的能力依赖推进）
- [ ] Listing、逐笔确认的出价、AtomRegistrar 的 Service 与负向测试（query-string token 不进入日志、错误或 URL 记录）（待实现；按当前策略的能力依赖推进）
- [ ] 逐项能力资格证据，或者带原因标记为不可执行（待实现；按当前策略的能力依赖推进）
- [ ] Atom Standard 整批上架（[Task Frame](ATOM_LISTING_CREATE_TASK_FRAME.md)；2026-11-24 已核对 `add-domain`/`domain-details`/`verify-dns` 官方合同。已完成第一部分：协议执行证据 `add_standard`、测试向量与 Cloud 审计/执行台账迁移 `202611240001`/`202611240002` 的准入。Host 设备签名已接入同一用途。Native `add-domain` 发送（固定 Standard、整数美元价格、仅文档回执）与写后整数售价读取已完成。剩余：本地计划/认领/结果（与 Codex 的 SellerHub DNS 分支 `202611200015` 重建同一本地批准表和四个共享触发器，待其合入后在其之上实施，避免两份整体重建互相覆盖）、Tauri 命令与批量页、文档与审查；补一条直接调用 Cloud 准入函数的 Postgres 负向测试，证明 `add_standard` 拒绝借用的 `matched`/`published` 结果（当前只由协议解析拦截）。协调：Codex 的 SellerHub DNS 验证分支 `202611200007`/`0008` 与本迁移整体替换同一 Cloud 准入函数，后合并的一方须把对方的用途并入自己的函数体）
- [ ] Atom Standard 所有权验证（`verify-dns` 触发与 TXT 发布；依赖上架切片与 Cloudflare DNS 写入资格）

### 11. 1.0 资格与发行

- [ ] 关闭 Q-CF（待实现；按当前策略的能力依赖推进）
- [ ] 关闭 Q-PROV（待实现；按当前策略的能力依赖推进）
- [ ] 关闭 Q-OPS、Q-AUDIT、支付与销售资格（待实现；按当前策略的能力依赖推进）
- [ ] 关闭 Q-NATIVE、Q-REL；`pnpm gate:validate` 通过（待实现；按当前策略的能力依赖推进）
- [ ] 在最终候选上重新通过阶段 4 的 V1 验收（待实现；按当前策略的能力依赖推进）
- [ ] 取得 `1.0.0` / `stable` 批准（待实现；按当前策略的能力依赖推进）

### 并行补强

- [x] live PostgreSQL 并发/RLS、容量、崩溃恢复、长时间运行（CI 运行 https://github.com/newcodebook/GoodDealer/actions/runs/43413659224 ，PostgreSQL 18.6，提交 caba50a，范围仅 workspace mutation ingest 路径：16 个租户共用同一工作区 id 并发写入 760 条、8 个连接，约 262 条/s，p50/p95/p99 约 57/73/111 ms；8 个租户 600 s 混合负载 47,134 次写入、11,782 次与新写入并发的已提交项重试、每 2 s 一次共 176 次不变量检查，无违例；同一项并发重复提交只应用一次；`fsync`、`synchronous_commit`、`full_page_writes` 均为 on 时 3 次写入中 SIGKILL 容器，已确认的写入无一丢失，每租户至多 1 项已提交未确认，已提交前缀一致，重提交恰为每个已提交项 1 次重复，12 个租户都续写到 1,000 项；六张负载表强制 RLS、应用角色非属主且无 BYPASSRLS，应用角色看不到其他租户的行。不构成：完整 RLS 资格（逐策略审计、全部写路径 WITH CHECK、其他表）、操作系统崩溃或断电下的持久性、超过 10 分钟的稳定性（vacuum/膨胀、XID 年龄、内存上限）、容量 SLO 或生产规格、Gate 关闭；本机 18.4 结果只是诊断） https://github.com/newcodebook/GoodDealer/pull/53
- [x] 把 `desktop_local_host/source.rs` 的快照临时目录改为仅属主可访问（启用生产备份的前提）（`private_snapshot_directory` 在 Unix 上以 `0700` 创建，创建后对目录本身（不跟随 symlink）校验属主为当前有效用户且组与其他用户无任何权限，不符即 `StorageRejected`；macOS 与 Linux 都走 Unix 分支；Windows 沿用系统临时目录（位于用户配置目录下，默认仅该用户可访问，未另加 ACL 校验）；生产代码中唯一的临时目录创建点；负向测试覆盖 0750/0705/0770/0777 与 symlink） https://github.com/newcodebook/GoodDealer/pull/53

## 2026-11-18 对谈后的实施增量

- [x] 十二平台 Rust/TypeScript 读取合同、展示名称与不可执行 manifest 同步；销售聚合支持全部十二平台。
- [x] DesktopLocalHost 按授权、业务、同步、Provider 协调和恢复拆分，保持单一数据库所有者。
- [ ] 按 ADR-0027 交付批量父计划、DNS 验证与重开对账续作。
- [ ] 交付跨机离线业务备份、受限读出与有效授权后的导入；不复用安装绑定 v1 作为跨机格式。
- [ ] 交付原设备丢失时的云恢复、Windows/macOS 原生实现及双向恢复演练。
- [ ] 完成 PROVIDER_API_REVIEW 中未核实的卖家端点、账户准入与真实平台资格。


## 2026-11-18 设备目录客户切片

- Task Frame：[设备目录与本机命名](DEVICE_DIRECTORY_TASK_FRAME.md)；基线 `b5bcee2`。
- 已实现：设置读取当前账户设备、显示本机/角色/系统/整点最近报告时间、保存本机名称，再次打开读取 Cloud 持久结果。
  Native 固定路由与 build platform、严格 Cloud v1/IPC、当前设备及 credential-instance 栅栏；Renderer 不接收签名元数据。
- Cloud 复用 `202611180001`，无新增迁移；读和报告都锁定有效签名密钥，revoked/rotated 拒绝且目录角色为 none。
  协议补 rotated-key 反例。保存不确定先刷新读取，不自动重复提交；业务 generation 更新保留编辑状态。
- 验证：PostgreSQL 18.6 UTF8 12 项（含真实锁等待后撤销、跨租户和名称约束）通过；Native 目录金向量/负向 3 项、
  client-core 2 项、设备 DOM/IPC、真实 WorkspaceView 输入保留回归通过。独立评估 `device_architecture_review` 已复跑以上范围并 PASS。
- 最终根 `pnpm check` 通过（结构 205 项、local-storage 408 项/6 项既有 ignored、Desktop Native 78 项、secure-host-core 41 项）；Desktop production build、相关 Native clippy 与格式检查通过。Windows/macOS 构件、实际 Cloud 部署和发行资格尚未验证；本地测试不授予这些声明。
- 未完成：Standby Cloud/Host v4、持久授权地板、目标引导/强制接管/云恢复；本切片不开放交接，不代表上述能力完成。


## 2026-11-18 引导到期后的重新登录恢复

- Task Frame：[过期引导后的重新登录恢复](BOOTSTRAP_EXPIRY_TASK_FRAME.md)；基线 `6e81e57`。
- 已接入现有 Desktop OAuth 登录/刷新：从已验证账户的默认工作区读取过期引导，在同一事务终结能力、nonce、pending allocation 与工作流，并经 checkpoints 端口释放 pin。
  保留旧 Lease、drain proof、步骤历史和 epoch 上界；原 allocation guard 继续拒绝未到期或孤立 pending。
- 无新增表或迁移；复用已有 burned/expired/failed 字段。严格核对 pending 与 current/highest、已存在 Lease、能力与目标绑定。
- 引导步骤/激活增加外部 I/O 后的当前时钟期限复核，防止等待或签名跨期后仍提交。
- 验证：PostgreSQL 18.6 UTF8 三文件 48/48 通过，独立评估复跑 48/48 并 PASS；最终根 `pnpm check` 通过（结构 205、local-storage 408/6 项既有 ignored、Desktop Native 78、secure-host-core 41）。差异与五份文档本地链接检查通过。
- 引导开始后的取消、Standby、目标引导安装和云恢复尚未完成；不声明真实 Cloud 或双系统发行资格。

## 2026-11-18 Standby 授权、无副本入口与只读降级

- Task Frame：[Standby 授权客户切片](STANDBY_AUTHORIZATION_TASK_FRAME.md)；持续目标与全部约束见 [实施目标](../IMPLEMENTATION_GOAL.md)。
- 原有独立 Standby 协议已单独保存为 `981804d`；本切片接续它，同时切换 Cloud/Native/client 到唯一 v4 角色交换，删除 v3 请求与裸响应路径。
- 第二设备 OAuth/刷新、三用途签名与 verifier registry、锁定角色推导、严格路由清单及签名后撤销/期限复查已组合。只有精确有效 pending bootstrap 目标获得 pending−1 地板，避免阻断其随后激活；其他设备使用 highest allocated。
- Host 验签后在 Native custody 写入并读回安装/租户/设备绑定的安全、时间、Lease 与商业地板，再在原 publication mutex 内发布角色；缺失键、标记/记录损坏或缺项拒绝。Active→Standby 保留真实 SQLCipher 资产、原子关闭业务/Provider/Outbox 执行，旧 Active 重放在重启后仍拒绝。
- 首次 Standby 没有副本时显示明确待副本页面及真实设备目录/刷新授权，不创建空业务库。已有副本呈只读；降级立即隐藏本机命名，普通业务同步仍保留未提交输入。
- 独立评估：[完整审查记录](../reviews/2026-11-18-standby-authorization-review.md)，Cloud 与 Host/Native/Renderer 均 PASS。最终拒绝顺序调整另经独立回归 1/1 与 Standby 13/13 复验。
- 验证：完整 PostgreSQL 18.6 UTF8 22 文件 344/344、协议 26 文件 464/464、修复后的设置入口 23/23、Desktop production build、三个 Native crate 的 clippy（含 all-targets / -D warnings）通过。新鲜根 `pnpm check` 通过：结构 205 项、Desktop 326 项、Cloud 788 项、local-storage 425 项（6 项既有 ignored）、Desktop Native 80 项、secure-host-core 42 项。最后一轮采用修复后的完整源码；之前失败的运行不计通过。
- 经验落实：nullable 持久字段仍须严格要求键出现；双角色切换不仅检查新角色，还须保留旧角色的单调地板；条件编译接口和原地 UI 降级都要单独审查。签名正确但不兼容的 Active 替换应在写入地板前拒绝。
- 本历史切片结束时未完成：正常交接成功证据驱动的 Standby Inbox、目标引导/强制接管/云恢复、Afternic 与其余平台实作、独立跨机恢复、Windows custody。当时 Standby Inbox 冻结（后续实现见下一条记录）；真实第三用途 OpenBao key/策略未部署，Windows/macOS 目标编译/实机与发行资格未取得。


## 2026-11-19 普通交接回执、原请求续作与 Standby Inbox

- Task Frame：[普通交接回执](NORMAL_HANDOFF_RECEIPT_TASK_FRAME.md)；基线 `1218e18`。完整持续目标见 [核心任务与约束](../IMPLEMENTATION_GOAL.md)，不能以本切片替代设备、平台与恢复总目标。
- Cloud switch view 严格升 v2；wrapper/request 仍 v1。回执由唯一 consumed accepted proof、normal_handoff 来源 Lease 和精确目标 capability 在同一 SQL snapshot 派生，完成/失败后的历史仍可查。修复真实 OAuth desktop_login allocation 的默认工作区准入，跨工作区仍拒绝。
- 本地追加 `202611180002`：不可变 attempt/receipt/refusal 与原 barrier 关联。Native 授权地板 v2 单独保存最后本机 Active epoch，v1 升级不推断未知历史。旧普通交接证据不能解冻后来强制接管的副本。
- 已签请求先落 Native custody，再写公开 attempt，最后发 HTTP；业务备份没有签名请求。重开自动查状态，已消费时记成功，未消费且当前 Active/未过期/同 target 与 epoch 才恢复相同 bytes。确定拒绝阻止重发；只有从未形成业务 attempt 的 Native 孤儿可替换。后台取消/失败且尚未成功释放时清屏障，成功释放后的目标失败不重开来源写入。
- 专用 Standby Inbox gate 复用原单 writer、publication mutex、reader cursor/readGeneration 与事务最终栅栏。Outbox/Provider/checkpoint 发布/业务写仍拒绝；retired cursor 持久要求恢复，强制接管库保留冻结。
- 独立评估：device_architecture_review 对 Cloud/protocol PASS（PG 18.6 三文件 61/61，协议 69 项、Cloud 单测 15 项）；standby_cloud 对 Host/DB/custody PASS（11 项，含真正签名角色与 SQLCipher 重开，OS custody 用 test store）。Native 协调器由 standby_native 独立 PASS（15+14）；最终 root `pnpm check` exit 0（local-storage 438/6 项既有 ignored，Native 87，Cloud 788，Desktop 326，协议 468，结构 205）。新增迁移回归 19 项和屏障清理最终栅栏回归独立通过；production build、严格 clippy、差异/链接检查通过。详见 [审查记录](../reviews/2026-11-19-normal-handoff-receipt-review.md)。
- 本切片不交付目标安装/激活与完整交接按钮；生产 Renderer 尚未调用 device-switch adapter，不能把 IPC 或后台代码等同完整双设备旅程。Windows/macOS 真实 OS custody、实际 Cloud/OpenBao 和双设备实机、Provider 与发行资格仍未取得。Afternic Core 为独立在途工作，不混入本切片提交。


## 2026-11-19 Afternic 连接、库存归集与具名商业授权

- Task Frame：[Afternic 客户闭环](AFTERNIC_LISTING_TASK_FRAME.md)；基线 `61979a5`。完整要求保留在 [实施目标](../IMPLEMENTATION_GOAL.md)。本切片接续原独立 Afternic Core，不重复 Standby 协议。
- 设置入口只接收连接标签；Native 受限录入/精确槽位 custody、完整分页扫描，Host 同事务导入资产、Outbox、原绑定与 Listing 观察。现有资产用户字段保留，墓碑/待重新添加/归档项跳过；空扫描只记录真实回执。
- prepared 在新 Grant 与真正关闭重开后加载原 incarnation/generation/proof；缺槽进入修复。撤销先持久停用再清槽，确认后隐藏连接但保留历史和资产；当前平台权限撤回仍允许本地首次撤销与清理。两平台共用串行 Native lane，分别恢复准入。
- 追加 `202611180003`，未改已应用迁移。读投影按连接/绑定代次关联，保留多连接 Listing，断连旧不存在结果变为 unknown。可见容量与 Settings 一致，retired 不占位置。
- Active Grant v4/commercialAuthority v2、role v5；空 capability 仍允许有效本地业务，write 依赖 observe。锁定 Licensing 精确交集，Native floor v3 和运行时/最终栅栏拒绝旧权限；稳定 `.v3` 签名用途不变。
- 独立审查各范围 PASS，发现和修复见 [审查记录](../reviews/2026-11-19-afternic-inventory-review.md)。最终根 `pnpm check` exit 0（`/tmp/gooddealer-afternic-final-passing-check.log`）：结构 205、Protocol 488、Cloud 798、Desktop 330、client-core 418、local-storage 463/6 项既有 ignored、Desktop Native 89、Core 56。Desktop production build、三个 Native crate 全 targets Clippy `-D warnings`、差异与修改文档链接检查通过。此前命令清单/迁移计数的失败记录不当作通过；修复后完整重跑。
- 未完成：Afternic 持久父计划/整批批准/Listing 写入/未知结果对账、私有所有权验证及 DNS；其他市场按既定优先级继续；设备目标引导/强制接管/云恢复、独立跨机离线恢复、Windows 原生 custody 等总目标保留。真实账号、目标平台实机和发行资格未取得，空资格清单仍拒绝执行。


## 2026-11-19 Afternic 整批下架、后台执行与重开对账

- Task Frame：[整批下架](AFTERNIC_DELIST_TASK_FRAME.md)；基线 `35d409a`，完整任务与条件保持在 [实施目标](../IMPLEMENTATION_GOAL.md)。原归集切片和本下架切片都不是完整 Listing/跨市场功能。
- 批量页选择连接/已有域名，从最新完整库存生成 15 分钟持久预览；整批批准一次，Host 固定全部前像/来源/代次，真正并发也只产生一个 operation 与一次 DELETE claim。每项精确 GET 前置复核；写响应不当成功，未知结果与重开 running 只做 GET。
- `202611180004` 复用原 plans/items/attempts/results 和绑定表，仅追加不可变对账事实。缺席观察、detach、聚合结果与最终栅栏原子提交；旧 unknown 保留。修复混合 unknown 结果 SQL 分桶、过期展示、空轮询/重复批准 readGeneration，完整保存合法 u32 Retry-After。
- 原 Native ProviderLane 逐项执行，Windows/macOS 系统电源事件先失效旧 epoch；批准/下架 worker 的最后网络 guard 在 Host 锁等待前后检查。缺槽进入 remediation，暂时 custody 不可用只退避。unsafe 仅两处固定 OS 通知文件；精确策略拒绝 warn 降级和新增公开回调/OS handle。
- 交接整合发现的空流错误已修：任何下架 attempt（含 queued/终结/重开）都阻止虚假 execution_fact/device_audit 空证明；持久屏障拒绝新预览/批准/claim/发送，已发 GET 可对账。真实两流来源、签名、上传确认及封链仍须接续，当前拒绝不能当作该旅程完成。
- 独立审查：[下架审查](../reviews/2026-11-19-afternic-delist-review.md)。Storage/Host 最终独立 Afternic 39、manifest 3、既有 drain 1；client-core 7、Desktop 49；Native helper 3/lane 11/IPC 1；实际 Core power 源码独立 4；root 策略独立 13、拓扑 20 均通过。Desktop build、全仓 typecheck 和 format 通过；新鲜根 `pnpm check` exit 0（`/tmp/gooddealer-delist-final-passing-check.log`）：结构 207、Protocol 488、Cloud 798、Desktop 350、client-core 425、local-storage 485/6 项既有 ignored、Native 94、Core 60。首轮拓扑目录缺四个 macOS 依赖的失败已修，独立复验后完整重跑；失败日志不计通过。最终三个 Native crate 全 targets Clippy `-D warnings` 通过（`/tmp/gooddealer-delist-final-clippy.log`）。
- 目标证据仅为 Windows GNU/macOS arm64 电源模块原样源码编译；完整应用目标构建、真实 OS 通知/凭据和 Afternic 接口未验收，Host 资格继续关闭。旧连接/刷新流程未统一接入新 power guard，Windows custody/Linux 与 Windows capture 未完成。
- 后续保持：执行事实/设备审计真实来源及 drain、Afternic 创建/改价/私有验证/DNS、其余平台按既定优先级、目标引导/强制接管/云恢复、独立离线恢复和双系统完整支持。下一实施不能伪造 trusted time、批准 envelope 或 device credentialEpoch 来满足旧协议字段。


## 2026-11-19 Fresh Standby 强制接管与首次云恢复

- Task Frame：[强制接管](FORCED_TAKEOVER_TASK_FRAME.md)；基线 `825878d`；独立评估见[审查记录](../reviews/2026-11-19-forced-takeover-review.md)。完整产品目标见[实施目标](../IMPLEMENTATION_GOAL.md)，本切片只包含可信 Fresh 或精确终止且未写库目标，不扩入已有副本替换与无 held 来源恢复。
- 已组合客户路径：设置/无副本 Standby 专用浏览器重新认证 → 来源 epoch 预览 → 一次确认 → Native 原意图持久保存 → Cloud 单次消费原五分钟认证窗口 → 可重开等待/取消 → 领取前持久安装准入 → 原 checkpoint/mutation 下载、安装和激活 → Active 及新鲜执行上下文后显示非空资产。Provider 凭据仍须重新连接，云只恢复最后成功同步的允许字段。
- Identity、Devices 与 Native 贯通绝对重新认证期限、source CAS、幂等重放、未知初始请求取消墓碑、等待续租冻结和历史离线期限 high-water；Cloud 025–029 追加迁移，旧 SQL 未改写。Host journal v3 沿原 publication mutex/安装提交栅栏；重开依赖新鲜 Cloud 状态，不用缓存 claimable 或本地时钟自动释放来源。
- 最终根 `pnpm check` exit 0，日志 `target/root-forced-takeover-check.log`：结构 215、i18n 19、UI 58、Protocol 529、connectors 7、cloud-client 8、client-core 426、Account Web 124、Desktop 394、Cloud 848；Rust automation 53、Desktop Native 166、local-storage 591＋2（6 项既有规模基准 ignored）、secure-host-core 85＋public 3。负向 SQLCipher 错钥测试的拒绝日志不属于检查失败。
- 独立真实 PostgreSQL 18.6 UTF8：root 完整 OAuth/devices 121/121，随后新增 execution-context/historical block 7/7；构建者完整 114/114 加最终 forced/历史升级 22/22。Host forced 最终 19/19 由 Native 与 Cloud 各自独立复跑，涵盖真实 SQLCipher 非空恢复与激活、取消及崩溃状态。Linux/Windows GNU 三 crate 全 targets 严格 Clippy、格式、Desktop production build、生成物、文档链接与差异检查通过。源码、数据库、目标编译分别记录，不声明实机发行资格。
- 经验已落实为实现和回归：跨运行时使用真实 raw IPC 解码；资格变化丢弃迟到预览；未知 initial POST 的 not_found 不代表取消；历史已签 Lease 上限不能只看最新行；取消领取后的 bootstrap 必须沿原取消 lane 收敛。失败的中间根检查已修复后完整重跑，不计通过。
- 未完成：已有副本恢复、写库后恢复、无来源 Lease、独立跨机备份及 Windows/macOS 实机；真实部署的第三/第四/第五签名用途与两设备验收仍需取得。迁移 026 保守 cutover＋24h 不可被本机测试免除。
- Provider 继续作为主线：在隔离 `afternic-listing` worktree 开发上架/改价持久父计划、真实执行证据、客户表单，Linux 原生凭据录入与真实电源通知分别验收。用户已授权 `wecin.com` 做受控上架/改价/下架，先在 Linux 跑真实业务，Windows/macOS 仍保留完整最终目标。当前仅 Cloudflare/Afternic 有适配代码；六来源完整账户归集、市场自动所有权/DNS与其余十平台仍未交付，不能从此设备切片推导完成。
## 2026-11-19 Linux Afternic 受限 Native 录入

- 复用原 Afternic Service、固定 slot 与 Secret Service，实现 Linux GTK 掩码 API key/secret 窗口；3 秒主循环准入、120 秒输入期限、50ms 当前授权复核、晚回调取消、所有关闭清空 Entry。秘密不经 Renderer/普通 TypeScript；ADR-0025 具名扩展该条目并保留同 UID 残余风险。
- Root/Cloud 独立源码及真实 GTK canary 5/5 通过；Core 92、public 3、doc 4、严格 Clippy 通过，GTK/logind ignored 项另外实跑。实际 GTK 测出并修复 GString 截断末字节，保留精确字节回归。详见[独立审查](../reviews/2026-11-19-linux-afternic-capture-review.md)。
- 本增量未输入真实账号、未调用真实 Afternic；Cloud 当前授权、平台资格与实际业务旅程继续实施。Linux power 另有独立增量，Windows/macOS 实机与发行资格尚未取得。


## 2026-11-19 Linux logind 电源监控

- secure-host-core 私有 gio 适配在独立 MainContext 订阅固定系统 logind owner；真实 delay inhibitor、PreparingForSleep 握手、owner 二次检查和严格 Variant signature 后才准入。睡眠意图先撤销旧 epoch、等待原最终提交栅栏再释放 inhibitor；恢复重新取得后才继续。退出不保留订阅/FD；没有新 writer、IPC 或通用代理。
- Root/Cloud 独立源码与实际 logind 注册释放 7/7 通过；Core 全量 92/public 3/doc 4、严格 Clippy 通过。GLib tuple 尾随成员负例已落实为精确 signature 校验。见[独立审查](../reviews/2026-11-19-linux-native-power-review.md)。
- 未实际挂起当前开发机，故仍缺真实 sleep/wake；Windows/macOS 实机及真实 Afternic 账号不由此推导。Provider 上架/改价继续原 lane 与当前授权，不开放资格清单冒充交付。


## 2026-11-19 开发 Cloud 五用途授权实际部署

- 用户授权自行定位环境与恢复丢失的开发签名管理材料；隔离 OpenBao v2 已生效，旧实例、数据库卷和其他业务保留。clean `f872727` 经精确27条前缀、受控archive/schema-only备份和受限migrator应用44条至71条；Account Web 原子发布。
- 实际生产 signer/AppRole 五用途签名/20错用途拒绝、公网401/400/401/200、源站403、五runtime隔离与12角色限制通过；公开registry两端摘要一致，秘密未下载到普通配置或输出。独立审查见[部署记录](../reviews/2026-11-19-development-cloud-authority-deployment.md)。
- PG仍18.4，archive只验TOC未恢复演练；030/031未部署，真实登录/Provider/双设备与双系统/发行资格不能由部署推导。


## 2026-11-19 Afternic 持久上架、改价与严格结果状态

- Task Frame：[上架与改价](AFTERNIC_LISTING_WRITE_TASK_FRAME.md)；在Provider隔离工作区完成，不混强制接管。沿原连接/绑定、唯一writer、ProviderLane与两条真实证据流，交付四字段create/所选键update、15分钟持久预览、整批一次批准、单次claim、精确GET前后复核及重开未知结果只读对账。
- 本地追加006、Cloud030/031；不改已有迁移。字段匹配与ACTIVE/隐藏、待验证、待平台和冲突状态分开；不能把请求成功或字段相等当作上市/所有权证明。客户批量入口、历史、详情与严格合同已组合。
- 独立接受见[审查记录](../reviews/2026-11-19-afternic-listing-write-review.md)：实际PG18.6三动作51/51、实际Host输出84/84严格client解析、Native153、Storage专项70默认12线程及UI/adapter/i18n复验通过；新鲜根pnpm check exit0。此前4项fixture开库SchemaRejected后未复现，原因未确定；测试专用脱敏诊断保留，整合最终源码再完整检查。
- 当前Linux恢复已有登录并显示Active，但Provider连接仍不可用：生产资格为空且开发Cloud商业catalog缺Afternic observe/write。不是账号登录问题；下一完整切片解决具名有限真实取证和可信商业重新观察，不伪造资格/receipt或直接改权益。wecin.com真实读写、私有验证/DNS、双系统实机和发行资格尚未取得。


## 2026-11-20 Afternic 受控连接入口与开发授权

- [受控验收工作包](AFTERNIC_CONTROLLED_ACCEPTANCE_TASK_FRAME.md)已在 Linux debug 接入设置与批量页。真实 Grant/Lease 与单一凭据槽准入，完整库存读取，`wecin.com` 上架、改价和下架受确定范围和连续时间限制。新增本地 007，原 006 保持原字节，连接和库存恢复补齐电源栅栏。
- 独立 Storage、Native 与客户入口验证通过；根 `pnpm check` 退出 0，主目录集成 PostgreSQL 18.6 矩阵 162/162。受控构建实际打开，用户现场核对本机。详细证据见 [受控审查](../reviews/2026-11-19-afternic-controlled-acceptance-review.md)。
- 已按用户明确批准更新共享开发配置、重启两项服务并发送一次 Stripe 测试订阅 metadata 更新。真实签名 Webhook、对账及新投影确认两项 Afternic 权限，原账单字段与期限相同。开发 Cloud 030/031 尚未发布，真实库存和 Listing 继续现场验收。


## 2026-11-20 Afternic 官方所有权审核复核

- 批量上架或改价可逐域名选入一个条件性 `OWNERSHIP_REVIEW` 复核，也可为现有 Listing 单独预览。一次确认冻结全部步骤，复核单独签名并至多持久 claim 一次。官方请求受理后用认证 GET 对账，重开和未知结果沿原 ProviderLane 续查。
- 本地 008、Cloud 032/033 仅追加，原 v1 计划、签名与迁移保留。SQLCipher 专项 25/25、旧 Afternic 回归 87/87、实际 Host→Client 7 个输出、Cloud PG18.6 升级与回归 184/184 通过。审查结果见 [独立记录](../reviews/2026-11-20-afternic-ownership-review.md)。
- 正式复核资格仍未开放。缺少可信前任关闭证据的后继来源拒绝新 claim，保留旧 claim 的 GET 对账。受控 `wecin.com` 范围维持原三项 Listing 动作。真实账号连接与操作、认证私有验证和 DNS、Windows/macOS 及发行仍分别取证。


## 2026-11-20 Afternic 首次库存读取故障恢复

- 用户在 Linux 原生窗口录入凭据后，连接仍为准备状态。现场确认最近一次操作未成功且库存按钮灰显。该状态表示尚无已提交的完整库存读取，无法据此判断凭据被 Afternic 拒绝。
- 已修复恢复扫描失败使同一连接无法继续手动读取的问题。完成恢复检查后，用户可重试读取原凭据槽，尚未确认的凭据删除仍阻止恢复。设置页区分凭据或权限拒绝、托管不可读、本机准入、网络/限流与响应校验问题，不传原始错误。
- 修复经 Native 独立审查和受控 Linux 构建。Native 179/179、Desktop 424/424、Client 458/458 和 i18n 19/19 通过。匿名对 Portfolio API 的 HTTPS 请求返回 401，已确认本机可直连。真实账号库存结果仍需在保留原凭据的同一工作区读取确认。


## 2026-11-20 Afternic Linux 真实库存归集

- 直接使用原 Native 托管凭据完成真实 Portfolio API 读取。脱敏诊断定位 `maxLeasePeriod:0` 及终页仍返回 `next` 两处实际响应差异。读取支持实测零值，仍校验其他租售期及分页的来源、路径、查询和位置，结束后无需再发下一页。
- 首次完整提交观察 188 个域名、新增 188 个本地资产。退出重开又读到 188 个，新增 0，跳过曾删除 0。用户已在桌面界面确认数据正确。记录中仅包含阶段和汇总数量。临时诊断代码已移除。
- Core Afternic 专项 22 项通过，严格 Clippy 及独立审查通过。最终 Linux 构件已按相同工作区重新打开。
- `wecin.com` 的真实上架、改价与下架，开发 Cloud 证据迁移，认证私有协议及 DNS，Windows/macOS 实机与发行资格尚待验证。

## Cloudflare Registrar 账户库存归集

- 设置中对有资格且已授权的 Cloudflare 连接选择「归集注册域名」，Native 使用当前 Zone 的账户身份按游标逐页读取官方 Registrar 列表。平台账户 ID、Token 与 cursor 留在 Native。使用连接和令牌绑定的账户范围承诺，阻止同一凭据代次在账户变化后向新账户发请求。
- 追加迁移 `202611190009`。完整结果在原 SQLCipher writer 原子保存注册商观察、扫描回执及新资产 Outbox。既有备注等用户字段保留，删除墓碑不会复活，空结果不删除资产。结果对 `cloudflare:registrar:observe` 独立验签准入，DNS 权限不能授权此扫描。休眠或退出中断读取时保留上一份完整结果；下一次从头读取。注册日期和到期日期已保存于注册商观察，续费提醒仍待接入。
- 本地验收覆盖状态失败后只重读、完整分页、空清单、墓碑、重复归集、最后提交栅栏、错账户、授权更替、并发旧读取及 SQLCipher 重开。Zone 激活与其余 Cloudflare 操作已统一发送给现有严格原生解码器的原始字节。
- 提交 `422444c` 的根 `pnpm check` 及独立审查通过。本机 PostgreSQL 的完整设备授权与执行证据套件通过 184 项，验证已有 DNS 签名权限不会自动获得 Registrar 读取能力。
- 已组合的路径需要账户下可读的 Zone、能读 Registrar 列表的原生托管令牌、真实开发授权及资格。无可用 Zone 的账户连接仍待实现。真实 Cloudflare 账户及 Windows/macOS 实机待验证。

## Linux Cloudflare 原生录入与托管

- Cloudflare 和 Afternic 使用同一 Native GTK 的窗口生命周期与取消处理。用途固定在对应的 Service 内，窗口接收各自有界字段。Cloudflare 复用 v3 信封与现有连接代次，Secret Service 条目由跨进程槽锁保护。退役仅检查固定槽元数据和删除结果，可处理无法解析的载荷与精确重复条目。
- Cloudflare 激活检查当前 Native 电源纪元。收到平台结果后，按电源、取消、Host 的锁顺序准入准备与 prewrite。进入 prewrite 后，已开始的本地托管 CAS 沿原标记和回读完成，失去 Host 权威时保留可恢复状态。当前仍需真实开发授权及 Cloudflare 账户验收。
- 真实 GTK 窗口与 Secret Service 测试槽分别通过。Native 验证覆盖两种窗口提交与取消、托管信封精确替换、损坏和重复条目退役及最终缺失确认。Core/Tauri 全模块测试、Storage 托管专项、严格 Clippy、平台无关检查及独立审查通过。
- 提交 `7966da4` 通过完整根 `pnpm check`，已快进到主工作目录。

## 2026-11-20 Spaceship Registrar 账户归集

- 设置页接入独立的 Spaceship 连接、刷新、结果和断开。官方 `domains:read` 使用固定 HTTPS 端点和专用 Native 托管槽。接续 Afternic 首次导入故障的经验，分开显示托管、凭据拒绝、网络/限速与响应校验状态，原始账号数据留在 Native。
- 新增本地 `202611190010`，旧迁移保持原字节。Node/Renderer 只传短业务动作或读取脱敏回执。SQLCipher 在既有 writer 里原子提交资产、Outbox 与注册观察。重启重新读取已持久发起的扫描；部分结果不提交，已存回执保留。确认空准备槽可回收，撤销先持久拒绝再清除精确 Native 槽。
- 根 `pnpm check`、Linux Desktop 构建、Windows GNU 目标严格 Clippy、本机 PostgreSQL 设备授权与执行证据 184/184、SQLCipher 专项 2/2、真实 GTK 与隔离 Secret Service 合成数据测试通过。源码与复审结果见 [审查记录](../reviews/2026-11-20-spaceship-registrar-review.md)。
- 真实验收需要具名开发准入和签发 `spaceship:registrar:observe`、有 `domains:read` 的 Spaceship 凭据与已知域名。生产资格仍待取证；SellerHub、Windows/macOS 实机验证待推进。

## 2026-11-20 阿里云 Registrar 账户归集

- 阿里云中国站账户已组合设置页原生连接、刷新、持久结果和断开。只执行官方 `QueryDomainList`，使用 RAM action `domain:QueryCommonInfo` 和 ACS3。官方样例与 SDK 5.1.1 的状态码表示差异均有明确输入形态测试。匿名端点请求返回 `MissingTimestamp`。
- 追加迁移 `202611190011`，沿原 SQLCipher writer 原子提交注册观察、资产、Outbox 与回执。重开从首面继续未完成扫描，确认空准备槽才撤销并清理。AccessKey、联系人相关字段、备注与标签保留在 Native，缺失的自动续费和锁信息写为未知。
- 根 `pnpm check`、Linux Desktop 构建、Linux 与 Windows GNU 目标严格 Clippy、PostgreSQL 184 项及 Linux GTK 与隔离 Secret Service 测试通过。见 [独立审查记录](../reviews/2026-11-20-aliyun-registrar-review.md)。
- 真实验证尚缺当前构建的具名开发准入及阿里云中国站 RAM AccessKey，需要包含 `domain:QueryCommonInfo` 与一项可核对的账户域名。所有凭据只通过原生窗口录入。卖家上下架和所有权验证继续按私有接口交付。

## 2026-11-20 Atom 官方卖家库存

- 设置页组合了专属 Native 凭据输入、后台卖家库存刷新、脱敏计数与断开。使用现有 ProviderLane 在重开时恢复持久扫描。确认账户内 Listing 时保留原域名用户字段，销售状态保持未知。
- 本地追加迁移 `202611190012`，复用既有市场观察与 Listing 绑定。单一事务提交归集结果及普通资产 Outbox；未知或不完整响应保留上次扫描。连接替换、撤销和过期授权均由 Host 准入检查。
- 根 `pnpm check`、PostgreSQL 18.6 授权回归 184 项、SQLCipher 三项专项、生产 Linux 构建、Linux GTK 和独立 Secret Service 验证通过。Windows GNU 目标严格 Clippy 通过，Windows 与 macOS 实机仍待验收。
- 真实验收需具名开发准入、获批的 Atom Seller API 用户 ID 和 token，以及账户中可核对的 Listing。上架、下架和自动验证尚待实现。接口与边界见 [独立审查记录](../reviews/2026-11-20-atom-marketplace-inventory-review.md)。

## 2026-11-20 GDBK v2 独立备份与离线恢复

- 当前授权下，设置可创建加密 `.gdbk` 和独立 `.gdkey`。无旧安装、旧 SQLCipher 密钥或 Cloud 时，登录或锁定页可进入隔离数据集，分页查看并导出域名资产 JSON。新工件的协议、密钥及文件路径均由 Native 拥有，Renderer 只接收业务视图。活动库 schema 和 GDBK v1 解析保持原样。
- 已验证源库关闭并移除、无授权 Host 恢复、JSON 字段边界、恢复材料缺失或错配、现有目标保护、仅密钥发布成功、发布前拒绝和 GTK 原生取消。独立审查与平台证据见 [审查记录](../reviews/2026-11-20-portable-backup-review.md)。
- 下一切片在当前 Active 授权下显示差异并按确认纳入现有业务事务。Windows/macOS 实机双向恢复、跨用户文件准入与发行资格仍单独验收。

## 2026-11-20 GDBK v2 授权新增导入

- 从当前 Active 工作区打开独立备份，可逐域名预览并一次批准新增。已存在域名、墓碑、不能直接新建的历史代次和缺失组合显示各自处理结果。备份中缺失的域名保持原样。现有资产逐字段冲突处理仍需实现。
- 预览绑定已认证的隔离数据集、当前工作区、授权代次和活动库 revision。提交事务重新核对计划与资产状态，普通创建 owner 写入记录、同步创建标记及 Outbox，并保存一个导入回执。复用原 schema 与最终提交栅栏。取消或关闭清除未提交预览。
- SQLCipher 回归覆盖整批拒绝回滚、已存在和删除记录、旧预览、提交重放及关闭重开；IPC 和桌面入口测试覆盖严格合同、预览、取消、一次确认及结果。独立源码审查覆盖授权与单 writer，Windows/macOS 实机仍待验证。
- 加密创建、离线查看与导出 `76fca8d`，授权新增导入 `c0a883e`，均已快进到主工作区。`c0a883e` 根 `pnpm check` 通过。Linux Desktop 构建、local-storage/Tauri Linux 和 Windows GNU 严格 Clippy、独立备份 SQLCipher 8 项和旧恢复回归 14 项通过。Linux 实际打开了桌面离线入口与 GTK 文件选择器，隔离进程的完整桌面导出尚未走通自动化。

## 2026-11-20 Afternic 真实写入发布前检查

- 只读核对共享开发 Cloud 和 worker 运行正常，当前 `f872727`、PostgreSQL 18.4。已部署的 71 条迁移及 ID、所有者和校验值逐项匹配候选 `c0a883e` 前缀。待应用的四条迁移为 030–033，分别扩展 Listing 写入及复核的审计与执行证据。
- 开发配置已具 Afternic observe/write，存在一份同时具两项能力的未到期 Active 商业投影。原生 Afternic 库存及重开复读已有真实证据。当前共享服务尚缺新写入证据合同，未开始 `wecin.com` 的真实写入。发布需按独立的共享环境批准执行。
- 本机 PostgreSQL 18.6 的完整预检通过 507 项。修复三个旧夹具与已存在迁移守卫的冲突，原切换目标和模式修改继续被数据库拒绝，正常并发切换夹具使用当前 Lease epoch。独立审查后补入与 forced 记录绑定的历史交接证据，仍不能读出正常交接回执。最终两套受影响回归 58 项通过。未修改生产代码或迁移内容。
- 独立 PostgreSQL 18.4 使用普通 migrator 建立与线上逐项相同的 71 条目录，将合成账户和原目录备份后还原到另一数据库。待发布的四条迁移应用到原测试库后重复运行，重启确认 75 条目录、既有合成记录和 12 个受限角色。此次仅连接临时 Unix socket，未操作共享数据库。
- 同一独立 18.4 升级库使用非特权角色通过设备授权、Afternic 签名证据与重放测试 184 项。此结果独立于仓库的 PostgreSQL 18.6 资格测试及线上发布。

## 2026-11-20 Afternic 首次连接与新鲜库存

- Native 首次录入用同一授权、取消及电源纪元完成完整只读预检，随后保留唯一凭据槽并逐字节读回。输入取消、无效凭据及未完成分页不会消耗首次绑定。已发布的槽继续沿现有重开恢复。
- 追加本地迁移 `202611200001`，完整扫描缺席让旧在售观察降为未知且使销售读缓存失效。没有历史 run 的空扫描与迁移前的未知顺序分别记录。此前已有观察与首次空扫描两种情况下，同秒后到的精确观察都能更新显示。原 Listing 绑定保留。
- 批量批准前重新校验最新扫描中的目标事实。相同事实可继续确认，缺失或变化须重新预览。写入 429 后保留原尝试和服务器等待时间，重开到期只执行 GET 对账。
- 独立源码审查确认没有将最新库存门槛带入已认领请求的精确对账。根 `pnpm check` 通过，含 659 项 local-storage 回归。受控构建的 Native 18 项、SQLCipher 114 项及 Linux/Windows GNU 严格 Clippy 通过。实际账号已有 188 项库存的历史证据，新版本首次连接的完整过程、真实挂牌写入和双目标实机仍须验证。

## 2026-11-20 Atom 首次连接预检

- Atom 设置中的首次连接现在先用 Native 内存里的候选凭据读取完整卖家库存，再创建凭据槽。取消、权限不足、跨工作区准入、坏响应或不完整分页时不会创建待验证连接。凭据精确读回后发布预检结果；凭据已保存但导入未完成时仍按原持久状态重开续读。
- 独立审查复现 SQLCipher 专项四项。核对了完整凭据读回、最终提交栅栏、空页终止、认证错误、重开、撤销及绑定历史。根 `pnpm check` 通过，含 SQLCipher 660 项。真实 Atom 账户读取仍需获批的 Seller API 账号及具名准入。Standard 下架只确认了官方写接口；其精确读取的缺失响应还需在卖家账号内取证。

## 2026-11-20 GDBK v2 预览并补齐已有资产

- Active 用户可以在导入预览前选择补齐已有域名的空字段。预览逐行列出拟写入的业务值并区分新增与补齐；同域名同代次才合并，现有非空值、其他资产、墓碑和待确认重新添加均保留。档案与恢复材料仍走原生文件准入，合并使用常规编辑、新 Outbox 与原恢复回执。
- SQLCipher 专项覆盖目标字段并发改动、旧和暂定代次、最终授权栅栏拒绝、混合新增/补齐回滚、回执重放及重开读回。独立评估复现九项 Rust 专项和三项客户端测试。根 `pnpm check` 通过，含 SQLCipher 661 项。Linux GTK 文件选择/取消组件测试和桌面整构建通过，Linux 与 Windows GNU 严格 Clippy 通过。发行资格和 Windows/macOS 签发构件的真实离线互恢复仍待取得。
- Linux 实际调试桌面构建在隔离 Xvfb、D-Bus 和无登录应用档案中经 GTK 窗口选择合成工件及恢复材料，显示解密域名并通过原生保存窗导出 JSON。用文件内容核对域名和备注，账户导入入口在该离线会话不可用。此验收覆盖离线旅程，Active 补齐以 SQLCipher 和界面组合测试验证。

## 2026-11-20 Cloudflare Registrar 刷新重开续作

- 设置刷新在受理前经现有 ProviderLane 和 Host 写栅栏保存原请求。追加迁移 `202611200002` 绑定工作区、连接、凭据代次、设备和 Lease。退出或休眠后当前权限仍匹配时，从账户首面恢复。完整结果原子消费请求并写入原资产、观察、Outbox 和回执。
- 手动重复刷新合并；撤销或凭据换代清除待执行请求，旧 Lease 不能被启动恢复采用。交接屏障拒绝新排队、续读及迟到提交，已保存请求保留。成功回执优先于上一条内存错误。
- 独立复验通过 Tauri 两项和 SQLCipher 四项。根 `pnpm check` 通过，含 Tauri 186 项和 SQLCipher 662 项。Linux 与 Windows GNU 严格 Clippy 通过。真实账户、无 Zone 的独立连接和 Windows/macOS 实机继续验收。

## 2026-11-20 账户归集进入资产详情与续费台

- 追加迁移 `202611200003`，记录新注册资料观察的资产代次，并按 Cloudflare、Spaceship、阿里云各当前连接最后一次完整扫描生成读取事实。资产列表、详情和续费台通过原合同显示注册商、到期日、自动续费和注册锁。续费统计与资产到期提示使用同一事实。
- 最后完整扫描缺席、多来源冲突、连接撤销或资产重加时，旧账户观察不能恢复字段；原资产和审计历史保留。没有账户扫描历史的工作区使用既有查询。取证下一步是用 Cloudflare 官方兼容的用户 API token 核对独立账户连接，真实账户与双目标系统仍待验收。
- 独立复验通过两项跨读取与代次场景和资产列表查询计划。根 `pnpm check` 通过，含 Tauri 186 项和 SQLCipher 664 项。Linux 与 Windows GNU 严格 Clippy 通过。Release 的 1 万资产基准最慢 102 ms，低于 150 ms 门槛。10 万资产续费末页为 194 ms；资产库末页为 1.060 s，未达 1 s 门槛，前一提交同机实测也为 1.031–1.058 s。

- 后续资产库修复在同一读取事务中先取得有序页键，再查找目标价和注册资料。资产库 1 万资产末页 96 ms，10 万资产末页 985 ms，两个 Release 基准均通过。独立 SQL 查询计划复验通过，根 `pnpm check` 通过。

## 2026-11-20 Cloudflare Registrar 独立账户连接

- 设置中的 Cloudflare Registrar 账户入口使用固定 Native 控件录入账户 ID 和用户 API Token。官方账户注册列表不需要 Zone。完整预检后写入不可变槽位，同一 SQLCipher 事务发布连接、注册商观察、资产与 Outbox。追加迁移 `202611200004`，既有 Zone 连接的权限与代次隔离。
- 显式刷新经原 ProviderLane 受理前持久化请求；重开只恢复相同设备及 Lease 的原请求。完成扫描原子消费请求。旧 Lease 的准备行可断开，迟到结果、账户范围不符和交接期间的请求均拒绝。断开先永久禁止使用，后按固定槽位精确清理并确认，保留历史扫描和资产。
- 独立审查复现 SQLCipher 三项，覆盖原子发布、与 DNS 连接隔离、重开及交接栅栏、错账户和 Lease、撤销及迟到结果。Linux 在独立 GTK 显示复验提交、取消、撤销、非法输入和迟到回调；独立 D-Bus Secret Service 清理了损坏的重复条目并保留邻近用途槽位。设置与 Native 权限组合测试 10 项通过，Linux Core、Storage、Tauri 和 Windows GNU Core、Storage 严格 Clippy 通过。
- 最终根 `pnpm check` 通过，含 Desktop 433 项、Tauri 187 项、SQLCipher 667 项和 Core 131 项；已应用迁移 SQL 保持原字节。
- Windows 的 Tauri 交叉构建需要本机缺失的 MinGW 资源编译器，macOS Core 交叉构建未找到支持 Apple 目标的 C 工具链。真实 Cloudflare 账户、Windows/macOS 实机和发行资格继续单独验收。

## 2026-11-20 Atom 卖家库存刷新重开续作

- 设置的刷新由 Native 在回执前提交。追加迁移 `202611200005` 把请求固定在当前工作区、连接 incarnation、设备和 Lease。重开只恢复同一请求并从首面读取。完整库存同事务消费请求、更新资产与 Listing 观察、写入 Outbox 和回执。
- 交接屏障、撤销和迟到结果关闭对应准入。旧版仅有 `scan_pending` 的连接可以显式刷新以建立当前范围的请求。运行中的第二次刷新返回忙碌，避免用上一请求代替新回执。
- 独立复验 SQLCipher/Host 六项和迁移 manifest 一项，Tauri 回执顺序专项通过。根 `pnpm check` 通过，含 SQLCipher 669 项和 Tauri 188 项。Linux Storage 与 Tauri 严格 Clippy 通过。官方 Standard 筛选和匿名响应已取证，真实卖家账户与 Standard 下架仍待验收或实现。

## 2026-11-20 Spaceship Registrar 首次连接与刷新续作

- 设置首次连接先用内存中的 Native 候选凭据完整读取官方账户库存。预检通过后创建连接和请求，精确读回托管凭据后同事务发布观察、资产、Outbox 与回执。权限拒绝、取消、无效响应和不完整分页不会创建待验证连接。
- 追加迁移 `202611200006`。刷新回执前持久保存当前工作区、连接 incarnation、设备与 Lease，重开从首面续读同一请求。回执原子消费请求。旧版标记可通过显式刷新重新准入。交接、撤销和代次替换禁止迟到结果。
- 独立审查复验 10 项，覆盖 SQLCipher/Host、注册资料读投影、IPC、Native 回执顺序和 schema manifest。修复 manifest 的迁移数、表数断言并复验通过。Linux Storage/Tauri 严格 Clippy 通过。真实验收仍需要具名开发准入、Native 输入的 `domains:read` 凭据及可核对的账户库存，Windows/macOS 分别实机取证。

## 2026-11-20 阿里云 Registrar 首次连接与刷新续作

- 中国站设置入口先在 Native 内存中用候选 RAM 凭据完成官方 ACS3 `QueryDomainList` 的完整库存预检。通过后发布经过精确读回的不可变凭据槽，再原子导入注册资料和资产。API 签名、入口和字段保持阿里云自己的合同，未知注册锁仍为空。
- 追加迁移 `202611200007`。刷新在回执前入库，按工作区、连接 incarnation、设备和 Lease 重开续读。单事务写观察、资产、Outbox 和回执并消费请求。期间失败保留先前结果；交接、撤销及代次变化后不能提交迟到结果。旧版待扫描位需显式刷新。
- 独立复验 10 项通过，包含 Native 回执顺序、IPC、Host/SQLCipher、schema manifest 及资产读投影。Linux Storage/Tauri 严格 Clippy 通过。真实只读账户仍需具名开发准入及中国站 RAM 权限 `domain:QueryCommonInfo`，Windows/macOS 实机各自验收。卖家私有上下架与验证继续实施。
- 两个 Registrar 切片的最终整合通过根 `pnpm check`，含 SQLCipher 675 项、Tauri 190 项、Core 131 项。Windows GNU Storage/Tauri 所有目标严格 Clippy 通过。两轮 Linux 构建曾重叠并替换测试可执行文件，导致旧轮两个子进程无法启动。两项单独复验与最终整合均通过。后续需等会启动同一测试二进制子进程的检查结束，再重建对应输出。

## 2026-11-20 GoDaddy Registrar 账户归集

- 官方 Domains v3.1.0 的账户清单以 Bearer PAT 和前向游标读取。核对两份独立公开副本，带上游来源的副本与记录的 SHA-256 一致。实际 OTE 匿名请求返回 401，生产连接超时。首个受控生产账户仍需明确读取授权、具名验收范围及可核对的注册域名。[接口证据](../PROVIDER_API_REVIEW.md)
- 设置用受限 Native 窗口接收单个 PAT，完整预检后才托管凭据。原提交栅栏与追加迁移 `202611200008` 保护原子归集、资产及续费资料、刷新受理回执、重开续读和撤销。迟到结果、过期设备/Lease、外工作区和交接均不能提交。断开按专属固定槽删除并确认缺席，损坏凭据不会恢复使用权。
- 独立复审修复并验证 Cloudflare 无 Zone 账户的现有读投影、损坏/重复 PAT 槽的撤销，以及两个 IPC 命令在 Renderer、Native 权限和证据清单中的一致性。SQLCipher/Host、Native 和 IPC 聚焦复验通过。本机 PostgreSQL 设备授权 184 项通过。Linux 的隔离 GTK 与 Secret Service canary 通过，Linux 和 Windows GNU 的相关 crate 全目标严格 Clippy 通过。真实 GoDaddy、Windows/macOS 实机和发行资格待分别验收。
- 最终根 `pnpm check` 通过，含 SQLCipher 681 项、Tauri 192 项与 Core 136 项。新增设置文案、生成权限清单和两处独立命令策略已纳入同一完整检查。

## 2026-11-20 Atom Standard 库存核对

- Native 用同一凭据分别完整读取无筛选库存与官方 `type=standard` 库存。两份清单中的规范域名、Listing 摘要、已知状态及明确的 Standard 标签一致后，设置展示已归集的核对数量与最多十二个域名。过滤读取失败或两份结果不一致时，已完成的基础库存保留并显示 Standard 未获核对。认证、权限及当前执行权威失效会拒绝本次提交。
- 追加迁移 `202611200009` 将正向证据关联至当次刷新请求、原 Listing 观察、Binding 和资产代次。重开可读回当次报告。零匹配与未知分别持久表达，旧扫描、撤销或包含隔离观察的报告不展示正向结果。独立复审复验未知状态（含两侧同一未知状态）、样本之外的隔离观察、SQLCipher 回滚/重开和原 IPC 的准入，17 项通过。
- 重新观察到两个匿名官方只读响应均为 HTTP 200 与 `text/html`，`/domains?type=standard` 返回凭据缺失，`/domain-details` 返回凭据无效或权限不足。都没有提供认证账户内 Listing 精确缺席的证据。Standard 下架仍待执行流程与真实对账完成。[接口证据](../PROVIDER_API_REVIEW.md)
- 根 `pnpm check` 通过，含 SQLCipher 682 项、Tauri 192 项和 Core 138 项。Linux 与 Windows GNU 的相关 crate 全目标严格 Clippy 通过。Linux 隔离 D-Bus 的原生 Atom 凭据槽读取及撤销通过。认证卖家接口与 Windows/macOS 实机分别待验收。

## 2026-11-20 Spaceship SellerHub 账户挂牌归集

- 设置接入独立 SellerHub 连接。同一 Spaceship Native Service 先用候选密钥通过完整库存预检，再发布并精确读回凭据槽。刷新受理前保存请求，重开按同一连接 incarnation、设备与 Lease 从首面续读。断开先持久撤销，之后按精确槽位元数据清理并确认缺席。
- 追加迁移 `202611200010` 保存原子归集回执，沿用原资产、Outbox、Listing 绑定、观察和销售投影。同域名的独立账户保持各自绑定。资产重加后新观察换代，扫描缺席只使先前观察失去新鲜度。当前销售投影使用明确启用、可表示的一口价。Registrar 和 SellerHub 读取独立授权和恢复。
- SQLCipher 回归覆盖重开、整笔回滚、错误设备与 Lease、重复回执、空清单、跨连接、资产重加和撤销。本机隔离 PostgreSQL 设备授权 184 项、Windows GNU 及 Linux 严格 Clippy 通过。Linux 隔离 Secret Service 实跑损坏与重复槽清理。独立复审关闭命令集合、错误分类和凭据清理问题。[审查记录](../reviews/2026-11-20-spaceship-sellerhub-inventory-review.md)
- 最终根 `pnpm check` 通过，含 Desktop 435 项、Tauri 194 项、SQLCipher 687 项及 Core 142 项。整合修复了设置文案计数与命令证据排序。既有 localhost 测试在具备 loopback 权限的环境复跑通过。
- 匿名库存、精确域名与验证记录入口均返回 401。认证验收需要具名开发范围、Native 录入的 `sellerhub:read` 凭据和可核对挂牌。继续实现上下架、改价和自动验证。Windows/macOS 实机与发行资格分别验收。

## 2026-11-20 SellerHub 一口价变更

- 「批量操作」接通账号选择、美元价格行、持久批次预览、整批一次确认、最近计划和逐域名结果。预览严格冻结全部行、精确美分、账户 incarnation、绑定与资产代次。确认回执丢失时读取已保存的同一计划。
- 本地追加 `202611200011` 复用原计划、尝试、结果、签名批准和证据流。Native 的预检遵循当前读取与写入授权，独立于待扫描状态。已失效的未发送项目落签名拒绝，不接触凭据或 Provider。单次认领在真正 PATCH 前入库，任意发送结果均进入精确 GET 对账，重开保持该语义。价格尚未匹配时持久延后读取，成功与刷新请求原子提交。通用 404 保持未知。
- Cloud 追加 `202611200001` 和 `202611200002`，验证 SellerHub 权限和独立签名用途，锁定冲突的认领和拒绝。后继设备可用观察权限引用同工作区内的原设备、Lease 与已接受执行事实。缺失历史或当前连接归属时保留未知。
- 独立审查发现并关闭了原事实 canonical 字节核对、无待扫描状态的准入以及撤销后未执行项目卡住的问题。[独立审查](../reviews/2026-11-20-sellerhub-bin-price-review.md) SQLCipher 专项 7 项，历史迁移字节与外键复验通过；Native 签名和跨语言向量 19 项，桌面改价与命令权限专项 8 项，Linux 三 crate 严格 Clippy，隔离 PostgreSQL 185 项通过。
- 根 `pnpm check` 通过，含 Desktop 437 项、Tauri 195 项、SQLCipher 694 项及 Core 148 项。
- 此次在本机执行源码和隔离数据库验收。SellerHub 认证接口、真实改价、开发 Cloud 发布、具名资格、Windows/macOS 实机和发行待验证。

## 2026-11-20 Atom Standard 批量下架与只读续作

- 批量页接通选连接、逐域名预览、整批一次确认和已保存结果。SQLCipher 追加 `202611200012`，冻结最新完整扫描的正向 Standard 证据、Listing 与资产代次，复用原有计划、尝试和结果。并发中仅一个签名认领能提交。撤销、变化或最终栅栏失败时拒绝发送。
- Native 在固定 `domain-details` 精确确认同一已批准 Standard 挂牌后，使用官方固定 `remove-domain` 单次发送。同一认领无论收到回执、超时或退出，重开后只进行精确读取。账号内缺席合同仍待认证取证，无法证实移除时显示未核实。历史认领和新设备观察分别验证权限。
- Cloud 追加 `202611200003` 和 `202611200004`。独立审查发现 Atom 对账沿用旧平台名，修复后重新验证。隔离 PostgreSQL 18.4 从 77 条前缀升级，186 项通过，含 Atom、SellerHub 和 Afternic 回归。Linux 三 crate 全目标严格 Clippy 通过。[独立审查](../reviews/2026-11-20-atom-standard-delist-review.md)
- 根 `pnpm check` 通过，含 Desktop 438 项、Tauri 196 项、SQLCipher 696 项和 Core 152 项。
- 真实 Atom 下架和账户内缺席需要获准的 Atom Seller API 账户及受控 Standard 挂牌。开发 Cloud 未部署本切片。Windows/macOS 实机及发行资格仍需各自验收。

## 2026-11-20 Sedo 卖家库存归集

- 设置组合 Native 四项录入、基本接口完整库存预检、精确凭据槽发布、刷新与断开。刷新请求受理前持久化，重开只在原设备及 Lease 下续读。Local-storage 追加 `202611200013`，在同一 writer 原子保存资产、Outbox、原 Listing 绑定、价格观察和最新扫描回执。空清单使旧观察失去新鲜度，挂牌状态仍为未知。断开先持久撤销，再核对凭据槽清理。
- 官方匿名 POST 实测 HTTP 200、`text/xml;charset=UTF-8` 与 E1 认证错误。独立复验通过 Native、SQLCipher/Host、严格 IPC、设置回显和权限合同。隔离 Linux GTK 实跑两个原生录入窗口，隔离 PostgreSQL 186 项通过，覆盖明确的 Sedo 只读权益。[审查记录](../reviews/2026-11-20-sedo-marketplace-inventory-review.md)
- 最终根 `pnpm check` 和本机三 crate 全目标严格 Clippy 通过。含 Desktop 439 项、Tauri 197 项、SQLCipher 699 项及 Core 157 项。
- 下一项真实验收需要 Basic API 卖家账号，核对成功分页、空账户及末页，并用设置和重开确认本机回执。Sedo 写入、自动验证、Windows/macOS 实机与发行资格继续推进。

## 2026-11-20 SellerHub 固定价批量上架

- 「批量操作」可保存既有资产的固定 USD 一口价预览、核对条款后确认一次，并从计划历史查看各域名结果。每项在完整认证库存中检查目标缺席，先持久认领再发送官方 POST。响应丢失、退出及重开均以同账户精确 GET 对账。平台正在验证时保存待验证，读到同域名在售且条款一致时记为已核实，并排队刷新销售投影。
- SQLCipher 追加 `202611200014`，Cloud 追加 `202611200005` 与 `202611200006`。独立审查发现迁移目录断言遗漏，以及创建技术资格撤回时阻断既有只读对账。修订后独立复验通过，隔离 PostgreSQL 升级及 187 项通过。[独立审查](../reviews/2026-11-20-sellerhub-fixed-price-creation-review.md)
- 官方 TXT 验证选项已在 Native 严格解析。下一步为批准 DNS 范围、确认权威 DNS 连接、只新增所需 TXT、精确读回并等待 SellerHub 确认。真实卖家认证创建、实机与发行待单独验收。
- 最终根 `pnpm check` 通过，含 Desktop 441 项、Cloud 858 项、Tauri 198 项、SQLCipher 701 项和 Core 162 项。Linux 三个受影响 crate 的全目标严格 Clippy 通过。
