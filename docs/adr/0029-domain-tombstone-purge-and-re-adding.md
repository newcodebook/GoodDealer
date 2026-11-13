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
  - checkpoint 重建遇到 delete 时直接移除该行而不留墓碑（`checkpoints/postgres-service.ts`）。
- **首次添加**已交付：副本中既无活跃行也无墓碑的实体，其首个 upsert 创建默认活跃行；当前状态为墓碑的
  实体仍以 `MUTATION_ENTITY_UNKNOWN` 拒绝。
- **本地**：Inbox 收到 delete 时已写入同一 entity/revision 的墓碑（`state='replicated'`；有待发送字段时
  `barrier_state='contested'`）；没有路径把墓碑置为 `purge_eligible` 或删除墓碑；创建对带 `deleted_at` 的行一律拒绝；
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

- **首次添加 ingest**（已交付，见背景）：引入 generation 后，其 `entityGeneration` 必须为 1。
- **删除 ingest 与物化**：`entityGeneration` 等于活跃行 generation 的 delete，在 ingest 事务内删除活跃
  行并写入同一 generation 的墓碑行；checkpoint 重建同样把 delete 物化为墓碑而不是移除行；本地 Inbox 已写入的墓碑
  补上 generation。

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

- **前提**（全部在写入事务内检查，任一不满足即以独立错误码拒绝，界面引导先到冲突中心处理）：
  1. 本地墓碑 `state` 为 `acknowledged` 或 `replicated`，`deleted_server_revision = R`（本设备删除经
     ACK，或经 Inbox 应用）；本地删除未经 Cloud 确认时不能重新添加；
  2. 墓碑 barrier 已收敛：`barrier_state` 不是 `contested`；为 `pending` 时要求 `state='acknowledged'`。
     现有代码中本设备删除写入 `state='pending'`、`barrier_state='pending'`，ACK 只把 `state` 改为
     `acknowledged` 而不推进 `barrier_state`，所以本设备已 ACK 的删除停在 `acknowledged`/`pending`，属于
     已收敛；Inbox 在本地仍有待发送字段时写入的 `state='replicated'`、`barrier_state='contested'` 墓碑不
     满足，接受远端删除后才变为 `replicated`/`replicated`；
  3. 资产行已物化为删除状态（`deleted_at` 非空）；
  4. 该实体没有未结束的 Outbox 行（`pending`/`sending`），也没有开放的冲突候选。被拒绝的重新添加
     （`conflicted`）本身不产生冲突候选，所以不阻止修正后的再次尝试。

  不能只凭“删除已 ACK”推出没有上一代的待发送写入：该论证只覆盖本设备的删除，经 Inbox 收到的删除可以
  与本地待发送编辑和冲突候选并存，所以第 2–4 项必须显式检查。
- **写入**：在一个事务内把已删除行重置为 generation g + 1 的新行（清空 `deleted_at` 与全部字段，只写入
  本次提供的字段），写入 Outbox 行（带 `entityGeneration` 与 `reAddsDeletedRevision`）及其创建标记。
  g + 1 在 ACK 前是**暂定**的：generation g 的墓碑行保留，并记录指向该 Outbox 行的暂定重新添加；收到
  该 mutation 的 ACK 时才在同一事务中删除墓碑行，g + 1 成为已确认 generation。
- **暂定期间冻结该实体**：从写入重新添加到它被 ACK 或拒绝之前，本地对该 `(entity_kind, entity_id)` 的
  任何写入（编辑、删除、再次重新添加，以及冲突中心对该实体的裁决写入）都在写入事务中拒绝，返回独立的错误码；界面把该域名显示为
  “正在同步重新添加”，不提供编辑与删除入口。因此暂定的 g + 1 之后不会有依赖它的 Outbox 行，撤回只
  涉及这一行。其他实体不受影响。选择冻结而不是定义依赖 mutation 的级联撤回，是因为后者需要逐条区分
  已发送、已拒绝与未发送的后续行，复杂度远超“稍后再编辑”的代价。
- **被拒绝的重新添加**：Cloud 拒绝该 mutation（generation 不符、版本不匹配或其他确定性原因）时，业务
  撤回与序列处理分开：
  - **业务撤回**：在一个事务中撤回暂定的 g + 1——活跃行恢复为 generation g 的已删除行，删除暂定记录，
    解除冻结——本地回到 Cloud 的墓碑状态。无法撤回时按 rebootstrap 处理，以 Cloud 状态为准。
  - **Outbox 证据**：Outbox 行与其字段、创建标记都不删除（`sync_outbox_fields_v2_immutable_delete`
    禁止删除已认领行的字段），而是经现有的 `reject_sync_batch_v2` 路径终止：`MUTATION_GENERATION_MISMATCH` 映射为
    `SYNC_MUTATION_CONFLICT`，行为 `conflicted` 且 `last_error_code='sync_mutation_conflict'`（与 ADR-0030
    计入 drain 的行一致）；输入或 schema 拒绝为 `rejected`。作为操作历史与审计证据；创建标记仍指向这条已终止的行，界面把它显示为“重新添加被拒绝”。
  - **序列**：被拒绝的行占用了一个 `device_mutation_sequence`，Cloud 从未收到它，而 drain 验证要求
    Cloud 的连续接收水位等于租约的最后分配序列且没有缺口，否则 `DRAIN_STREAM_GAP`。这不是重新添加
    特有的问题：任何确定性拒绝都会留下同样的缺口。被拒绝序列如何结束由
    [ADR-0030](0030-closing-deterministically-rejected-mutation-sequences.md) 提议（Cloud 拒绝回执计入 drain
    水位），重新添加以它为前置，不另造跳过协议。
  暂定期间 Inbox 或快照带来的 generation g 墓碑与本地已确认状态一致，只确认该墓碑行，不被第 5 条
  拒绝，也不覆盖暂定的 g + 1 行与其 Outbox 项——后者仍由 ACK 或拒绝决定。
