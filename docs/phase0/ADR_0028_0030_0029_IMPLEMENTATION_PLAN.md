# ADR-0028、0030、0029 落地计划

更新：2026-11-13。三项架构决策均已 Accepted；本计划直接执行，不重复请求产品确认。
首次 custody 清理仍须由产品界面的用户显式确认，这是运行时行为，不是开发审批。

## 目标与依赖

先补齐 ADR-0028 的本机凭据清理，再交付 ADR-0030 的原子结果回执与版本化 drain，
最后交付 ADR-0029 的端到端删除、generation 与重新添加。墓碑物理清除不在本计划内。
每一批修改同时更新合同、迁移、实现、测试与当前状态文档；底层实现通过不等于产品入口已完成。

| 批次 | 所有者与范围 | 验收条件 | 依赖与状态 |
| --- | --- | --- | --- |
| A0 | local-storage：确切基线撤销重试；保留已取消尝试，前向迁移 credential schema V3。 | 取消重试、burned 重试、恢复、基线不符、权限栅栏与迁移保留证据测试。 | 已实现；专用界面入口已在 A3 接入。 |
| A1 | local-storage：持久退役请求、终止 recovery intent、退役完成与准入阻断；schema V4。 | prepared/prewrite/write-started 拒绝退役；recovery_required 只可原子放弃；不伪造账本；请求/完成不可回退；迟到回调零写入；连接证据保留。 | 已实现，专项测试及本批根检查通过，依赖 A0。 |
| A2 | Native Host 与 secure-host-core：不透明退役计划、准入工作区推导槽位、同锁删除与不存在回读。 | 错误工作区/incarnation、无请求、过期准入被拒绝；Unknown 保留请求；非 macOS 不可用；不解析未知槽位内容、不返回 Token。 | Host、Secure Host 及 Native 生产适配已实现；macOS 真实 custody 资格待取得，依赖 A1。 |
| A3 | Desktop 编排、设置与恢复：首次确认、清理/重试入口、每次可写打开每 incarnation 一次；备份恢复单调合并。 | 两段式每个崩溃点可恢复；不与凭据写入交错；recovery_required 不阻止清理自身；退役行隐藏；旧备份不回退请求/完成；本地清理与 Cloudflare 吊销文案准确。 | 清理通道、首次确认/手动重试、可写打开单次重试及备份保留已实现；情况 1、2 的专用撤销重试入口已由 Host 动作 `retry_revoke` 驱动；仅 macOS 实机资格待完成。 |
| B1 | protocol、Cloud devices：独立结果 envelope 与 drain proof/manifest 版本、保留旧证据及 accepted 链重建。 | 冻结 mutation wire/digest 不变；新旧版本不混算；缺失证据失败关闭；execution_fact/device_audit 合同不变。 | 已实现：结果 envelope、proof v2、按版本验证与 PostgreSQL v2 seal 重建；PostgreSQL 18.6 资格以 PR CI 为准。 |
| B2 | Cloud mutations/PostgreSQL：accepted/rejected 联合 ledger、权限与前向迁移；单项业务拒绝和序号/drain 同事务提交。 | 先查回执；全局设备序号唯一；接受/拒绝竞争只占用一次；多项失败全回滚；存储失败可重试；响应丢失精确重放；跨租户/epoch/lease/seal 负向测试。 | 已实现：结果联合 ledger 迁移、单项业务拒绝同事务记账、先查回执与精确重放、v2 seal 合并拒绝；PostgreSQL 18.6 资格以 PR CI 为准。 |
| B3 | Desktop/local-storage：持久化 Cloud 终止结果，生成同版本 drain 证据，串通设备切换验证。 | 响应落盘前崩溃不自行终结序号；拒绝后后续同步及 drain 成功；无持久回执的输入/schema 拒绝保留缺口。 | 客户端合同已实现（含跨 Lease epoch 的全局 v2 链，迁移 `202611130004`）：Outbox 已原子持久化 ACK 与单项 `SYNC_MUTATION_CONFLICT`，client-core 只从这两种结果折叠 v2 结果链并生成 v2 声明。设备切换端到端串通待 Desktop 设备切换流程交付（Host 读取、签名、Cloud proof 写入须保存 `proof.schemaVersion`）。PostgreSQL 资格通过后关闭 ADR-0030。 |
| C1 | protocol、Cloud、本地存储：generation 迁移与 wire 版本；首次添加 generation 1；删除 ingest、墓碑物化及重建。 | 普通 upsert/delete generation 精确匹配；删除可 ACK/拉取；checkpoint、rebootstrap、连续性恢复保留墓碑与 generation。 | 待实施；可先于 B3 开发，重新添加入口须等 B3 完成。 |
| C2 | local-storage/Host 与 Cloud：已确认墓碑上重新添加、暂定指针、实体冻结、ACK 确认与拒绝撤回。 | ACK/pending 与 replicated/replicated 墓碑可用；contested、未 ACK、未结束 Outbox/冲突拒绝；冻结涵盖冲突裁决；撤回保留 Outbox/字段/创建标记；同一 g+1 可再次尝试。 | 待实施，依赖 B3、C1。 |
| C3 | 备份、Inbox、快照、连续性恢复与 Desktop 界面：按已确认 generation 拒绝旧数据，解释可重加条件。 | 旧格式按 generation 1；旧备份/旧设备 mutation 不复活前代；暂定期间旧墓碑不覆盖新行；跨设备删除后重新添加成功；并发只接受一次。 | 待实施，依赖 C2；PostgreSQL 资格通过后关闭 ADR-0029。 |

