# Phase 0 执行计划

## 目标

Phase 0 建立“Cloud 控制面授权、本地 SQLCipher 执行业务、Cloud 保存脱敏同步副本”的可验证
纵向，不以部署、Provider 资格或发行证据替代本地实现。

## 已接受 ADR 的落地安排

ADR-0028 → ADR-0030 → ADR-0029 的批次、所有者、前置与验收条件见
[专项落地计划](ADR_0028_0030_0029_IMPLEMENTATION_PLAN.md)。A0–A3 已实现，仅 macOS 实机资格待外部证据；ADR-0030 B1、B2 已实现，
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
| C1 | Local Connector | 按 ADR-0027 逐平台、逐项接入 8 个首发平台的域名能力，先以 Cloudflare 抽象共用框架；当前只有最小 Token 的 Cloudflare Host-local Zone/DNS API read 与现有资产本地绑定，其余写入、Registrar、交易市场、获取与其他平台仍不可执行。 | Provider 账号与凭据只本地；每项新能力具名授权、计划/确认、对账和本地优先结果通过负向测试，真实执行另需对应 Q-CF 或 Q-PROV 资格。 |
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

Cloud 的有序目录包含 27 项 migration（M001–M017、M019、M020、三项 Sync/Observation、Account recovery、后续 account capability migrations 与两项 Desktop 登录 loopback redirect migrations）；M015 是规范化商业领域的 greenfield baseline，M016
增加 Identity refresh recovery，M017 增加 Devices 登录授权加固，M019 增加 Identity transaction
capability，M020 增加 Account access challenge 和加密邮件 outbox，M023 增加密码恢复、challenge-bound
dead-letter outbox 和 Session 撤销；
不存在 M018 compatibility migration。当前 M002 是无 Provider 连接身份的显式业务
副本 schema；连接键控的 Cloud Observation client 和 Repository不存在。Desktop 正常 Query 不经过 Cloud。

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
- [ ] 设置页逐角色展示能力可用性与原因；未声明角色的连接不得被隐藏（随阶段 5 角色模型）
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
- [ ] 资产库与销售每页读取都对全工作区做 O(N) 聚合（在售计数每条挂牌两次已完成运行判定、估值读取全部目标价、销售窗口函数加临时排序）；预算须在阶段 4 V1 验收前确定并满足
  - [x] 提议每页延迟预算（DATABASE_SCHEMA：release 下 1 万资产 ≤ 150 ms、10 万资产 2 市场 ≤ 1 s）并给 1 万与 10 万基准加上限；补 1 万、100 万与 10 万 8 市场基准（本机：10 万最慢约 0.71 s；8 市场销售约 2.0 s、资产库约 0.9 s；100 万资产库约 7.3 s、销售约 5.4 s，只记录） https://github.com/newcodebook/GoodDealer/pull/53
  - [x] 到期谓词改为可走 `domain_assets_by_status_expiry` 的 `lifecycle_status IN ('active', 'expired')` 并带表别名（续费首页 0.14 s → 0.12 s）；续费先切页再查注册商名称（末页 0.52 s → 0.19 s） https://github.com/newcodebook/GoodDealer/pull/53
  - [x] 查询计划固定为被忽略的 `paged_reads_never_scan_a_base_table`：记录各分页读取实际执行的语句，断言没有任何基表扫描（含覆盖索引扫描） https://github.com/newcodebook/GoodDealer/pull/53
  - [x] 8 市场最坏情况：按数据 generation（连接 `total_changes()` 与 `data_version`，读取前后一致才存取）缓存销售合并结果，同一数据的后续页约 0.1 ms；8 市场基准除首次合并外以 1 s 为上限；资产库 8 市场约 0.89 s 在预算内，未缓存 https://github.com/newcodebook/GoodDealer/pull/53
  - [x] 销售合并缓存的内存：100 万资产约 33 万个挂牌域名时估计 2 市场约 60–80 MB、8 市场约 170–200 MB；用 100 万基准测峰值 RSS，并考虑以平台索引与状态枚举代替字符串或按行数设上限（每行改为平台位集、单字节状态枚举与原样金额，行大小与市场数无关；100 万基准中缓存向分配器请求约 21 MiB、10 万约 2 MiB——这是下限，不含分配器开销（约 66 万个小块，实际堆估计约 30–35 MiB）与合并期间的瞬时峰值；未测得峰值 RSS：种子数据释放的堆被合并复用，RSS 增量读数为 0，不能反映缓存；不设行数上限） https://github.com/newcodebook/GoodDealer/pull/53
  - [ ] 每次写入后的首次销售读取仍需全量合并（10 万 8 市场约 2 s，超出 1 s 预算）：确定该首读是否计入预算，或改为增量维护合并结果（写入后、销售读取前的首次设置读取扫描同一批挂牌，8 市场约 2.1 s，随同处理）（已做：缓存键改为迁移 `sales_listing_generation` 的触发器计数与 `data_version`，只有挂牌观察、确认它们的 marketplace 运行与目标状态及资产删除才推进，备注、目标价、DNS 与注册商/DNS 观察运行等写入后销售约 0.08 ms、设置约 0.22 s；合并改为按新索引顺序的连接查询，10 万 8 市场首读 2 s → 1.1 s、设置扫描 → 1.3 s；2 市场 10 万全部读取 ≤ 0.73 s 仍断言 ≤ 1 s。暂停：待决事项——8 市场挂牌写入后的这两次首读（约 1.1 s / 1.3 s）是否计入 1 s 预算须由用户确认；仓库只记录了 10 万资产每页 1 s，未记录 8 市场是否在预算口径内。确认计入则改做增量维护） https://github.com/newcodebook/GoodDealer/pull/53
  - [x] 由用户确认分页读取延迟预算（含 100 万资产目标），确认后才作为阶段 4 V1 验收条件（用户于 2026-11-06 确认：10 万资产每次分页读取 ≤ 1 s 作为阶段 4 V1 验收条件；100 万资产只记录、不设 V1 预算；8 市场写入后首读仍超预算，见上一项） https://github.com/newcodebook/GoodDealer/pull/53
  - [x] 100 万资产的全量计数随资产线性增长（约 7 s）：正式规模声明前确定 100 万预算与做法（缓存或增量计数）（已由用户 2026-11-06 的预算决定确定：100 万资产只记录、不设 V1 预算，见 VERIFICATION 阶段 4 与 DATABASE_SCHEMA；v1 不作 100 万规模声明，所以不做缓存或增量计数，基准继续只记录约 7 s；将来要作 100 万规模声明时须先另定预算并追加任务） https://github.com/newcodebook/GoodDealer/pull/53
