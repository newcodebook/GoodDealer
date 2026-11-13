# ADR-0029：已删除域名的墓碑清除与重新添加

状态：Proposed — 待产品负责人确认；未实现，删除的域名目前不能重新添加。扩展
[ADR-0004](0004-cloud-business-data-sync.md) 与 [ADR-0019](0019-complete-local-business-schema-and-cloud-replica-model.md)。

## 背景

DomainAsset 以规范小写 IDNA ASCII 域名作为 `entity_id`（ADR-0019），删除是带删除时间的显式 mutation，
本地写入 `deleted_at` 与 `sync_tombstones`。当前：

- 没有生产路径把墓碑置为 `purge_eligible`，也没有删除墓碑与已删除行的路径；
- 本地创建对带 `deleted_at` 的行一律拒绝，所以同一域名删除后永远不能重新添加；
- [DATABASE_SCHEMA](../DATABASE_SCHEMA.md) 规定：端到端墓碑 materializer 上线前，Cloud ingest 对 delete
  失败关闭；墓碑在所有保留设备与恢复窗口越过删除 revision 前不得清理；
- `sync_outbox_local_creations` 的插入触发器只允许标记资产的首个本地 upsert，重新添加时若该域名的早期
  Outbox 行仍在，整个创建事务会被中止。

可选的两条路都改变 Cloud 同步合同，因此需要本 ADR。

## 决策（提议）

分两步，前者是后者的前提：

1. **先交付端到端删除**：Cloud ingest 接受 delete mutation，物化到 `workspace_replica_tombstones`，
   下行到其他设备时由 Inbox 写入同一 entity/revision 的墓碑。这是 ADR-0019 已要求、尚未交付的部分；
   在此之前不能有任何重新添加路径。
2. **经同步的重新添加（推荐）**：重新添加同一域名是一条普通 upsert mutation。`baseServerRevision` 保持
   现有含义（设备已观察到的工作区 head，ingest 接受 `base <= head` 并逐字段检测冲突），不另作约束。
   - **Cloud 接受条件**：副本中该实体的当前状态是删除 revision 为 R 的墓碑，且 `R <= baseServerRevision`
     （设备在提交前已看到该删除）。否则拒绝。
   - **本地前提**：设备持有 Cloud 在 R 处的墓碑——由本设备 Outbox 的删除经 ACK 确认，或经 Inbox 从 Cloud
     应用而来（后者没有本地 Outbox 项可 ACK）。本地删除尚未被 Cloud 确认时不能重新添加。
   - **新一代**：Cloud 把它作为该实体的新一代，旧字段值不复活，所有字段从本次 upsert 重新开始。其他设备
     经 Inbox 收到后物化新一代。
   - **保留一代标记，而不是清除墓碑**：本地与 Cloud 都为该实体保留按 generation 递增的标记（保留墓碑历史
     及其删除 revision，或单独的实体 generation 计数）。新一代写入后，备份恢复与 Inbox 必须拒绝任何属于
     更早一代的数据——否则一个在删除前创建的备份，在重新添加清除墓碑后恢复，将不再与墓碑冲突
     （`crates/local-storage/src/backup/restore.rs` 的 `reject_candidate_tombstone_conflicts` 只依赖墓碑或
     `deleted_at` 行），其旧字段可能以本地 upsert 进入新一代。
   - 单活跃设备（[ADR-0005](0005-single-active-device-and-continuity.md)）保证同一时刻只有 Active 设备
     写入，所以“删除 → 重新添加”在 Cloud 上是线性的；Standby 设备只读。前任 Active 设备在删除前未同步的
     mutation 由其 Lease epoch 栅栏拒绝，不会被应用到新一代。
   - 本地触发器改为：允许 `entity_kind = 'domain_asset'` 在持有 Cloud 墓碑之后的首个 upsert，并把
     `entity_kind` 纳入该检查；早期 Outbox 历史保留，不需要先压缩。
3. **墓碑清除（存储回收）推迟**：只有在 Cloud 能给出每台保留设备与恢复窗口都已越过删除 revision 的
   水位后，才把墓碑置为 `purge_eligible` 并级联清理。它不再是重新添加的前提，可在后续单独 ADR 中定义；该 ADR 必须在清除墓碑后仍保留实体的 generation 标记（计数或最后的删除 revision），否则上面的恢复防护会重新出现缺口。

## 备选方案

- **先清除墓碑再允许重新创建**：需要 Cloud 侧的保留设备水位与恢复窗口判定，而目前两者都不存在；
  清除前同一域名仍不能重新添加，用户等待时间不确定。不作为第一步。
- **给重新添加的域名分配新身份**：与 ADR-0019“域名即 `entity_id`、不保留第二身份列”冲突。不采用。

## 待产品负责人确认

- 是否接受“经同步的重新添加”作为删除后再添加的语义，以及“旧字段不复活”的规则。
- 端到端删除（步骤 1）是否作为 v1 范围内的前置任务追加到执行台账（推荐：追加到阶段 3）。

## 后果

接受后，执行台账“墓碑清除与已删除域名的重新添加”拆为：Cloud delete ingest 与墓碑 materializer、
Inbox 删除物化、经同步的重新添加（Cloud 合同、实体 generation 标记、本地触发器与 Host 创建路径）及其
负向测试（本地删除未经 Cloud 确认、`baseServerRevision < R`、Standby 写入、跨租户、重新添加后恢复删除前
的备份、前任 Active 设备的旧 mutation），以及界面把“目前不能重新添加”改为说明何时
可以重新添加。墓碑清除另立任务。
