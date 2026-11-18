# ADR-0029：域名添加、删除与 generation

状态：Accepted

## 生命周期决策

### 1. 实体 generation

每个 DomainAsset 带一个**实体 generation**（正整数）。首次添加为 1；删除不改变 generation（墓碑记录被
删除的那一代）；重新添加为墓碑 generation + 1。generation 只增不减。

- **Cloud**：`workspace_replica_domain_assets` 与 `workspace_replica_tombstones` 各增加 `entity_generation`。
  活跃实体只有资产行；已删除实体是软删除的资产行加一行墓碑（决策 2），两行的 generation 相同。
  generation 标记始终在现存的行里，不需要单独的历史表。
- **本地**：`domain_assets` 与 `sync_tombstones` 各增加 `entity_generation`，规则相同。
- **wire**：每条 DomainAsset mutation 带 `entityGeneration`；重新添加另带 `reAddsDeletedRevision`
  （被取代的墓碑的删除 revision R）。同步 schema version 升级；旧版本请求按版本不匹配拒绝。
  checkpoint、rebootstrap 快照与 Inbox 下行都携带 generation 与墓碑。
- 迁移：现有行与墓碑的 generation 为 1。

### 2. 添加与删除

添加、删除与重新添加遵循同一实体生命周期：

- **首次添加 ingest**：引入 generation 后，其 `entityGeneration` 必须为 1。
- **删除 ingest 与物化（软删除）**：`entityGeneration` 等于活跃行 generation 的 delete，在 ingest 事务内把
  资产行改为软删除——`deleted_at` 取 mutation 的删除时间，`lifecycle_status='archived'`，业务字段清空为默认值，
  字段 revision 置为本次 revision——并写入同一 generation 的墓碑行。资产行不移除：Cloudflare DNS 观察回执
  不可变，并以 `ON DELETE RESTRICT` 外键引用资产行，移除活跃行会被拒绝；保留行让不可变证据与数据库层的
  引用完整性都不变，与本地 `deleted_at` 模型一致。数据库保证两者同进同出：软删除必须在同一事务内有墓碑，
  墓碑必须指向已软删除的行，已删除行仅可通过决策 3 的重新添加协议变为活跃。所有读取——投影、快照、
  checkpoint 与引导、恢复候选、观察准入——都排除已删除行。对副本中没有活跃行的实体（不存在或已删除）
  的 delete，以及不满足决策 3 的已删除实体 upsert，以 `MUTATION_ENTITY_UNKNOWN` 拒绝；同一批次内按顺序判断，先
  upsert 新建再 delete 可以接受。delete 不做字段过期判定：它只要求实体当前活跃（generation 落地后另要求 generation 相等），所以其他设备在其 base 之后的字段编辑不阻止删除，删除胜出；那些设备经 Inbox 收到删除，有待发送字段时按冲突处理。checkpoint 重建同样把 delete 物化为删除：被删除的行不进入结果，范围内
  不满足决策 3 的重新添加视为链损坏；本地 Inbox 墓碑同样携带 generation。

- **被 Cloud 确定拒绝的本地删除**：若 Cloud 为该 mutation 返回确定性输入/协议拒绝或实体冲突，且本地仍有与该 Outbox 行同 generation、同 local commit sequence 的 `pending` 墓碑，则在同一事务中保留终态 Outbox 证据、移除该墓碑、恢复被软删除行原有业务投影与本地版本，并移除本次 delete 创建的 `lifecycleStatus` 待同步版本。该删除没有成为共享状态，界面应说明删除未生效，用户可以再次删除；随后的 Cloud mutation 可按正常 revision 顺序应用。mutation id/设备序号幂等冲突不能证明此前是否已有同 id 操作生效，不自动撤回，保持删除状态并失败关闭。未经确认的网络错误不进入终态处置，也保留墓碑与 Outbox。

### 3. 经同步的重新添加

重新添加是一条带 `reAddsDeletedRevision` 的 upsert。

- **Cloud 接受条件**（全部在 ingest 现有的工作区 head 锁事务内检查与写入，一次提交或全部回滚）：
  1. 该实体当前是墓碑行，generation 为 g，删除 revision 为 R；
  2. `reAddsDeletedRevision = R` 且 `entityGeneration = g + 1`；
  3. `R <= baseServerRevision <= head`。

  否则以 `MUTATION_GENERATION_MISMATCH` 拒绝。接受时，在同一事务中删除墓碑行、把软删除的资产行重置为
  generation g + 1 的活跃行（清除 `deleted_at`，所有字段只来自本次 upsert，未提供的取默认值，旧字段不复活）、把该实体所有字段 revision 置为
  本次分配的 revision、写入 mutation log 与回执。重复提交按现有回执返回精确重复，不会分配第二个
  generation。
