# ADR-0028、0030、0029 落地计划

更新：2026-11-13。三项架构决策均已 Accepted；本计划直接执行，不重复请求产品确认。
首次 custody 清理仍须由产品界面的用户显式确认，这是运行时行为，不是开发审批。

## 目标与依赖

先补齐 ADR-0028 的本机凭据清理，再交付 ADR-0030 的原子结果回执与版本化 drain，
最后交付 ADR-0029 的端到端删除、generation 与重新添加。墓碑物理清除不在本计划内。
每一批修改同时更新合同、迁移、实现、测试与当前状态文档；底层实现通过不等于产品入口已完成。

| 批次 | 所有者与范围 | 验收条件 | 依赖与状态 |
| --- | --- | --- | --- |
| A0 | local-storage：确切基线撤销重试；保留已取消尝试，前向迁移 credential schema V3。 | 取消重试、burned 重试、恢复、基线不符、权限栅栏与迁移保留证据测试。 | 已实现；上一批根检查通过；专用界面入口待 A3。 |
| A1 | local-storage：持久退役请求、终止 recovery intent、退役完成与准入阻断；schema V4。 | prepared/prewrite/write-started 拒绝退役；recovery_required 只可原子放弃；不伪造账本；请求/完成不可回退；迟到回调零写入；连接证据保留。 | 已实现，专项测试及本批根检查通过，依赖 A0。 |
| A2 | Native Host 与 secure-host-core：不透明退役计划、准入工作区推导槽位、同锁删除与不存在回读。 | 错误工作区/incarnation、无请求、过期准入被拒绝；Unknown 保留请求；非 macOS 不可用；不解析未知槽位内容、不返回 Token。 | Host、Secure Host 及 Native 生产适配已实现；macOS 真实 custody 资格待取得，依赖 A1。 |
| A3 | Desktop 编排、设置与恢复：首次确认、清理/重试入口、每次可写打开每 incarnation 一次；备份恢复单调合并。 | 两段式每个崩溃点可恢复；不与凭据写入交错；recovery_required 不阻止清理自身；退役行隐藏；旧备份不回退请求/完成；本地清理与 Cloudflare 吊销文案准确。 | 清理通道、首次确认/手动重试、可写打开单次重试及备份保留已实现；情况 1、2 的专用撤销重试界面与 macOS 资格仍待完成，依赖 A2。 |
| B1 | protocol、Cloud devices：独立结果 envelope 与 drain proof/manifest 版本、保留旧证据及 accepted 链重建。 | 冻结 mutation wire/digest 不变；新旧版本不混算；缺失证据失败关闭；execution_fact/device_audit 合同不变。 | 待实施，ADR-0030 的第一批。 |
| B2 | Cloud mutations/PostgreSQL：accepted/rejected 联合 ledger、权限与前向迁移；单项业务拒绝和序号/drain 同事务提交。 | 先查回执；全局设备序号唯一；接受/拒绝竞争只占用一次；多项失败全回滚；存储失败可重试；响应丢失精确重放；跨租户/epoch/lease/seal 负向测试。 | 待实施，依赖 B1；兼容链未就绪不启用生产拒绝计入 drain。 |
| B3 | Desktop/local-storage：持久化 Cloud 终止结果，生成同版本 drain 证据，串通设备切换验证。 | 响应落盘前崩溃不自行终结序号；拒绝后后续同步及 drain 成功；无持久回执的输入/schema 拒绝保留缺口。 | 待实施，依赖 B2；PostgreSQL 资格通过后关闭 ADR-0030。 |
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
- 下一批：补情况 1、2 的专用撤销重试界面及剩余验收证据，再进入 B1。macOS 真实 custody 资格单独取得；本机 Linux 检查不能替代。

上位执行计划：[Phase 0 执行计划](PHASE0_EXECUTION_PLAN.md)。
架构依据：[ADR-0028](../adr/0028-refused-cloudflare-custody-purge.md)、
[ADR-0030](../adr/0030-closing-deterministically-rejected-mutation-sequences.md)、
[ADR-0029](../adr/0029-domain-tombstone-purge-and-re-adding.md)。
