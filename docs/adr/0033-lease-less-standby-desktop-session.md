# ADR-0033：无 Lease 的 Standby Desktop 会话与 Grant

状态：Proposed（2026-11-18）。回应 [ADR-0032](0032-desktop-device-switch-and-drain-handoff.md)“待决：Standby 会话”；
产品负责人 2026-11-17 选择其方案 A，本 ADR 给出方案 A 的规定，待接受。接受前不改变任何源码行为；本 ADR 不声明
V1 验收或任何外部资格。

## 背景

[ADR-0005](0005-single-active-device-and-continuity.md) 规定一个账户同时只有一台 Active 设备持有 ActiveDeviceLease；
[ADR-0011](0011-device-identity-lifecycle.md) 规定 Desktop 以设备签名密钥的持钥证明登录；
[ADR-0026](0026-desktop-oauth-loopback-redirect.md) 规定浏览器登录的 loopback 回调；ADR-0032 决策 1、4、5 假定目标设备与
交接后的旧设备能以 Standby 身份连接 Cloud。

2026-11-18 源码快照（`desktop-ui-rebuild` 分支）：

- **登录即要求 Lease**：`PostgresDesktopOAuthAuthorizationService.authorize`（`apps/cloud/src/modules/identity/postgres-desktop-oauth.ts`）
  在写入授权码后调用 `ensureCurrentLease`，失败则不返回授权码；`exchange` 在 `checkLoginEligibility` 之后调用
  `requireCurrentLease`，只有本设备持有未释放、在线期内的 Lease 才创建会话。
  `DesktopTokenRefreshService.rotate` 每次刷新都调用 `ensureCurrentLease`，另一台设备持有 Lease 时返回
  `authorization_unavailable`。因此另一台设备持有 Lease 时，本设备既不能登录，已有会话也不能刷新。
- **Grant 必含 Lease**：`desktopAuthorizationGrantSchema`（`packages/protocol/src/devices/authorization-grant.ts`，v3）
  以必填的 `activeDeviceLease` 与固定 `scopes: ["workspace:mutate","workspace:read"]` 定义 Grant；
  `PostgresDesktopAuthorizationApplicationService` 读不到本设备的当前 Lease 即拒绝；Host 的
  `activate_authorization_grant`（`crates/local-storage/src/backup/desktop_local_host.rs`）与 `authority.rs` 只接受
  Grant v3 + Lease 两个用途的签名。
- **路由准入只有 Active**：`/v1/workspace-sync/*` 与 `/v1/device-switch/*` 的应用层都经
  `PostgresDesktopSyncAuthority.resolveActiveDevice`，它联结 `device_active_leases`，要求会话设备持有本工作区当前 epoch
  的未释放 Lease。路由表（`apps/cloud/src/entrypoints/routes/public/boundary.ts`）只按 `clientKind` 区分 Desktop 与
  Account Web。强制接管请求固定返回 `FORCED_SWITCH_UNAVAILABLE`。
- **登录可能在切换中分配 Lease**：`ensureCurrentLease` 在无人持有 Lease 时以 `desktop_login` 分配
  `highest_allocated_lease_epoch + 1`，只检查 `exclusive_execution_block_until`，不检查是否存在未结束的切换工作流。
  drain 交接（`postgres-drain-transition.ts`）释放来源 Lease 并为目标预分配 `pending` epoch 后，来源设备或任何已绑定
  设备的下一次刷新都可能分配一个更高的 epoch 而绕过引导与激活。源码与测试中未见阻止此路径的约束。
- **已有词汇**：协议已有 `deviceRoleSchema`（`active`/`standby`/`none`）与 `deviceAuthorityProjectionSchema`（Standby
  不得含 `workspace:mutate`、`platform:*`、`operation:approve`）；Renderer 适配器
  （`apps/desktop/src/adapters/tauri/index.ts`）已接受 `standby_read_only` 状态且其能力只能是 `["local:read"]`，但 Host
  的 `DesktopLocalBusinessState` 没有该状态，生产中从不产生。
