# Phase 0 执行计划

## 目标

Phase 0 建立“Cloud 控制面授权、本地 SQLCipher 执行业务、Cloud 保存脱敏同步副本”的可验证
纵向，不以部署、Provider 资格或发行证据替代本地实现。

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
  - [ ] 销售合并缓存的内存：100 万资产约 33 万个挂牌域名时估计 2 市场约 60–80 MB、8 市场约 170–200 MB；用 100 万基准测峰值 RSS，并考虑以平台索引与状态枚举代替字符串或按行数设上限
  - [ ] 每次写入后的首次销售读取仍需全量合并（10 万 8 市场约 2 s，超出 1 s 预算）：确定该首读是否计入预算，或改为增量维护合并结果
  - [ ] 由用户确认分页读取延迟预算（含 100 万资产目标），确认后才作为阶段 4 V1 验收条件
  - [ ] 100 万资产的全量计数随资产线性增长（约 7 s）：正式规模声明前确定 100 万预算与做法（缓存或增量计数）
- [x] 销售视图模型上限（100,000）与 Host 窗口上限（1,000,000）对齐或改为分页（对齐：`salesListingLimit` 同时约束视图模型与投影，域名超限时投影失败而不截断；Host 行上限按每域名多市场保留） https://github.com/newcodebook/GoodDealer/pull/53
- [x] 销售、续费与 DNS 读取在 100k 规模下改为 Host 侧分页与聚合指标，遵守 DATABASE_SCHEMA 的 keyset/窗口分页规则，不在 Renderer 汇总全部窗口（拆为以下三项，三项完成后勾选） https://github.com/newcodebook/GoodDealer/pull/53
  - [x] 续费：Host 页读取，到期数与自动续费开/关计数由 Host 全量返回，续费台使用 kit `Pagination`；页越界时回到末页，后页读取失败时回到首页 https://github.com/newcodebook/GoodDealer/pull/53
  - [x] DNS 健康：Host 页读取与全量指标（搜索交给 Host） https://github.com/newcodebook/GoodDealer/pull/53
  - [x] 销售：Host 按域名分页（多市场合并在 Host 侧完成）与全量指标（在售数、单一价格规则下的挂牌估值） https://github.com/newcodebook/GoodDealer/pull/53
