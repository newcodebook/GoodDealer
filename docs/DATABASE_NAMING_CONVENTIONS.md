# 数据库命名规范

本规范是 GoodDealer 数据库、持久化模型和对应 wire contract 的强制设计约束。字段命名必须同时说明
所属运行时、信任域、事实类型和版本空间，不能依赖调用上下文猜测含义。

## 1. 架构前提

- Desktop SQLCipher Active Workspace 是业务实体、业务事务、Provider 观察、操作和历史的唯一运行权威。
- Cloud PostgreSQL 是账号、订阅、设备、Lease/Epoch 等控制面的权威；业务数据只能以允许字段的
  `workspace_replica_*` 同步/恢复副本存在。
- Provider Account ID、连接 ID、显示别名、凭据、Browser Profile 和任何秘密只允许存在于本地。
- 登录授权依赖 Cloud 不会改变本地数据库的业务权威；已经授权的 Desktop 业务事务先提交本地，
  Cloud 不作为 Desktop Repository。

## 2. 基础形式

| 对象 | 规则 | 示例 |
| --- | --- | --- |
| SQL 表、列、约束、索引 | `snake_case` | `provider_observation_runs` |
| TypeScript wire/value | `camelCase` | `baseServerRevision` |
| Rust 字段 | `snake_case`，由 serde 显式映射 wire | `local_commit_sequence` |
| ID | `<aggregate>_id`；通用跨实体合同可用 `entity_id` | `workspace_id`、`domain_asset_id` |
| 分类 | `*_kind`，不能与生命周期混用 | `provider_kind` |
| 生命周期 | `*_status` | `lifecycle_status` |
| 工作流阶段 | `phase` 或限定后的 `*_phase` | `operation.phase` |
| 发生时间 | `*_at` | `materialized_at` |
| 业务日期 | `*_on` | `expires_on` |
| 数量 | `*_count` | `attempt_count` |
| 布尔值 | 肯定陈述，不使用含糊的 flag | `auto_renew` |

`status`、`state`、`phase` 只有在表名已经限定上下文、枚举受 CHECK/Schema 约束且三者不混用时才能
单独出现。`updated_at` 只表示整行最后一次持久化变更；观察、执行、同步、ACK、物化和 Provider
修改时间必须使用各自限定名称。禁止在持久化字段和领域 wire contract 中新增没有限定语义的
`source`、`version`、`revision`、`availability`、`uncertainty`、`payload`、`data` 或 `metadata`；
通用 transport envelope 中由严格 schema 限定的 `data`/`payload` 不属于业务字段命名。

## 3. 顺序和版本空间

| 含义 | 必须使用 | 禁止使用 |
| --- | --- | --- |
| 本地业务提交顺序 | `local_commit_sequence` | `revision` |
| 设备在 Lease Epoch 内的 Mutation 顺序 | `device_mutation_sequence` | `mutation_sequence` |
| 设备在 Lease Epoch 内的 Execution Fact 顺序 | `execution_fact_sequence` | `sequence` |
| 设备在 Lease Epoch 内的审计事件顺序 | `audit_sequence` | `sequence` |
| Drain 绑定的当前授权 Epoch | `active_lease_epoch` | `lease_epoch` |
| Cloud Workspace 日志位置 | `server_revision` | `workspace_revision` |
| 已连续应用的 Cloud 前缀 | `applied_through_server_revision` | `server_revision` |
| 已物化的 Cloud 前缀 | `materialized_through_server_revision` | `version` |
| Reader 已读取前缀 | `read_through_server_revision` | `last_read_revision` |
| Cursor 已确认前缀 | `acknowledged_through_server_revision` | `cursor_revision` |
| Checkpoint 覆盖前缀 | `checkpoint_through_server_revision` / `through_server_revision` | `checkpoint_revision` |
| 已压缩前缀 | `compacted_through_server_revision` | `compaction_watermark` |
| 行 CAS | `row_version` | `version` |
| 工作流 CAS | `workflow_revision` | `revision` |
| 格式兼容性 | `*_schema_version` | `version` |
| 密钥轮换版本 | `key_version` / `credential_version` | `version` |

`lease_epoch` 只允许作为 Device Lease 聚合本身的 Epoch 主字段；任何引用当前授权 Lease 的业务事实、
Drain 或同步记录必须命名为 `active_lease_epoch`。持久化 Drain record 和 seal 必须分别使用 capability
限定的 `*_sequence` 与 `last_assigned_*_sequence`，不得依赖表名解释裸 `sequence`。携带显式 `stream`
判别字段、由同一算法处理三类 Drain 的通用协议 claim/内存状态可以使用 `lastAssignedSequence`；消费者
不得在移除 `stream` 后持久化这个通用名称。

