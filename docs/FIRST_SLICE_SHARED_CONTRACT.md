# GoodDealer 首个垂直切片共享合同

## 范围与权威

共享合同冻结账户激活、个人默认工作区授权、ActiveDeviceLease、账号 billing、`domain_asset` 同步和恢复输入。
公开合同位于 `@gooddealer/protocol` 的 `./account`、`./devices`、`./workspace` 导出，类型化消费面
位于 `@gooddealer/cloud-client`。它们不注册 Cloud route、Tauri command，也不实现数据库或密码学。

Cloud 从已认证主体、当前绑定设备和唯一 `default_owner` binding 导出 Account/Workspace 范围。
所有请求都不含 `accountId` 或 `workspaceId`。Desktop 日常 Query/Command 仍只使用本地 SQLCipher；
Cloud replica、MutationPage 和 Checkpoint 只提供同步或恢复输入。

## 冻结操作

| operation id | 请求与响应 | 语义 |
| --- | --- | --- |
| `account.activation.activate` | `accountActivationRequestSchema` / `accountActivationResponseSchema` | 服务器原子创建或解析 Account、个人默认 Workspace 和唯一所有者绑定；响应只确认 `state: "active"`。 |
| `account.billing.checkout.create` | `billingCheckoutCreateRequestSchema` / `billingCheckoutCreateResponseSchema` | 以 GoodDealer `requestId` 幂等创建或恢复购买；响应只含 GoodDealer `checkoutId` 和短期一次性 approval handle，不含 Provider URL 或资源标识。 |
| `account.billing.status.read` | `billingStatusReadRequestSchema` / `billingStatusReadResponseSchema` | 区分 creation/approval/cancellation 的 pending、outcome-unknown 与 Provider 已确认状态；unknown 状态保留 slot 与 paid-through 事实。 |
| `account.billing.subscription.cancel` | `billingSubscriptionCancelRequestSchema` / `billingSubscriptionCancelResponseSchema` | 以 GoodDealer cancellation `requestId` 持久化并恢复取消意图；只有 Provider 已确认不续费才返回 `cancel_at_period_end`。 |
| `account.billing.fixedTerm.confirm` | `billingFixedTermConfirmRequestSchema` / `billingFixedTermConfirmResponseSchema` | 以独立 GoodDealer `requestId` 和 `checkoutId` 关联 fixed-term capture；响应精确回显二者。 |
| `account.billing.firstPurchaseRefund.request` | `billingFirstPurchaseRefundRequestSchema` / `billingFirstPurchaseRefundRequestResponseSchema` | 只提交 GoodDealer `requestId` 与 `purchaseId`；确定性资格拒绝与已接受退款聚合严格分离。 |
| `account.billing.firstPurchaseRefund.status.read` | `billingFirstPurchaseRefundStatusReadRequestSchema` / `billingFirstPurchaseRefundStatusReadResponseSchema` | 以 GoodDealer `refundRequestId` 恢复已接受退款；unknown、retry-wait 与 manual-resolution 均保持只读且不表示已退款。 |
| `devices.authorizationGrant.issue` | `desktopAuthorizationGrantRequestSchema` / `desktopAuthorizationGrantSchema` | 返回整体签名 Grant v3；其签名覆盖个人默认 Workspace、完整已签 ActiveDeviceLease、精确 `workspace:mutate`、`workspace:read` scope 与商业执行权限。 |
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

Billing checkout 的 `approval` 只能是严格的
`{ kind: "gooddealer_redirect", handle, expiresAt }`。Account Web/Cloud Client 只由 handle 导出同源
`/billing/approval/:handle`，不能接收或持久化 Provider URL。已确认 pending 的同 request 恢复只为同一
已绑定 Provider 资源换发新 handle，不重新创建 Provider 资源。Provider price/plan/subscription/order/
resource/payment/customer 标识、payer/card 数据、URL、credential/header/secret-like 字段在公共 JSON
任意层级均失败关闭。

首购退款请求只含 `{ schemaVersion, requestId, purchaseId }`。一旦接受，所有 termination/refund pending、
outcome-unknown、retry-wait、manual-resolution 和最终 `refunded` 状态都明确返回
`commercialAccess: "read_only"`、GoodDealer `refundRequestId`/`purchaseId` 与严格 USD minor amount。
只有 `retry_wait` 返回 `retryable: true` 和规范 UTC `retryAfter`；其余 accepted 状态一律返回
`retryable: false` 与 `retryAfter: null`。
只有 `refunded` 携带完成时间并表示退款完成；只有封闭理由的确定性 `rejected` 允许新 request identity。
超时或刷新恢复只能重放原请求或用 `refundRequestId` 读状态，不能同步触发新的 Provider 操作。
资格是账号终身唯一的首次 settled acquisition 后 336 小时窗口，续费不改变其付款身份或截止时间。
订阅只有在 termination 已由 Provider 确认后才进入退款操作；固定期限与订阅都必须以 exact binding、
同币种完整剩余金额的成功事实完成，partial、unknown 或 manual 状态不能被客户端提升为完成。

## Desktop 消费点

Desktop Host 通过 `AccountActivationClient`、`DesktopAuthorizationClient`、`WorkspaceSyncClient`
和 `DomainAssetReplicaRecoveryClient` 消费合同。Renderer 不接收 grant、Lease、Mutation、Checkpoint
或恢复 DTO，也不直接持有 `CloudTransport`。

`DesktopAuthorizationClient.issue()` 只验证 wire 形状。Host 在消费 Grant v3 前必须先验证覆盖
Workspace、scope、窗口和完整嵌套 Lease 的外层目的限定签名，再独立验证 ActiveDeviceLease 的
签名、key purpose、issuer、audience、账号/设备绑定、Epoch 和可信时间窗口。验证成功后才把
`workspace.kind === "personal_default"` 的身份写入 OS-protected binding；该 binding 只允许过期后
重开同一本地数据库进行读取，不能恢复修改权。schema 解析不能替代密码学或服务器身份验证。

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
