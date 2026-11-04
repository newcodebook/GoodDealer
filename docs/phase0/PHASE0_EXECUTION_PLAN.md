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
- [ ] 设置读取（Rust 与 Zod）接受 ADR-0027 的 8 个平台，须在首个非 Cloudflare 连接写入之前完成（当前非 Cloudflare 连接会使整个设置读取失败关闭）
- [x] 销售页同一域名多市场合并为一行（与 brand 一致），而非每市场一行 https://github.com/newcodebook/GoodDealer/pull/53
- [ ] 销售页“冲突”状态说明为市场间状态不一致，与同步冲突中心区分（文案或提示）
- [x] 销售读取的最新观察需确认所属运行已完成，避免未完成运行遮蔽已确认挂牌 https://github.com/newcodebook/GoodDealer/pull/53
- [ ] 续费、资产库与域名详情的观察读取（最近注册商、在售计数）与销售读取共用“已完成运行且目标成功”的规则（当前取最新可用观察，不论运行是否完成；补 partial 包含与 failed 排除的测试）
- [x] 销售视图模型上限（100,000）与 Host 窗口上限（1,000,000）对齐或改为分页（对齐：`salesListingLimit` 同时约束视图模型与投影，域名超限时投影失败而不截断；Host 行上限按每域名多市场保留） https://github.com/newcodebook/GoodDealer/pull/53
- [ ] 销售、续费与 DNS 读取在 100k 规模下改为 Host 侧分页与聚合指标，遵守 DATABASE_SCHEMA 的 keyset/窗口分页规则，不在 Renderer 汇总全部窗口
- [ ] 销售域名超限在分页前改为提前停止读取（读到超过上限的不同域名即失败），并以“超出本视图容量”文案替代可重试的读取失败
- [x] 续费与资产库到期计数排除已售（sold）资产，或在续费页展示生命周期（排除：已售、已放弃与已归档资产不再需要续费，续费列表与资产库计数共用同一 Host 谓词） https://github.com/newcodebook/GoodDealer/pull/53
- [ ] 资产库行与域名详情的“即将到期”高亮改用 Host 的同一到期谓词与日期（当前只按 Renderer 日期判断，已售、已放弃、已归档与已过期资产仍会高亮）
- [x] 续费页自动续费覆盖指标区分“未记录”与“已关闭”（覆盖值仍为已开启/全部，指标说明行分别列出已关闭与未记录数量；英文文案更正为 coverage） https://github.com/newcodebook/GoodDealer/pull/53
- [ ] 续费页自动续费覆盖值使用 `formatNumber`，并补 en-US 的“Off / Not recorded”断言
- [ ] 注册商名称校验在 Rust（字符数、控制字符）与 Zod（UTF-16 长度、格式字符）之间对齐
- [ ] 资产库到期计数在搜索过滤下与续费页列表口径一致
- [x] 续费、销售、批量、历史、人工任务路由补 generation 过期与重试路径测试 https://github.com/newcodebook/GoodDealer/pull/53
- [ ] 批量计划生成、计划详情读取与逐项确认（随首个批量操作能力资格认证；认证前新建与执行保持不可用）
- [ ] 历史页“今日变更”改为 Host 侧计数（当前只统计已加载的最新 500 条）
- [ ] 历史回滚：撤销计划命令与高风险确认（随首个可撤销操作能力资格认证；认证前回滚与导出保持不可用）
- [ ] 人工任务对账：打开平台、标记完成与重新检查后由 Host 重新观察平台状态完成对账（随对应能力资格认证；认证前保持不可用）
- [ ] 人工任务等待时间改用 `manual_action_required` 结果的观察时间，而非尝试开始时间
- [ ] 人工任务读取每任务域名样本收窄（当前每任务最多 10,000 个，单窗口载荷过大）
- [ ] 打包的 Tauri 构件在真实 Host 与种子数据上逐页可达，并与 `brand/ui_kits/desktop` 逐屏对照（当前只有源码与打包依赖图层面的证据）
- [x] 历史与人工任务等显示文本的长度口径在 Rust 与 Zod 之间对齐（核实：Zod 4 的 `max` 按码点计数，与 Rust 字符数一致，无需改动；需要 UTF-16 上限的 Zod 校验须显式比较 `length`） https://github.com/newcodebook/GoodDealer/pull/53
- [ ] `client-core` 的 `dnsProviderSummarySchema` 平台集合与 ADR-0027 的 8 个平台对齐或退役
- [ ] Provider 绑定写入时强制绑定平台与连接平台一致（当前只在 DNS 健康读取时拒绝，单行坏数据会让整页不可读）
- [ ] DNS 健康 Rust 测试覆盖“非 Cloudflare 绑定 + 既有 Cloudflare 观察”同时存在的情况
- [ ] Standby DNS 读取组合前改写 `readOnlyNotice`（当前暗示修复与重新验证在 Active 中可用）
- [ ] Host 路由读取的重试接线测试：重试按钮已测试会调用 `retry`；`useHostRouteRead` 由 `attempt` 驱动重新读取仍缺 hook 级测试（需要渲染环境）
- [ ] DNS 页 DNSSEC 各状态与 en-US 渲染测试（当前只覆盖 zh-CN 的“未知”）
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
