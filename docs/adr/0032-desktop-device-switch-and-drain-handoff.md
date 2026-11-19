# ADR-0032：设备切换、drain 与无 Lease 的 Standby 会话

状态：Accepted

## 单活动设备与时间约束

最多绑定两台设备，同一时刻只有一台 Active；Cloud 是设备、Lease/Epoch 的授权源，外部执行窗口最长 24 小时。
无效 Lease、撤销设备或本地自报状态不能取得执行权，授权失效不删除或覆盖本地数据库。
普通切换 drain 期限为 24 小时；drain proof 绑定三条流、来源设备及用途，签名有效期至多 600 秒。
强制接管最早时间取请求时间、独占执行封锁与旧 Lease `offlineExecuteUntil` 的最大值，其后 24 小时内接管。
引导能力至多 1 小时，绑定目标设备当前有效密钥和工作流；引导完成并核对摘要后才能激活预分配 epoch。
`bootstrapping` 的取消或过期必须烧掉 pending epoch 与能力；切换界面启用前须交付该终结路径。

## 交接协议

### 1. 发起方式

- **普通切换在当前 Active 设备上发起**：设置“设备”中选择一台已绑定的 Standby 设备并确认（brand 设计稿的移交对话框，
  步骤：停止本机写入并同步、目标设备引导、Lease epoch +1）。Active 设备是唯一能完成 drain 的一方，由它发起可以在同一会话
  里先停写再出证明，不需要跨设备通知。
- **强制接管在目标设备上发起，纳入 v1**：用于 Active 设备丢失或损坏。须五分钟内的密码或 Passkey 重新认证；采用下文规定的新登录与单次重新认证窗口，界面明示最早接管时间与“旧设备上尚未同步的修改不会进入新设备”。等待期内旧设备若恢复联系，
  它的同步与续租照常；接管完成后旧 Lease 失效，旧设备转为 Standby。
- 目标设备必须已与账户绑定且签名密钥有效；Cloud 拒绝已移除或密钥已撤销的设备。

### 2. 旧设备的 drain

- 发起后 Host 原子关闭本机业务写入准入（与退出 drain 相同的提交栅栏），再推送 Outbox 直到每一行都有持久 Cloud 结果
  （`acknowledged`，或 ADR-0019 的单项 `conflicted`/`sync_mutation_conflict`）。仍有 `pending`/`sending` 行、或推送失败
  可重试时不出证明，界面显示“等待同步”，用户可取消切换并恢复写入。
- Host 按 ADR-0019 的 mutation 结果链规则从持久结果折叠 v2 结果链；持久结果与设备私钥在 Native，Host 构建并签名声明，两端以共同金向量校验，
  以 **ADR-0011 的设备签名密钥**、drain proof 自己的签名域签名，不新建用途密钥：Cloud 已按绑定的
  `signingKeyId`/`signingKeyVersion` 验签，签名域与登录证明分离，私钥不离开 Host custody。
- **`execution_fact` 与 `device_audit` 两条流**：只有确实不产生对应事件时才声明空流（接收水位 0、无缺失区间、
  创世摘要），Cloud 核对其 ledger 确实为空。第一项 Provider 能力产生执行事实前必须交付两条流的本地来源。
- Provider 执行历史通过 ADR-0019 的真实 execution_fact/device_audit 来源、签名和精确回执进入证明，不能将本地已存在的尝试声明为空流。
  drain 屏障关闭新批准与 dispatch，等待本机在途 producer 到安全边界；远端未决结果可明确冻结为 unknown 并停止旧 epoch producer，界面显示数量与原机保留含义。
  所有已分配事件必须获得精确 Cloud 确认后才能封链；冻结不丢弃序号、不伪造成功，也不将队列或凭据搬给目标设备。取消仅按原屏障规则恢复；成功后旧机不能继续旧 epoch 追加或重发。
  producer 冻结与结果提交采用同一数据库锁序和事务边界：结果完整提交并进入待确认的尾部，或保留原 claim/unknown。
  冻结后到达的 HTTP 响应不补写旧 epoch 结果。权威取消确认且仍持原 Active epoch 时可原子重开 producer；之后重新 GET
  取得当前观察。交接成功不能重开；原机以后取得新的 Active epoch 时，同样只以新 GET 和当前上下文生成关联旧事实的
  新观察审计，不能为先前响应补造时间或签名。