- **为什么 `R <= base` 足够**：Inbox 按 revision 顺序应用，设备观察到的 head ≥ R 就意味着已应用这次删除；
  条件 1 又要求 Cloud 当前状态就是这块墓碑，所以“删除后已重新添加、又再删除”的情况会因 R 或 g 不同而
  被拒绝，不会出现 ABA。`reAddsDeletedRevision` 让 Cloud 精确比对设备引用的是哪一块墓碑。
- **普通 upsert 与 delete** 也必须 `entityGeneration` 等于活跃行 generation，否则拒绝。因此任何属于更早
  一代的 mutation（包括前任 Active 设备未同步的写入）都会被拒绝，这独立于 Lease epoch 栅栏。
- **单活跃设备**（[ADR-0032](0032-desktop-device-switch-and-drain-handoff.md)）只减少合法写入者，不是安全依据；
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
    `SYNC_MUTATION_CONFLICT`，行为 `conflicted` 且 `last_error_code='sync_mutation_conflict'`（与 ADR-0019
    计入 drain 的行一致）；输入或 schema 拒绝为 `rejected`。作为操作历史与审计证据；创建标记仍指向这条已终止的行，界面把它显示为“重新添加被拒绝”。
  - **序列**：接受与确定性业务拒绝按 [ADR-0019](0019-complete-local-business-schema-and-cloud-replica-model.md)
    的持久回执计入 drain；输入/协议拒绝等没有 Cloud 回执的序号继续失败关闭，不能自报跳过。
  暂定期间 Inbox 或快照带来的 generation g 墓碑与本地已确认状态一致，只确认该墓碑行，不被第 5 条
  拒绝，也不覆盖暂定的 g + 1 行与其 Outbox 项——后者仍由 ACK 或拒绝决定。
- **上一代被拒绝写入留下的字段标记**：
  Cloud 确定性拒绝本地编辑后，该编辑的字段保持 `pending`（ADR-0019 的处置不改字段状态，对方写入到达时
  因此进入冲突中心而不覆盖本地值）。实体其后被删除时，这些标记属于已结束的 generation g：拒绝已把
  Outbox 行终止，没有任何内容要发送。进入 g + 1 的三个入口——Inbox 应用其他设备的重新添加、本设备的
  重新添加、rebootstrap 的 checkpoint generation 前进——都按决策 3 删除 g 的全部字段版本，这些标记随之
  退役：不写回 g + 1，不生成冲突候选，已终止的 Outbox 行保留为证据。等待只针对仍有欠账的工作：该实体
  还有 `pending`/`sending` Outbox 行、`conflicted` 字段或开放冲突时，Inbox 与 rebootstrap 仍以 `MutationConflict` 等待、不写入；本设备的重新添加以 `LOCAL_ASSET_RE_ADD_BLOCKED` 拒绝（`conflicted` 字段总与开放冲突同时产生，由后者拦下）。
  对墓碑实体，Cloud 以 `SYNC_MUTATION_CONFLICT` 终止仍排队的上一代写入，所以这种等待会结束，不会让拉取
  或 rebootstrap 永久停滞。
- **创建标记触发器**改为不依赖本地是否有 delete 的 Outbox 行（删除可能发生在另一台设备，本设备只经
  Inbox 收到墓碑，随后才晋升为 Active）。标记的 upsert 必须满足以下之一：
  - 首次添加：在本 mutation 的 `local_commit_sequence` 之前没有已提交的活跃行或墓碑（创建路径在同一
    事务中先写入资产行、后写入标记，所以不能以“当前没有活跃行”判断），没有更早的 Outbox 行，且
    `entityGeneration = 1`（经 Inbox 应用的行同样必须提供可比较的 `local_commit_sequence`）；
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

- 纳入活动工作区的备份候选与完整恢复（不含 generation 的旧格式备份按 generation 1 处理）；
- rebootstrap 与 checkpoint 快照应用；
- Inbox mutation 应用；
- 客户端与 Cloud 的 checkpoint 重建；
- Standby 晋升为 Active 时的连续性恢复。

离线历史备份的隔离查看/导出按 ADR-0023 执行，不把活动工作区的 generation 门禁用于拒绝历史数据读取。

### 6. 墓碑回收边界

墓碑清除（存储回收）不是重新添加的前提。只有 Cloud 能给出每台保留设备与恢复窗口都越过删除
revision 的水位后才能定义，另立 ADR；该 ADR 必须在删除墓碑行后仍保留该实体的 generation 下限，否则
第 5 条的防护会出现缺口。