- **Desktop 数据面**：`native_cloud_session.rs` 的 `DataPlaneRoute` 固定九条路由，任何一条都以同一 Bearer 凭据发送；
  Grant 获取与刷新串行化在同一 single-flight 中，Grant 激活失败即视为凭据失败。

## 决策

### 1. 谁可以取得 Standby 会话

Standby 会话是 `client_kind = 'desktop'` 的普通 Desktop 会话，取得时不要求本设备持有 Lease。资格条件全部来自锁定的
服务端状态，在授权码签发、换码、每次刷新与每次 Grant 签发时各检查一次：

- 账户安全状态 `normal`，且会话、授权码与当前 `account_security_epoch` 一致；
- 设备绑定 `bound`，且存在 `active` 的设备签名密钥（与 `checkLoginEligibility` 相同条件）；
- 登录仍须完成 ADR-0011 的 challenge 与持钥证明、ADR-0026 的 loopback 与 PKCE；首次绑定仍须五分钟内的密码或 Passkey
  认证。Standby 不降低任何登录证明，只去掉“必须持有 Lease”这一条；
- 账户与租户只来自授权码或令牌中的账户、该账户的个人默认工作区（`DefaultWorkspaceTenantResolverPort`），设备只来自
  会话行的 `device_id`；请求体不携带任何账户、工作区、设备、epoch 或角色选择。

**角色不写进会话，按请求从服务端状态派生。** 同一会话在交接、激活或强制接管后无须重新登录即改变角色：

| 服务端状态（同一账户事务内锁定读取） | 角色 |
| --- | --- |
| 会话设备持有当前 epoch、未释放、在线期内的 Lease | Active |
| 另一台设备持有 Lease；或存在任一未结束的切换工作流（`requested`、`draining`、`waiting_expiry`、`bootstrapping`）且本设备不是持有者；或 `exclusive_execution_block_until` 未到 | Standby |
| 无人持有 Lease、无未结束的切换、无封锁 | 登录或刷新按现有规则为本设备分配 Lease，成为 Active |
| 资格条件任一不满足 | 拒绝（不签发、不刷新、路由拒绝） |

登录与刷新的 Lease 步骤因此从“必须得到 Lease”改为“得到 Lease 或确定为 Standby”。**登录与刷新绝不在存在未结束切换
工作流或 `pending` epoch 分配时分配 Lease**；这同时关闭背景所述的切换中分配缺口，且必须先于本 ADR 的其余实现交付。

商业权益：Standby 只读、不执行，**不要求有效权益**（建议，见“待产品负责人决定”1）；Lease 的分配与续租仍按现有
规则受 Licensing 截止时间约束。

### 2. Standby 可调用的路由与其余路由的拒绝方式

Standby 可调用的路由是封闭清单：

| 路由 | Standby 条件 |
| --- | --- |
| `POST /v1/devices/authorization-grant` | 返回 Standby Grant（第 3 节） |
| `POST /v1/workspace-sync/mutations/pull` | 只读；reader cursor 按会话设备打开与推进 |
| `POST /v1/workspace-sync/checkpoint` | 只读 |
| `POST /v1/workspace-sync/rebootstrap` | 只读，返回重建计划 |
| `POST /v1/device-switch/requests/status` | 只对本设备为来源或目标的切换可见（现有规则） |
| `POST /v1/device-switch/requests` | 只接受 `mode: "forced"`，且 `toDeviceId` 必须等于会话设备；须满足第 5 节的重新认证 |
| `POST /v1/device-switch/requests/cancel` | 只接受取消本设备为目标、仍处于 `waiting_expiry` 的强制接管（见“待产品负责人决定”4） |
| ADR-0032 S1d 新增的引导能力获取、引导步骤与激活路由 | 会话设备必须是工作流目标，且引导步骤与激活同时出示绑定该设备与工作流的引导能力 |