- Cloud 接收 proof 时在 `device_drain_proofs` 保存 `proof.schemaVersion`，seal 与 Lease 释放同事务提交。

### 3. 已确认 Outbox 的提交版本核对

本地记录为 wire 版本 2 的已确认行，需要核对 Cloud 实际记录的 v2/v3 提交版本。Cloud 仅向当前 Active
会话设备返回其自己的 mutation 回执（记录版本、wire 摘要、epoch、序号与接受/拒绝结果）。Host 核对回执与
本地两种候选的版本、摘要及身份一致，再把判别结果作为不可变记录落盘；用该版本在本地重建提交 envelope
并折叠结果链，不把回执摘要直接当作链摘要。未知、缺失、重复、错配或查询失败均不出证明。
查询及落盘必须在 drain 释放 Lease 前完成。

### 4. 目标设备引导与激活

- 目标设备持一次性引导能力，按已有步骤固定 checkpoint、拉取其后的 mutation、重建并提交重建摘要；Cloud 核对摘要后
  激活并签发新 epoch 的 Lease。
- 本地库：目标设备若已有本工作区的 Standby 副本，以 ADR-0029 的 rebootstrap 安装按已确认 generation 前进，零写入
  拒绝任何更旧数据；没有副本时新建本地库再安装。rebootstrap 必须完成生产原生组合与故障验证。
- **不迁移**（ADR-0016）：Provider 凭据、平台连接、Provider 绑定与观察、修复回执等只在本机的数据不随切换移动；
  新设备上这些为空，界面在激活后提示重新连接平台。
- 普通交接后的旧设备保留本地库为 Standby 只读副本并跟随 Inbox；强制接管后有未同步修改的旧设备按下文保留原快照。

### 5. 界面

设置“设备”区由 Host 读取驱动（设备列表、当前 epoch、可选目标），沿用 `brand/ui_kits/desktop` 的移交确认；目标设备上
显示引导进度与强制接管入口。切换期间两台设备的写入入口都不可用并说明原因。

## Standby 会话与授权

### S1. 谁可以取得 Standby 会话

Standby 会话是 `client_kind = 'desktop'` 的普通 Desktop 会话，取得时不要求本设备持有 Lease。资格条件全部来自锁定的
服务端状态，在授权码签发、换码、每次刷新与每次 Grant 签发时各检查一次：

- 账户安全状态 `normal`，且会话、授权码与当前 `account_security_epoch` 一致；
- 设备绑定 `bound`，且存在 `active` 的设备签名密钥（与 `checkLoginEligibility` 相同条件）；
- 登录仍须完成 ADR-0011 的 challenge、持钥证明、loopback 与 PKCE；首次绑定仍须五分钟内的密码或 Passkey
  认证。Standby 不降低任何登录证明，只去掉“必须持有 Lease”这一条；
- 账户与租户只来自授权码或令牌中的账户、该账户的个人默认工作区（`DefaultWorkspaceTenantResolverPort`），设备只来自
  会话行的 `device_id`；请求体不携带任何账户、工作区、设备、epoch 或角色选择。

**角色不写进会话，按请求从服务端状态派生。** 同一会话在交接、激活或强制接管后无须重新登录即改变角色：

| 服务端状态（同一账户事务内锁定读取） | 角色 |
| --- | --- |
| 会话设备持有当前 epoch、未释放、在线期内的 Lease | Active |
| 另一台设备持有 Lease；或存在任一未结束的切换工作流（`requested`、`draining`、`waiting_expiry`、`bootstrapping`）且本设备不是持有者；或存在 pending epoch 分配；或 `exclusive_execution_block_until` 未到 | Standby |
| 无人持有 Lease、无未结束的切换、无 pending epoch、无封锁 | 满足商业授权时，登录或刷新为本设备分配 Lease，成为 Active |
| 资格条件任一不满足 | 拒绝（不签发、不刷新、路由拒绝） |

登录与刷新的 Lease 步骤因此从“必须得到 Lease”改为“得到 Lease 或确定为 Standby”。**登录与刷新绝不在存在未结束切换
工作流或 `pending` epoch 分配时分配 Lease**；分配约束必须先于切换入口启用。