SQL、TypeScript、Rust、测试向量和 wire 字段必须使用同一个概念名。首次生产发布前，所有 GoodDealer
自有协议、持久化 schema、证据报告和测试 manifest 的最终确认形态统一使用 `schemaVersion = 1`；
设计迭代直接覆盖 v1，不使用递增版本号记录修改次数，也不保留尚未发布形态的兼容分支。未知版本拒绝测试
统一使用 `999`，避免把测试输入误读为真实历史版本。首次生产发布后，wire 字段改名才属于必须提升
`schemaVersion`、追加兼容/迁移处理并重新生成规范摘要测试的不兼容协议变更。

## 4. 本地与 Cloud 命名

- 本地私密 Provider 聚合使用 `local_provider_connections`；主身份是 `connection_id`。
- Provider 类型使用 `provider_kind`，用户可读别名使用 `display_label`，第三方账号标识使用
  `provider_account_id`。
- Cloud 业务副本表必须使用 `workspace_replica_*`；禁止使用不带 `replica` 的业务权威式表名。
- Cloud 副本生成信息使用 `materialization_*`，例如 `materialization_origin`、
  `materialization_version_token`、`materialized_at`。
- Cloud 副本状态使用 `projection_availability`、`projection_evidence_status` 和
  `materialized_through_server_revision`，不能使用静态 `source='gooddealer_cloud'` 证明来源。

## 5. 用户意图、Provider 事实和物化投影

三类事实必须在名称上分离：

| 事实 | 命名 | 示例 |
| --- | --- | --- |
| 用户期望 | `desired_*` | `desired_nameservers` |
| Provider 观察 | `provider_*`、`observed_*`、`observation_*` | `provider_version_token` |
| 查询副本 | `materialization_*`、`projection_*` | `projection_evidence_status` |

Provider Observation 使用以下固定词汇：

- `observation_origin`: `workspace | provider | manual | recovery`。
- `observation_capability`: `registrar | dns | marketplace | valuation`。
- `provider_kind`: 可同步的 Provider 类型；不得携带 Provider Account 或本地 Connection 身份。
- `provider_version_token`: Provider ETag、revision 或可比较版本令牌。
- `provider_modified_at`: 仅当 Provider 明确返回修改时间时使用。
- `connector_version`: Connector 实现/协议版本，不能冒充 Provider 版本。
- `observation_availability`: 观察证据是否可用。
- `evidence_status`: `confirmed | stale | conflicted | unknown`。
- 领域可用性必须限定业务，例如 `registration_availability`；获取失败记录在 target 的
  `status/error_code`，不能复用业务可用性。

## 6. Payload、摘要和秘密边界

- Payload 必须按用途命名：`observation_payload`、`event_payload`、`canonical_submitted_envelope`。
- 可扩展 Payload 必须有 `payload_schema_version` 和 kind-specific 严格 schema。
- 字段名不能使用 `sanitized_payload` 声称安全；是否可上云由 schema 白名单、materializer 和
  secret-canary 共同证明。
- 普通内容或字节证据的固定 SHA-256 使用 `*_sha256`。`*_digest` 只用于协议已定义规范编码、
  domain separator、摘要算法和表示的 transcript/链完整性值，例如 `checkpoint_digest`；算法可变时
  必须另存算法或 crypto profile，不能让消费者从 `digest` 猜测。
- `normalized_evidence_sha256` 表示规范化证据摘要；`provider_response_sha256` 表示 Provider 原始响应
  字节摘要，两者不能互换。
- SQLite hex SHA-256 为 64 字符，wire base64url SHA-256 为 43 字符，PostgreSQL 原始摘要为
  32-byte `bytea`；列约束必须证明其表示。

## 7. 设计审查清单

新增或修改字段前必须确认：

1. 哪个运行时拥有它，哪个数据库是权威？
2. 它是用户意图、Provider 事实、执行证据还是物化副本？
3. ID、sequence、revision、version 分别属于哪个作用域？
4. 时间表示发生、观察、应用、ACK、物化还是过期？
5. 字段是否允许同步；若允许，是否会间接暴露 Connection、Provider Account 或秘密身份？
6. Payload 是否有明确 kind、schema version、大小限制和摘要输入规则？
7. SQL、Repository、协议、测试向量、示例和当前态文档是否同步使用新名称？
8. 是否已通过旧名称残留扫描、schema manifest、Migration checksum 和协议摘要测试？

设计开发阶段应直接更新集中 schema 和对应固定 checksum。首次生产发布后，不得重写已发布
Migration，只能追加由拥有模块维护的迁移。