- [x] DNS 健康与续费只读一页后（销售仍每次全表校验），页外坏行（平台不一致的绑定、非法标签）不再让每次读取失败关闭，但仍计入全量计数；补一次全表完整性检查或在设置/诊断中报告（已改为每次读取全量校验并失败关闭：DNS 对每个有绑定或适用观察的资产复用逐行校验；续费先校验全部可用注册商观察的去重名称，仅在有非法名称时再逐资产解析实际显示的名称；100k 基准下续费约 0.20 s、DNS 约 0.21 s） https://github.com/newcodebook/GoodDealer/pull/53
- [x] 续费 Host 投影校验 `domain_assets.expires_on` 的日期格式并纳入全量校验（该列无 schema CHECK，当前只由 Renderer 逐页校验；页外格式错误但按字符串比较落入窗口的日期会被计入而不被拒绝），或在后续迁移中加 CHECK；若续费精确名称扫描因历史非法名称而常态触发，记录非法名称计数以便发现（已完成：续费计数查询把 `expires_on IS NOT date(expires_on)` 计为异常并让整次读取失败） https://github.com/newcodebook/GoodDealer/pull/53
- [ ] 续费读取因历史非法注册商名称而每次触发逐资产精确扫描时，在设置/诊断中报告非法名称计数，避免静默变慢；同时在设置/诊断中报告并提供修复让读取失败关闭的存储坏行（非法到期日期、平台不一致的绑定等），避免单行坏数据让整页长期不可读；读取侧的全表校验（DNS 绑定、续费名称与到期日期、资产库到期日期）只能在迁移或修复步骤清理完迁移前的旧行之后移除
- [x] 到期日期的 `date()` 往返校验同样用于资产库：资产库每次读取统计全工作区非法到期日期并失败关闭，资产行与域名详情逐行校验 `YYYY-MM-DD` 日历日期（与 `validate_timestamp`、Renderer `z.iso.date()` 同规则）；测试覆盖闰日、2 月 30 日等不可能日期与后缀；100k 基准资产库末页约 0.78 s（新增一次全表扫描，计入 O(N) 预算项） https://github.com/newcodebook/GoodDealer/pull/53
- [x] `domain_assets.expires_on` 写入时校验：存储完整性迁移以插入/更新触发器要求 `NULL` 或 `date()` 原样往返的 `YYYY-MM-DD` 日期（SQLite 不能为已有表追加 CHECK，触发器等效）；迁移前的旧行不改写，资产库与续费读取的全表日期校验保留并继续失败关闭（两侧差异：资产库拒绝全工作区非法日期，续费只拒绝窗口内的） https://github.com/newcodebook/GoodDealer/pull/53
- [x] 分页/搜索读取进行中时，旧页只以 `aria-busy` 标记；按 `brand/ui_kits/desktop` 是否有加载态核实视觉忙碌提示；搜索后读取失败时考虑保留上一视图并内联显示失败，而不是整页替换（kit 的进行中提示是 Settings/Sign-in 中缓慢旋转的弱化 RefreshCw，复用在 Pagination 备注位并尊重减少动效；同一来源的读取失败保留上一结果和搜索框，失败横幅与重试内联在台面上方，换端口或代际不沿用旧值） https://github.com/newcodebook/GoodDealer/pull/53
- [x] 非首页读取失败时 `recoverHostPage` 一律回到第 1 页，使内联失败横幅一闪而过；把回退限定在起点越界，或保留横幅直到用户操作（Renderer 无法区分越界失败，故仍显示上一结果的失败页留在原页并保留横幅，可重试或换页；无可显示结果时才回到第 1 页） https://github.com/newcodebook/GoodDealer/pull/53
- [x] 搜索读取失败后，保留的行与计数属于上一查询而搜索框显示新查询；在失败横幅中经 i18n 说明当前显示的是上一次成功读取的结果（三个分页台面的 `staleResult`，en-US/zh-CN） https://github.com/newcodebook/GoodDealer/pull/53
- [x] 为续费与销售台面补一项翻页读取失败的 DOM 测试，固定 `busy={false}` 与旧页加横幅的状态 https://github.com/newcodebook/GoodDealer/pull/53
- [x] 翻页读取失败后分页器高亮上一结果的页码，再次点击失败页会设回同一页而不读取；失败时点击当前请求页改为重试 https://github.com/newcodebook/GoodDealer/pull/53
- [ ] 分页台面读取失败横幅放在台面头部上方（kit 无台面内错误示例）；在打包构件逐屏对照 `brand/ui_kits/desktop` 时确认或调整该位置
- [x] 销售每次翻页都全表扫描并合并已确认挂牌（100k 域名 × 8 市场时约 80 万行，含已完成运行 `EXISTS` 与窗口函数）：在 100k 规模验证中计时并做 `EXPLAIN QUERY PLAN`，过慢时按读取 generation 缓存合并结果（已计时与检查：3.3 万个双市场域名每页约 0.55 s，查找均走索引；是否缓存并入资产库与销售 O(N) 聚合一项） https://github.com/newcodebook/GoodDealer/pull/53
- [x] 销售页行价格保留首个市场的原始写法（如 `1000.50`），挂牌估值为规范化写法；核实销售台金额格式化后两者显示一致（一致：两者都经 `formatAssetMoney`，销售台测试固定） https://github.com/newcodebook/GoodDealer/pull/53
- [x] `formatAssetMoney` 经 `Number` 转换，超过 15 位有效数字的金额（合同允许 16 位整数加 8 位小数）显示会失真；改为按十进制字符串格式化（`formatMoney` 接受经校验的十进制字符串并原样交给 Intl） https://github.com/newcodebook/GoodDealer/pull/53
- [ ] 精确金额格式化依赖各 Tauri WebView（WebKitGTK、WKWebView、WebView2）支持 ECMA-402 NumberFormat v3 的字符串格式化，不支持时会静默退回双精度舍入；在打包构件中验证或在 VERIFICATION 写明最低 WebView 版本
- [ ] 其余金额显示与求和仍经 `Number`：kit `Money` 组件（资产库目标价、域名详情挂牌价）、资产库本页估值、域名详情利润、批量编辑示例与合计、续费金额、报价中间价；改为十进制字符串格式化与精确求和
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
- [ ] 搜索生效时资产库到期指标标明为工作区范围（与随搜索的其余指标区分）；`EXPIRING_ASSET` 改为带表别名，避免在连接查询中绑定到其他表的同名列（别名部分已完成：`expiring_asset(alias)`；剩余 UI 标明范围）
- [x] 续费、销售、批量、历史、人工任务路由补 generation 过期与重试路径测试 https://github.com/newcodebook/GoodDealer/pull/53
- [ ] 批量计划生成、计划详情读取与逐项确认（随首个批量操作能力资格认证；认证前新建与执行保持不可用）
- [x] 历史页“今日变更”改为 Host 侧计数（当前只统计已加载的最新 500 条）（Renderer 在读取请求中给出本地日的规范 UTC 起止时刻（起含止不含，23–25 小时），Host 校验后与总数同一次扫描计数全账本；同一次读取的各窗口计数须一致） https://github.com/newcodebook/GoodDealer/pull/53
- [ ] 历史页跨过本地午夜后自动重新读取“今日变更”（当前保留上次计数直到重新读取）
- [ ] Outbox 写入时校验 `created_at` 为规范 UTC 时刻（“今日变更”按字符串比较计数，依赖规范格式）
- [x] `local-storage` 业务测试数据库随测试结束删除（原 `tempdir().keep()` 每次运行在临时目录残留上万个目录，耗尽配额；改为 `TestDatabase` 持有目录） https://github.com/newcodebook/GoodDealer/pull/53
- [ ] 历史回滚：撤销计划命令与高风险确认（随首个可撤销操作能力资格认证；认证前回滚与导出保持不可用）
- [ ] 人工任务对账：打开平台、标记完成与重新检查后由 Host 重新观察平台状态完成对账（随对应能力资格认证；认证前保持不可用）
- [x] 人工任务等待时间改用 `manual_action_required` 结果的观察时间，而非尝试开始时间（每项取最新尝试最早的 `manual_action_required` 结果观察时间，结果尚未记录时退回尝试开始时间；任务按其中最早者排序） https://github.com/newcodebook/GoodDealer/pull/53
- [x] 人工任务读取每任务域名样本收窄（当前每任务最多 10,000 个，单窗口载荷过大）（Host 只发送收件箱显示的前 3 个域名（字节序），`domainCount` 仍精确；读取与视图合同共用 `manualTaskDomainSampleLimit` 并拒绝其他样本大小，Desktop 测试固定它与 Host 的 `DOMAIN_LIMIT` 相等；等待起点不早于尝试开始） https://github.com/newcodebook/GoodDealer/pull/53
- [ ] 打包的 Tauri 构件在真实 Host 与种子数据上逐页可达，并与 `brand/ui_kits/desktop` 逐屏对照（当前只有源码与打包依赖图层面的证据）
- [x] 历史与人工任务等显示文本的长度口径在 Rust 与 Zod 之间对齐（核实：Zod 4 的 `max` 按码点计数，与 Rust 字符数一致，无需改动；需要 UTF-16 上限的 Zod 校验须显式比较 `length`） https://github.com/newcodebook/GoodDealer/pull/53
- [x] `client-core` 的 `dnsProviderSummarySchema` 平台集合与 ADR-0027 的 8 个平台对齐或退役（已对齐：`providerKind` 改用唯一的 `launchPlatformKindSchema`，移除 `registrar_dns`/`custom`；注册商自带 DNS 即该注册商平台；补每个首发平台接受与旧值拒绝测试） https://github.com/newcodebook/GoodDealer/pull/53
- [ ] Host 按平台报告支持的角色后，把 DNS 读取契约（`dnsProviderSummarySchema` 与 `dns-health.ts` 的 Zone 绑定）的 `providerKind` 收窄为支持 DNS 的平台（当前 Afternic、Atom 等纯市场平台也被接受为 Zone 托管方）
- [x] Provider 绑定写入时强制绑定平台与连接平台一致（当前只在 DNS 健康读取时拒绝，单行坏数据会让整页不可读）（已完成：存储完整性迁移在写入时拒绝平台不一致的绑定，并禁止已绑定连接改变平台；业务写入路径本就只接受 Cloudflare 连接） https://github.com/newcodebook/GoodDealer/pull/53
- [x] DNS 健康 Rust 测试覆盖“非 Cloudflare 绑定 + 既有 Cloudflare 观察”同时存在的情况 https://github.com/newcodebook/GoodDealer/pull/53
- [x] Standby DNS 读取组合前改写 `readOnlyNotice`（当前暗示修复与重新验证在 Active 中可用）（改为说明 Standby 不做修改，且 DNS 修复与所有权重新验证尚未在任何设备上取得资格；en-US/zh-CN 与测试同步） https://github.com/newcodebook/GoodDealer/pull/53
- [ ] DNS 修复或所有权重新验证在 Cloudflare 阶段取得资格时，同步改写 DNS `readOnlyNotice`（届时说明这些操作只在 Active 设备上执行；Active 上 `canEdit: false` 时也显示只读说明，与续费按 `!canEdit` 判断一致）
- [x] Host 路由读取的重试接线测试：重试按钮已测试会调用 `retry`；`useHostRouteRead` 由 `attempt` 驱动重新读取仍缺 hook 级测试（需要渲染环境）（同一测试：首读失败后点击“重新读取”，从同一页起点重新读取） https://github.com/newcodebook/GoodDealer/pull/53
- [x] DNS 页 DNSSEC 各状态与 en-US 渲染测试（当前只覆盖 zh-CN 的“未知”）（四种状态 en-US 与 zh-CN 均有渲染测试；已观察的 Zone 读取契约必带状态，未观察的行不显示 DNSSEC 标签并有测试） https://github.com/newcodebook/GoodDealer/pull/53
- [ ] `read_cloudflare_connection` 返回的连接标签改用统一标签规则（当前 Host 不校验，适配器允许 256 个单元且只拒绝 C0/DEL；随 `features/connections` 进入生产导航）
- [ ] 注册商委派观察接入后，与 Zone 分配的 nameserver 比对得出委派状态与 NS 异常计数（随注册商能力）

### 3. Cloudflare 路径稳定

- [ ] 引导流程：欢迎 → 设备门 → 连接 Cloudflare（可跳过）→ 从观察结果导入或手动添加 → 完成
- [ ] 资产创建，并对导入和手动添加去重
- [ ] 绑定 UI
- [ ] Grant/Lease 能力门禁接入生产导航
- [ ] 凭据原子撤销，revoke/deactivate 的 Host capability
- [ ] Cloudflare generation/auth fences 从 `features/connections` 进入生产组合
- [ ] 断网、Token 失效、权限不足、撤销后，都失败关闭并给出可恢复提示

### 4. 当前范围全系统 V1 汇合验收

- [ ] 在同一冻结候选上，为 v1 详细垂直验收表的每一行取得新鲜证据
- [ ] 独立复审 PASS

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

- [ ] live PostgreSQL 并发/RLS、容量、崩溃恢复、长时间运行
- [ ] 把 `backup/source.rs` 的快照临时目录改为仅属主可访问（启用生产备份的前提）