商业权益：Standby 只读、不执行，**不要求有效权益**；Lease 的分配与续租仍按现有
规则受 Licensing 截止时间约束。

### S2. Standby 可调用的路由与其余路由的拒绝方式

Standby 可调用的路由是封闭清单：

| 路由 | Standby 条件 |
| --- | --- |
| `POST /v1/devices/authorization-grant` | 返回 Standby Grant（S3 节） |
| `POST /v1/workspace-sync/mutations/pull` | 只读取同步副本，不写入业务数据；按会话设备打开并推进 reader cursor（Cloud 状态写入，见下文） |
| `POST /v1/workspace-sync/checkpoint` | 只读 |
| `POST /v1/workspace-sync/rebootstrap` | 只读，返回重建计划 |
| 设备列表（`/v1/devices/list`） | 只读；只要求已绑定的 Desktop 会话 |
| 本设备名称上报（`/v1/devices/self`） | 属于设备元数据写入，要求 Active；Standby 通过列表读取本设备，不显示改名入口 |
| `POST /v1/device-switch/requests/status` | 只对本设备为来源或目标的切换可见（现有规则） |
| `POST /v1/device-switch/requests` | 只接受 `mode: "forced"`，且 `toDeviceId` 必须等于会话设备；须满足 S5 节的重新认证 |
| `POST /v1/device-switch/requests/cancel` | 只接受取消本设备为目标、仍处于 `waiting_expiry` 的强制接管 |
| `POST /v1/device-switch/bootstrap/status` | 仅发现本会话设备作为目标的唯一 `bootstrapping` 工作流，或按精确 id 读取本目标历史；账户和默认工作区由服务器派生 |
| `POST /v1/device-switch/bootstrap/cancel` | 仅终止本会话设备作为目标的精确 `bootstrapping` 工作流；未领取能力也可取消；原子烧 pending epoch、消费能力与 nonce、释放 pin，保留来源交接回执，不授予执行权限 |
| `POST /v1/device-switch/bootstrap/receipt` | 当前绑定的精确目标会话可核对原 claim、step 或 activation；不要求历史能力仍有效，终态回执不能恢复旧 nonce 或执行权 |
| `POST /v1/device-switch/bootstrap/claim`、`step`、`checkpoint`、`activate` | Active/Standby 会话设备必须是工作流目标；后三者同时出示绑定该设备与工作流的独立用途引导能力 |

目标停止引导的确认绑定精确工作流 id，Native 先持久化意图再发送；未知响应与重开先查同一工作流，再决定重发原取消。新工作流必须重新预览确认，历史取消不得套用到它。取消与激活、过期、步骤提交在账户/工作流锁序下串行；终结不回退最高分配 epoch，不恢复来源 Lease，也不删除既有云副本或原机数据。

其余 Desktop 路由——`mutations/push`、`mutations/receipts`、`device-switch/requests/drain`、普通切换请求、来源设备取消、
`/v1/workspace-observations/cloudflare-dns` 以及以后新增的任何路由——都要求 Active。拒绝分两层，任一层都足以拒绝：

1. **路由声明**：Desktop 路由的 `RouteAdapter` 增加必填的 `deviceRole: "active" | "active_or_standby" | "bound_device"`，没有默认值；
   路由表测试钉住 `active_or_standby` 的精确集合，新增路由不声明或扩大集合都使测试失败（与现有 Tauri 命令清单测试
   同一方式）。`bound_device` 仅用于目标引导 `status`、`cancel`、`receipt` 三条路由；它验证当前会话、刷新族、安全代次、默认工作区、设备绑定和有效设备密钥，不要求仍有效的 Lease 或引导能力。历史回执查询和终结不能被过期的 pending 能力阻止；不使用空角色跳过准入。
2. **应用层解析**：Active 路由继续只经 `resolveActiveDevice`；Standby 可调用的路由改经新的
   `resolveSessionDevice(principal, workspaceId) → { deviceId, role } | null`，它在同一事务中复核 S1 节全部资格条件，
   再由各服务按上表细化（例如强制接管要求 `role = standby` 且目标为本设备，Active 设备不能对自己发起强制接管）。

