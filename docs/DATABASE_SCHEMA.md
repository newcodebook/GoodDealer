# GoodDealer 数据库设计

## 设计目标

GoodDealer 使用两个职责不同、不能互相替代的数据库：

- Desktop 的 SQLCipher Active Workspace 是业务实体、业务事务、Provider 观察、操作结果和历史的
  唯一运行权威。
- Cloud PostgreSQL 是 GoodDealer 账号与商业控制面的权威，并保存允许字段的同步/恢复副本和复制
  协调状态。Cloud 副本不成为 Desktop Repository。

一个活动 SQLCipher 文件只绑定一个 `workspace_id`，所有根表通过外键结构性绑定该单例。未来团队或多工作区能力需要新的产品决定和
租户模型，但不能改变“每个 Desktop 业务命令先提交本地事务”的原则。

## 通用字段规则

字段和 wire 命名必须遵守 [数据库命名规范](./DATABASE_NAMING_CONVENTIONS.md)。

| 类型 | 规则 |
| --- | --- |
| ID | 通用 wire ID 使用 1–160 字节可打印 ASCII；数据库复合键始终包含 `workspace_id`。 |
| 域名 | DomainAsset 的 `entity_id` 本身就是 3–253 字节、全小写的 canonical IDNA ASCII 域名；不维护无法经同步恢复的第二域名身份列。 |
| 金额 | 使用三位大写币种和规范十进制字符串，禁止浮点持久化。 |
| 时间 | wire 使用秒级 UTC RFC 3339；SQLite 使用同一规范 TEXT，PostgreSQL 使用 `timestamptz`。 |
| Boolean | SQLite 使用受 CHECK 约束的 0/1；PostgreSQL 使用 boolean。 |
| JSON | 只用于有界、严格验证的复合值或不可变事件载荷；参与筛选、关联和生命周期的值必须列化。 |
| Revision | 使用 0–`Number.MAX_SAFE_INTEGER`；Cloud `server_revision` 与本地 `local_commit_sequence` 分离。 |
| 删除 | 业务行使用明确生命周期和 `deleted_at`；同步使用独立墓碑，空副本永不表示删除。 |
| 秘密 | Provider 账号身份和密封凭据只在本地表；任何 Cloud 表、Mutation 或审计均不得含这些字段。 |

SQLite 打开后强制 `foreign_keys`、`recursive_triggers`、`trusted_schema=OFF` 和有界 busy timeout。
所有本地表使用 `STRICT`。设计开发阶段由单一 Active Workspace schema 快照定义最终 DDL，
Migration 使用 ID、Owner、checksum 和事务应用；首次生产发布后再切换为只追加迁移。

## 本地 SQLCipher 模型

### 工作区和版本

`active_workspace_metadata` 保存单一工作区、schema version、`applied_through_server_revision`、
`local_commit_sequence`、下一 `device_mutation_sequence`、复制/Provider/备份时间。已应用 Cloud
前缀不能替代本地提交序列。单例的 workspace identity、storage domain 和
schema version 由触发器终身冻结；即使数据库尚无业务子行，也不能删除后绑定到另一 workspace。

### Portfolio 和 DomainAsset

| 表 | 职责 |
| --- | --- |
| `portfolios` | 本地资产分组、排序和软删除。 |
| `domain_assets` | canonical 域名身份（即 `entity_id`）、生命周期、取得/到期、成本、续费和 Registrar Lock。 |
| `domain_asset_desired_state` | 用户意图：Portfolio、备注、目标价格、销售状态和目标 Nameserver。 |
| `domain_asset_tags` | 可索引、唯一的标签关系。 |
| `domain_asset_field_versions` | 每字段最后 Cloud revision、本地提交序列和复制状态。 |
| `portfolio_domain_assets` | 当前窄 Query 的本地物化投影；不是第二业务权威，写事务必须与上述表同步更新。 |

Desired State 与 Observed State 永远分离。Provider 观察不能直接覆盖用户意图；需要合并时由领域
策略比较字段版本，无法自动判断的值进入 `sync_conflicts`。

### Provider 连接和观察

| 表 | 职责 | 是否允许同步 |
| --- | --- | --- |
| `local_provider_connections` | Provider 类型、账号别名、Provider Account ID、能力和连接生命周期。 | 否 |
| `provider_credential_versions` | 密封凭据字节的唯一持久化位置，并保存 seal/key 版本、轮换/吊销和验证状态。 | 否 |
| `provider_observation_runs` | 一次本地 Provider 读取的状态、`observation_capability`、Connector 版本和错误。 | 否；含本地连接 FK |
| `provider_observation_targets` | 每次读取的逐资产 requested/succeeded/failed/missing 结果，用于部分失败和有界重试。 | 否；含本地运行 FK |
| `registrar_observations` | Registrar、注册/到期、续费、锁定和置信状态。 | 仅显式脱敏字段 |
| `dns_zone_observations` | Zone、NS、DNSSEC、Provider 修改时间和证据状态。 | 仅显式脱敏字段 |
| `dns_record_observations` | 规范化 DNS RR 观察。 | 仅显式脱敏字段 |
| `marketplace_listing_observations` | 市场状态和价格观察，不保存第三方账号身份。 | 仅显式脱敏字段 |
| `asset_valuation_observations` | 手工、Provider 或可比交易估值。 | 仅显式脱敏字段 |