- [x] 销售视图模型上限（100,000）与 Host 窗口上限（1,000,000）对齐或改为分页（对齐：`salesListingLimit` 同时约束视图模型与投影，域名超限时投影失败而不截断；Host 行上限按每域名多市场保留） https://github.com/newcodebook/GoodDealer/pull/53
- [x] 销售、续费与 DNS 读取在 100k 规模下改为 Host 侧分页与聚合指标，遵守 DATABASE_SCHEMA 的 keyset/窗口分页规则，不在 Renderer 汇总全部窗口（拆为以下三项，三项完成后勾选） https://github.com/newcodebook/GoodDealer/pull/53
  - [x] 续费：Host 页读取，到期数与自动续费开/关计数由 Host 全量返回，续费台使用 kit `Pagination`；页越界时回到末页，后页读取失败时回到首页 https://github.com/newcodebook/GoodDealer/pull/53
  - [x] DNS 健康：Host 页读取与全量指标（搜索交给 Host） https://github.com/newcodebook/GoodDealer/pull/53
  - [x] 销售：Host 按域名分页（多市场合并在 Host 侧完成）与全量指标（在售数、单一价格规则下的挂牌估值） https://github.com/newcodebook/GoodDealer/pull/53
- [x] DNS 健康与续费只读一页后（销售仍每次全表校验），页外坏行（平台不一致的绑定、非法标签）不再让每次读取失败关闭，但仍计入全量计数；补一次全表完整性检查或在设置/诊断中报告（已改为每次读取全量校验并失败关闭：DNS 对每个有绑定或适用观察的资产复用逐行校验；续费先校验全部可用注册商观察的去重名称，仅在有非法名称时再逐资产解析实际显示的名称；100k 基准下续费约 0.20 s、DNS 约 0.21 s） https://github.com/newcodebook/GoodDealer/pull/53
- [x] 续费 Host 投影校验 `domain_assets.expires_on` 的日期格式并纳入全量校验（该列无 schema CHECK，当前只由 Renderer 逐页校验；页外格式错误但按字符串比较落入窗口的日期会被计入而不被拒绝），或在后续迁移中加 CHECK；若续费精确名称扫描因历史非法名称而常态触发，记录非法名称计数以便发现（已完成：续费计数查询把 `expires_on IS NOT date(expires_on)` 计为异常并让整次读取失败） https://github.com/newcodebook/GoodDealer/pull/53
- [ ] 为让读取失败关闭的存储坏行（非法到期日期、平台不一致的绑定、非法注册商名称与挂牌观察、迁移前写入的非规范 Outbox `created_at` 等）提供修复，避免单行坏数据让整页长期不可读；读取侧的全表校验（DNS 绑定、续费名称与到期日期、资产库到期日期、销售挂牌、历史的 Outbox 时间）只能在修复步骤清理完迁移前的旧行之后移除（暂停：待决事项——这些行属于同步复制的业务数据与已提交的变更流水，修复是经变更流水改写、删除或标记旧观察不可用，还是改写已确认的 Outbox 时间，需要先有 ADR 决定；建议：业务数据经变更流水以新变更修复以保持副本收敛，已确认的 Outbox 历史保持不可变、只标记不改写；设置中的报告已完成，见本阶段末项）
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
- [ ] 批量计划生成、计划详情读取与逐项确认（随首个批量操作能力资格认证；认证前新建与执行保持不可用）
- [x] 历史页“今日变更”改为 Host 侧计数（当前只统计已加载的最新 500 条）（Renderer 在读取请求中给出本地日的规范 UTC 起止时刻（起含止不含，23–25 小时），Host 校验后与总数同一次扫描计数全账本；同一次读取的各窗口计数须一致） https://github.com/newcodebook/GoodDealer/pull/53
- [x] 历史页跨过本地午夜后自动重新读取“今日变更”（当前保留上次计数直到重新读取）（`useLocalHistoryDay` 持有本地日并在其结束时按时钟重新计算；本地日作为读取的重启键，因此同一次读取的各窗口不会跨两天，翻日或窗口在新的一天回到前台时重新读取，并保留上次结果直到新结果到达；DOM 测试用假时钟跨过午夜） https://github.com/newcodebook/GoodDealer/pull/53
- [x] Outbox 写入时校验 `created_at` 为规范 UTC 时刻（“今日变更”按字符串比较计数，依赖规范格式）（新迁移 `outbox_integrity.sql` 的插入与更新触发器只接受 `YYYY-MM-DDTHH:MM:SSZ` 且小时不超过 23，与 Host `validate_timestamp` 一致；历史读取在同一次聚合中发现任何迁移前的非规范时间即整体拒绝，而不是按错误的日期计数） https://github.com/newcodebook/GoodDealer/pull/53
- [x] `local-storage` 业务测试数据库随测试结束删除（原 `tempdir().keep()` 每次运行在临时目录残留上万个目录，耗尽配额；改为 `TestDatabase` 持有目录） https://github.com/newcodebook/GoodDealer/pull/53
- [ ] 历史回滚：撤销计划命令与高风险确认（随首个可撤销操作能力资格认证；认证前回滚与导出保持不可用）
- [ ] 人工任务对账：打开平台、标记完成与重新检查后由 Host 重新观察平台状态完成对账（随对应能力资格认证；认证前保持不可用）
- [x] 人工任务等待时间改用 `manual_action_required` 结果的观察时间，而非尝试开始时间（每项取最新尝试最早的 `manual_action_required` 结果观察时间，结果尚未记录时退回尝试开始时间；任务按其中最早者排序） https://github.com/newcodebook/GoodDealer/pull/53
- [x] 人工任务读取每任务域名样本收窄（当前每任务最多 10,000 个，单窗口载荷过大）（Host 只发送收件箱显示的前 3 个域名（字节序），`domainCount` 仍精确；读取与视图合同共用 `manualTaskDomainSampleLimit` 并拒绝其他样本大小，Desktop 测试固定它与 Host 的 `DOMAIN_LIMIT` 相等；等待起点不早于尝试开始） https://github.com/newcodebook/GoodDealer/pull/53
- [ ] 打包的 Tauri 构件在真实 Host 与种子数据上逐页可达，并与 `brand/ui_kits/desktop` 逐屏对照，并记录各 WebView 的 NumberFormat v3 探测结果与超大金额的显示（当前只有源码与打包依赖图层面的证据）（暂停：待决事项——工作区页面只有在真实账号经浏览器 PKCE 登录、取得商业授权与 Active Lease 后才可达，登录须由用户本人输入凭据；三种 WebView 分别只在 macOS（WKWebView）、Windows（WebView2）与 Linux（WebKitGTK）上存在，当前执行环境只有 Linux 且不能操作原生窗口。影响：阶段 2 验收“每个设计页面在真实构件中可达”与阶段 4 的真实构件证据都依赖此项。可选方案：①用户在三种系统的打包构件上登录，按页面清单逐屏截图并运行内置 NumberFormat 探测，由执行方对照 kit 记录偏差并修复；②在 Linux 上经用户批准安装 `tauri-driver` 与 WebKitWebDriver 做 WebKitGTK 的自动逐屏对照（登录仍由用户完成），macOS 与 Windows 仍按①；③先只取 Linux 证据，macOS/Windows 推迟到阶段 11 的最终候选。推荐②+①：Linux 部分可重复，其余两种系统一次人工对照）
- [x] 历史与人工任务等显示文本的长度口径在 Rust 与 Zod 之间对齐（核实：Zod 4 的 `max` 按码点计数，与 Rust 字符数一致，无需改动；需要 UTF-16 上限的 Zod 校验须显式比较 `length`） https://github.com/newcodebook/GoodDealer/pull/53
- [x] `client-core` 的 `dnsProviderSummarySchema` 平台集合与 ADR-0027 的 8 个平台对齐或退役（已对齐：`providerKind` 改用唯一的 `launchPlatformKindSchema`，移除 `registrar_dns`/`custom`；注册商自带 DNS 即该注册商平台；补每个首发平台接受与旧值拒绝测试） https://github.com/newcodebook/GoodDealer/pull/53
- [ ] Host 按平台报告支持的角色后，把 DNS 读取契约（`dnsProviderSummarySchema` 与 `dns-health.ts` 的 Zone 绑定）的 `providerKind` 收窄为支持 DNS 的平台（当前 Afternic、Atom 等纯市场平台也被接受为 Zone 托管方）
- [x] Provider 绑定写入时强制绑定平台与连接平台一致（当前只在 DNS 健康读取时拒绝，单行坏数据会让整页不可读）（已完成：存储完整性迁移在写入时拒绝平台不一致的绑定，并禁止已绑定连接改变平台；业务写入路径本就只接受 Cloudflare 连接） https://github.com/newcodebook/GoodDealer/pull/53
- [x] DNS 健康 Rust 测试覆盖“非 Cloudflare 绑定 + 既有 Cloudflare 观察”同时存在的情况 https://github.com/newcodebook/GoodDealer/pull/53
- [x] Standby DNS 读取组合前改写 `readOnlyNotice`（当前暗示修复与重新验证在 Active 中可用）（改为说明 Standby 不做修改，且 DNS 修复与所有权重新验证尚未在任何设备上取得资格；en-US/zh-CN 与测试同步） https://github.com/newcodebook/GoodDealer/pull/53
- [ ] DNS 修复或所有权重新验证在 Cloudflare 阶段取得资格时，同步改写 DNS `readOnlyNotice`（届时说明这些操作只在 Active 设备上执行；Active 上 `canEdit: false` 时也显示只读说明，与续费按 `!canEdit` 判断一致）
- [x] Host 路由读取的重试接线测试：重试按钮已测试会调用 `retry`；`useHostRouteRead` 由 `attempt` 驱动重新读取仍缺 hook 级测试（需要渲染环境）（同一测试：首读失败后点击“重新读取”，从同一页起点重新读取） https://github.com/newcodebook/GoodDealer/pull/53
- [x] DNS 页 DNSSEC 各状态与 en-US 渲染测试（当前只覆盖 zh-CN 的“未知”）（四种状态 en-US 与 zh-CN 均有渲染测试；已观察的 Zone 读取契约必带状态，未观察的行不显示 DNSSEC 标签并有测试） https://github.com/newcodebook/GoodDealer/pull/53
- [x] `read_cloudflare_connection` 返回的连接标签改用统一标签规则（当前 Host 不校验，适配器允许 256 个单元且只拒绝 C0/DEL；随 `features/connections` 进入生产导航）（Host 读取对标签应用与其他读取相同的 `valid_connection_label`，不经创建路径写入的违规标签让读取失败关闭；适配器的状态、创建回执与创建输入都改用 client-core 的 `connectionLabelSchema`（至多 120 个 UTF-16 单元，拒绝控制与格式字符），违规输入在 IPC 之前拒绝；Host 与适配器测试覆盖零宽字符、控制字符与超长标签） — https://github.com/newcodebook/GoodDealer/pull/53
- [ ] 注册商委派观察接入后，与 Zone 分配的 nameserver 比对得出委派状态与 NS 异常计数（随注册商能力）
- [x] 设置“关于”报告让其他读取失败关闭或变慢的存储坏行计数：非法到期日期（资产库与续费）、非法注册商名称的可用观察（续费变慢，显示时失败）、DNS 绑定或观察无效的资产、无效挂牌观察（销售）、时间非规范的 Outbox 行（历史）；每项计数复用对应读取的校验谓词，设置读取本身不因坏行失败；修复尚不可用并如实说明 https://github.com/newcodebook/GoodDealer/pull/53
- [x] 设置读取每次全量运行完整性计数（含销售挂牌合并查询，10 万资产约 0.5–2 s）：改为复用销售按数据代缓存或仅在打开“关于”时计数，并纳入 10 万基准计时（同一数据代已有合并成功的销售台面时不再扫描挂牌，提交落在读取期间则不用缓存重读；10 万基准：2 市场冷读 0.72 s、缓存后 0.22 s，8 市场冷读 2.1 s、缓存后 0.23 s；8 市场写入后首次读取与销售首次合并同属下一项的预算问题） https://github.com/newcodebook/GoodDealer/pull/53

