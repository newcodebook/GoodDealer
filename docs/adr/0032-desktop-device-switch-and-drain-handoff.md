# ADR-0032：Desktop 设备切换与 drain 交接

状态：Accepted — 产品负责人于 2026-11-17 按建议接受第 1–5 节与“待产品负责人决定”的全部五项建议（2026-11-16 已决定
把设备切换纳入 v1，台账第 195 行）。实现中：S1a 已实现，S1b–S1d、S2–S4 待完成。实施 [ADR-0030](0030-closing-deterministically-rejected-mutation-sequences.md)
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
  - S1b 切换请求的 PostgreSQL 服务与路由（发起、状态、取消、强制接管），规则与内存参考实现一致；
  - S1c drain 提交路由：组合 PostgreSQL drain 验证端口与 `PostgresDeviceDrainTransition`，保存 `proof.schemaVersion`；
  - S1d 引导步骤与激活路由：组合已有服务，引导能力以独立用途密钥签发；开发 OpenBao 可组合，生产密钥属外部资格。
- S2 Host：停写栅栏、drain 进度、v2 声明折叠与设备密钥签名、版本 2 行判别；rebootstrap 安装进入生产组合。
- S3 Desktop：设置“设备”Host 读取、移交确认、目标设备引导与强制接管界面。
- S4 端到端：拒绝后后续同步与 drain 成功、Lease 轮换后 drain 成功、强制接管后旧设备转为 Standby。
