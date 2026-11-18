# ADR-0032：Desktop 设备切换与 drain 交接

状态：Accepted — 产品负责人于 2026-11-17 按建议接受第 1–5 节与“待产品负责人决定”的全部五项建议（2026-11-16 已决定
把设备切换纳入 v1，台账第 195 行）。实现中：S1a、S1b 普通部分、S1c、S2a、S2b、S2c 本地部分已实现，S1b 强制部分、S1d、S2d、S3、S4 待完成。实施 [ADR-0030](0030-closing-deterministically-rejected-mutation-sequences.md)
的 v2 drain 串通，并是 [ADR-0029](0029-domain-tombstone-purge-and-re-adding.md) 生产重新添加入口的剩余前置。

## 背景

[ADR-0005](0005-single-active-device-and-continuity.md) 规定一个工作区同时只有一台 Active 设备持有
ActiveDeviceLease，业务执行在本地 SQLCipher 中进行。把执行权从一台设备移到另一台，就是设备切换。

2026-11-17 源码快照：

- **协议**：`deviceSwitchRequestSchema`（`normal`；`forced` 须带重新认证证明）与 `deviceSwitchRequestViewSchema`
  （`requested`、`draining`、`waiting_expiry`、`bootstrapping`、`completed`、`cancelled`、`failed`）；目标设备的引导步骤
  `pin_checkpoint`、`fetch_mutations`、`submit_rebuild_digest`；drain proof v1/v2（`execution-events`），以设备签名密钥
  （`signingKeyId`/`signingKeyVersion`）签名，有效期至多 600 秒，覆盖 `mutation`、`execution_fact`、`device_audit` 三条流。
- **Cloud**：`DeviceSwitchWorkflow` 状态机与内存参考服务（`requestSwitch`、`beginBootstrap`、`acceptDrain`）；PostgreSQL
  `device_switch_workflows`、引导能力与步骤服务、`PostgresDeviceDrainTransition`、三条流各自的 drain ledger 与 v2 seal
  （ADR-0030）。规则已编码：普通切换在有 Active 设备时进入 `draining`（24 小时期限）；强制切换进入 `waiting_expiry`，
  最早接管时间取请求时间、独占执行封锁与旧 Lease 离线执行期限的最大者，其后 24 小时内可接管；引导能力 1 小时有效。
- **缺口**：Cloud 入口没有切换、drain 提交、目标设备引导或激活的 HTTP 路由；Desktop 没有切换流程，Host 没有以设备
  密钥签名 drain proof 的路径，也没有 `execution_fact`、`device_audit` 两条流的本地来源；rebootstrap 安装只在测试中编译；
  设置“设备”区没有 Host 来源。

## 决策

### 1. 发起方式

- **普通切换在当前 Active 设备上发起**：设置“设备”中选择一台已绑定的 Standby 设备并确认（brand 设计稿的移交对话框，
  步骤：停止本机写入并同步、目标设备引导、Lease epoch +1）。Active 设备是唯一能完成 drain 的一方，由它发起可以在同一会话
  里先停写再出证明，不需要跨设备通知。
- **强制接管在目标设备上发起，纳入 v1**：用于 Active 设备丢失或损坏。须五分钟内的密码或 Passkey 重新认证（已有
  `reauthProofId`），界面明示最早接管时间与“旧设备上尚未同步的修改不会进入新设备”。等待期内旧设备若恢复联系，
  它的同步与续租照常；接管完成后旧 Lease 失效，旧设备转为 Standby。
- 目标设备必须已与账户绑定且签名密钥有效；Cloud 已拒绝已移除或密钥已撤销的设备。

### 2. 旧设备的 drain

- 发起后 Host 原子关闭本机业务写入准入（与退出 drain 相同的提交栅栏），再推送 Outbox 直到每一行都有持久 Cloud 结果
  （`acknowledged`，或 ADR-0030 的单项 `conflicted`/`sync_mutation_conflict`）。仍有 `pending`/`sending` 行、或推送失败
  可重试时不出证明，界面显示“等待同步”，用户可取消切换并恢复写入。