## 每批交付要求

1. 修改前定位业务所有者与信任域；业务规则留在所属模块，命令和组合根只编排。
2. 仅新增前向迁移，不改已存在迁移的字节；重建 SQLite 表时保留数据、外键、索引与触发器，更新 schema guard/manifest。
3. 先运行所属模块的正向与安全负向测试，再运行根 `pnpm check`；最后运行格式与 `git diff --check`。
4. 根检查覆盖本机平台中立与 Rust workspace/all-targets；macOS 真实 custody、PostgreSQL 并发和权限资格单独记录证据，不用模拟测试替代。
5. 每批记录已实现、生产入口是否可用、剩余事项及验证结果。只有端到端验收通过才勾选总执行计划对应项。

## 当前执行记录

- A0：已实现；local-storage 318 passed、6 ignored，根 `pnpm check` 通过。
- A1：已实现 V4 前向迁移、不可回退请求/完成、恢复 intent 原子放弃、凭据准入阻断、完成后设置隐藏；专项测试通过。
- A2：已实现 Host 不透明请求/恢复/完成计划与清理前准入重检；Secure Host 删除原语沿用槽位锁，只查询存在性。删除回读失败保持 Unknown，非 macOS 拒绝。生产适配已接入 ProviderLane；macOS 实机资格待验证。
- 上一批专项测试：local-storage 6 项、secure-host-core 3 项通过；根 `pnpm check`、`cargo fmt --all --check`、`git diff --check` 全部通过。
- A3 本批：新增严格有界、只含连接引用/标签/请求状态的维护目标读取与闭合动作 IPC。设置页仅在可写时读取维护目标；首次确认和已请求重试分开，失败后重新读取持久状态，不自动重复提交删除。
- ProviderLane：清理可在恢复失败后排队，但与恢复/其他凭据操作同循环串行；计数溢出仍关闭准入。Native 在槽位锁内重新检查 Host 与取消栅栏，完成提交也受栅栏约束。
- 自动重试：Host 可写运行时快照仅记录本次打开已有的请求，每 incarnation 消费一次；首次确认新请求前冻结旧集合，后续 wake 不重试失败或本次新请求。
- 备份：现行格式不恢复凭据控制数据；业务白名单合并保持当前请求与完成时间，无需给备份增加凭据表合并。新增旧快照恢复同时保留 pending/retired 的回归测试。
- 本批验证：根 `pnpm check` 通过（含平台中立检查与 Rust workspace/all-targets）；local-storage 326 passed、6 ignored，Desktop Native 69 passed，secure-host-core 37 passed。随后最新 Desktop 310 项测试与类型检查通过；`cargo fmt --all --check`、`git diff --check` 通过。接手复核时发现 `cargo clippy --workspace --all-targets -D warnings` 未通过（根 `pnpm check` 不含 Rust lint），已修正测试闭包模式、一次性句柄的按值消费说明、超长测试说明与整数转换；修正后 clippy 通过。持久证据以 PR CI 运行为准。
- A3 收尾：设置页按 Host 给出的 `retry_revoke` 动作提供情况 1、2 撤销重试（无首次确认、不删除），仅在撤销确认且目标消失后显示成功；候选读取对存储故障失败关闭。macOS 真实 custody 资格单独取得；本机 Linux 检查不能替代。
- B1：协议 `encodeMutationDrainResultEnvelope`（二进制、独立 domain，只接收已算好的 32 字节摘要）与 proof schema v2（typ、codec、签名/摘要 domain 同步升级；v1 字节冻结测试保留）。Cloud `DrainStreamWatermarkPort` 必须带 proof 版本；内存 mutation 账本从保留 envelope 重建 v2 accepted 链。PostgreSQL 迁移 `202611130001`（devices）为 proof 增加版本列并提供只供 definer 使用的读取函数，`202611130002`（workspace/mutations）替换 mutation seal：v2 逐条核对 `envelope_digest = sha256(canonical_envelope)` 后按与 TypeScript 逐字节一致的结果 envelope 成链，seal 行记录版本。独立 Python 计算的结果链向量与 PostgreSQL 实测一致；本机 PostgreSQL 18.4 诊断运行受影响的 4 个套件 57 项通过（非资格）。
- B2：迁移 `202611130003` 建立结果联合（CHECK 互斥、accepted 外键、拒绝 code 白名单、拒绝行冻结提交 envelope 摘要、app 无 UPDATE/DELETE 且不可变触发器保留）。PostgreSQL ingest 单项 `MUTATION_FIELD_STALE`/`MUTATION_ENTITY_UNKNOWN` 在同一事务写回执并推进全局水位；拒绝写入与接受路径同经 `workspace_mutation_drain_lock_domain`，重新断言当前活跃 Lease 域，已封存 drain 域拒绝写入；`resolveReceipt` 返回 `rejected` 状态并在业务重判前重放。mutation seal 第三版按序合并两种结果。内存参考实现（账本 `appendRejected`、v2 投影合并、ingest 回执）同步。新增负向资格测试：封存后不再记录拒绝、拒绝写入后的存储故障整体回滚且重试只记一次、同一序号接受/拒绝竞争只占用一次。本机 PostgreSQL 18.4 诊断：mutation 套件 27 项通过，全量仅 18.6 版本守卫失败（非资格）。
- B3：Desktop 已在单个 SQLite 事务内把单项 `SYNC_MUTATION_CONFLICT` 终止为 `conflicted`/`sync_mutation_conflict`，ACK 终止为 `acknowledged`；落盘前崩溃时行仍为 `sending`，租约到期后重发并得到 Cloud 精确重放，不自行终结序号。client-core 新增 `MutationResultDrainLedger`、`classifyPersistedMutationResult` 与 `foldPersistedMutationResults`：只有这两种持久结果计入，首个未确认序号后全部 pending；`buildDrainProofClaims` 必须声明 proof 版本，v1/v2 与链类型不可混用，本地链标记不进入声明。结果链复现协议向量（与 Cloud v2 seal 同一编码）。独立评估发现 B1/B2 的 v2 seal 只在 proof 所属 epoch 内从 0 成链，而设备序号全局递增，Lease 轮换后无法封存；迁移 `202611130004` 让 v2 seal 跨该设备全部 epoch 成链（v1 不变），内存账本同步，PostgreSQL 与内存均新增轮换后封存测试（按 epoch 重新起链的声明被拒绝）。本机 PostgreSQL 18.4 诊断：mutation 套件 28 项通过。仓库没有 Desktop 设备切换流程与 Cloud proof 写入路径，端到端串通作为阶段 3 新增的暂停项登记。
- C1 拆为三步，每步单独评估、根检查与推送，任何一步都保持 Desktop 与 Cloud 的 wire 版本一致：
  - C1a：同步 wire 升为 schema version 3，DomainAsset mutation 必带 `entityGeneration`，可带 `reAddsDeletedRevision`；协议、Cloud 解析、Rust 严格解析/生成与 wire 语料同时更新。此步尚无 generation 列，Cloud 只接受 `entityGeneration = 1` 且拒绝 `reAddsDeletedRevision`（C2 前失败关闭），Desktop 生成 1。
  - C1b：Cloud generation 前向迁移、ingest 按副本 generation 精确匹配、删除 ingest 与墓碑物化、checkpoint 重建保留墓碑与 generation。
  - C1c：本地 generation 列、Inbox/checkpoint/rebootstrap/连续性恢复保留墓碑与 generation，删除可 ACK 与拉取。