### 3. Cloudflare 路径稳定

- [x] 引导流程：欢迎 → 设备门 → 连接 Cloudflare（可跳过）→ 从观察结果导入或手动添加 → 完成（观察导入必须逐个经 `local_domain_asset_create` 新增，不得另开写入路径，否则去重失效）（生产组合：Active 且无域名的工作区每次会话首次进入时显示 kit 接入向导，可在欢迎页跳过；设备门显示新 Host 读取 `local_device_lease_read` 校验过的设备与 Lease Epoch（无签名信封与密钥，非 Active 时拒绝），Host 没有设备名，不显示也不编造；Cloudflare 在 Q-CF 关闭前显示不可用、无连接路径，观察导入同样不可用，手动添加复用 `local_domain_asset_create`，重复域名如实提示；完成页取 Host 的域名数与已应用的服务器 revision。连接与观察导入的可执行路径随下方 Cloudflare 进入生产组合与 Q-CF 一并交付） https://github.com/newcodebook/GoodDealer/pull/53
- [x] 资产创建，并对导入和手动添加去重（Host 经 `local_domain_asset_create` 在当前 Host 提交栅栏下以一个同步 upsert 新增资产；规范域名是去重键，工作区已有的域名返回 `DESKTOP_LOCAL_ASSET_EXISTS` 且不写入任何数据，已删除仍有墓碑的域名被拒绝；Host 与 Renderer 都拒绝非规范名称与 IP 字面量；资产库在 kit 的工具栏次按钮位提供“添加域名”，Standby/只读时不可用；kit 无加号图标，按钮不带图标。导入的去重依赖引导导入也走该命令，见上一项） https://github.com/newcodebook/GoodDealer/pull/53
- [x] 绑定 UI（DNS 页的 kit 行操作列：Host 读取显示无有效绑定、且有本资产同名 Zone 的已确认可用 Cloudflare 观察时，可写界面提供“绑定 Zone”，经 `local_domain_asset_provider_bind` 由 Host 复核证据与读取代后提交，提交后按回执代重新发布；kit 没有绑定专用画面，沿用 DNS 页行操作按钮；生产导航尚无建立连接或观察的入口，所以目前不会出现该操作） https://github.com/newcodebook/GoodDealer/pull/53
- [x] Grant/Lease 能力门禁接入生产导航（Host 只在 Grant v3 与嵌套 ActiveDeviceLease 验签通过、且商业能力为 `cloudflare:dns:observe` 时进入 Active；Renderer 只得到由此派生的 `local:read`/`workspace:mutate` 状态，`adjudicateDesktopPresentation` 据此决定锁定页、Standby/商业只读/受限与可用路由，写入口（添加域名、目标价、绑定 Zone、引导）只在 Active 且含 mutate 时组合；新增渲染测试逐个状态证明写入口的有无。Cloudflare 连接入口按同一能力门禁随下方 Cloudflare 进入生产组合一项交付） https://github.com/newcodebook/GoodDealer/pull/53
- [x] 凭据原子撤销，revoke/deactivate 的 Host capability（`cloudflare_connection_revoke` 经同一串行 ProviderLane 提交、不限速；Host 在准备撤销的同一提交中把连接置为 `revocation_pending` 并拒绝凭据使用，即停用先于 custody 生效；Secure Host 新增 `publish_cloudflare_tombstone_guarded`，在 Keychain 锁内只对 exact Active 基线写入下一 generation 的无 Token 墓碑（保留 scope 与 Zone），与 activation 同一 prewrite/marker/回读栅栏，基线矛盾进入 remediation 且凭据保持拒绝；确认后连接为 `revoked`，Token 在墓碑确认后才离开 custody，重放与并发撤销被拒绝。撤销只撤回 GoodDealer 的 custody 与使用，不会在 Cloudflare 吊销 API Token。凭据只在 macOS Keychain 中，其他平台的墓碑发布失败关闭；生产界面的撤销入口随下方 Cloudflare 进入生产组合与 Q-CF 提供。已在 `remediation_required` 状态的连接尚不能撤销，见新增项） https://github.com/newcodebook/GoodDealer/pull/53
- [x] Cloudflare generation/auth fences 从 `features/connections` 进入生产组合（含：全新安装没有 Cloudflare 连接行、凭据采集仅 macOS、观察表对 `domain_assets` 有外键，所以“连接后从观察导入”需要新建连接与按区域导入的 Host 能力；交付时让引导的连接与导入步骤改用它，导入仍逐个经 `local_domain_asset_create`；同时决定 DNS 页“绑定 Zone”在 Q-CF 关闭前是否可见，若不可见，把 `bind_zone` 绑定到连接或能力状态上；交付连接与导入入口时，它们须经同一 `readOnly === null` 门禁与 Host `qualified` 判定，并为之补写入口渲染测试——当前生产中没有 Cloudflare 写入口，所以已勾选的界面组合项的门禁条款只是因为不存在入口而成立）（拆分：门禁已由下一项交付；剩余为新建连接、按区域导入、生产界面组合三项，见下）（引导的 Cloudflare 卡片改用新建连接与激活（激活时按区域导入），已连接时准入撤销；准入只取 Host 事实：工作区可写（Active 且有 mutate，与其他写入口同一门禁）、Host 报告 `qualified`、Host 报告本构建可采集凭据（`capturable`，仅 macOS；其他系统卡片不可用并说明“目前仅 macOS 支持连接”）、无运行中/恢复/阻塞的操作且状态可读，Host 自身仍逐次核对；操作期间卡片为连接中且不准入；之后按有界轮询读取 Host 状态决定显示，失败或被拒也显示 Host 原因；连接后首次导入步骤说明 Zone 已在连接时导入；设置不在连接行上放操作，而在可写时提供 kit 的“重新运行接入向导”进入同一引导；DNS“绑定 Zone”维持由 Host 的 `bindable` 决定，Q-CF 关闭前没有已认证连接能观察 Zone，故不出现；写入口渲染测试覆盖引导 Cloudflare 卡片与设置“重新运行接入向导”在 Active+mutate、Active 无 mutate、Standby、商业只读四种状态下的门禁，以及认证与否、可否采集凭据） https://github.com/newcodebook/GoodDealer/pull/53
- [x] Host 的 ADR-0024 资格登记与执行门禁（`active_workspace/capability_qualification.rs`：已认证能力清单，当前为空；Cloudflare 激活准入、凭据准备与观察准入在 Host 内逐次核对，未认证时以 `DESKTOP_CAPABILITY_UNQUALIFIED` 拒绝，即使已有有效 Active 凭据也不执行；撤销与凭据写入恢复不核对，只减少 Host 持有的东西；设置读取的角色可用性取自同一清单，契约尚无可执行状态，所以某角色一旦认证会让读取失败关闭，直到契约扩展——认证任何角色前必须先为设置契约增加可执行状态；每个清单条目须指向 `docs/` 下的资格证据，测试拒绝无证据条目；测试经线程内的临时资格覆盖保留激活与观察成功路径的 Host 测试。由此 DNS 页“绑定 Zone”在 Q-CF 关闭前不会出现：它需要已确认的观察，而观察准入被拒绝） https://github.com/newcodebook/GoodDealer/pull/53
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
- [ ] 墓碑清除与已删除域名的重新添加：当前没有生产路径把墓碑置为 `purge_eligible` 或删除墓碑与已删除行，创建对带 `deleted_at` 的行一律拒绝，所以删除的域名永远不能重新添加；交付后把“目前不能重新添加”改为说明何时可重新添加。Cloud 侧 ingest 遇到 delete 即拒绝整个请求，没有墓碑物化，checkpoint 重建把 delete 处理为移除行而不留墓碑；本地 `sync_outbox_local_creations` 触发器只允许标记实体的首个本地 upsert，备份恢复只凭墓碑或 `deleted_at` 判断冲突（决策已接受：产品负责人于 2026-11-13 确认 [ADR-0029](../adr/0029-domain-tombstone-purge-and-re-adding.md)，端到端删除、generation 与重新添加纳入阶段 3，暂定期间冻结该实体，失败保留证据并允许修正后重试；墓碑物理清除推迟。先实现端到端删除与 generation；重新添加仍等待已接受的 ADR-0030 实现。）C1a（mutation wire v3）已交付 5d3d499。（暂停：C1b 删除物化与 ADR-0029 决策 1 冲突——Cloudflare DNS 观察回执不可变且以 `ON DELETE RESTRICT` 外键引用 `workspace_replica_domain_assets`，有观察记录的域名无法“删除活跃行并写墓碑行”；须由用户在保留已删除资产行（软删除）与解除观察证据对资产行的外键之间择一并修订 ADR-0029）
- [x] 写入口门禁的渲染测试覆盖全部写入口：目前只逐状态证明“添加域名”，补上域名详情目标价、冲突中心解决、DNS“绑定 Zone”，Cloudflare 连接、激活与观察入口进入生产组合时一并加入；若 Host 将来产生 Active 但无 mutate 的“受限”状态，补一条说明写入口缺失原因的横幅（`apps/desktop/src/app/write-entries.test.tsx` 在 DOM 中渲染真实工作区，对 Active+mutate、Active 无 mutate、Standby 只读、商业只读四种状态逐一证明域名详情“编辑价格”、冲突中心“保留本地”/“接受平台”与 DNS“绑定 Zone”只在可写时出现；夹具的数据本身都允许写入（详情可编辑、冲突裁决可用、Zone 已观察），所以门禁是唯一能隐藏它们的条件。Cloudflare 连接、激活与观察入口的同类测试由生产界面组合一项交付。Host 的 Active 状态总是同时带 `workspace:mutate`，“受限”横幅随该状态出现时再加） https://github.com/newcodebook/GoodDealer/pull/53