- Host 按 ADR-0030 B3 从持久结果折叠 v2 结果链（client-core `foldPersistedMutationResults`、`buildDrainProofClaims`），
  以 **ADR-0011 的设备签名密钥**、drain proof 自己的签名域签名，不新建用途密钥：Cloud 已按绑定的
  `signingKeyId`/`signingKeyVersion` 验签，签名域与登录证明分离，私钥不离开 Host custody。
- **`execution_fact` 与 `device_audit` 两条流**：v1 Desktop 不产生这两类事件（没有已资格化的 Provider 执行）。建议以空流
  声明（接收水位 0、无缺失区间、空链摘要），Cloud 以其 ledger 中该设备该流确实为空作核对；第一项 Provider 能力资格化、
  开始产生执行事实前，必须先交付这两条流的本地来源，否则该能力不得资格化。备选：先交付两条流再做切换（推迟本 ADR）。
- Cloud 接收 proof 时在 `device_drain_proofs` 保存 `proof.schemaVersion`，seal 与 Lease 释放同事务提交（已有
  `PostgresDeviceDrainTransition`）。

### 3. 跨 C1a 升级的 Outbox 行

本地记录为 wire 版本 2 的已确认行，无法从本地判断 Cloud 接受的是 v2 还是 v3 提交 envelope，而 v2 结果链按 Cloud
记录的 envelope 摘要成链。建议：Cloud 提供只读的本设备回执查询（只返回该设备自己 mutation 的记录版本与 envelope
摘要），Host 对每个版本 2 行核对返回值属于本地按 v2、v3 分别计算的两个候选之一，并把结果作为该行不可变的版本记录
落盘，之后出证明；任何不符或查询失败都不出证明（失败关闭）。备选：要求所有版本 2 行在升级后已被新的 ACK 覆盖，
否则拒绝切换。

### 4. 目标设备引导与激活

- 目标设备持一次性引导能力，按已有步骤固定 checkpoint、拉取其后的 mutation、重建并提交重建摘要；Cloud 核对摘要后
  激活并签发新 epoch 的 Lease。
- 本地库：目标设备若已有本工作区的 Standby 副本，以 ADR-0029 C3b 的 rebootstrap 安装按已确认 generation 前进，零写入
  拒绝任何更旧数据；没有副本时新建本地库再安装。rebootstrap 安装须在本 ADR 的实现中离开“只在测试编译”。
- **不迁移**（ADR-0005、ADR-0016）：Provider 凭据、平台连接、Provider 绑定与观察、修复回执等只在本机的数据不随切换移动；
  新设备上这些为空，界面在激活后提示重新连接平台。
- 旧设备不删除本地库；它保留为 Standby 的只读副本，其后按 Inbox 正常跟随。

### 5. 界面

设置“设备”区由 Host 读取驱动（设备列表、当前 epoch、可选目标），沿用 `brand/ui_kits/desktop` 的移交确认；目标设备上
显示引导进度与强制接管入口。切换期间两台设备的写入入口都不可用并说明原因。

## 未采用的方案

- **从 Account Web 发起普通切换**：Active 设备仍须在线出 drain proof，多一跳通知而不减少依赖。
- **把本地专有数据随切换搬到新设备**：违反 ADR-0005 与 ADR-0016 的秘密与观察边界。
- **不签名或以会话令牌代替 drain proof**：Cloud 验证要求设备持钥证明，会话不能证明本地 Outbox 已排空。

## 后果

- 切换只在 Outbox 全部有持久结果后完成；离线或持续推送失败的设备只能走强制接管，代价是未同步修改留在旧设备。
- 新设备需重新连接平台；这是凭据不出设备的直接结果。
- `execution_fact`/`device_audit` 的空流声明把“交付两条流”变为第一项 Provider 能力资格化的前置。

## 已决定事项（2026-11-17，均按建议）

1. 普通切换在 Active 设备发起、强制接管在目标设备发起，强制接管纳入 v1。
2. `execution_fact`/`device_audit` 以空流声明；交付两条流是第一项 Provider 能力资格化的前置。
3. drain proof 使用 ADR-0011 设备签名密钥与独立签名域。
4. 版本 2 行以 Cloud 本设备回执查询判别，不符或查询失败即不出证明。
5. 新设备不迁移本地专有数据，激活后提示重新连接平台；旧设备保留为 Standby 只读副本。

## 待决：Standby 会话（2026-11-17 实施 S1b 时发现）

