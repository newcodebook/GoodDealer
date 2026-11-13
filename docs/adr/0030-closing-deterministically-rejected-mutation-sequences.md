# ADR-0030：结束被确定性拒绝的 mutation 设备序号

状态：Proposed — 待产品负责人确认；未实现。扩展 [ADR-0004](0004-cloud-business-data-sync.md) 与
[ADR-0005](0005-single-active-device-and-continuity.md) 的 drain 合同。

## 背景

- 本地每次提交在 Outbox 中分配一个连续的 `device_mutation_sequence`，并冻结 wire。
- Cloud ingest 只要求同一请求内设备序号递增，并拒绝 id 或序号与已存回执冲突的提交
  （`postgres-ingest-service.ts`）；它**接受**序号缺口，所以一条被拒绝的 mutation 之后的写入仍能同步。
- Desktop 对确定性拒绝把单项批次终止为 `rejected`（`SYNC_INPUT_REJECTED`、`SYNC_SCHEMA_UNSUPPORTED`）
  或 `conflicted`（`SYNC_IDEMPOTENCY_CONFLICT`、`SYNC_MUTATION_CONFLICT`），保留行、wire 与字段；
  本地 `sync_outbox_fields_v2_immutable_delete` 禁止删除已认领行。Cloud 从未收到这些序号。
- 设备切换的 drain 验证（`apps/cloud/src/modules/devices/drain-verification.ts`）对 `mutation` 流要求
  Cloud 的 `contiguousReceivedThrough` 等于 proof 声明的 `lastAssignedSequence`、没有缺失区间、
  rolling digest 一致，否则 `DRAIN_STREAM_GAP`/`DRAIN_STREAM_WATERMARK_SHORT`/`DRAIN_STREAM_DIGEST_MISMATCH`。

因此，任何一条被确定性拒绝的 mutation 都会让该设备此后的 drain 永远失败。Desktop 目前还不生成 drain
proof，所以这还不是一个已发生的阻塞，但在设备切换交付前必须解决。被拒绝的序号如何计入 drain 改变
drain 合同，因而需要本 ADR。

## 决策（提议）

1. **Cloud 拒绝回执**：Cloud 只对**单项**推送请求、且只对以下拒绝，在拒绝之后的独立事务中把该序号
   记为已结束：`MUTATION_FIELD_STALE`、`MUTATION_ENTITY_UNKNOWN`（映射为 `SYNC_MUTATION_CONFLICT`）；
   [ADR-0029](0029-domain-tombstone-purge-and-re-adding.md) 若被接受，其 `MUTATION_GENERATION_MISMATCH` 同样映射并写回执。
   前提与 ingest 相同：会话设备与 Lease epoch 已准入、请求通过 schema 校验、该序号没有已存回执。
   回执记录 `(source_device_id, active_lease_epoch, device_mutation_sequence, mutation_id,
   wire digest, rejection code)`，不分配 server revision，不写副本。
2. **幂等与冲突**：同一 `(device, epoch, sequence)` 再次以相同 mutation id 与 wire digest 提交时，返回
   同一拒绝；不同内容按 `MUTATION_SEQUENCE_CONFLICT` 拒绝，与已接受回执的规则一致。已有拒绝回执的
   序号永远不能再被接受。
3. **drain 水位**：mutation drain ledger 把拒绝回执与接受回执一样计入 `contiguousReceivedThrough`；
   rolling digest 的 envelope 增加“已接受/已拒绝”标志，Desktop 对本地终止为 `conflicted` 且
   `last_error_code='sync_mutation_conflict'` 的行以同一 envelope 计入 proof，两端独立计算后比对。
4. **不覆盖的拒绝**：`SYNC_INPUT_REJECTED`、`SYNC_SCHEMA_UNSUPPORTED` 表示 Cloud 无法信任请求内容，
   不写回执；`SYNC_IDEMPOTENCY_CONFLICT` 表示该序号已被另一内容占用，Cloud 已有回执。前两者只会来自
   本地 writer 的缺陷或版本不匹配，出现时该设备的 drain 失败关闭，按 rebootstrap 与人工处理，不做跳过。
5. **不新增跳过协议**：Desktop 不能单方面声明某个序号“已放弃”；序号只经 Cloud 回执结束。

## 备选方案

- **Desktop 在 drain proof 中声明被拒绝的序号**：Cloud 无法核实这些序号确实被拒绝而不是被隐藏，等于
  允许设备跳过任意写入。不采用。
- **拒绝后重用同一序号提交新内容**：违反 Outbox 冻结与回执幂等，不采用。
- **维持现状**：设备切换在出现任一确定性冲突后永久失败。不采用。

## 待产品负责人确认

- 是否接受 Cloud 拒绝回执计入 drain 水位，以及 rolling digest envelope 的变更。

## 后果与验收

接受后实现：Cloud 拒绝回执表与迁移、ingest 拒绝后的回执写入、drain ledger 水位与 digest、Desktop
drain proof 计入 `conflicted` 行、同步合同文档。测试至少覆盖：冲突后后续 mutation 同步且 drain 通过；
同一拒绝重放；同一序号不同内容；拒绝回执后再提交同一序号；多项批次不写回执；`SYNC_INPUT_REJECTED`
不写回执且 drain 失败关闭；跨租户与非 Active 设备；PostgreSQL 资格证据覆盖新路径。