任何可同步观察都必须从本地观察重新构造为无连接 ID、无账号别名、无 Provider Account ID、无秘密
的值对象；不得直接序列化本地观察行。

### Plan、Operation、Result 和 History

| 表 | 职责 |
| --- | --- |
| `operation_plans` | 经用户审阅的不可变意图摘要、规范哈希、风险和批准生命周期。 |
| `operation_plan_items` | 每个目标、字段差异、前置条件、能力和执行模式。 |
| `operations` | 一次获准执行的幂等实例和总体阶段。 |
| `operation_attempts` | 每项每次尝试、请求 digest、重试和 `outcome_unknown`。 |
| `operation_results` | 版本化结果和证据 digest；不得把未知结果当失败后自动重试。 |
| `business_history_events` | 本地 append-only 业务历史，按 aggregate 和 sequence 查询。 |

表结构覆盖只读观察、未来受限写入、批量计划、部分失败、人工处理、远端等待、未知结果和回滚；
数据库存在不授予 Provider 写入能力，执行仍需独立 capability、授权、条款和运行资格。
Operation 只能引用已批准且未过期的 Plan；批准后的 Plan 内容和 Item 不可改删；Attempt 必须引用
该 Plan 的真实 Item，Result 必须引用具体 Attempt；History 由触发器保证 append-only。
Plan 获批时 item 数量和连续 ordinal 必须与冻结集合一致；included automatic Item 必须绑定真实
DomainAsset 与本地 Provider connection。直接 INSERT approved Plan 被拒绝，必须经验证过的状态转换。
Attempt 仅能在前一次 `failed_retryable` Attempt 已存在匹配 Result 证据后连续重试；`outcome_unknown`
阻断自动重试；完成的 Attempt、Result、Provider run/target/observation 证据均不可改写。观察证据只在
DomainAsset 已满足 `purge_eligible` tombstone 和保留期限时随实体级联清理，不能单独删除。各类观察
只能引用 connection 明确声明且类型匹配的 `observation_capability`（`registrar | dns | marketplace |
valuation`），Provider 估值也必须绑定对应 run；run 汇总必须与逐目标结果和观察证据一致。

### 同步、冲突、删除和恢复

| 表 | 职责 |
| --- | --- |
| `sync_outbox` | 本地提交后待上传 Mutation 的因果、重试、ACK 和 rejection 状态。 |
| `sync_outbox_fields` | 严格字段白名单、规范值和 digest。 |
| `sync_inbox` | 按连续 `server_revision` 接收、验证和原子应用下行 Mutation。 |
| `sync_conflicts` | 本地值、远端候选、两个版本和显式解决状态。 |
| `sync_tombstones` | 显式删除、ACK、复制和延迟清理。 |
| `sync_reader_state` | 设备 cursor generation、checkpoint 和 rebootstrap 状态。 |
| `local_backup_catalog` | 本地备份 manifest、覆盖 revision、crypto profile、验证状态、保留期和清理期限。 |

本地业务写入、字段版本和 Outbox 必须在一个 `IMMEDIATE` 事务中提交。ACK 只改变复制状态。Inbox
应用不得生成回声 Outbox。墓碑在所有保留设备和恢复窗口安全越过删除 revision 前不得清理。
同步记录使用 `mutation_payload_json + mutation_payload_sha256`，字段行使用
`field_value_json + field_value_sha256`；本地历史使用 `event_payload_json + event_payload_sha256`，
不得用裸 `payload` 或把普通 SHA-256 冒充协议 digest。
同步 wire 和 Cloud mutation log 已区分 upsert 与显式 delete；delete 必须带规范删除时间且不能伪造
changed fields。端到端 tombstone materializer 上线前，Cloud ingest 对 delete 保持 fail-closed 拒绝。
本地 Inbox 只有在同一 entity/revision 的墓碑已存在时才能把 delete 标记为 applied。备份 manifest
digest 统一使用 43 字符无填充 base64url SHA-256；storage locator digest 是独立的本地索引值。

## Cloud PostgreSQL 模型

Cloud 的身份、会话、商业授权、设备、Lease/Epoch、Job 和服务器审计表继续由各自控制面模块拥有。
业务副本最终表统一使用 `workspace_replica_*` 命名：

- `workspace_replica_domain_assets`
- `workspace_replica_portfolio_state`
- `workspace_replica_portfolios`
- `workspace_replica_observations`
- `workspace_replica_dns_records`
- `workspace_replica_operation_summaries`
- `workspace_replica_business_events`
- `workspace_replica_tombstones`

所有副本表使用 `account_id + workspace_id`、强制 RLS、FK、revision/digest 和显式删除。Cloud 只保存
操作摘要，不保存本地 Plan 的第三方账号、连接或秘密内容；观察副本只保存
`observation_origin + observation_capability + provider_kind`，不保存具体本地连接身份。