决策 1、4、5 假定目标设备与交接后的旧设备能以 Standby 身份登录 Cloud。源码中 Desktop OAuth 换码与登录 Lease
签发在另一台设备持有当前 Lease 时拒绝，生产中没有无 Lease 的 Desktop 会话，也没有 ADR 规定它。在决定前只推进
Active 设备一侧（S1b 普通发起/状态/取消、S1c、S2）。方案 A（推荐）：新 ADR 规定已绑定且密钥有效的设备可取得
无 Lease 的 Standby 会话与不含 Lease 的 Grant，只能调用只读同步、切换状态、强制接管发起和持引导能力的引导步骤；
push、drain 与续租仍要求 Lease。方案 B：修订本 ADR，目标设备只凭一次性引导能力引导、强制接管由 Account Web
重新认证发起，旧设备交接后退出登录、只保留本地只读副本。

## 实施

- S1 Cloud：PostgreSQL 切换请求服务、drain 提交、引导步骤与激活的 HTTP 路由及回执查询；保存 `proof.schemaVersion`；
  跨租户、过期、重放与绑定不符的负向测试；PostgreSQL 资格运行。2026-11-17 源码快照：PostgreSQL 的
  `PostgresDeviceDrainTransition`、`PostgresBootstrapStepService`、`PostgresBootstrapActivation` 已存在但未组合进任何入口，
  切换请求只有内存参考实现，引导能力的生产验证密钥源固定拒绝。按共享面拆为：
  - S1a 本设备回执查询（决策 4）：协议请求/响应、按会话派生的设备读取 `workspace_device_mutation_sequence_ledger`
    中本设备的 mutation（不接受调用方提供的设备），路由与负向测试。已实现：`POST /v1/workspace-sync/mutations/receipts`（协议
    `workspaceMutationReceiptRead*` v1，一次至多 256 个互不相同的 mutation id），只对当前 Active 的 Desktop 会话设备
    返回其自己的回执（mutation id、Lease epoch、设备序号、Cloud 记录的 wire 版本 2/3 与摘要、接受或拒绝），未记录或
    属于其他设备、其他租户的 id 不出现在结果中；未组合读取器时路由不注册。查询要求会话设备仍持有未释放、未过期的
    Lease，所以 S2 必须在提交 drain proof（释放 Lease）之前完成版本 2 行的判别；
  - S1b 切换请求的 PostgreSQL 服务与路由（发起、状态、取消、强制接管），规则与内存参考实现一致。已实现普通部分：
    `POST /v1/device-switch/requests`、`…/status`、`…/cancel`（协议 `deviceSwitchResponseSchema`，接受时返回请求视图，
    拒绝时只返回封闭代码）。只有持有本工作区当前未过期 Lease 的 Desktop 会话设备能发起，按 drain 锁序加锁，直接进入
    `draining`（24 小时期限），工作流绑定目标设备的有效签名密钥（引导步骤与激活据此验签）；同一幂等键重放返回首个
    结果，内容不同则冲突；一个账户同时只有一个未结束的切换。状态只对切换涉及的两台设备可见，取消只能由来源设备在
    引导开始前进行（引导中的取消须烧掉待定 epoch 与引导能力，归 S1d）。强制接管返回 `FORCED_SWITCH_UNAVAILABLE`，
    等待上文“待决：Standby 会话”；
  - S1c drain 提交路由：组合 PostgreSQL drain 验证端口与 `PostgresDeviceDrainTransition`，保存 `proof.schemaVersion`。
    S1c1 已实现：`PostgresDeviceDrainTransition` 与 SQL `device_consume_drain_proof` 原先把工作流的 `bound_key_id` 与
    来源设备的 proof 签名密钥比较，而引导步骤与激活把它当作目标设备的密钥，两者不可能同时成立；迁移
    `202611170001-drain-handoff-target-key` 与 TypeScript 交接改为要求绑定密钥是目标设备当前有效的密钥，并保留
    proof 签名密钥必须是来源设备当前有效密钥的检查。S1c2 已实现：`/v1/device-switch/requests/drain`（16 KiB）只接受
    会话设备为来源、指名本切换与本工作区的 proof；Cloud 以来源设备当前有效 ADR-0011 公钥按 drain proof 签名域验
    Ed25519 签名（PostgreSQL 无此原语，与 Desktop 登录 proof 同样由应用验签），再调用所有者例程
    `device_record_drain_proof`（迁移 `202611170002-drain-proof-admission`；应用角色对 `device_drain_proofs` 仍只有
    读取权）独立复核本来源的 `draining` 工作流、来源密钥与绑定、当前持有的 Lease、proof 时间窗与 600 秒上限，并把
    proof id 永久绑定到一个摘要；随后交接事务消费 proof，三条流的 seal 例程按不可变 head 核对，短缺、缺口或分叉
    整体回滚并返回 `DRAIN_STREAMS_INCOMPLETE`，切换保持 `draining` 以便提交新的 proof。成功后返回 `bootstrapping`；
    同一 proof 重放返回切换当前状态。`execution_fact`/`device_audit` 空流以序号 0 与创世摘要声明，PostgreSQL 用例
    验证其可 seal；
  - S1d 引导步骤与激活路由：组合已有服务，引导能力以独立用途密钥签发；开发 OpenBao 可组合，生产密钥属外部资格。
