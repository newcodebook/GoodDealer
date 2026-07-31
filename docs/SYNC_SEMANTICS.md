# GoodDealer 同步与冲突语义

状态：Draft  
更新日期：2026-07-31

GoodDealer 同时处理两类同步，不能混为一谈：

- 设备与 GoodDealer Cloud 的业务数据同步。
- GoodDealer Desired State 与外部平台 Observed State 的对账。

## 1. 活动设备与云端合并

每次设备修改保存 `cloud_base_revision`。服务端收到 Mutation 时比较：

```text
cloud_base      设备开始编辑时的云端字段版本
device_local    当前设备提交的新值
cloud_current   服务端已接受的最新值
```

- `cloud_current == cloud_base`：接受设备修改。
- 设备和云端修改不同字段：按字段自动合并。
- 正常情况下只有当前活动设备能够提交 Mutation，因此不把双设备同时编辑作为常规工作流。
- 标签等集合字段可按元素合并；普通字段不默认使用时间戳 Last Write Wins。
- Sold、Nameserver、DNS 删除和所有权状态冲突必须人工处理或使用明确的安全规则。
- 字段的冲突等级由 protocol 字段元数据 `mergeClass`（auto/manual/safety_priority）单源定义；服务端合并与客户端对账消费同一份标注，不得各自维护高风险字段清单。

Mutation 使用全局唯一 `mutation_id` 幂等处理。Device Cursor 按服务器 Revision 增量拉取；Revision 表示 GoodDealer 内部顺序，不证明外部平台状态。

设备来源的可变状态冲突只在以下恢复场景进入系统：

- 强制切换后，旧设备携带过期 `active_lease_epoch` 上线；其修改成为 `StaleDeviceCandidate`。
- 用户恢复旧备份；其差异成为 `RestoreCandidate`。
- 服务端或本地状态相对 Candidate 创建时已再次变化。

Candidate 不等同于 Mutation，不能静默覆盖云端。用户选择字段后，系统以当前 Server Revision 为新基线生成 Mutation；高风险字段必须重新预览和批准。

旧 Epoch 的 Operation 尝试、平台结果、远端任务 ID、确认等级、`outcome_unknown` 和审计事件不是冲突候选。它们在验证旧 Lease、设备签名、ApprovedOperation、计划 Hash 和序列号后作为 `LateExecutionEvent` 追加保存，且不能由用户丢弃。LateExecutionEvent 不覆盖当前 Desired/Observed State；当前活动设备通过后续平台读取决定最新 Observed State。

## 2. 平台三方状态模型

同步不能只比较 Desired 与最新 Observed。每次本地编辑必须保存编辑时的基线：

```text
base    用户编辑时最后确认的平台状态
local   当前 desired state
remote  新读取的平台 observed state
```

逐字段合并规则：

```text
remote == base                 平台未改，执行 local
local == base                  本地未改，接受 remote
local == remote                已自然收敛
local != base && remote != base && local != remote
                               字段冲突
```

冲突按字段判定，不按整个对象判定。本地只修改 BIN、远端只修改 Description 时可以安全合并。

## 3. 默认字段策略

| 对象/字段 | 默认规则 |
| --- | --- |
| BIN、最低报价、分期参数 | 无待执行本地修改时接受远端；双方同时修改同字段则人工冲突 |
| 描述、分类、标签 | 不同字段自动合并；相同字段同时修改则人工冲突 |
| Listing Active/Paused | 本地下架优先；远端意外下架时不自动重上，转人工确认 |
| Sold/Transfer Pending | 安全状态优先，立即接受并触发跨平台下架 |
| DNS 新增记录 | 不与现有记录冲突时可合并 |
| DNS 修改/删除 | 远端发生变化时一律人工确认，不自动覆盖 |
| Nameserver、DNSSEC | 永远不自动合并；同域名串行并需要重新规划 DNS 操作 |
| 注册商到期/锁定状态 | 以注册商读取为准；本地写意图单独保留为待执行操作 |

用户可以按平台和字段覆盖默认策略，但首版不提供“所有冲突永远强制本地覆盖”。

本表是 protocol 字段元数据 `mergeClass` 的具体化：默认规则与设备↔云端合并共用同一份标注；用户覆盖不改变 `safety_priority` 字段的人工确认要求。

## 4. 冲突记录

`SyncConflict` 至少保存：

```text
domain_asset_id
provider_connection_id
object_type
field_path
base_value
local_value
remote_value
detected_at
source_snapshot_id
resolution
```

