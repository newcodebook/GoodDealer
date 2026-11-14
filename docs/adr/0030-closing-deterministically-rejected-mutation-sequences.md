# ADR-0030：结束被确定性拒绝的 mutation 设备序号

状态：Accepted — 产品负责人于 2026-11-13 接受独立审查后的修订方案；实现中（B1、B2 已实现；B3 的客户端合同已实现，设备切换端到端串通待 Desktop 设备切换流程交付）。扩展 [ADR-0004](0004-cloud-business-data-sync.md) 与
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

## 决策

1. **Cloud 拒绝回执与原子终结**：只对**单项**推送、且通过身份、租约、wire 与工作区 schema 校验的
   `MUTATION_FIELD_STALE`、`MUTATION_ENTITY_UNKNOWN` 与 ADR-0029 的 `MUTATION_GENERATION_MISMATCH`
   写入拒绝回执。这些业务拒绝映射为 `SYNC_MUTATION_CONFLICT`。
   - 判定与拒绝回执、序号 ledger、连续水位及 drain 记录在**同一个 tenant 事务**中提交；沿用 ingest 的
     锁顺序：租约准入、设备序号 head、工作区 revision。单项业务拒绝返回可提交的结果，不通过会回滚
     整个事务的 `IngestRejected` 抛出。拒绝路径在副本写入与 server revision 分配前结束，不物化业务数据。
   - 拒绝回执持久化成功后才能向 Desktop 返回终止性业务拒绝。存储失败则回滚全部拒绝证据，返回可重试的
     存储错误；客户端保留并重试同一冻结请求。提交成功但响应丢失时，再提交得到同一拒绝结果。
   - 多项批次仍全部接受或全部回滚；业务拒绝时不写任何拒绝回执，由现有批次隔离最终发起单项请求。
2. **统一的序号与 mutation 身份**：接受与拒绝占用同一全局设备序号空间，唯一键沿用
   `(account_id, workspace_id, source_device_id, device_mutation_sequence)`，**不把 Lease epoch 纳入唯一键**；
   epoch 是不可变的提交身份。mutation ID 在 `(account_id, workspace_id)` 内也只能绑定一次。
   - 通过前置准入后，先解析已有的接受或拒绝回执，再判业务条件。同一 mutation ID、设备序号、epoch
     与冻结 wire digest 的重放返回原结果；不同内容返回既有 ID/序号冲突，绝不重写原结果。
   - `workspace_device_mutation_sequence_ledger` 扩展为不可变的结果联合：`accepted` 必须有正整数
     `server_revision` 与接受时间，`rejected` 必须无 server revision 并有白名单 rejection code 与拒绝时间。
     现有接受回执外键仅约束 accepted 分支。数据库 CHECK、唯一键与写权限保证两种结果互斥，拒绝行
     无法用于伪造接受回执；历史记录前向迁移为 accepted，原 wire digest 与回执保持原样。
3. **drain 水位与摘要**：全局设备序号连续水位把两种结果都计入；租约域的 drain ledger 仍按原始 epoch
   记录。为 mutation drain 引入独立、带版本及 domain separation 的结果 envelope，绑定原始冻结 wire 的
   digest 与 `accepted`/`rejected`。拒绝 code 保存在回执中，不进入结果 envelope，避免依赖宽泛的 IPC 错误码
   反推 Cloud 内部 code。Desktop 只有 ACK 或明确的 `SYNC_MUTATION_CONFLICT` 响应落盘后才能记录结果；
   本地未获 Cloud 确认的状态不能自行计入 proof。
   - **冻结的 mutation wire 与其 digest 不变**。结果 envelope 只用于 drain，必须使用独立编码器，不能修改
     当前同时被 mutation 提交证据使用的 `encodeDrainStreamEnvelope` 来偷偷改变已有回执摘要。
   - drain proof/manifest 明确声明新的结果 envelope 版本；新旧版本不可混算。旧 drain 记录保留不重写；
     新版本链从保留的原 envelope 与持久回执重建 accepted 结果，并纳入 rejected 结果。无法重建任何一项
     则失败关闭；旧签名 proof 不升级或重签为新 proof。execution_fact 与 device_audit 的编码保持既有合同。
   - 新版本读写链、历史接受记录兼容与 proof 版本校验全部交付后才启用拒绝回执计入 drain。
4. **不覆盖的拒绝**：输入/schema 错误不生成拒绝回执；ID/序号冲突不生成第二条回执。无法认证、非 Active、
   租约失效、drain 已封存等前置拒绝均不占用新序号。输入与版本错误的本地项保留为 rejected，其序号缺口
   继续失败关闭，走 rebootstrap 或人工处理，不把它伪装成业务冲突。
5. **不新增跳过协议**：Desktop 不能单方面声明序号已放弃，只有 Cloud 持久化的接受或拒绝回执才能结束序号。

## 独立审查（2026-11-13）

原提案有三处阻断问题，已在上述提案中修订，产品负责人已于 2026-11-13 接受修订方案：

- “拒绝后的独立事务”在两个事务之间释放锁，可能与另一个提交竞争，使已返回的拒绝与实际接受结果不一致；
  改为判定与拒绝证据同事务，提交失败不返回终止性拒绝。
- 原 `(device, epoch, sequence)` 幂等规则弱于现有跨 epoch 的全局设备序号唯一性；改为沿用现有身份域，
  接受与拒绝共用一条不可变结果 ledger。
- 现有 mutation drain encoder 同时用于提交证据；直接增加结果字段会改变冻结摘要。改用独立结果编码与
  新 proof 版本，保留既有 wire 与历史证据，并明确兼容与失败关闭规则。

