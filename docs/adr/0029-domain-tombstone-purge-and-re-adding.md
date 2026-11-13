# ADR-0029：已删除域名的重新添加与实体 generation

状态：Proposed — 待产品负责人确认；未实现，删除的域名目前不能重新添加。扩展
[ADR-0004](0004-cloud-business-data-sync.md) 与 [ADR-0019](0019-complete-local-business-schema-and-cloud-replica-model.md)。

## 背景

DomainAsset 以规范小写 IDNA ASCII 域名作为 `entity_id`（ADR-0019），删除是带删除时间的显式 mutation，
本地写入 `deleted_at` 与 `sync_tombstones`。当前代码中：

- **Cloud 已有的部分**：`workspace_mutations.operation_kind` 允许 `delete` 且要求 `deleted_at`，仓储能
  持久化与读出 delete mutation，`workspace_replica_tombstones` 表已建（每实体一行，记录
  `deleted_server_revision`）。
- **Cloud 缺失的部分**：
  - ingest 的 wire 解析遇到任何 `operationKind === "delete"` 即拒绝整个请求（`mutations/index.ts`）；
  - 没有把 delete 物化到 `workspace_replica_tombstones` 的路径；
  - checkpoint 重建遇到 delete 时直接移除该行而不留墓碑（`checkpoints/postgres-service.ts`）；
  - ingest 对副本中不存在的实体返回 `MUTATION_ENTITY_UNKNOWN`，所以本地新增的域名同样无法同步到
    Cloud——首次添加的 ingest 也尚未交付。
- **本地**：没有路径把墓碑置为 `purge_eligible` 或删除墓碑；创建对带 `deleted_at` 的行一律拒绝；
  `sync_outbox_local_creations` 的触发器只允许标记实体的首个本地 upsert，且检查不含 `entity_kind`；
  备份恢复的 `reject_candidate_tombstone_conflicts` 只依赖墓碑或 `deleted_at` 行。
- [DATABASE_SCHEMA](../DATABASE_SCHEMA.md) 规定：端到端墓碑 materializer 上线前，Cloud ingest 对 delete
  失败关闭；墓碑在所有保留设备与恢复窗口越过删除 revision 前不得清理。

“删除后再添加”改变 Cloud 同步合同与 wire 格式，因此需要本 ADR。

## 决策（提议）

### 1. 实体 generation

每个 DomainAsset 带一个**实体 generation**（正整数）。首次添加为 1；删除不改变 generation（墓碑记录被
删除的那一代）；重新添加为墓碑 generation + 1。generation 只增不减。

- **Cloud**：`workspace_replica_domain_assets` 与 `workspace_replica_tombstones` 各增加 `entity_generation`。
  任一时刻每个实体至多一行：活跃行或墓碑行，generation 标记始终在现存的那一行里，不需要单独的历史表。
- **本地**：`domain_assets` 与 `sync_tombstones` 各增加 `entity_generation`，规则相同。
- **wire**：每条 DomainAsset mutation 带 `entityGeneration`；重新添加另带 `reAddsDeletedRevision`
  （被取代的墓碑的删除 revision R）。同步 schema version 升级；旧版本请求按版本不匹配拒绝。
  checkpoint、rebootstrap 快照与 Inbox 下行都携带 generation 与墓碑。
- 迁移：现有行与墓碑的 generation 为 1。

### 2. 前置：端到端添加与删除

在任何重新添加路径之前，先交付（可作为独立任务）：

- **首次添加 ingest**：对副本中既无活跃行也无墓碑的实体，`entityGeneration = 1` 的 upsert 创建活跃行，
  未提供的字段取默认值。
- **删除 ingest 与物化**：`entityGeneration` 等于活跃行 generation 的 delete，在 ingest 事务内删除活跃
  行并写入同一 generation 的墓碑行；checkpoint 重建同样把 delete 物化为墓碑而不是移除行；Inbox 下行
  时本地写入同一 entity/revision/generation 的墓碑。

### 3. 经同步的重新添加

重新添加是一条带 `reAddsDeletedRevision` 的 upsert。

- **Cloud 接受条件**（全部在 ingest 现有的工作区 head 锁事务内检查与写入，一次提交或全部回滚）：
  1. 该实体当前是墓碑行，generation 为 g，删除 revision 为 R；
  2. `reAddsDeletedRevision = R` 且 `entityGeneration = g + 1`；
  3. `R <= baseServerRevision <= head`。

  否则以 `MUTATION_GENERATION_MISMATCH` 拒绝。接受时，在同一事务中删除墓碑行、插入 generation g + 1 的
  活跃行（所有字段只来自本次 upsert，未提供的取默认值，旧字段不复活）、把该实体所有字段 revision 置为
  本次分配的 revision、写入 mutation log 与回执。重复提交按现有回执返回精确重复，不会分配第二个
  generation。
- **为什么 `R <= base` 足够**：Inbox 按 revision 顺序应用，设备观察到的 head ≥ R 就意味着已应用这次删除；
  条件 1 又要求 Cloud 当前状态就是这块墓碑，所以“删除后已重新添加、又再删除”的情况会因 R 或 g 不同而
  被拒绝，不会出现 ABA。`reAddsDeletedRevision` 让 Cloud 精确比对设备引用的是哪一块墓碑。
- **普通 upsert 与 delete** 也必须 `entityGeneration` 等于活跃行 generation，否则拒绝。因此任何属于更早
  一代的 mutation（包括前任 Active 设备未同步的写入）都会被拒绝，这独立于 Lease epoch 栅栏。
