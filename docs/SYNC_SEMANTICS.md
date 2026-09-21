# GoodDealer 同步与冲突语义

## 定位

同步把本地 SQLCipher 中允许共享的业务字段复制到 Cloud，并把其他设备的允许字段合并回本地。
Desktop 的业务 Query 和 Command 始终以本地数据库为 Repository；UI 不直接查询 Cloud 业务表。

客户同步状态不是 Cloud 内部复制诊断的投影。客户只读取持久化 `SyncSnapshot`：待提交、开放冲突、拒绝
Mutation 的 durable counts，恢复要求、已应用的 Cloud Revision、最近复制活动和 Native transport
观察。transport 只允许 `checking`、`reachable`、`offline`、`blocked`；启动和重启从 `checking` 开始，
不得复用上次成功状态或 `navigator.onLine`。同步没有手动触发模式。

## 本地提交

1. client-core 验证用户意图并调用具体本地业务端口。
2. `local-storage` 在一个 `IMMEDIATE` 事务中更新业务表并追加 `sync_outbox`。
3. 事务提交后 UI 立即读取本地结果，不等待网络或 Cloud ACK。
4. 同步器异步发送 Outbox；失败保留待同步项并显示可辨识状态。

Mutation ID 必须幂等。业务表更新与 Outbox 插入任一失败时整体回滚，不能出现已修改但不可复制
或已排队但本地未提交的状态。

## 上行白名单

每种实体拥有封闭 schema。V1 `domain_asset` 只允许 entityId、note、portfolioId、tags 和
targetPrice 等已批准字段。发现未知字段、Provider 账号字段或任何秘密 canary 时，Mutation 必须
失败关闭且不能发送。

## 下行合并

Pull 响应从 `unknown` 解析并验证租户绑定、实体种类、字段、版本、游标和规范顺序。合法变更经过
冲突判定后在本地事务中合并；本地 Query 只看已提交结果。空响应只表示没有可应用 Mutation，
绝不表示删除本地数据。显式删除也必须携带支持幂等和冲突处理的墓碑语义。

## 冲突

用户意图、Provider 观察和同步副本是不同语义。字段级版本可以用于确定无冲突合并；无法自动
判断时保留本地值和远端候选，交由冲突中心处理。Cloud 副本不能凭“更近”或“为空”获得覆盖权。

冲突中心通过独立 `sync.conflicts` 路由提供一个严格投影。Active 只可对单个候选提交一个绑定
candidate version、server revision、current-value hash 的显式选择；商业只读/Standby 仅查看，
resolution admission 为 unavailable；locked、retryable、security、recovery surface 无路由。
Resolution receipt 只证明本地事务提交（或幂等重放）并按需要排队 Outbox，不是 Cloud ACK。
首次 resolve 必须满足 Host 当前 `readGeneration == expectedReadGeneration`，成功 receipt 严格为
`expected + 1`；只有请求、候选证据和选择完全一致且没有中间 generation 变化时才允许重放。
Renderer 随后只发布同一 Host generation 下完整重读的业务状态、资产列表、冲突和同步快照。

## ACK、Cursor 与恢复

ACK 仅确认 Cloud 已持久化副本，随后本地可以标记对应 Outbox 项。Cursor/Checkpoint 描述复制
进度，不定义业务事实。Host 对每次已提交且 Renderer 可见的 Pull（包括首次空终止页）、ACK、
确定性 reject 和首次 recovery 变化只推进一次 `readGeneration`；完全一致重放和 retryable defer
不推进，事务失败也不能提前推进。恢复必须先在本地重建、解锁、迁移并验证 SQLCipher 数据库，
再开放本地 Query；恢复内容同样受字段白名单和秘密排除规则约束。

Native 每个同步周期共同聚合 Push、Pull、Checkpoint，优先级固定为
`RecoveryRequired > SecurityBlocked > AuthorizationBlocked > Retryable > Valid > NotAttempted`。
取消和退出先封住发布再 drain 已接纳工作；迟到的成功结果不得覆盖已有 transport 状态，也不得启动新周期。

## 离线与授权

Cloud transport 失败不撤销已提交的本地事务。业务能力是否可继续由缓存的已签名授权及产品定义
的离线期限决定；无效订阅或 Lease 仍可锁定入口。授权权威和业务数据权威不得混为一谈。

首个实现切片统一采用[共享合同](FIRST_SLICE_SHARED_CONTRACT.md)中的 tenant-neutral Push、精确 ACK、
Pull Cursor、Checkpoint 和恢复输入定义；拥有模块不得复制或放宽 wire schema。