其余 Desktop 路由——`mutations/push`、`mutations/receipts`、`device-switch/requests/drain`、普通切换请求、来源设备取消、
`/v1/workspace-observations/cloudflare-dns` 以及以后新增的任何路由——都要求 Active。拒绝分两层，任一层都足以拒绝：

1. **路由声明**：Desktop 路由的 `RouteAdapter` 增加必填的 `deviceRole: "active" | "active_or_standby"`，没有默认值；
   路由表测试钉住 `active_or_standby` 的精确集合，新增路由不声明或扩大集合都使测试失败（与现有 Tauri 命令清单测试
   同一方式）。
2. **应用层解析**：Active 路由继续只经 `resolveActiveDevice`；Standby 可调用的路由改经新的
   `resolveSessionDevice(principal, workspaceId) → { deviceId, role } | null`，它在同一事务中复核第 1 节全部资格条件，
   再由各服务按上表细化（例如强制接管要求 `role = standby` 且目标为本设备，Active 设备不能对自己发起强制接管）。

拒绝沿用各路由现有的封闭结果（同步路由 `SYNC_AUTHORIZATION_REJECTED`，其余为不带细节的授权拒绝），不新增
“你是 Standby”的错误码；设备的角色只经 Grant 告知 Host。

### 3. 不含 Lease 的 Grant

**Wire**：`/v1/devices/authorization-grant` 的请求升为 `schemaVersion: 4`，响应为按 `role` 区分的封闭联合：

```text
{ schemaVersion: 4, role: "active",  grant: <desktopAuthorizationGrantSchema v3，原样> }
{ schemaVersion: 4, role: "standby", grant: <desktopStandbyGrantSchema v1> }
```

`desktopStandbyGrantSchema` 是独立的 strict 对象，不是 v3 Grant 的可空变体：

- `typ: "gd.desktop-standby-grant.v1"`，`aud: "gooddealer-desktop/standby"`，`iss` 与 v3 相同，签名域
  `GOODDEALER-DESKTOP-STANDBY-GRANT-V1`；
- `kid`、`issuedAt`、`expiresAt`（至多 900 秒，与 access token 同长）、`accountId`、`deviceId`、`accountSecurityEpoch`、
  `workspace: { workspaceId, kind: "personal_default" }`；
- `leaseEpochFloor`：签发事务中读到的 `highest_allocated_lease_epoch`（安全非负整数，含 `pending` 分配）；
- `scopes: ["workspace:read"]`（固定元组）；`signature`。
- 没有 `activeDeviceLease`、`commercialAuthority` 或任何执行能力字段；strict 解析使带有这些键的对象整体被拒绝。

v3 请求与 v3 裸响应一并移除，不保留兼容路径（[ORCHESTRATION](../ORCHESTRATION.md)“没有兼容或过渡路径”）。

**签名密钥**：Standby Grant 用独立用途的 OpenBao Transit 密钥签名，Desktop 的 build-pinned 公钥 allowlist 增加该用途
（建议，见“待产品负责人决定”2）；Grant v3、Lease 与 Standby Grant 三个用途的公钥互不通用。

**存储**：Cloud 不新增会话列或 Grant 表。会话行不记录角色；Standby Grant 与现有 Grant 一样签发后不落库，签发事务对
安全状态、会话与刷新族、默认工作区、设备绑定与签名密钥、`device_account_states` 加锁读取，签名返回后以
`clock_timestamp()` 复核这些状态与“本设备仍不持有 Lease”。Host 把已接受的 Standby 授权与 `leaseEpochFloor` 持久化在
现有授权地板旁（`minimum_lease_epoch`），作为单调地板。

**负向情形**：

