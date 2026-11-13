# ADR-0028：清理已拒绝使用的 Cloudflare 凭据 custody 并退役连接 incarnation

状态：Proposed — 待产品负责人确认；未实现，下述四种情况继续失败关闭。

## 背景

Cloudflare 凭据只在 Host custody（macOS 数据保护 Keychain）中（[ADR-0010](0010-host-owned-secret-path.md)
要求秘密操作由受限 Host 所有）。每个连接 incarnation 对应一个 Keychain 槽位，账户名 `connection_digest`
由 Host 从**准入会话的工作区**与 incarnation 推导（`cloudflare_connection_digest(admission.workspace_id,
incarnation)`），调用方不能提供工作区、账户名或路径。

**现行 custody 规则**此前只体现在实现中（`secure-host-core` 的 `cloudflare_keychain` 计划类型的
`expected_base_*` 字段，以及执行台账“凭据原子撤销”项），没有写入任何 ADR：在该 incarnation 的锁内读取
槽位，与本地数据库 `cloudflare_credential_roots.known_envelope_*` 记录的**确切基线**（类型、generation、
scope/zone digest、public proof）比较，一致才写入目标状态，不一致则失败关闭。本 ADR 首次把该规则写成
决定（见“决策”第 0 条）。

以下四种情况中，本地已经拒绝使用该凭据（失败关闭），但 Token 可能仍留在 Keychain，而现有路径无法再
撤销——撤销的准入只接受 `credential_use_state IN ('inactive','active')`：

1. **`revocation_pending`，撤销 intent 为 `cancelled`**：撤销在准备后、prewrite 前被锁定或登出取消。
   Keychain 从未被写，`known_envelope_*` 仍是该槽位的确切基线（Active 信封）。
2. **`revoked`，账本头为 `burned`/`target_not_observed` 的撤销**：回读结果**等于**基线（`classify_resolution`
   只在观察值与 intent 基线完全相同时给出 `TargetNotObservedBurned`）。`known_envelope_*` 只在 `Confirmed`
   或 `TargetPresentAuthorityStaleBurned` 时更新，`TargetNotObservedBurned` 不改动它，所以它仍是确切基线，槽位里就是旧 Active 信封。
3. **`remediation_required`**：custody 矛盾——恢复观察为 `recovery_required`、内容格式错误或不可读，
   或 prewrite 检查与基线不一致。此时槽位内容不等于任何允许写入的已知基线，比较写入不可能成立。
4. **intent 停在 `recovery_required`**：Keychain 写入开始后崩溃，恢复观察到的槽位既不是目标也不是基线，
   或格式错误、不可读。`classify_resolution` 对格式错误与不可读永远返回 `RecoveryRequired`，而 intent 的
   phase 触发器只允许 `recovery_required → consumed`，所以槽位持续畸形时这个 intent 永远不会结束；连接停在
   `transition_pending` 或 `revocation_pending`，唯一索引 `cloudflare_credential_one_live_intent` 使该
   incarnation 不能再准备任何 intent。

因此情况 1、2 缺的只是**准入**，基线规则本身足以完成撤销；情况 3、4 真正无法基于基线写入，且情况 4
还缺一个不伪造 custody 结果的终止路径。

**用户并没有因此失去连接能力**：新建连接（`create_cloudflare_connection_guarded`）只复用从未建立 root
的 inactive 连接，否则插入新的逻辑连接与 incarnation，状态读回 `not-configured`，引导照常提供“连接”。
四种情况真正失去的是**清理**：旧 Token 可能留在 Keychain 中无法由应用移除，设置中留下一行无效的旧
连接。本 ADR 只解决这一清理问题。

现有结构中可复用的部分：`cloudflare_credential_roots.retired_at` 已存在且已被执行——凭据准备在
`retired_at` 非空时拒绝，唯一索引 `cloudflare_connection_one_current_incarnation` 只计 `retired_at IS NULL`
的 incarnation，DNS 发布查询要求 `retired_at IS NULL`——但目前没有任何路径设置它。唯一索引
`cloudflare_credential_one_live_intent` 保证每个 incarnation 至多一个未结束的 intent（`prepared`、
`prewrite_inspection_started`、`keychain_write_started`、`recovery_required`）。