解决选项：保留本地并重新计划、接受平台、手工输入新值、忽略到指定时间。解决操作进入审计日志。

## 5. 平台读取同步策略

只有当前活动设备执行外部平台读取。Standby 可以读取 GoodDealer Cloud 已有快照，但不运行连接器、平台后台刷新或对账。设备切换后，新活动设备先拉取共享的 `quota_scope`、剩余配额、重置时间、`backoff_until` 和最近刷新时间，再决定是否读取平台。

连接器声明的是具体读取能力，不使用含糊的 `supportsWebhook`：

```typescript
interface ChangeDetectionCapabilities {
  listMode: "full" | "cursor" | "modified_since" | "per_item";
  pushMode: "none" | "optional_relay";
  recommendedFullRefreshSeconds?: number;
  recommendedDeltaRefreshSeconds?: number;
}
```

本地客户端首版 `pushMode` 全部为 `none`。桌面应用不能可靠接收入站 Webhook；未来只有在用户明确启用可选中继服务后才能使用 `optional_relay`，且中继设计必须单独评审。

## 6. 读配额和优先级

读写共享每个 `ProviderConnection` 的令牌桶，但预留配额给高优操作：

| 优先级 | 用途 |
| --- | --- |
| P0 | 已售下架确认、安全状态确认、结果未知的写操作确认 |
| P1 | 用户手动刷新和当前界面读取 |
| P2 | `waiting_remote`、`waiting_dns` 工作流 |
| P3 | 后台增量刷新 |
| P4 | 全量审计和历史补全 |

高优读取可以越过排队中的低优读取，但不能突破平台硬限流。连接器若返回 Rate Limit Header，调度器动态更新预算；否则使用保守配置并指数退避。

## 7. 建议刷新节奏

- 远端异步任务：5 秒起步，逐渐退避到 30 秒、2 分钟、5 分钟。
- DNS 传播：基于 TTL，最短 30 秒，随后指数退避。
- 活跃销售平台：15～60 分钟增量刷新。
- 注册商资产：6～24 小时全量/增量刷新。
- DNS 全量记录：按需读取；验证中的 Zone 单独刷新。
- 用户打开详情页时允许 P1 定向刷新。

10,000 个域名优先使用平台分页列表，不逐域名刷新。只有 `per_item` 的平台必须分片到较长时间窗口，并在 UI 显示数据陈旧时间。

## 8. 快照一致性

云端同步的业务快照与平台读取快照必须使用不同类型和 Revision。切换后的活动设备收到前一设备的 Observed State 时可以展示其来源和读取时间，但不能把它当成本设备凭据可用或平台刚刚确认。

- 一次分页全量刷新拥有 `sync_run_id`。
- 只有所有分页成功后才把该 Run 提升为完整快照。
- 中途失败的 Run 可用于更新已确认字段，但不能据此把缺失域名标记为离开账户。
- 平台列表中一次缺失只标记 `unobserved`，需要后续确认才能改变持有状态。

## 9. 日志分类与回放边界

系统存在三类追加式记录，语义不同，禁止合并为一本日志或统一回放：

| 记录 | 语义 | 回放行为 |
| --- | --- | --- |
| `SyncMutation` | 业务状态变更意图 | 可回放：Checkpoint + 后续 Mutation 重建业务状态 |
| `LateExecutionEvent` 与 Operation 结果 | 外部副作用的既成事实 | 不回放为状态：只补全历史与审计，平台状态以重新读取的 Observed 为准 |
| `AuditEvent` | 审计证据（Hash 链） | 不回放、不合并、不可丢弃 |

设备重建 = 最近服务端 Checkpoint + 之后的 Mutation Log 回放；事实与审计记录按时间线附加展示，不参与状态重建。把事实记录当作状态回放（例如回放“下架已执行”导致本地状态被改写）是明确禁止的实现错误。

## 10. 设备与云端一致性校验

协议正确不等于实现正确。本地工作库与云端库是同一逻辑数据的两次物化，必须有独立于同步协议的差异检测：

- 客户端在指定 Server Revision 上按实体类型计算摘要（行数 + 内容 Hash），与服务端同 Revision 的摘要比对。
- 校验作为 P4 Maintenance 周期执行；设备激活完成基线对齐后强制执行一轮。
- 摘要不一致时定向重拉该实体类型（最近 Checkpoint + 后续 Mutation），修复前后各记录一条审计事件；不得静默改写云端数据。
- 校验只覆盖可同步业务数据；设备秘密和本地 Artifact 不参与。