- **伪造 Lease 声明**：Cloud 从不接受客户端提供的 Grant、Lease 或角色——每条路由从锁定状态派生角色，客户端无从
  “声明”Lease。Host 侧，Standby Grant 不能携带 Lease（strict 拒绝），Active 响应中的 v3 Grant 仍须分别以 Grant v3 与
  Lease 两个用途的密钥验签；用 Standby 密钥签的 v3 形状、用 v3 密钥签的 Standby 形状、`role` 与 `grant.typ` 不符、两种
  形状混合，全部拒绝。
- **已撤销设备**：绑定 `removed` 或签名密钥非 `active` 时，授权码签发、换码、刷新、Grant 签发与每条 Standby 路由都在
  各自事务中拒绝；引导能力与工作流已绑定目标设备的有效密钥（ADR-0032 S1c1），撤销后引导步骤与激活同样拒绝。
- **跨租户**：账户来自令牌，工作区来自该账户的默认工作区解析，设备来自会话；切换、引导能力与步骤行都在
  `withTenant` 的账户与工作区范围内读取；状态只对来源或目标设备可见；引导能力的 `deviceId` 必须等于会话设备。
  另一账户的设备 id、工作流 id、能力 jti 一律表现为不存在。
- **重放**：授权码单次消费；刷新沿用轮换与复用检测；Standby Grant 至多 900 秒有效，Host 只接受 `issuedAt` 不早于上次
  接受的授权、`leaseEpochFloor` 不低于已知地板、且 `leaseEpochFloor` 不低于本机仍持有的 Lease epoch 的 Standby Grant
  （重放一份旧 Standby Grant 不能把已重新成为 Active 的设备降级）；Active Grant 的 Lease epoch 必须高于已接受的
  Standby 地板（持有者从不收到 Standby Grant，所以被越过的 epoch 不会再成为本机的有效 Lease）。强制接管请求沿用幂等键；
  重新认证窗口单次消费（第 5 节）；引导能力 jti 与步骤 nonce 摘要沿用现有唯一约束。

### 4. Host 与 Renderer 如何区分 Active 与 Standby

- **Host 是唯一来源**。`NativeCloudSession` 取得 v4 响应后，`activate_authorization_grant` 按 `role` 分别验证：Active 路径
  不变；Standby 路径以 Standby 用途公钥验签，核对账户、设备与本机绑定、`accountSecurityEpoch` 地板与第 3 节的单调规则，
  发布 `Standby { workspaceId, leaseEpochFloor, expiresAt }` 授权。
- `DesktopLocalBusinessState` 增加 `StandbyReadOnly`，序列化为 Renderer 已接受的 `standby_read_only`，能力固定
  `["local:read"]`；Host 不为 Standby 发布写入准入，所有本地业务写入命令在 Host 内拒绝。Standby 授权过期后与现有
  授权过期相同处理：可锁定入口，不改写本地库（ADR-0005）。
- **Host 数据面的角色表**：`DataPlaneRoute` 增加与 Cloud 第 2 节同一集合的 Standby 允许表；Standby 时其余路由在发出
  请求前本地拒绝（不联网）。Cloud 的拒绝仍是最终边界，本地表只是失败关闭的早拒绝，两侧由同一金清单测试钉住。
- **降级**：Host 持有 Active Lease 时收到合法的 Standby Grant（`leaseEpochFloor` ≥ 本机 Lease epoch）即在一次 Host
  提交内撤下 Active 授权、关闭写入准入并发布 `standby_read_only`；本地库不删除。
- **Renderer** 只经现有严格解析的 Host 状态得知角色（`local_business_status` 与随 ADR-0032 S3 的设置“设备”读取），
  不接触 Grant、Lease、引导能力、重新认证状态或会话令牌；未知状态或能力组合按现有适配器规则抛出并失败关闭。

### 5. 交接后的旧设备与新设备的引导