- S2 Host：停写栅栏、drain 进度、v2 声明折叠与设备密钥签名、版本 2 行判别；rebootstrap 安装进入生产组合。
  Outbox 与设备密钥都在 Rust Host，Renderer 不可信，所以决策 2 所说 client-core `foldPersistedMutationResults` 与
  `buildDrainProofClaims` 的定义由 Host 以 Rust 复现，并与协议测试钉住同一组金摘要，任何一侧偏离都在两边测试中失败，
  而不是到 Cloud seal 时才发现。按共享面拆为：
  - S2a 声明编码与折叠：提交 envelope（wire 版本 3，及版本 2 行在 ADR-0029 下唯一的首代形式）、v2 结果链折叠（只
    折叠 ACK 与单项 `sync_mutation_conflict`，在第一个没有持久结果的序号处停止）、handoff proof 的 wire 形式、签名
    transcript 与摘要输入；未排空、自相矛盾、空流不在创世摘要或非安全整数的声明一律拒绝生成。已实现：
    `crates/local-storage/src/active_workspace/business/drain_claims.rs`，复现 `mutation-result-v2` 链向量、v3/v2 提交
    envelope 与 v1/v2 handoff proof 的 transcript 与摘要输入金摘要（v2 handoff 的金摘要同时加入协议测试）；
  - S2b 停写栅栏与 drain 进度：持久栅栏原子关闭业务写入准入，在一个快照中读取 Outbox 行与本设备最高已分配序号并
    折叠。已实现：本地迁移 `202611170001` 的 `device_handoff_barriers`（每工作区一行、不可改），存在时由触发器拒绝推进
    设备序号与插入 Outbox，覆盖所有写入路径并跨重启保持；同一切换重复开启幂等，另一切换须先清除；Cloud 结果照常落盘。
    `read_drain_mutation_progress` 重建每行提交时的 wire（加工作区 id、按该行 wire 版本编码），序号须为 1..=最高已分配
    且连续，得出 `Ready`（可签名的声明）、`Waiting`（仍有 pending/sending）或 `Blocked`（本地终止拒绝、幂等冲突或缺行，
    永远无法与 Cloud 链一致，失败关闭）；
  - S2c 版本 2 行判别：经 `/v1/workspace-sync/mutations/receipts` 核对 Cloud 记录的版本与摘要属于本地两个候选之一，
    结果作为该行不可变的版本记录落盘，在提交 proof（释放 Lease）之前完成。已实现本地部分：本地迁移 `202611170002` 的
    `sync_outbox_cloud_wire_versions`（不可变，只能指名有持久结果的版本 2 行）；`drain_receipt_candidates` 列出尚无记录
    的版本 2 行及其 v2、v3 wire 摘要（租户中立 mutation 的摘要，即回执报告的 Cloud 账本 `wire_mutation_digest`；两种
    语言以同一金摘要钉住），`record_cloud_wire_versions` 要求每个回执的 Lease epoch、序号、结果与
    所报版本下的摘要都与候选一致，任一不符整批不写；drain 进度在这些行有记录前报告 `ReceiptsRequired`，有记录后按
    Cloud 版本重建、复核 wire 摘要，再在本地重建该版本的提交 envelope 成链（链摘要不取自回执）。发送回执查询与严格解析响应随 S2d 的协调与 Host 入口；Cloud 未返回的行保持
    `ReceiptsRequired`，协调须失败关闭；
  - S2d 设备密钥签名与提交：ADR-0011 设备身份只对 drain proof transcript 签名（不暴露任意签名），可信时间给出
    600 秒内的窗口，经 `/v1/device-switch/requests/drain` 提交；协调生命周期（开启栅栏、推送 Outbox 直到
    每行有持久结果、折叠、签名、提交，取消、失败或交接完成后清除栅栏）与 Host 入口随本切片；栅栏须能识别出自更早
    Lease epoch 的遗留行（例如记录开启时的 epoch），避免本设备日后重新取得 Lease 时被未清除的栅栏静默关闭写入；S2d1 已实现：
    `secure-host-core` 的 `sign_drain_proof_transcript` 只签逐帧解码为 drain proof 签名域（V1/V2）加唯一规范 proof 对象、
    schemaVersion 与 typ 与域一致、purpose 为 `handoff`、aud 为 drain 验证、尚无签名且 `sourceDeviceId`/`signingKeyId` 为本机的
    transcript，其余（登录证明域、追加字节、重复或乱序键、他机或他钥）一律拒绝，测试钉住协议 v2 handoff transcript 金摘要。
    生产中设备签名密钥只登记版本 1（`device_signing_keys` 无轮换路径），所以 Host 以本机 key id、版本 1 签名，版本不符
    由 Cloud 验签拒绝；引入密钥轮换时 Host 须改为读取 Cloud 登记的版本；S2d2a 已实现：本地迁移
    `202611170003` 为栅栏记录开启时排空的 Lease epoch（同一切换与 epoch 重复开启幂等，其余冲突），
    `clear_left_over_device_handoff_barrier` 在本设备以更新 epoch 持有 Lease 时清除更早或无 epoch 的遗留栅栏，当前
    epoch 的栅栏保持；S2d2b 已实现：`crates/local-storage/src/desktop_device_switch.rs` 的
    Host 入口——在运行准入（设备、Lease epoch 取自已验证 Lease）下开启或清除栅栏、读取 drain 进度、生成至多 256 个 id
    的回执查询并严格解码回执（只接受所问 id、不重复、封闭字段），在本切换栅栏以当前 epoch 关闭写入且 mutation 流完全
    确认时构建 v2 handoff 声明（另两条流为空流、有效期 300 秒、密钥版本 1）与签名 transcript，组装
    `/v1/device-switch/requests/drain` 请求体，并严格解码切换响应（须为本切换、来源为本设备、满足协议细化规则）；S2d3a 已实现：
    Host 生成普通切换请求体（幂等键由 Host 生成），切换 id 只取自 Cloud 接受视图且该视图须是本设备发往所请求目标的普通切换，
    并能读取以当前 Lease epoch 关闭写入的切换以便重启后续行；`apps/desktop/src-tauri/src/device_switch_drain.rs` 的协调器
    串行化本设备的切换调用：Cloud 接受后在提交其答复的同一 Host 提交内关闭写入，已有栅栏时续行而不发起新切换；mutation 流未
    确认时唤醒同步并报告等待，回执读取重复同一批行（Cloud 未返回某行）时失败关闭，只有进度为 Ready 时才以设备密钥签署 Host
    构建的 transcript 并提交；Cloud 报告取消或失败时在同一提交内清除栅栏，交接后栅栏保持（本设备不再持有 Lease），由每次推送前的
    遗留栅栏清除在本设备以更新 epoch 取得 Lease 后清除；发起前先清除更早 epoch 的遗留栅栏；未获答复的请求以同一幂等键与原目标重试，在其获答复前不为任何目标准备新请求（Cloud 可能已开启该切换），已答复的请求不再复用；会话关闭后不提交
    任何答复。切换 Tauri 命令、权限清单、适配器与 Renderer 端口随 S2d3b；rebootstrap 安装进入生产组合随 S1d（待 Standby 决定）。
- S3 Desktop：设置“设备”Host 读取、移交确认、目标设备引导与强制接管界面。
- S4 端到端：拒绝后后续同步与 drain 成功、Lease 轮换后 drain 成功、强制接管后旧设备转为 Standby。