- [x] 准备已提交后失败的 Provider 操作也唤醒投影：撤销在准备时已提交 `revocation_pending` 与拒绝使用，激活在准备时已提交 prewrite 状态，但其后 prewrite 检查、标记或解析返回 `Err` 时 `run_provider_operation` 只在 `Ok(true)` 时唤醒，投影保持旧状态直到下一次唤醒；让编排器区分“未准备”与“准备后失败”，后者同样唤醒（`run_provider_operation` 在每次 Provider 操作结束后无条件唤醒投影：激活在 Zone 导入与 prewrite 时、撤销在准备时已提交，非确认结果同样改变连接，所以不按结果判断；重读是幂等的，相对限速的 Provider 调用成本很小；源码策略测试防止唤醒再次依赖结果） https://github.com/newcodebook/GoodDealer/pull/53
- [x] 本地新增的域名同步到 Cloud：Cloud ingest 对副本中不存在的实体返回 `MUTATION_ENTITY_UNKNOWN`（`apps/cloud/src/modules/workspace/mutations/index.ts` 与 `postgres-ingest-service.ts`），副本行只来自 seed 或快照物化，所以经 `local_domain_asset_create` 新增的域名的首个 upsert 会被 Cloud 拒绝。需要 ingest 对副本中既无活跃行也无墓碑的实体接受首个 upsert 并创建活跃行（未提供字段取默认值），客户端处理该拒绝码的现状一并核对；PostgreSQL 资格证据覆盖新路径。ADR-0029 已接受；generation 实现后首次添加的实体 generation 为 1。审查 ADR-0029 时发现（Cloud ingest——PostgreSQL 与内存实现——在 tenant 事务与工作区 revision 锁内读取墓碑，只拒绝当前为墓碑的资产，其余未知资产由首个 upsert 以默认字段与 revision 0 创建副本行后应用字段，字段过期判定对新建资产从 0 起算；app role 只用已授予的列级 INSERT，`ON CONFLICT DO NOTHING` 不覆盖既有行。Cloud 与 client-core 的 checkpoint 重建对同一情形创建默认行，client-core 遇 delete 改为失败关闭。Desktop Inbox 本就为新实体建默认行，不需改动。测试：PostgreSQL 新增、同批次新增后编辑、重复提交为精确重复、本设备其后的编辑被接受（其他 epoch 或更旧 base 的写入过期由同字段规则的测试覆盖）、另一租户不可见；墓碑资产作为毒项整批拒绝；内存 ingest、端口、两处重建各有正向与负向用例；两个并发的首个 upsert 只创建一次。PostgreSQL 18.6 资格运行 https://github.com/newcodebook/GoodDealer/actions/runs/43435475601 在 abd7a30 上通过，报告 `qualified: true`、按名单逐项执行新测试） https://github.com/newcodebook/GoodDealer/pull/53
- [x] 同一字段连续未确认的编辑永久卡住同步：本地编辑以提交时的 `applied_through_server_revision` 作为 `baseServerRevision`，Outbox 的 wire 在提交时冻结；同一字段的第二次编辑若在第一次 ACK 前提交，其 base 小于第一次被分配的 revision，Cloud 按字段 revision 判为 `MUTATION_FIELD_STALE`，Desktop 把映射后的 `SYNC_STORAGE_REJECTED` 视为可重试，于是该项与其后的整条 Outbox 永久重试（已复现：PostgreSQL 测试中同一设备 base 均为 0 的两次编辑，第二次被判过期；Rust 测试证明 ACK 前的两次编辑带同一 base、设备序号递增。修复：Cloud 的过期判定——PostgreSQL 与内存实现共用 `stale-field-rule.ts`——把同一设备、同一 Lease epoch、更小设备序号且 base 不大于本次的已接受写入视为本设备的先前编辑而不是冲突；写入者从 `workspace_mutations` 读取，replay 已压缩时失败关闭为过期。负向测试：以更旧 base 提交的后续写入、另一 Lease epoch 的写入仍判过期；并发同字段测试改为两次互不知情的写入。`ACCOUNT_AND_SYNC` 写明该规则。CI `wp2-workspace-sync-persistence` 运行 43437306915 在 eb25634 上通过，报告 `qualified: true`，PostgreSQL 18.6） https://github.com/newcodebook/GoodDealer/pull/53
- [x] 确定性的推送拒绝不应无限重试：`sync/http-service.ts` 的 `mapPushCode` 把 `MUTATION_FIELD_STALE`、`MUTATION_BASE_REVISION_AHEAD` 与 `MUTATION_ENTITY_UNKNOWN` 都映射为 `SYNC_STORAGE_REJECTED`，Desktop 把它视为可重试，所以真正的冲突让 Outbox 头永久重试、阻塞其后全部同步（`mapPushCode` 改为对 ingest 拒绝码的穷举映射；新增推送拒绝码 `SYNC_MUTATION_CONFLICT`，覆盖字段过期与墓碑实体，协议 schema、wire 语料（生成）与 Rust 严格校验同时更新；Desktop 对多项批次先隔离，单项把 Outbox 行终止为 `conflicted`、`last_error_code='sync_mutation_conflict'`，保留行与字段，其后 Outbox 继续发送；字段 `sync_state` 不变，拉取到对方写入时进入冲突中心而不覆盖本地值。`MUTATION_BASE_REVISION_AHEAD` 只在 Cloud 状态回退时出现，与 `MUTATION_DRAIN_SEALED`、`MUTATION_WORKSPACE_MISMATCH` 一同保持可重试以保住本地编辑。Cloud 应用层逐码测试、Rust 业务层与推送处置测试。被拒绝序号在 drain 中的缺口拆为下一项） https://github.com/newcodebook/GoodDealer/pull/53
- [ ] 被确定性拒绝的 mutation 序号在设备切换 drain 中留下缺口：Cloud ingest 接受序号缺口，但 drain 验证（`devices/drain-verification.ts`）要求 `mutation` 流连续接收水位等于最后分配序号、无缺失区间且 rolling digest 一致，否则 `DRAIN_STREAM_GAP`；本地 `sync_outbox_fields_v2_immutable_delete` 禁止删除已认领行，不能靠丢弃 Outbox 行解决；Desktop 目前尚不生成 drain proof，所以在设备切换交付前须解决。ADR-0029 的经同步重新添加以本项为前置（决策已接受：产品负责人于 2026-11-13 接受原子拒绝回执、全局设备序号身份及独立有版本的 drain 结果摘要，待实现与资格验证。见 [ADR-0030](../adr/0030-closing-deterministically-rejected-mutation-sequences.md)（Accepted，2026-11-13；实现中：B1 的结果 envelope、drain proof v2 与 PostgreSQL v2 seal 重建，B2 的结果联合 ledger 与单项业务拒绝同事务记账，以及 B3 的客户端 v2 结果链合同与跨 Lease epoch 的全局 v2 seal 已交付；设备切换端到端串通见下一项））
- [ ] 设备切换端到端串通 ADR-0030 v2 drain：Host 按序读取 Outbox 的持久 Cloud 结果（`acknowledged` 与 `conflicted`/`sync_mutation_conflict`），用 client-core `foldPersistedMutationResults` 与 `buildDrainProofClaims`（v2）生成声明并签名，Cloud 接收 proof 写入 `device_drain_proofs` 时保存 `proof.schemaVersion`；端到端覆盖拒绝后后续同步与 drain 成功、Lease 轮换后 drain 成功；跨 ADR-0029 C1a 升级的行须能确定 Cloud 记录的是 v2 还是 v3 提交 envelope（本地目前只记 v2 编码摘要，升级前认领、升级后 ACK 的行两者皆有可能），由 C1c 或本项记录 Cloud 接受的 wire 版本（暂停：仓库没有 Desktop 设备切换流程与 Cloud proof 接收路径，ADR-0027 的 v1 范围未列入设备切换，是否纳入 v1 由用户决定）

