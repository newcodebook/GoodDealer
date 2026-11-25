# ADR-0028：Cloudflare 凭据清理与连接退役

状态：Accepted

## 适用状态

以下 generation、intent 与账本规则适用于从 Zone 建立的 Cloudflare 连接，包括该连接衍生的 Registrar 角色。
独立 Registrar 账户凭据没有 Zone 或轮换操作，适用文末不可变槽位规则。

凭据留在 Native custody，每个连接 incarnation 对应一个槽位；Host 从已准入工作区与 incarnation 派生
`connection_digest`，调用方不能选择工作区、账户名或路径。清理按四种状态处理：

1. `revocation_pending` 且最近撤销 intent 为 `cancelled`：prewrite 前取消，槽位仍为已知 Active 基线。
2. `revoked` 且账本头为 `revoke/burned/target_not_observed`：观察值等于基线，已知 Active 基线未改变。
3. `remediation_required`：内容错误、不可读或 prewrite 与基线不一致，无法执行基线比较写入。
4. intent 为 `recovery_required`：写入开始后的恢复既不匹配目标也不匹配基线，需要不伪造结果的终止路径。

## 清理与退役协议

0. **基线比较规则**：Cloudflare custody 槽位的任何写入（激活、轮换、撤销）都必须在该 incarnation 的
   Keychain 锁内对 `known_envelope_*` 记录的确切基线比较后进行，不一致即失败关闭。第 2 条的删除原语是
   它唯一的例外，且只用于情况 3、4。

1. **情况 1、2：按基线再次撤销，不需要例外。** 撤销准入扩展到这两种状态，且仅当：
   - 情况 1：该 incarnation 没有未结束的 intent，最近一个撤销 intent 为 `cancelled`；
   - 情况 2：root 的账本头是 `operation_kind='revoke'`、`result='burned'`、`burn_reason='target_not_observed'`；
   - 两者都要求 `known_envelope_kind='active'`、`retired_at IS NULL`。

   新撤销走现有协议：期望头为 `highest_resolved_generation`，基线为 `known_envelope_*`，目标为下一
   generation 的墓碑，准备时连接保持（或回到）`revocation_pending`。已取消且未记录写入 marker 的 intent
   不消耗 generation：保留旧尝试，以新 intent ID 与 public proof 重试相同目标 generation；目标 generation
   的唯一性约束仅排除 `revoke/cancelled/cancelled_before_inspection` 尝试，未结束 intent 的唯一性保持不变。已写入 marker 的 intent 不可取消，
   因而不能释放 generation。`Confirmed` 后连接为 `revoked`，root
   `known_envelope_kind='tombstone'`，与任何一次正常撤销的结果相同，不再需要退役。若基线比较失败，按
   现有路径进入 `remediation_required`，即情况 3。

2. **情况 3、4：新增一个无基线、只删除的 Secure Host 原语** `purge_retired_cloudflare_slot`：
   - 输入是 Host 为已准入工作区生成的计划，只含 incarnation；`connection_digest` 由 Host 从准入会话的
     `workspace_id` 推导，原语不接受工作区、路径、服务名或账户名。
   - 在该槽位的 Keychain 锁内删除（无论内容是什么），随后在同一锁内回读，要求槽位不存在。
   - 结果只有 `Purged`、`AlreadyAbsent` 与 `Unknown`（删除或回读失败）；不读取、不返回、不记录 Token，
     也不解析槽位内容。
   - 当前系统必须具备 Cloudflare 托管后端。Linux 按 [ADR-0025](0025-linux-secret-service-custody.md) 只用元数据核对固定槽位及确认删除，精确匹配的重复条目可在原槽位锁内一并退役。Windows/macOS 后端均为首发交付目标。

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

6. **恢复不回退退役**：业务备份不包含凭据与连接身份。任何保留本地状态的恢复/重建均不得回退
   `retirement_requested_at`/`retired_at`；已有退役事实以当前单调值为准，不能通过旧状态重新准入槽位。

7. **重新连接**只经现有的新建连接路径，产生新的逻辑连接、incarnation 与槽位；退役的 incarnation 永不
   复用。

8. **用户确认与准入**：情况 3、4 首次退役删除前用户显式确认，后续重试不重复确认；情况 1、2 沿用已批准的撤销意图。确认文案说明“只清除本机保存的 Token，不会在
   Cloudflare 撤销它”，完成后继续提示用户到 Cloudflare 删除或轮换该 API Token。这是本地 custody 清理，
   不访问 Cloudflare 网络，不受 ADR-0027 能力资格限制。

无基线删除只针对已在事务中永久拒绝、没有执行中 intent、永不复用的槽位；删除不写入新凭据。
迁移必须保留身份、phase、marker 配对和 live-intent 唯一约束。故障测试覆盖每一步崩溃、Unknown 重试、
晚到回调、并发写入、非法工作区/槽位与退役单调性，最终原生后端须独立验证。

## 独立 Registrar 账户的不可变槽位

- 独立 Registrar 连接由 Cloudflare Service 持有 Account ID 和用户 API Token。它不取得 DNS 角色，也不创建 Zone root、generation 或 intent。完整账户只读预检成功后才允许写入单一不可变槽位，回读确认后由 Host 提交连接和业务观察。新凭据需经新连接和 incarnation 录入。
- Host 记录工作区、连接、incarnation、公开 proof 和原待扫描请求。槽位键由这些 Host 身份派生，账户 ID、Token 与分页 cursor 留在 Native。仅保存限定当前槽位的账户承诺。刷新请求绑定当前设备和 Lease；交接屏障、撤销或授权变化会拒绝迟到结果。
- 用户在设置断开连接后，Host 先不可逆停用槽位、清空待扫描请求，再准入固定用途元数据删除。成功确认不存在才隐藏连接。未知结果在可写重开或用户重试时重复同一删除，保留历史回执。删除不解码槽位内容，不接触 Cloudflare，也不准入其他连接。