“只读”指业务数据：Standby 的 pull 会为该设备打开 reader cursor，而活动 cursor 会钉住 Cloud 的 mutation 历史保留。这不新增机制——cursor 沿用现有退役规则（`ttl_expired`、`compaction_race`、`device_removed`），退役后该设备只能经
rebootstrap 计划重建——但长期不在线或权益已过期的 Standby 设备会影响保留量；权益过期账户也沿用同一 cursor TTL 退役规则限制保留量。

拒绝沿用各路由现有的封闭结果（同步路由 `SYNC_AUTHORIZATION_REJECTED`，其余为不带细节的授权拒绝），不新增
“你是 Standby”的错误码；设备的角色只经 Grant 告知 Host。

### 目标首次安装、激活与未知结果

首次安装只接纳 Native custody 明确证明尚未初始化的固定业务库；复用其已有 SQLCipher key，不替换已初始化副本。Fresh、OrdinaryOpening、Installing、Initialized 持久标记区分普通初始化、合法崩溃前缀与缺失/截断；不能凭零长度库推导 fresh。现有副本恢复仍遵守 ADR-0023 的替换合同。

用户确认精确工作流后，Host 在 Native 中先持久化每个原请求及身份，再进行网络操作。claim 保存原签名能力和首 nonce；step v2 的 pin 请求为空，由 Cloud 在同一授权事务选择或构建、持久读回核验、发布并固定真实 checkpoint 与目标 revision/schema。最终摘要使用包含资产 generation 和墓碑的 checkpoint state v3。数据页按实际 UTF8 字节预算取连续前缀；Native 验证严格字段、页摘要、完整分区、排序、代次与 mutation 连续性后，由原单 writer 原子写入业务数据和不可变安装回执，不导入平台凭据、绑定、Outbox 或可执行任务。

安装 journal 使用专用域从本机数据库 key 派生的加密密钥，数据写入 Native 私有文件并同步、读回，OS custody 中的小型 head 绑定安装、固定业务文件和 journal digest/revision。恢复先验证 head 与所选文件；任一缺失或篡改均失败关闭。秘密临时缓冲由 zeroizing owner 持有，journal 不进入业务备份。慢速文件、数据库及验签在 stage 执行，最终内存发布仍经过原 publication/power/session 栅栏。

激活仅使用本机已落盘的原 activation UUID、请求摘要、完整安装回执和该工作流预留的 pending epoch。Cloud 同事务保存精确原请求与签名 Lease 响应，重复请求返回原回执，不重新签名、延长期限或分配 epoch。未知 claim、step 或 activation 结果先按精确身份查询 receipt，只有明确 uncommitted 且工作流仍活跃时才重发原字节。历史 receipt 可在能力过期后由当前有效目标身份查询，但不能继续已终结工作流。安装未完成不得经普通 Standby 读取或 Active 刷新提前发布；取得匹配的当前 Active Grant 与新鲜执行上下文后才开放资产工作区，平台需重新连接。

Cloud 已提交激活但本机丢失回复时，重开可能先收到 Active Grant。Host 可接受与持久 pending activation 精确匹配的签名身份，发布单独受限的目标安装控制准入；它不发布业务库，不提供普通同步、Provider 或本地读写能力，只允许固定的原 receipt、status、cancel。Renderer 显示 `target_installation_pending`，不冒充 Standby 或空资产工作区。取回并验证原激活回执后准备已安装库，匹配的新鲜 execution context 在原最终栅栏发布后才开放业务；后台随后持久标记安装完成。

取消意图先持久化。若激活结果未知，安装与终止协调器共享同一串行入口，先查原激活回执：committed 接受已完成事实；uncommitted 后禁止重发激活，继续精确取消。取消确认不能被瞬时拒绝后仍自动推进激活，也不能被 Renderer 误报为已生效。

### S3. 不含 Lease 的 Grant

**Wire**：`/v1/devices/authorization-grant` 的请求升为 `schemaVersion: 5`，响应为按 `role` 区分的封闭联合：

```text
{ schemaVersion: 5, role: "active",  grant: <desktopAuthorizationGrantSchema v4> }
{ schemaVersion: 5, role: "standby", grant: <desktopStandbyGrantSchema v1> }
```

`desktopStandbyGrantSchema` 是独立的 strict 对象，不是 Active Grant 的可空变体：