## 决策（提议）

0. **写明现行规则**：Cloudflare custody 槽位的任何写入（激活、轮换、撤销）都必须在该 incarnation 的
   Keychain 锁内对 `known_envelope_*` 记录的确切基线比较后进行，不一致即失败关闭。第 2 条的删除原语是
   它唯一的例外，且只用于情况 3、4。

1. **情况 1、2：按基线再次撤销，不需要例外。** 撤销准入扩展到这两种状态，且仅当：
   - 情况 1：该 incarnation 没有未结束的 intent，最近一个撤销 intent 为 `cancelled`；
   - 情况 2：root 的账本头是 `operation_kind='revoke'`、`result='burned'`、`burn_reason='target_not_observed'`；
   - 两者都要求 `known_envelope_kind='active'`、`retired_at IS NULL`。

   新撤销走现有协议：期望头为 `highest_resolved_generation`，基线为 `known_envelope_*`，目标为下一
   generation 的墓碑，准备时连接保持（或回到）`revocation_pending`。`Confirmed` 后连接为 `revoked`，root
   `known_envelope_kind='tombstone'`，与任何一次正常撤销的结果相同，不再需要退役。若基线比较失败，按
   现有路径进入 `remediation_required`，即情况 3。

2. **情况 3、4：新增一个无基线、只删除的 Secure Host 原语** `purge_retired_cloudflare_slot`：
   - 输入是 Host 为已准入工作区生成的计划，只含 incarnation；`connection_digest` 由 Host 从准入会话的
     `workspace_id` 推导，原语不接受工作区、路径、服务名或账户名。
   - 在该槽位的 Keychain 锁内删除（无论内容是什么），随后在同一锁内回读，要求槽位不存在。
   - 结果只有 `Purged`、`AlreadyAbsent` 与 `Unknown`（删除或回读失败）；不读取、不返回、不记录 Token，
     也不解析槽位内容。
   - 只在当前平台具备 Cloudflare custody 后端时可用（目前仅 macOS 数据保护 Keychain）；其他平台返回
     不可用。Linux 依 [ADR-0025](0025-linux-secret-service-custody.md) 不托管 Cloudflare 凭据，Windows 目前
     没有该后端。

3. **退役建立在 `cloudflare_credential_roots` 上，不另造凭据表状态。**
   - root 新增 `retirement_requested_at`（可空）。`retirement_requested_at` 与 `retired_at` 都只能从空
     变为非空，`retired_at` 非空要求 `retirement_requested_at` 非空；由触发器保证不可回退。
   - 所有凭据准入（准备、prewrite、观察、恢复、DNS 发布）在 `retirement_requested_at` 非空时拒绝，
     与现有 `retired_at` 检查并列。
   - `local_provider_connections.credential_use_state` 新增 `retired`，只在设置 `retired_at` 的同一事务中
     写入；退役请求期间连接保持 `remediation_required`（情况 4 在进入退役的事务中改为
     `remediation_required`，见第 4 条）。
   - root、generation 账本、intent 与连接行全部保留（外键为 `RESTRICT`，审计历史不丢）；不删除物理行。
     设置界面不再列出 `retired` 连接。
   - 凭据 schema guard 升到新 epoch 与新指纹。

