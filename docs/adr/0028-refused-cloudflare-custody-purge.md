# ADR-0028：清除已拒绝使用的 Cloudflare 凭据 custody 并退役连接 incarnation

状态：Proposed — 待产品负责人确认；未实现，三种情况继续失败关闭。

## 背景

Cloudflare 凭据只在 Host custody（macOS 数据保护 Keychain）中（[ADR-0010](0010-host-owned-secret-path.md)
要求秘密操作由受限 Host 所有）。每个连接 incarnation 对应一个 Keychain 槽位，账户名是由工作区与 incarnation
推导的 `connection_digest`。

**现行 custody 规则**此前只体现在实现中（`secure-host-core` 的 `cloudflare_keychain` 计划类型的
`expected_base_*` 字段，以及执行台账“凭据原子撤销”项），没有写入任何 ADR：在该 incarnation 的锁内读取
槽位，与本地数据库记录的**确切基线**（类型、generation、scope/zone digest、public proof）比较，一致才写入
目标状态，不一致则失败关闭。撤销同样如此：准备时先在本地提交 `revocation_pending` 并拒绝使用，再以墓碑
替换 Active 信封并回读确认。本 ADR 首次把该规则写成决定（见下文“决策”第 0 条），并定义它唯一的例外。

以下三种情况中，本地已经拒绝使用该凭据（失败关闭），但 Token 可能仍留在 Keychain，且现有协议无法
再次撤销：

1. custody 矛盾后连接停在 `remediation_required`，`active_credential_generation` 已清空；
2. 撤销在准备后、prewrite 前被锁定或登出取消，重启后 intent 为 `cancelled`，连接停在
   `revocation_pending`；
3. 撤销回读仍为基线（`TargetNotObservedBurned`），连接已标为 `revoked`。

三者的共同点是 Host 不再掌握槽位的确切基线：它无法区分槽中是旧 Active 信封、墓碑还是别的内容，
基于基线的比较写入因此永远不会成立。

**用户并没有因此失去连接能力**：新建连接（`create_cloudflare_connection_guarded`）只复用未使用过的
inactive 连接，否则插入新的连接 incarnation 与新槽位，状态读回 `not-configured`，引导照常提供“连接”。
三种情况真正失去的是**清理**：旧 Token 可能留在 Keychain 中无法由应用移除，设置中留下一行无效的旧连接。
本 ADR 只解决这一清理问题。

## 决策（提议）

0. **写明现行规则**：Cloudflare custody 槽位的任何写入（激活、轮换、撤销）都必须在该 incarnation 的锁内
   对本地记录的确切基线比较后进行，不一致即失败关闭。下面的原语是它唯一的例外。
1. **新增一个无基线、只删除的 Secure Host 原语** `purge_retired_cloudflare_slot(incarnation)`：
   - 只针对由连接 incarnation 推导出的那一个 Keychain 槽位；不接受路径、服务名或任意账户名。
   - 在 Keychain 锁内删除该槽位（无论内容是什么），随后在同一锁内回读，要求槽位不存在。
   - 结果只有 `Purged`、`AlreadyAbsent` 与 `Unknown`（删除或回读失败）；不读取、不返回、不记录 Token，
     也不解析槽位内容。
   - Linux 与 Windows 上 Cloudflare custody 本就不可用（[ADR-0025](0025-linux-secret-service-custody.md)），
     原语在那里返回不可用。
2. **连接 incarnation 增加不可逆的退役状态**：`local_provider_connections` 与受 schema guard 保护的凭据
   表增加 `retirement_pending` → `retired`。只有上述三种已拒绝使用的状态可以进入
   `retirement_pending`，且该 incarnation 不得有任何未解决的凭据 intent 或恢复（否则清除可能与孤立恢复
   竞争）；进入后该 incarnation 的任何激活、准备、观察或写入都被数据库拒绝，且永不复用。备份恢复不得把
   `retirement_pending` 或 `retired` 回退为更早的状态（即使回退，槽位已删除，比较写入仍失败关闭，所以这是
   稳健性要求而不是安全前提）。
3. **两段式执行**：先提交 `retirement_pending`（凭据已被拒绝使用，此步不改变可用性），再调用原语；
   `Purged` 或 `AlreadyAbsent` 时提交 `retired`；`Unknown` 时停在 `retirement_pending`，下次可重试
   （删除是幂等的，重试只会得到 `Purged` 或 `AlreadyAbsent`）。崩溃发生在任何一步，都只会停在可重试的
   `retirement_pending`。
4. **重新连接**只经现有的新建连接路径，产生新的 incarnation 与新的槽位；退役的 incarnation 不会被
   重新激活。
5. **准入**与撤销相同：这是本地 custody 清理，不访问 Cloudflare 网络，不受 ADR-0024 能力资格限制，
   但只在工作区可写（Active 且持有 mutate）时可执行。界面在完成后继续提示用户到 Cloudflare 删除或轮换
   该 API Token——清除本地 custody 不等于在 Cloudflare 撤销 Token。

## 为什么这是 custody 协议的例外，以及为什么安全

现有规则“只对 exact 基线比较后写入”防止的是并发写入覆盖仍在使用的凭据。本原语只作用于数据库已经
永久拒绝使用、且永不复用的 incarnation 槽位：没有任何合法写入者会再写这个槽，删除不会覆盖任何仍然
有效的状态。它也只删除不写入，所以不可能引入未经验证的凭据。

## 备选方案

- **维持失败关闭**：不增加原语。用户仍可新建连接继续使用，但旧 Token 只能由用户自己在系统钥匙串中
  删除，设置中的无效旧连接一直保留。安全，代价是清理落在用户身上。
- **重建基线**：从槽位内容推断基线再走比较写入。需要 Host 读取并解析可能已损坏或来源不明的槽位内容，
  违背“不解析未知 custody 内容”的失败关闭原则。不采用。

## 待产品负责人确认

- 是否接受第 0 条写明的 custody 规则，以及这一无基线删除原语作为它唯一的例外；或维持失败关闭、
  把清理留给用户。
- 退役是否需要用户在界面上显式确认（推荐：需要，与撤销一致，确认文案说明不会在 Cloudflare 撤销
  Token）。

## 后果

接受后，执行台账“清除已拒绝使用但未写成墓碑的 custody”一项按本 ADR 实现：Secure Host 原语与负向
测试（错误 incarnation、非退役状态、锁外调用、回读非空）、迁移与 schema guard、编排器两段式与崩溃
恢复测试，以及引导/设置中对应的界面入口与渲染测试。