### 4. 当前范围全系统 V1 汇合验收

- [ ] 在同一冻结候选上，为 v1 详细垂直验收表的每一行取得新鲜证据（暂停：依赖阶段 2 的打包构件逐屏对照（真实账号登录由用户完成，三种 WebView 分属三种系统）与阶段 3 的 ADR-0028/0029 实现与 ADR-0030 实现；8 市场写入后首读是否计入预算也待用户确认。阶段 5–11 以本阶段为进入条件，随之等待；是否允许阶段 5 框架源码先行由用户决定）
- [ ] 独立复审 PASS（暂停：随上一项）

### 5. 多平台共用框架与 Cloudflare 全能力

- [ ] 平台连接与角色模型（registrar、dns、marketplace、acquisition）
- [ ] binding 增加 `listing` 资源类型
- [ ] 每平台私有 Service 骨架和能力 manifest，以及资格登记
- [ ] 跨平台所有权验证的本地操作计划
- [ ] 对账任务模型
- [ ] 逐笔资金确认组件（含出价）
- [ ] 负向测试：越权、跨租户、伪造 grant/bid、角色串用凭据、批量部分失败
- [ ] Cloudflare Registrar 能力
- [ ] 第一个写入 `domain_assets.expires_on` 的注册商观察必须写入注册局到期时刻的 UTC 日期，不能用本地日期或注册商显示日期（到期窗口按 UTC 日计算的前提；当前只有测试种子写入该列），并补写入侧测试
- [ ] Cloudflare DNS 写入与 DNSSEC
- [ ] Cloudflare 监控
- [ ] 核对 Cloudflare 平台事实并更新快照