4. **原子准入与并发**：
   - 进入退役在一个 `BEGIN IMMEDIATE` 事务内完成，先确认 `retirement_requested_at` 与 `retired_at`
     为空，再按 incarnation 的未结束 intent 分三类：
     - **`prepared`、`prewrite_inspection_started`、`keychain_write_started`**：拒绝进入退役。前两者
       可能有执行中的操作（或由下次可写打开的孤儿恢复取消），后者需要先经恢复观察落到 `consumed` 或
       `recovery_required`。这三个 phase 是仅有的“可能正在执行或尚未观察”的状态，排除它们就排除了
       所有执行中的操作。
     - **没有未结束的 intent**：连接必须为情况 3（`remediation_required`）。
     - **`recovery_required`（情况 4）**：在同一事务中把该 intent 从 `recovery_required` 改为新的终止
       phase `abandoned_for_retirement`（`terminal_reason='retired'`），并把连接改为
       `remediation_required`、`lifecycle_status='invalid'`。
     然后设置 `retirement_requested_at`。该事务提交后，任何后续准入都在其自身的 IMMEDIATE 事务中看到
     该列并拒绝。
   - **放弃恢复不伪造 custody 结果**：`abandoned_for_retirement` 只在上述事务中、只从
     `recovery_required` 进入，phase 触发器加入这一条边且它是终止态，此后不能再转换。intent 行（基线、
     目标、marker 与时间）原样保留作为审计证据；不写 generation 账本结果，不推进
     `highest_resolved_generation`，不改动 `known_envelope_*`，所以没有任何记录声称槽位处于目标、基线或
     墓碑状态。恢复解析读取 intent 与写入账本时都限定 phase 为 `keychain_write_started` 或
     `recovery_required`，所以放弃后迟到的恢复回调失败关闭、不写任何东西；恢复观察本身只读
     Keychain、从不写入（`inspect_cloudflare_recovery_guarded`）。
   - 已在 Keychain 写入中的操作必然持有 `keychain_write_started` 的 intent，所以无法与退役同时存在；
     Keychain 写入与原语共用同一槽位锁，原语不会与写入交错。
   - 只有工作区可写（Active 且持有 mutate）时可执行；提交前复核准入与租约。

5. **两段式执行与持久重试**：
   - 先提交 `retirement_requested_at`（凭据已被拒绝使用，此步不改变可用性；情况 4 的连接本来就因为
     未结束的 intent 不能使用），再调用原语；`Purged` 或
     `AlreadyAbsent` 时在一个事务内设置 `retired_at` 与 `credential_use_state='retired'`；`Unknown` 时保持
     请求状态。
   - 重试只在两个时机发生：工作区以可写身份打开时（与现有凭据孤儿恢复同一时机，每次打开每个
     incarnation 至多一次），以及用户在设置中点“重试清理”。没有后台循环。删除幂等，重试只会得到
     `Purged`、`AlreadyAbsent` 或再次 `Unknown`。
   - 界面在请求状态下显示“清理未完成”和重试按钮；用户不能撤回退役请求（凭据本已拒绝使用，撤回没有
     意义）。请求状态不影响备份、恢复与其他连接。
   - 崩溃发生在任何一步，都只会停在可重试的请求状态。

6. **备份恢复不回退退役**：恢复时若候选中某 incarnation 的 `retirement_requested_at`/`retired_at` 比当前
   更早或为空，以当前值为准（单调合并）。即使回退，槽位已删除，比较写入仍失败关闭，所以这是稳健性
   要求而不是安全前提。

7. **重新连接**只经现有的新建连接路径，产生新的逻辑连接、incarnation 与槽位；退役的 incarnation 永不
   复用。

8. **用户确认与准入**：与撤销一致，执行前用户显式确认，确认文案说明“只清除本机保存的 Token，不会在
   Cloudflare 撤销它”，完成后继续提示用户到 Cloudflare 删除或轮换该 API Token。这是本地 custody 清理，
   不访问 Cloudflare 网络，不受 ADR-0024 能力资格限制。

## 为什么第 2 条是 custody 协议的例外，以及为什么安全

现有规则“只对确切基线比较后写入”防止的是并发写入覆盖仍在使用的凭据。删除原语只作用于数据库已经
在原子事务中永久拒绝使用、没有未结束 intent（情况 4 的 intent 在同一事务中已终止为
`abandoned_for_retirement`）、且永不复用的 incarnation 槽位：没有任何合法写入者会再写
这个槽，删除不会覆盖任何仍然有效的状态。它只删除不写入，所以不可能引入未经验证的凭据。情况 1、2
不使用该例外，因为它们的基线仍然确切。

