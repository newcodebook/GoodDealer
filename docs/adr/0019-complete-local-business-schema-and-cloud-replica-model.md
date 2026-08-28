# ADR 0019：完整本地业务 Schema 与显式 Cloud 副本模型

## 状态

Accepted

## 决策

完整业务模型落在 Desktop SQLCipher Active Workspace：DomainAsset 身份和生命周期、Desired
State、Provider Observed State、Provider 本地账号与凭据版本、Plan/Operation/Attempt/Result、
History、Inbox/Outbox、冲突、墓碑和本地备份目录均由本地拥有。

Cloud PostgreSQL 业务表统一使用 `workspace_replica_*` 语义，并且只保存允许字段、复制进度和恢复
证据。Cloud 不保存第三方账号、Provider Account ID、别名、连接 ID、Credential Binding、密钥、
Token、Cookie、密码、2FA 或 Browser Profile。

本地使用独立 `local_commit_sequence`；Cloud 使用 `server_revision`。字段版本同时记录两者和复制
状态，避免把 Cloud revision 误当成本地事务版本。删除使用显式墓碑，空副本不具有删除语义。
DomainAsset 以 canonical lowercase IDNA ASCII 域名作为 `entity_id`；本地、wire、Cloud 和恢复均
使用同一身份，不保留无法通过副本重建的第二域名身份列。
同步删除是带删除时间的显式 mutation variant，Cloud log 不以“字段为空”猜测删除；在墓碑
materializer 完成前 ingest 必须拒绝该 variant，不能接受后静默忽略。

## 理由

单张 Portfolio 投影无法表达完整资产生命周期、用户意图与外部观察差异、批量执行、未知结果、
字段冲突和安全删除。继续横向增加可空列会把 Provider、本地业务和复制状态混在同一信任域。
稳定实体、Desired/Observed 分离、append-only 历史和字段级复制状态可以在不改变数据权威边界的
前提下支持未来能力。

Cloud 表原先的 Portfolio 命名容易被误用为 Desktop Repository。显式 Replica 命名、双键 RLS 和
字段排除使其用途可由 schema 本身审查，而不依赖调用者记住文档。

## 约束

- Schema 覆盖未来能力不等于启用这些能力；Provider 写入、市场/Registrar、团队和多工作区仍需
  各自产品决定、能力合同和资格。
- Provider 观察必须先写本地。允许字段通过重新构造的脱敏值进入 Outbox，不能序列化本地连接行。
- Operation history 区分失败、可重试、等待远端和结果未知；结果未知不能自动重放。
- 密封 Provider 凭据只由本地 `provider_credential_versions` 持有，账号元数据行不得复制凭据字节。
- 未拥有严格 wire/materializer/secret/recovery 验收的 Cloud 副本表不得授予 application role DML。
- Cloud application role 的写权限按列授予；Restore Candidate 证据列不可变，生命周期只能通过
  status/version/updated-at 的数据库状态图和下一版本 CAS 更新；Checkpoint 使用同样的 DDL CAS。
- Provider 批量观察必须保存逐目标结果，观察类型必须与 run capability 一致；运行级 error 不能
  代替 requested/failed/missing 的目标级证据。
- Cloud ACK、Cursor 和 Checkpoint 不参与本地业务事务提交。
- Cloud revision head 必须对应连续 Mutation 区间；提交时仍领先于 head 的 replay/receipt 被 deferred
  constraint 拒绝。application role 不能直接更新 compaction watermark 或删除 replay，只能通过同时
  验证 replay chain、Checkpoint、Cursor、Pin 和 Recovery 水位的受限函数清除已提交前缀，并永久
  保留 Receipt/Drain 证据。
- Backup、Diff、Restore Candidate 和 Checkpoint 使用有 digest 的 section/page/range partition；
  单次数组上限不是提高规模容量的手段。
- 扩展同步实体必须同步更新本地字段状态、wire schema、Cloud materializer、墓碑和恢复测试。

## 后果

本地 schema 可以在不依赖 Cloud 的情况下承载完整业务状态；Cloud 可以提供多设备同步和恢复而不
获得 Provider 身份或 Desktop Repository 权威。代价是拥有模块需要维护严格的投影、字段版本、
迁移和冲突策略，并在规模化前把当前全量 Portfolio Query 替换为分页 Query。
