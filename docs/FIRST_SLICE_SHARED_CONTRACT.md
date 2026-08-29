# GoodDealer 首个垂直切片共享合同

## 范围与权威

首个切片只冻结账户激活、个人默认工作区授权、ActiveDeviceLease、`domain_asset` 同步和恢复输入。
公开合同位于 `@gooddealer/protocol` 的 `./account`、`./devices`、`./workspace` 导出，类型化消费面
位于 `@gooddealer/cloud-client`。它们不注册 Cloud route、Tauri command，也不实现数据库或密码学。

Cloud 从已认证主体、当前绑定设备和唯一 `default_owner` binding 导出 Account/Workspace 范围。
所有请求都不含 `accountId` 或 `workspaceId`。Desktop 日常 Query/Command 仍只使用本地 SQLCipher；
Cloud replica、MutationPage 和 Checkpoint 只提供同步或恢复输入。

## 冻结操作

| operation id | 请求与响应 | 语义 |
| --- | --- | --- |
| `account.activation.activate` | `accountActivationRequestSchema` / `accountActivationResponseSchema` | 服务器原子创建或解析 Account、个人默认 Workspace 和唯一所有者绑定；响应只确认 `state: "active"`。 |
| `devices.authorizationGrant.issue` | `desktopAuthorizationGrantRequestSchema` / `desktopAuthorizationGrantSchema` | 返回个人默认 Workspace、已签名 ActiveDeviceLease 和首切片的 `workspace:mutate`、`workspace:read` scope。 |
| `workspace.sync.mutations.push` | `workspaceMutationPushRequestSchema` / `workspaceMutationPushResponseSchema` | 接收无租户字段的 Mutation，返回精确关联的 ACK 或封闭拒绝码。 |
| `workspace.sync.mutations.pull` | `workspaceMutationPullRequestSchema` / `workspaceMutationPullResponseSchema` | 从本地已提交 revision 继续读取严格 MutationPage；cursor 由 Cloud 生成。 |
| `workspace.sync.checkpoint.read` | `workspaceCheckpointReadRequestSchema` / `workspaceCheckpointReadResponseSchema` | 返回服务器范围内最新可用 Checkpoint，或显式 `null`。 |
| `workspace.sync.domainAssetReplica.recover` | `workspacePortfolioReadRequestSchema` / `workspacePortfolioReadResponseSchema` | 返回脱敏副本，只作为本地恢复输入；空副本不是删除命令。 |

`TenantNeutralSubmittedSyncMutation` 是上行 wire item。`SubmittedSyncMutation` 和 `SyncMutation` 仍是
带 `workspaceId` 的工作区内部/下行记录；Cloud adapter 必须用可信服务器范围补入并核对该字段，
Desktop 不能把本地记录原样作为上行 payload。

## Cloud 消费点

Cloud API 实现只从以上 public exports 导入 schema 和 operation id，并在进入领域服务前从
`unknown` 解析。路由认证后先解析主体和默认绑定，再把可信 `(accountId, workspaceId)` 传给拥有
模块；客户端 payload 不能覆盖该范围。

激活响应有意不返回 `accountId`、`workspaceId`、默认 Workspace 或 Lease。Cloud 内部必须完成并复核
个人默认 Workspace，但 Desktop 取得公开 Workspace identity 与授权能力的唯一合同是后续独立的
`devices.authorizationGrant.issue` / `desktopAuthorizationGrantSchema`；不得把激活响应扩张成租户权威。

Mutation adapter 把 `TenantNeutralSubmittedSyncMutation` 与服务器解析的 `workspaceId` 组合成拥有
模块所需的 `SubmittedSyncMutation`，并核对 `sourceDeviceId`、`activeLeaseEpoch` 与当前授权事实。
ACK 必须逐项保持请求的 `mutationId`、`deviceMutationSequence` 顺序；重复提交返回
`duplicate: true`，不得分配另一个业务效果。

## Desktop 消费点

Desktop Host 通过 `AccountActivationClient`、`DesktopAuthorizationClient`、`WorkspaceSyncClient`
和 `DomainAssetReplicaRecoveryClient` 消费合同。Renderer 不接收 grant、Lease、Mutation、Checkpoint
或恢复 DTO，也不直接持有 `CloudTransport`。

`DesktopAuthorizationClient.issue()` 只验证 wire 形状。Host 在消费 grant 前仍必须验证
ActiveDeviceLease 的签名、key purpose、issuer、audience、账号/设备绑定、Epoch 和可信时间窗口，
并把 `workspace.kind === "personal_default"` 的绑定保存在受限本地授权状态。schema 解析不能替代
密码学或服务器身份验证。

本地业务事务先原子提交业务表和 Outbox。同步器把 Outbox 项投影为
`TenantNeutralSubmittedSyncMutation`；精确 ACK 后只推进复制 metadata。Pull/Checkpoint/恢复响应必须
匹配已验证 grant 的工作区，经过严格解析、冲突判定和本地事务后才可被本地 Query 观察。

## 错误与恢复语义

- 请求 schema 失败时 client 不调用 transport；响应未知字段、错误类型、错误版本或关联不一致时
  Promise 失败，不能推进 ACK、cursor、checkpoint 或本地 materialization。
- Push 的 `accepted: false` 是整批拒绝；调用方保留 Outbox。`accepted: true` 只有在 ACK 数量、
  `mutationId` 和 `deviceMutationSequence` 与请求逐项相等时才有效。
- Pull 的 `MUTATION_PAGE_COMPACTED` 要求调用方使用返回的 Checkpoint（若存在）或显式恢复读取；
  不能把 cursor 错误、空页、`null` checkpoint 或空恢复副本解释为删除本地数据。
- `AUTHORIZATION_REJECTED`、`WORKSPACE_TENANT_UNRESOLVED` 和 malformed/conflict 拒绝不触发隐式
  fallback。网络、HTTP 和认证传输失败由 `CloudTransport` 以 rejected Promise 表达，不能伪装为
  成功 DTO。

## 禁止事项

- 不得在请求、Renderer、普通日志、错误或同步 DTO 中加入租户选择、Provider 身份、连接 ID、
  URL/header、凭据、Token、Cookie、密码、2FA、Browser Profile 或恢复/解锁材料。
- 不得把 Cloud replica 组合为 Desktop 正常 Repository，不得让本地事务等待 Cloud ACK。
- 不得新增深层 import、兼容 operation id、临时 adapter、双同步路径、Provider/browser fallback，
  或在共享包内实现 Cloud/Desktop/Host 的业务逻辑。