## 备选方案

- **Desktop 在 drain proof 中声明被拒绝的序号**：Cloud 无法核实这些序号确实被拒绝而不是被隐藏，等于
  允许设备跳过任意写入。不采用。
- **拒绝后重用同一序号提交新内容**：违反 Outbox 冻结与回执幂等，不采用。
- **维持现状**：设备切换在出现任一确定性冲突后永久失败。不采用。

## 产品确认

产品负责人于 2026-11-13 接受修订后的方案：业务拒绝与回执原子提交、接受/拒绝共用全局设备序号身份、独立且有版本的 drain 结果摘要与历史兼容。交付状态以执行台账与测试证据为准。

## 后果与验收

接受后实现：结果 ledger 前向迁移与权限、单项业务拒绝事务、统一回执查重、drain 结果编码与 proof 版本、
历史接受记录重建、Desktop 响应持久化及 proof、同步合同文档。PostgreSQL 资格证据至少覆盖：

- 冲突后后续 mutation 可同步，拒绝序号计入连续水位且 drain 通过；
- 拒绝提交前崩溃或存储故障全部回滚，客户端只能得到可重试错误；提交成功但响应丢失后重放同一拒绝；
- 同一请求并发重放只产生一个结果；接受与拒绝竞争、同序号跨 epoch、同 ID 不同内容都不能双重占用；
- 回执查重先于业务重判，副本条件变化后原拒绝仍不可转为接受；
- 多项拒绝回滚且无拒绝记录，隔离后单项才记账；输入/schema/权限拒绝不计入水位；
- 跨租户、非 Active、租约撤销和 drain 封存竞争；
- 新结果摘要不改变 mutation wire/digest；历史 accepted 与新 rejected 混合链两端计算一致，旧 proof
  版本被明确处理，缺失重建证据时失败关闭；
- Desktop 在响应落盘前崩溃时不自行终结序号，重试恢复后结果与 Cloud 一致。

完成条件：上述验证与相关完整检查通过；本 ADR 接受及兼容链交付前不启用生产路径。

## 实施状态

B1 已实现：协议新增独立结果 envelope `GOODDEALER-MUTATION-DRAIN-RESULT-V1`（二进制布局，绑定冻结提交 envelope
的 SHA-256 与 `accepted`/`rejected`，不含拒绝 code）与 drain proof schema v2（`gd.drain-proof.v2`、codec 2、
独立签名/摘要 domain）；v1 proof、mutation wire 与既有摘要字节不变，版本不可混算。Cloud 验证按 proof 版本
读取水位；PostgreSQL 前向迁移 `202611130001`（devices，proof 版本，历史行为 v1）与 `202611130002`
（workspace/mutations，v2 seal 从保留的 v1 记录重建 accepted 链，记录摘要不符即失败关闭）。拒绝结果入链
等 B2 的结果 ledger；Desktop v2 proof 尚未启用。

B2 已实现：前向迁移 `202611130003` 把全局设备序号 ledger 改为不可变的 accepted/rejected 结果联合（CHECK
互斥；只有 accepted 带 server revision 并受接受回执外键约束；rejected 带白名单 code、拒绝时间与冻结提交
envelope 摘要；历史行为 accepted，原字节不变），并替换 mutation seal：v2 按序合并 accepted 记录与 rejected
回执，同一序号两种结果即失败关闭，v1 遇到拒绝序号即无法封存。PostgreSQL ingest 对单项的
`MUTATION_FIELD_STALE`/`MUTATION_ENTITY_UNKNOWN` 在同一 tenant 事务内写入拒绝回执并推进全局序号水位，提交后
才返回；回执查重先于业务重判，精确重放返回原拒绝 code（不重放字段明细），不同内容仍为 ID/序号冲突；多项批次
仍整体回滚、不写回执；存储失败按可重试错误返回。内存参考实现同步一致。
B3 客户端合同已实现：client-core `MutationResultDrainLedger` 只在 Cloud 结果落盘后按序折叠结果 envelope，
`foldPersistedMutationResults` 只把 Outbox 的 `acknowledged`（ACK）与 `conflicted`+`sync_mutation_conflict`（单项
业务拒绝回执）计为结果；仍在 `sending`、输入/schema 拒绝与幂等冲突不结束序号，首个未确认序号之后全部保持
pending，drain 失败关闭。`buildDrainProofClaims` 必须声明 proof 版本：v2 只接受结果链，v1 不接受结果链，本地链
标记不进入签名声明。按决策 3，v2 链覆盖该设备在全部 Lease epoch 中的全局序号并从序号 1 开始：B2 的 seal
与内存账本只在 proof 所属 epoch 内成链，设备经历 Lease 轮换后 v2 proof 无法封存；前向迁移 `202611130004`
（workspace/mutations）改为跨 epoch 按序合并该设备两种结果，seal 行仍按 proof 的 epoch 记录，v1 保持原有
按 epoch 范围，所以 v1 proof 在 Lease 轮换后无法封存（历史格式，失败关闭），设备切换只能使用 v2。客户端结果链与协议向量、Cloud v2 seal 逐字节一致，含 Lease 轮换后的情形。Desktop 目前没有设备切换流程：Host 读取
Outbox 结果、签名 proof 与 Cloud 接收 proof 的生产路径尚不存在；交付时必须使用上述合同，Cloud 写入
`device_drain_proofs` 时必须保存 `proof.schemaVersion`（列默认 1 会让 v2 proof 封存失败关闭）。
批次与验收见[专项落地计划](../phase0/ADR_0028_0030_0029_IMPLEMENTATION_PLAN.md)。