- **单活跃设备**（[ADR-0005](0005-single-active-device-and-continuity.md)）只减少合法写入者，不是安全依据；
  安全来自上述事务内条件与 generation 比较。

### 4. 本地前提与本地写入

- **前提**：本地墓碑的 `state` 为 `acknowledged` 或 `replicated` 且 `deleted_server_revision = R`
  （本设备删除经 ACK，或经 Inbox 应用）。本地删除未经 Cloud 确认时不能重新添加。Outbox 按序排空，删除
  已 ACK 意味着该实体更早的 Outbox 行也都已 ACK，不存在属于上一代的待发送 mutation。
- **写入**：在一个事务内把已删除行重置为 generation g + 1 的新行（清空 `deleted_at` 与全部字段，只写入
  本次提供的字段），写入 Outbox 行（带 `entityGeneration` 与 `reAddsDeletedRevision`）及其创建标记。
  g + 1 在 ACK 前是**暂定**的：generation g 的墓碑行保留，并记录指向该 Outbox 行的暂定重新添加；收到
  该 mutation 的 ACK 时才在同一事务中删除墓碑行，g + 1 成为已确认 generation。
- **被拒绝的重新添加**：Cloud 拒绝该 mutation（generation 不符、版本不匹配或其他原因）时，在一个事务中
  撤回暂定的 g + 1——活跃行恢复为 generation g 的已删除行，丢弃该 Outbox 行与创建标记——本地回到
  Cloud 的墓碑状态；无法撤回时按 rebootstrap 处理，以 Cloud 状态为准。暂定期间 Inbox 或快照带来的
  generation g 墓碑与本地已确认状态一致，只确认该墓碑行，不被第 5 条拒绝，也不覆盖暂定的 g + 1 行
  与其 Outbox 项——后者仍由 ACK 或拒绝决定。
- **创建标记触发器**改为：标记的 upsert 必须是同一 `(entity_kind, entity_id)` 在最近一条 delete 之后的
  首个 Outbox 行（无 delete 时即首个 Outbox 行）。标记不可修改，重放同一 mutation 不会产生第二个标记。
  操作历史因此把重新添加显示为“添加资产”。

### 5. 所有入口都按 generation 拒绝旧数据

以下入口在写入前比较 generation，比较对象只是本地**已确认**的 generation（已 ACK 或经 Inbox 应用的
活跃行或墓碑，不含第 4 条的暂定 g + 1）：候选数据的 generation 小于它，或等于已确认墓碑的
generation 且不是该墓碑本身，一律拒绝：

- 隔离备份候选与完整恢复（取代 `reject_candidate_tombstone_conflicts` 仅凭墓碑/`deleted_at` 的判断；
  不含 generation 的旧格式备份按 generation 1 处理）；
- rebootstrap 与 checkpoint 快照应用；
- Inbox mutation 应用；
- 客户端与 Cloud 的 checkpoint 重建；
- Standby 晋升为 Active 时的连续性恢复。

### 6. 墓碑清除推迟

墓碑清除（存储回收）不是重新添加的前提。只有 Cloud 能给出每台保留设备与恢复窗口都越过删除
revision 的水位后才能定义，另立 ADR；该 ADR 必须在删除墓碑行后仍保留该实体的 generation 下限，否则
第 5 条的防护会出现缺口。

## 备选方案

- **先清除墓碑再允许重新创建**：需要 Cloud 侧的保留设备水位与恢复窗口判定，而目前两者都不存在；
  且清除后若不保留 generation，旧备份可复活旧字段。不采用。
- **不引入 generation，只凭墓碑判断**：重新添加后墓碑消失，删除前的备份与旧 mutation 无从识别。不采用。
- **用 Cloud revision 充当 generation**：设备在 ACK 前不知道分配的 revision，本地重新添加与恢复防护无法
  在离线时确定。不采用。
- **给重新添加的域名分配新身份**：与 ADR-0019“域名即 `entity_id`、不保留第二身份列”冲突。不采用。

## 待产品负责人确认

- 是否接受“经同步的重新添加”与“旧字段不复活”的语义，以及引入实体 generation 与 wire 字段。
- 首次添加 ingest 与端到端删除（第 2 条）作为阶段 3 的前置任务追加到执行台账（推荐）。

## 后果与验收

接受后，执行台账中的对应项拆为：

1. 首次添加 ingest；
2. 删除 ingest、Cloud 墓碑物化、重建与 Inbox 的删除物化；
3. generation 的 Cloud/本地迁移与 wire 版本；
4. 经同步的重新添加（Cloud 合同、本地写入与触发器、Host 创建路径）；
5. 第 5 条所有入口的 generation 防护；
6. 界面把“目前不能重新添加”改为说明何时可以重新添加。

负向测试至少覆盖：本地删除未经 Cloud 确认；`reAddsDeletedRevision` 或 `entityGeneration` 不符；
`baseServerRevision < R`；实体当前不是墓碑；同一重新添加并发提交两次只分配一个 generation；Standby
写入；跨租户；重新添加后恢复删除前的备份；前任 Active 设备的旧 mutation；旧 generation 的 Inbox 与
checkpoint 数据；重新添加被 Cloud 拒绝后撤回暂定 generation，随后应用 Cloud 快照与墓碑。墓碑清除另立任务。

完成条件：上述测试全部通过，且 PostgreSQL 资格证据覆盖新增的 ingest 路径；在此之前生产入口不存在
重新添加的可执行路径。
