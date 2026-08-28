# GoodDealer 数据关系与所有权地图

```text
Cloud control plane
Account -- Subscription/Entitlement -- Device/Lease/Epoch
   `-- default workspace binding

Desktop local SQLCipher (business authority)
Workspace
  +-- DomainAsset -- DesiredState / ObservedState
  +-- ProviderConnection (account identity and label; local only)
  +-- Operation / Task / Result / History
  +-- SyncInbox / SyncOutbox
  `-- local replication metadata

Local secret boundary
  `-- Provider credentials / browser profiles / database key material

Cloud sync replica
  `-- allowlisted business projection / ACK / Cursor / Checkpoint
```

| 实体 | 权威所有者 | Cloud 角色 | 关键约束 |
| --- | --- | --- | --- |
| Account、Session | Cloud identity | 权威 | 客户端不能自选账号。 |
| Subscription、Entitlement、Lease/Epoch | Cloud commercial/devices | 权威 | 决定能力门禁，不拥有业务行。 |
| Workspace binding | Cloud control plane | 权威 | Host 从已验证授权取得本地数据库身份。 |
| DomainAsset、任务、操作、历史 | 本地 SQLCipher | 允许字段的副本 | 正常 Query/Command 不依赖 Cloud。 |
| ProviderConnection | 本地 SQLCipher/Host | 不保存 | 包括 Provider Account ID 和账号别名，全部禁止同步。 |
| Provider credential | 本地秘密边界 | 不保存 | 不进入普通 TypeScript、wire、日志、错误或审计。 |
| SyncMutation、ACK、Cursor、Checkpoint | 本地复制状态与 Cloud sync plane | 复制协调 | ACK 不决定本地业务提交。 |
| ServerAuditEntry | Cloud audit | 权威 | 只记录脱敏控制面/同步事件，不接收秘密。 |
| BackupArtifact | 本地备份/恢复边界 | 可选加密副本 | 恢复先重建本地 SQLCipher，不能成为日常 Repository。 |

Cloud PostgreSQL 中现有 Portfolio 与 Observation 表是同步副本或恢复物化。它们不能被 Desktop
正常读取路径当作业务权威。视觉资产、fixture、文案和本地报告也不构成任何业务事实。