## 备选方案

- **维持失败关闭**：不扩展撤销准入，也不增加原语。用户仍可新建连接继续使用，但旧 Token 只能由用户
  自己在系统钥匙串中删除，设置中的无效旧连接一直保留。安全，代价是清理落在用户身上。
- **四种情况都用无基线删除**：实现更简单，但对情况 1、2 无必要地扩大了例外的适用范围。不采用。
- **从槽位内容重建基线**：需要 Host 读取并解析来源不明的槽位内容，违背“不解析未知 custody 内容”的
  失败关闭原则。不采用。
- **情况 4 把 intent 记为 `consumed` 或写一条 burned 账本结果后再退役**：会让审计记录声称一个从未观察到
  的 custody 结果。不采用；改用不写账本的终止 phase。

## 待产品负责人确认

- 是否接受第 0 条写明的 custody 规则；情况 1、2 按基线再次撤销；情况 3、4 使用无基线删除原语作为
  唯一例外，情况 4 的 intent 以 `abandoned_for_retirement` 终止。或维持失败关闭、把清理留给用户。
- 退役是否需要用户在界面上显式确认（推荐：需要）。

## 后果与验收

接受后，执行台账“清除已拒绝使用但未写成墓碑的 custody”一项按本 ADR 实现：

- **迁移**：root 的 `retirement_requested_at` 与单调触发器、连接状态 `retired`、schema guard 新 epoch；
  所有凭据准入查询加入退役检查。intent 表是 SQLite `STRICT` 表，其 CHECK 只能经**重建表**修改，重建时：
  phase 枚举加入 `abandoned_for_retirement`；`terminal_reason` 枚举加入 `retired`；“只有 `cancelled` 可带
  `terminal_reason`”的配对约束改为 `cancelled` 或 `abandoned_for_retirement` 可带（后者必须为
  `retired`）；“已记录 marker 只能处于 `keychain_write_started`/`consumed`/`recovery_required`”的约束加入
  `abandoned_for_retirement`（情况 4 的 intent 一定已记录 marker）；phase 触发器加入唯一一条边
  `recovery_required → abandoned_for_retirement`。目前没有其他表引用 intent 表，重建不涉及外键迁移。重建会丢弃该表的触发器与索引，迁移须重建身份不可变触发器、phase
  触发器与 `cloudflare_credential_one_live_intent`（其未结束 phase 列表不含 `abandoned_for_retirement`），并以
  schema 测试比对重建后的定义。
- **再次撤销**：情况 1、2 的准入扩展与测试；基线不一致时进入 `remediation_required` 的测试。
- **Secure Host 原语**与负向测试：非准入工作区、错误 incarnation、未请求退役的 incarnation、锁外调用、
  回读非空、非 macOS 平台不可用；结果不含 Token。
- **编排器**：两段式、每一步崩溃后的重启恢复、`Unknown` 重试、`prepared`/`prewrite_inspection_started`/
  `keychain_write_started` 时拒绝进入退役、退役请求后各类准入被拒绝、备份恢复不回退。
- **槽位持续畸形，仍可安全退役**：intent 为 `recovery_required` 且槽位畸形或不可读时，退役事务把 intent
  终止为 `abandoned_for_retirement`，账本、`highest_resolved_generation` 与 `known_envelope_*` 不变，intent
  行保留；之后迟到的恢复回调被拒绝且不写入；`abandoned_for_retirement` 不能再转换；原语删除
  槽位后连接为 `retired`。
- **界面**：设置中的“清理”与“重试清理”入口、确认文案、完成后的 Cloudflare 提示与渲染测试。

完成条件：上述测试全部通过；生产入口在本 ADR 接受前不存在可执行路径。