- C1a：已实现。协议 Mutation wire 版本 3 与 legacy v2 编码器；向量与 native 语料重新生成（新增 generation 缺失/为 0、版本 2、首代 re-add、re-add 晚于 base 的拒绝用例）。Cloud 按记录版本比较回执与提交 envelope，迁移 `202611130005` 扩展 ledger 版本白名单；generation ≠ 1 或 re-add 以 schema 不支持拒绝、不写回执（内存与 PostgreSQL 测试），并以改写成迁移前形态的 v2 行验证精确重放、内容冲突与 v3 读取。cloud-client Push 使用版本 3。Desktop 发送 v3、严格解析只接受 generation 1；本地 `wire_schema_version` 列仍为 2 并记录同一内容的 v2 编码摘要（既有认领摘要不变，有测试固定），C1c 重建本地表时移除。独立评估第一轮 FAIL：Desktop rebootstrap 仍只接受 v2 replay 页；已改为接受 v3/generation 1 并新增含 replay 页的 Rust 测试，generation 拒绝移到 PostgreSQL 租户事务之前，补 v2 时代拒绝回执的重放测试，并把跨升级行的 drain envelope 版本缺口记入 ADR-0029 与设备切换暂停项。本机 PostgreSQL 18.4 诊断：mutation 套件 31 项通过（非资格）。
- C1b 暂停（待决）：ADR-0029 决策 1 要求删除时移除活跃行并写入同代墓碑行（“每个实体至多一行”），但 `cloudflare_dns_observation_receipts` 与 `cloudflare_dns_observation_projections` 以 `ON DELETE RESTRICT` 外键引用 `workspace_replica_domain_assets`，回执不可变，已有 DNS 观察的域名删除物化必然失败。可选：A. 保留资产行并置 `deleted_at`/`lifecycle_status='archived'`（现有列与 CHECK 已支持）作为删除状态，同时写墓碑行，“活跃行”定义为 `deleted_at IS NULL`；B. 墓碑行取代资产行，观察回执与投影改为不以外键引用资产行（实体身份由墓碑或资产二者之一承载），观察历史作为已删除实体的证据保留。两者都修订已接受的 ADR-0029 决策 1，须用户决定后先改 ADR 再实现。
- 下一批：C1b（待上项决定）。

上位执行计划：[Phase 0 执行计划](PHASE0_EXECUTION_PLAN.md)。
架构依据：[ADR-0028](../adr/0028-refused-cloudflare-custody-purge.md)、
[ADR-0030](../adr/0030-closing-deterministically-rejected-mutation-sequences.md)、
[ADR-0029](../adr/0029-domain-tombstone-purge-and-re-adding.md)。