### 6. Porkbun

- [ ] 核对官方文档并更新平台事实快照
- [ ] 能力清单映射到四种角色
- [ ] 私有 Service、合同与负向测试
- [ ] 逐项能力资格证据（使用沙箱或 `dryRun`）
- [ ] 证明框架核心模型未改动

### 7. Spaceship（含 SellerHub）

- [ ] 核对官方文档并更新平台事实快照
- [ ] 能力清单映射到四种角色
- [ ] 私有 Service、合同与负向测试（凭据 scope 和资格按角色隔离）
- [ ] 逐项能力资格证据

### 8. Dynadot、Namecheap

- [ ] Dynadot：核对事实、列出能力清单、实现 Service 与测试（HMAC 密钥只在 Host custody）、取得资格证据
- [ ] Namecheap：核对事实、列出能力清单、实现 Service 与测试（IP 白名单不满足时失败关闭并说明如何修复）、取得资格证据

### 9. GoDaddy、Afternic

- [ ] GoDaddy：核对事实、列出能力清单、实现 Service 与测试、取得资格证据
- [ ] Afternic：核对事实、列出能力清单，实现 Portfolio API 的 Listing 与改价，取得资格证据

### 10. Atom（含 AtomRegistrar）

- [ ] 核对官方文档和准入门槛，更新平台事实快照
- [ ] Listing、逐笔确认的出价、AtomRegistrar 的 Service 与负向测试（query-string token 不进入日志、错误或 URL 记录）
- [ ] 逐项能力资格证据，或者带原因标记为不可执行