- **普通切换**（ADR-0032 决策 1）：
  1. 目标设备登录或刷新，因来源持有 Lease 而为 Standby；可轮询切换状态。
  2. 来源提交 drain proof，Cloud 在同一事务中释放来源 Lease、预分配 `pending` epoch 并创建引导能力（现有
     `PostgresDeviceDrainTransition`）。此后来源再取 Grant 得到 `leaseEpochFloor` ≥ `pending` 的 Standby Grant，
     Host 按第 4 节降级；handoff 栅栏照 ADR-0032 S2d3a 保留，Inbox 照常应用，本地库成为只读副本。
  3. 目标以 Standby 会话经 S1d 的能力获取路由取得绑定其设备与工作流的引导能力，依次执行 `pin_checkpoint`、
     `fetch_mutations`、`submit_rebuild_digest`；激活签发 `pending` epoch 的 Lease 给目标设备。
  4. 目标再取 Grant 即得到 Active 响应（Lease 来自激活，不来自登录分配）。
- **强制接管**（ADR-0032 决策 1，纳入 v1）：
  1. 目标设备以 Standby 会话发起。重新认证由一次新的浏览器登录提供：Desktop 以“要求重新认证”打开同一 ADR-0026
     登录，Account Web 只在会话由五分钟内的密码或 Passkey 认证创建时继续（与首次绑定同一检查）；Cloud 把
     该窗口作为单次可用的重新认证窗口记在新会话上（只存截止时间与消费时间），强制接管请求在同一事务中消费它。
     协议中强制请求的 `reauthProofId` 因此移除（见“待产品负责人决定”3）。
  2. 工作流进入 `waiting_expiry`；最早接管时间之前旧设备若在线，照常同步与续租。
  3. 最早接管时间之后，目标经 S1d 路由取得引导能力：Cloud 在同一事务中以 `release_reason = 'forced_takeover'` 释放
     旧 Lease、预分配 `pending` epoch、签发能力；其后的引导与激活与普通切换相同。
  4. 旧设备再联系 Cloud 时只能得到 Standby Grant 并降级；离线的旧设备，其本地 Lease 的 `offlineExecuteUntil` 不晚于
     最早接管时间（ADR-0032 的计算规则），所以在接管完成时已不能执行。旧设备上未推送的 Outbox 行不进入 Cloud
     （ADR-0032 决策 1），Host 保留它们与本地库，不推送、不删除；该副本此后能否继续跟随 Inbox，见“待产品负责人
     决定”5。

## 未采用的方案

- **方案 B：不提供会话**——目标设备只凭一次性引导能力引导、强制接管由 Account Web 重新认证发起、旧设备交接后退出
  登录只保留本地只读副本。未采用：引导能力须经某个已认证通道送达目标设备，没有会话就要在 Account Web 与 Desktop
  之间另建传递；旧设备退出登录后不能按 Inbox 跟随，与 ADR-0032 决策 5“旧设备保留为 Standby 的只读副本，其后按
  Inbox 正常跟随”冲突；强制接管从 Account Web 发起时，无法证明发起者就在目标设备上。
- **登录时把角色写进会话**：交接、激活、强制接管后角色立即过时，需要强制重新登录或额外的会话改写路径；按请求
  派生没有这个窗口。
- **在 v3 Grant 中把 `activeDeviceLease` 改为可空**：同一解析器同时承担执行授权与只读授权，Host 的“Grant 必有已验签
  Lease”不变量被削弱，任何解析缺陷都可能把只读会话当作执行授权；独立 typ、aud、签名域与密钥让混淆在验签处失败。
- **Standby 只凭 Bearer 会话而不要求设备持钥登录**：会退化为普通 OAuth 会话证明设备身份，违反 ADR-0011。
- **Standby 会话由 Account Web 会话代行**：Account Web 不在 Host custody 内，不能持有设备密钥或读取本地库。

## 后果

- 第二台已绑定设备可以随时登录并只读跟随；任何时刻仍只有一台设备能推送、drain 或续租。
- 登录与刷新不再因“另一台设备持有 Lease”失败；只有资格条件失败才拒绝。Desktop 必须能在 Active 与 Standby 之间
  无重启切换。