普通 Cloud application role 目前只对已实现的 DomainAsset/Portfolio State materializer 拥有列级
`SELECT/INSERT/UPDATE`：仅当前四个同步字段、对应 server revision 和投影状态可写；生命周期、materialization
等未来列不可写，也不拥有硬删除权限。其余未来副本族只有 `SELECT`。只有在严格 wire schema、
owner materializer、secret-canary、墓碑和恢复测试一起落地后，才允许扩大对应表的 DML。

Cloud Mutation receipt/log/field、Cursor、Checkpoint 和 Restore Candidate 是复制协调权威。它们
描述副本顺序与恢复证据，不拥有本地业务事务。DomainAsset 在 Mutation、Checkpoint、Recovery 和
Replica 中统一使用 3–253 字节 canonical domain ID。Restore Candidate 的证据列对 application role
不可更新，只有 `status/row_version/updated_at` 生命周期列可按数据库状态图和 `row_version + 1` CAS 更新；
Checkpoint 同样由数据库强制 `building → verified → available → superseded` 或 invalid 路径及
`row_version + 1`。JSON 证据在数据库层有形状和 1 MiB 上限，checkpoint tags 在数据库层也必须
满足长度、去重和 UTF-8 严格升序。

`workspace_revisions` 必须从 0 建立；head 只能越过已持久化的连续 Mutation 区间，且 deferred
constraint 会在事务提交时拒绝仍领先于 head 的 Mutation 和孤立 Receipt。application role 不拥有
`compacted_through_server_revision` 列更新或 Mutation `DELETE` 权限；只能调用受限 compaction 函数。该函数在
数据库内重新验证完整 replay chain、available Checkpoint、Device/Reader Cursor、Checkpoint Pin 和
未解决 Recovery comparison，先原子推进 watermark，随后才允许删除该 watermark 以内的 replay
行；Receipt 和 Drain 证据永久保留。Checkpoint DomainAsset 以每 512 行一个稳定
`pNNNN` range partition 保存，最多 4096 个 digest 分区，可表示超过 100 万资产；空快照使用独立
`empty` digest。Recovery 预留带 page/range/count/encoded-bytes/digest 的 page 目录，当前旧式单次
request 路径不因此获得批量运行资格。

Cloud 业务副本由集中 M002 直接创建最终表；生产 PostgreSQL 资格版本为 18.6。

## 当前落地与运行链路边界

集中 schema 已覆盖未来实体、约束、索引、同步状态和恢复元数据，但 schema coverage 不等于旅程已
上线。当前 DomainAsset 本地写入和窄副本读取已存在；以下仍是 runtime 实现任务：新实体
首次 Cloud ingest、字段级 Inbox/conflict materializer、ACK revision settlement、delete ingest 与端到端墓碑、
Portfolio/观察/Operation 副本 writer、完整本地备份恢复、全副本 checkpoint，以及 10 万/100 万
资产 keyset/page composition。在这些验收完成前，不得把对应旅程描述为可用。

`note` 是明确允许同步的用户业务内容；Provider 账号行、连接身份和凭据版本绝不能被序列化到
`note` 或任何 Mutation。系统使用实体级严格 schema 防止字段走私，但不会声称可以可靠识别用户
主动粘贴到自由文本中的任意秘密值；若产品要求此类内容也绝不出端，需要单独的 local-only note
字段或明确的 DLP 产品策略。

## 查询与规模策略

- Domain、状态、到期、更新时间、标签和开放冲突均有覆盖索引。
- Operation 按 phase/time，History 按 aggregate/sequence，观察按 entity/kind/time、connection/time
  和逐目标状态查询；Backup 具有 retention/purge 访问路径。
- 列表 Query 必须使用 keyset/window 分页；当前窄 Portfolio 全量 Query 仅适用于现有最小纵向，
  不得用于十万级资产。
- Checkpoint 使用 512 行稳定 range partition；Backup、Diff 和 Restore Candidate 协议提供最多
  1024 条、4 MiB 的 page envelope，Manifest 最多绑定 256 个有序 section。旧式单次数组仍只用于
  当前窄路径，规模化实现必须使用 page/cursor，不能提高单次内存上限代替分页。
- 正式规模声明需要 1 万、10 万和 100 万资产基准，以及 Outbox 积压、冲突和恢复故障测试。

## 演进规则

1. 设计开发阶段修改集中 schema 快照和固定 checksum；首次生产发布后既有 Migration 不重写，
   只追加拥有模块的有序 Migration。
2. 新字段默认本地权威且禁止同步，只有协议白名单、secret-canary、Cloud 副本和恢复测试同时存在
   才能进入同步。
3. 新 Provider 字段先判断是否含账号或凭据身份；这些字段无论是否看似非秘密都只留本地。
4. 新外部副作用先建立 Plan/Attempt/Result/History 和失败语义，再实现执行器。
5. 每次 schema 变更同步更新精确 manifest、合同、测试、当前文档和规模索引。