### 11. 1.0 资格与发行

- [ ] 关闭 Q-CF
- [ ] 关闭 Q-PROV
- [ ] 关闭 Q-OPS、Q-AUDIT、支付与销售资格
- [ ] 关闭 Q-NATIVE、Q-REL；`pnpm gate:validate` 通过
- [ ] 在最终候选上重新通过阶段 4 的 V1 验收
- [ ] 取得 `1.0.0` / `stable` 批准

### 并行补强

- [x] live PostgreSQL 并发/RLS、容量、崩溃恢复、长时间运行（CI 运行 https://github.com/newcodebook/GoodDealer/actions/runs/43413659224 ，PostgreSQL 18.6，提交 caba50a，范围仅 workspace mutation ingest 路径：16 个租户共用同一工作区 id 并发写入 760 条、8 个连接，约 262 条/s，p50/p95/p99 约 57/73/111 ms；8 个租户 600 s 混合负载 47,134 次写入、11,782 次与新写入并发的已提交项重试、每 2 s 一次共 176 次不变量检查，无违例；同一项并发重复提交只应用一次；`fsync`、`synchronous_commit`、`full_page_writes` 均为 on 时 3 次写入中 SIGKILL 容器，已确认的写入无一丢失，每租户至多 1 项已提交未确认，已提交前缀一致，重提交恰为每个已提交项 1 次重复，12 个租户都续写到 1,000 项；六张负载表强制 RLS、应用角色非属主且无 BYPASSRLS，应用角色看不到其他租户的行。不构成：完整 RLS 资格（逐策略审计、全部写路径 WITH CHECK、其他表）、操作系统崩溃或断电下的持久性、超过 10 分钟的稳定性（vacuum/膨胀、XID 年龄、内存上限）、容量 SLO 或生产规格、Gate 关闭；本机 18.4 结果只是诊断） https://github.com/newcodebook/GoodDealer/pull/53
- [x] 把 `backup/source.rs` 的快照临时目录改为仅属主可访问（启用生产备份的前提）（`private_snapshot_directory` 在 Unix 上以 `0700` 创建，创建后对目录本身（不跟随 symlink）校验属主为当前有效用户且组与其他用户无任何权限，不符即 `StorageRejected`；macOS 与 Linux 都走 Unix 分支；Windows 沿用系统临时目录（位于用户配置目录下，默认仅该用户可访问，未另加 ACL 校验）；生产代码中唯一的临时目录创建点；负向测试覆盖 0750/0705/0770/0777 与 symlink） https://github.com/newcodebook/GoodDealer/pull/53