- `typ: "gd.desktop-standby-grant.v1"`，`aud: "gooddealer-desktop/standby"`，`iss` 与 Active Grant 相同，签名域
  `GOODDEALER-DESKTOP-STANDBY-GRANT-V1`；
- `kid`、`issuedAt`、`expiresAt`（至多 900 秒，与 access token 同长）、`accountId`、`deviceId`、`accountSecurityEpoch`、
  `workspace: { workspaceId, kind: "personal_default" }`；
- `leaseEpochFloor`：通常为签发事务中读到的 `highest_allocated_lease_epoch`（安全非负整数，含 `pending` 分配）。唯一例外是**当前有效引导工作流的精确目标设备**：Cloud 在同一锁定事务确认唯一 pending 分配、`pending = highest > current`、工作区与账户一致、工作流仍为 bootstrapping、当前 security epoch、目标有效绑定与精确签名密钥、未消费且未过期的同工作流引导能力后，签发 `pending - 1`。该目标稍后才能接受预留 epoch 的 Active Lease；其余设备仍使用 highest，任何不一致状态拒绝签发。客户端不能选择此例外；
- `scopes: ["workspace:read"]`（固定元组）；`signature`。
- 没有 `activeDeviceLease`、`commercialAuthority` 或任何执行能力字段；strict 解析使带有这些键的对象整体被拒绝。

只接受当前版本请求和角色联合响应，其他版本均拒绝，不保留兼容路径（[ORCHESTRATION](../ORCHESTRATION.md)“没有兼容或过渡路径”）。

**签名密钥**：Standby Grant 用独立用途的 OpenBao Transit 密钥签名，Desktop 的 build-pinned 公钥 allowlist 增加该用途；
Active Grant、Lease 与 Standby Grant 三个用途的公钥互不通用。

**存储**：Cloud 不为角色或 Grant 新增持久字段或表；重新认证窗口单独按 S5 节存储。会话行不记录角色；Standby Grant 与现有 Grant 一样签发后不落库，签发事务对
安全状态、会话与刷新族、默认工作区、设备绑定与签名密钥、`device_account_states` 加锁读取，签名返回后以
`clock_timestamp()` 复核这些状态与“本设备仍不持有 Lease”。Host 在 local-storage 的 Native custody 中持久化安装、账户、工作区、设备绑定及 security epoch、issuedAt、最大 Lease epoch、Standby floor 和最近商业 revision/digest/deadline/capabilities 地板；它们不属于业务库或业务备份。持久写入和读回成功后才在原 publication mutex 内发布角色。首次建立标记与地板记录任一缺失、损坏或绑定不符均失败关闭，不能把已建立记录丢失当成首次授权；整个 OS 托管区被一起回滚的抵抗能力需要平台资格单独取证。Standby 降级不得遗忘商业地板。

**负向情形**：

- **伪造 Lease 声明**：Cloud 从不接受客户端提供的 Grant、Lease 或角色——每条路由从锁定状态派生角色，客户端无从
  “声明”Lease。Host 侧，Standby Grant 不能携带 Lease（strict 拒绝），Active 响应中的 v4 Grant 仍须分别以稳定的 Desktop Grant 与
  Lease 两个用途的密钥验签；用 Standby 密钥签的 Active Grant 形状、用 Desktop Grant 密钥签的 Standby 形状、`role` 与 `grant.typ` 不符、两种
  形状混合，全部拒绝。
- **已撤销设备**：绑定 `removed` 或签名密钥非 `active` 时，授权码签发、换码、刷新、Grant 签发与每条 Standby 路由都在
  各自事务中拒绝；引导能力与工作流已绑定目标设备的有效密钥，撤销后引导步骤与激活同样拒绝。
- **跨租户**：账户来自令牌，工作区来自该账户的默认工作区解析，设备来自会话；切换、引导能力与步骤行都在
  `withTenant` 的账户与工作区范围内读取；状态只对来源或目标设备可见；引导能力的 `deviceId` 必须等于会话设备。
  另一账户的设备 id、工作流 id、能力 jti 一律表现为不存在。
