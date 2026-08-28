# GoodDealer 同步与冲突语义

## 定位

同步把本地 SQLCipher 中允许共享的业务字段复制到 Cloud，并把其他设备的允许字段合并回本地。
Desktop 的业务 Query 和 Command 始终以本地数据库为 Repository；UI 不直接查询 Cloud 业务表。

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

## ACK、Cursor 与恢复

ACK 仅确认 Cloud 已持久化副本，随后本地可以标记对应 Outbox 项。Cursor/Checkpoint 描述复制
进度，不定义业务事实。恢复必须先在本地重建、解锁、迁移并验证 SQLCipher 数据库，再开放本地
Query；恢复内容同样受字段白名单和秘密排除规则约束。

## 离线与授权

Cloud transport 失败不撤销已提交的本地事务。业务能力是否可继续由缓存的已签名授权及产品定义
的离线期限决定；无效订阅或 Lease 仍可锁定入口。授权权威和业务数据权威不得混为一谈。