- 新增一个签名用途（Standby Grant），Desktop allowlist 与 OpenBao 密钥随之增加；生产密钥仍属外部资格。
- 每条新 Desktop 路由都必须声明角色，Standby 集合的扩大需要修订本 ADR。

## 待产品负责人决定

1. **Standby 是否要求有效权益**。建议不要求：Standby 只读、不执行，权益过期的账户仍可在第二台设备上查看自己的副本。
   备选：要求有效权益或宽限期，过期时登录只得到锁定状态。
2. **Standby Grant 的签名密钥**。建议独立用途密钥（与 Devices 模块“密钥按用途分离”的规则一致），代价是多一个 OpenBao
   密钥与外部资格项。备选：沿用 Grant v3 密钥，只以独立签名域与 typ/aud 区分。
3. **强制接管的重新认证**。建议用新登录在会话上记录单次可用的五分钟窗口，移除协议中的 `reauthProofId`。备选：保留
   `reauthProofId`，新增 Account Web 签发、绑定设备的单次重新认证证明与其传递路径。
4. **目标设备能否取消自己的强制接管**。建议能，但只在 `waiting_expiry` 期间；`bootstrapping` 中的取消仍归 S1d
   （须烧掉待定 epoch 与引导能力）。
5. **强制接管后旧设备的未同步修改**。建议：旧设备降级后停止应用 Inbox，保留原本地库为只读快照，并提供“按 Cloud
   当前状态新建 Standby 副本”（新库，以 ADR-0029 C3b rebootstrap 安装），不覆盖原库（ADR-0005）。备选：旧设备只保留
   原库、不再跟随。

## 实施

- **T1 协议**：`desktopStandbyGrantSchema` 与签名 transcript；Grant 请求 v4 与按 `role` 区分的响应；移除 v3 请求与裸
  响应；强制切换请求按决定 3 调整；Standby 能力组合与 `deviceAuthorityProjectionSchema` 一致的测试；金 transcript
  向量供 Rust 复用。
- **T2 Cloud**（`apps/cloud/src/modules/devices`、`modules/identity`）：
  - T2a 登录与刷新：`ensureCurrentLease` 与 `requireCurrentLease` 改为返回 `active | standby | refused`，在未结束切换、
    `pending` 分配或封锁存在时绝不分配 Lease（先交付，含 PostgreSQL 负向测试）；`authorize`、`exchange` 与
    `DesktopTokenRefreshService.rotate` 按结果签发会话；
  - T2b Grant：`PostgresDesktopAuthorizationApplicationService` 按角色签发 v3 或 Standby Grant，签发后复核；Standby 用途的
    签名端口与 OpenBao 开发密钥；
  - T2c 路由准入：`RouteAdapter.deviceRole`、`resolveSessionDevice`、路由表的 Standby 清单测试；
  - T2d 强制接管：请求、重新认证窗口、目标取消，规则与内存参考实现一致；
  - T2e 引导：与 ADR-0032 S1d 合并——能力获取、步骤与激活路由，强制路径的旧 Lease 释放。
- **T3 Host**（`crates/local-storage`、`apps/desktop/src-tauri`）：Standby Grant 验证与单调地板、`StandbyReadOnly` 状态、
  降级提交、数据面角色表、v4 响应解析；rebootstrap 安装进入生产组合（ADR-0032 S1d）。
- **T4 Desktop UI**：并入 ADR-0032 S3——设置“设备”的角色显示、目标设备的引导进度与强制接管入口（含重新认证登录）、
  Standby 的只读说明。
- **T5 测试**：每层的负向测试覆盖第 3 节全部情形（伪造或混合形状、错误用途密钥、撤销设备、跨账户 id、Grant 重放与
  降级回退、切换中登录分配、Standby 调用每条 Active 路由）；端到端并入 ADR-0032 S4（普通交接后旧设备转 Standby 并
  跟随、强制接管后旧设备转 Standby、目标设备经 Standby 会话引导并激活）。