- **重放**：授权码单次消费；刷新沿用轮换与复用检测；Standby Grant 至多 900 秒有效，Host 只接受 `issuedAt` 不早于上次
  接受的授权、`leaseEpochFloor` 不低于已知地板、且 `leaseEpochFloor` 不低于本机仍持有的 Lease epoch 的 Standby Grant
  （重放一份旧 Standby Grant 不能把已重新成为 Active 的设备降级）；Active Grant 的 Lease epoch 必须高于已接受的
  Standby 地板（持有者从不收到 Standby Grant，所以被越过的 epoch 不会再成为本机的有效 Lease）。强制接管请求沿用幂等键；
  重新认证窗口单次消费（S5 节）；引导能力 jti 与步骤 nonce 摘要沿用现有唯一约束。

### S4. Host 与 Renderer 如何区分 Active 与 Standby

- **Host 是唯一来源**。`NativeCloudSession` 取得 v5 响应后，`activate_authorization_grant` 按 `role` 分别验证：Active 路径
  不变；Standby 路径以 Standby 用途公钥验签，核对账户、设备与本机绑定、`accountSecurityEpoch` 地板与 S3 节的单调规则，
  发布 `Standby { workspaceId, leaseEpochFloor, expiresAt }` 授权。
- 有本地副本时 `DesktopLocalBusinessState` 为 `StandbyReadOnly`，序列化为 `standby_read_only`，能力固定 `["local:read"]`；没有副本时为 `StandbyAwaitingReplica`（`standby_awaiting_replica`），能力为空。后者只提供设备目录和刷新授权入口，不调用业务读取、不创建空业务库冒充恢复成功。Host 的 `Standby` 授权状态独立于副本是否存在；只读 Cloud 请求可持有不依赖业务库的精确角色准入。
  Host 不为 Standby 发布执行准入，所有本地业务写入命令在 Host 内拒绝。Standby 授权过期后与现有
  授权过期相同处理：可锁定入口，不改写本地库（ADR-0032）。
- **Host 数据面的角色表**：`DataPlaneRoute` 增加与 Cloud S2 节同一集合的 Standby 允许表；Standby 时其余路由在发出
  请求前本地拒绝（不联网）。Cloud 的拒绝仍是最终边界，本地表只是失败关闭的早拒绝，两侧由同一金清单测试钉住。
- **降级**：Host 持有 Active Lease 时收到合法的 Standby Grant（`leaseEpochFloor` ≥ 本机 Lease epoch）即在一次 Host
  提交内撤下 Active 授权、关闭写入准入并发布 `standby_read_only`；本地库不删除。
- **Renderer** 只经现有严格解析的 Host 状态得知角色（`local_business_status` 与设置“设备”读取），
  不接触 Grant、Lease、引导能力、重新认证状态或会话令牌；未知状态或能力组合按现有适配器规则抛出并失败关闭。

### S5. 交接后的旧设备与新设备的引导

- **普通切换**（ADR-0032 决策 1）：
  1. 目标设备登录或刷新，因来源持有 Lease 而为 Standby；可轮询切换状态。
  2. 来源提交 drain proof，Cloud 在同一事务中释放来源 Lease、预分配 `pending` epoch 并创建引导能力。此后来源再取 Grant 得到 `leaseEpochFloor` ≥ `pending` 的 Standby Grant，
     Host 按 S4 节降级；handoff 栅栏在交接后保留。只有已持久化的普通交接成功回执与本机原 attempt、来源/目标、proof id/digest、来源 Lease epoch、barrier 全匹配后，Inbox 才继续应用，本地库成为只读副本。
  3. 目标以 Standby 会话经能力获取路由取得绑定其设备与工作流的引导能力，依次执行 `pin_checkpoint`、
     `fetch_mutations`、`submit_rebuild_digest`；激活签发 `pending` epoch 的 Lease 给目标设备。
  4. 目标再取 Grant 即得到 Active 响应（Lease 来自激活，不来自登录分配）。