- **创建标记触发器**改为不依赖本地是否有 delete 的 Outbox 行（删除可能发生在另一台设备，本设备只经
  Inbox 收到墓碑，随后才晋升为 Active）。标记的 upsert 必须满足以下之一：
  - 首次添加：在本 mutation 的 `local_commit_sequence` 之前没有已提交的活跃行或墓碑（创建路径在同一
    事务中先写入资产行、后写入标记，所以不能以“当前没有活跃行”判断），没有更早的 Outbox 行，且
    `entityGeneration = 1`（实现时须核对经 Inbox 应用的行如何写入可比较的 `local_commit_sequence`）；
  - 重新添加：该实体本地**已确认**状态是 generation g、删除 revision R 的墓碑（来源是本设备删除的
    ACK 或 Inbox 应用，二者等价），该 Outbox 行带 `entityGeneration = g + 1` 与
    `reAddsDeletedRevision = R`，且该实体没有其他未结束（`pending`/`sending`）的 Outbox 行。
  **generation 与创建尝试分开**：同一 generation g + 1 可以有多次已终止（`rejected`/`conflicted`）的
  尝试，每次尝试是一条独立的 Outbox 行与创建标记；标记沿用现有以 `mutation_id` 为键的表，不以
  generation 为键，不可修改，重放同一 mutation 不会产生第二个标记。限制只有一条：同一实体至多一个
  未结束的重新添加（与暂定期间的冻结一致）。第一次尝试被拒绝并撤回后，Cloud 仍是 g 的墓碑，用户修正后
  再次添加仍提交 g + 1，旧尝试的行与标记作为证据保留，不阻止新尝试。操作历史把每次尝试显示为
  “添加资产”，已终止的尝试同时显示其结果。

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
- 端到端删除（第 2 条）作为阶段 3 的前置任务追加到执行台账（推荐）。

## 后果与验收

接受后，执行台账中的对应项拆为：

1. 首次添加 ingest 补上 generation 1；
2. 删除 ingest、Cloud 墓碑物化、重建与 Inbox 的删除物化；
3. generation 的 Cloud/本地迁移与 wire 版本；
4. 经同步的重新添加（Cloud 合同、本地写入、暂定期间冻结、触发器、Host 创建路径），前置为 ADR-0030；
5. 第 5 条所有入口的 generation 防护；
6. 界面把“目前不能重新添加”改为说明何时可以重新添加。

测试至少覆盖：

- 另一台设备删除、本设备只经 Inbox 收到墓碑并晋升为 Active 后重新添加：创建标记成立、Cloud 接受；
- 重新添加后立即编辑或删除被拒绝；随后收到 Cloud 拒绝：业务撤回到 generation g 墓碑，Outbox 行为
  `conflicted`（`sync_mutation_conflict`）且字段与创建标记保留，冻结解除；
- 本设备删除经 ACK（墓碑 `acknowledged`/`pending`）后重新添加被接受；
- 重新添加被拒绝 → 撤回 → 修正 → 以同一 generation g + 1 再次添加并被 Cloud 接受；旧尝试的行与标记
  保留；
- 远端删除与本地待发送编辑冲突（墓碑 `barrier_state='contested'`，有开放冲突候选）后尝试重新添加：
  被拒绝且不写入任何数据，冲突处理完成后才可重新添加；
- 重新添加被拒绝后，该设备后续 mutation 仍能同步，设备切换的 drain 不因该序列被阻塞（依赖
  ADR-0030）；

负向测试至少覆盖：本地删除未经 Cloud 确认；`reAddsDeletedRevision` 或 `entityGeneration` 不符；
`baseServerRevision < R`；实体当前不是墓碑；同一重新添加并发提交两次只分配一个 generation；Standby
写入；跨租户；重新添加后恢复删除前的备份；前任 Active 设备的旧 mutation；旧 generation 的 Inbox 与
checkpoint 数据；重新添加被 Cloud 拒绝后撤回暂定 generation，随后应用 Cloud 快照与墓碑。墓碑清除另立任务。

完成条件：上述测试全部通过，且 PostgreSQL 资格证据覆盖新增的 ingest 路径；在此之前生产入口不存在
重新添加的可执行路径。