- **强制接管**（ADR-0032 决策 1，纳入 v1）：
  1. 目标设备以 Standby 会话发起。重新认证由一次新的浏览器登录提供：Desktop 以“要求重新认证”打开同一 ADR-0011
     登录，Account Web 只在会话由五分钟内的密码或 Passkey 认证创建时继续（与首次绑定同一检查）；Cloud 把
     该窗口作为单次可用的重新认证窗口记在新会话上（只存截止时间与消费时间），强制接管请求在同一事务中消费它。
     协议中强制请求的 `reauthProofId` 因此移除。
  2. 工作流进入 `waiting_expiry`；最早接管时间之前旧设备若在线，照常同步与续租。
  3. 最早接管时间之后，目标经引导路由取得引导能力：Cloud 在同一事务中以 `release_reason = 'forced_takeover'` 释放
     旧 Lease、预分配 `pending` epoch、签发能力；其后的引导与激活与普通切换相同。
  4. 旧设备再联系 Cloud 时只能得到 Standby Grant 并降级；离线的旧设备，其本地 Lease 的 `offlineExecuteUntil` 不晚于
     最早接管时间（ADR-0032 的计算规则），所以在接管完成时已不能执行。旧设备上未推送的 Outbox 行不进入 Cloud
     （ADR-0032 决策 1），Host 保留它们与本地库，不推送、不删除；Host 停止向该快照应用 Inbox，保留原库只读。用户可另建按 Cloud 当前状态重建的 Standby 副本，
     不覆盖原库。

## 交接栅栏与验证

初始普通切换意图也必须先落盘再发 HTTP：local-storage 在原单 writer 事务中保存不可变的幂等键、目标设备、来源设备和当前 Lease epoch，以及精确请求字节。普通请求 v2 带 `expectedSourceLeaseEpoch`，由 Native 当前准入派生；Cloud 首次创建在同一身份/账户锁与有效 Lease 事务中比较来源 epoch，变化即拒绝，不能让迟到请求变成新 epoch 的意图。既有精确幂等请求只能返回原工作流历史，不能重建。

固定 `POST /v1/device-switch/requests/resolve` 仅按幂等键读取本会话设备作为来源的历史，账户和默认工作区由服务器派生，Active/Standby 都可查询。请求不接受来源、目标或 epoch 选择器。响应携带原目标签名密钥身份和 `sourceLeaseEpoch`；旧行的未知 epoch 保持 null。未知结果或重开先查询：同 epoch 确认未找到才可重发原字节；已验证更高 epoch 且未找到时原意图作废，不能自动新建；找到的当前 epoch requested/draining 在回答落盘的同一业务事务中建立屏障和冻结来源。旧 epoch 非终态或未知 epoch 不能建立当前屏障，终态只消解历史。未返回初始请求与回答/屏障之间的任何崩溃窗口都不能丢失原幂等身份。

Host 写入栅栏跨重启持久化，绑定切换与 Lease epoch；取消或失败且来源尚未成功释放时可解除，交接后保留。目标引导随后失败不撤销来源已成功释放的事实。
Cloud 的普通交接回执必须来自唯一已消费且 accepted 的 handoff proof、同一工作流的来源 Lease（normal_handoff 释放原因）和匹配目标引导能力，不能只看 status。回执在工作流完成或失败后仍可读取；强制接管不产生该回执。
Host 单独持久化最后一次本机已接受的 Active epoch；全局 Standby floor 不能代替它。旧 Native 记录缺少该事实时必须保持未知并冻结 Inbox，不能猜测。来源成功回执只能解冻同一最后本机 Active epoch 的副本，不能让早先普通交接证据解冻后来被强制接管的库。
已签完整请求先存 Native、再提交本地公开 attempt，最后才发 HTTP；签名材料不进入业务备份。重启或未知结果先查状态，成功则保存回执，明确尚未消费且当前仍持有同 epoch Active 授权时只可恢复原签名请求。过期或确定拒绝的 proof 不再发送；需要取消未释放的切换后重新预览发起。没有业务 attempt 的 Native 孤儿从未发出，可以清理；已有 attempt 不得用新 proof 替换。
Standby Inbox 只经专用读取/应用 gate，并保持原 reader cursor、页原子事务、read generation 和最终授权提交栅栏；它不开放 Outbox、Provider、checkpoint 发布或业务写入。
本设备以后取得更高 epoch 时，只能清除更早 epoch 的遗留栅栏，不能清除当前切换的栅栏。
drain 只能由 Host 从持久结果构造、以设备密钥按专属 transcript 签名；不公开任意签名 API。
必须验证普通交接、强制丢机接管、撤销、过期、跨租户、重放、用途混淆、切换中登录和引导崩溃路径。
