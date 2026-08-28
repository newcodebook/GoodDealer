# GoodDealer 系统架构

## 核心结论

GoodDealer 是由 Cloud 控制面授权、由 Desktop 本地数据面执行业务的本地优先应用。

```text
Cloud control plane                         Desktop data plane
Account / Session                           Tauri Host
Subscription / Entitlement                      |
Device / Lease / Epoch  -- signed grant -->     +-- local SQLCipher (business authority)
Sync ACK / Cursor                                +-- local provider credentials
                                                  +-- provider execution
                                                  `-- secret-free Sync Outbox --> Cloud replica
```

Cloud 授权用户和设备是否可以使用能力；本地 SQLCipher 决定 Desktop 业务数据是什么。二者不能
互换。有效授权窗口内，Cloud 业务数据服务不可达不应阻止本地业务读写。

## 运行与信任域

| 域 | 拥有职责 | 明确禁止 |
| --- | --- | --- |
| Desktop Renderer | 呈现本地 Query、收集有界意图、显示授权和同步状态。 | SQL、路径、密钥、Provider 凭据、任意网络。 |
| client-core | Host-independent 业务规则、命令和 Query 端口。 | Cloud/SQLite Repository 实现和秘密。 |
| Tauri / Secure Host | 授权门禁、本地数据库组合、秘密 custody、Provider 调用。 | 通用数据库/文件/网络 IPC。 |
| local-storage | SQLCipher 业务表、事务、任务、历史、Inbox/Outbox、恢复后的本地 Query。 | 依赖 Cloud ACK 提交本地事务。 |
| Cloud control plane | GoodDealer 账号、会话、订阅、Entitlement、设备、Lease/Epoch。 | 拥有 Desktop 业务数据或 Provider 凭据。 |
| Cloud sync plane | 脱敏业务副本、Mutation ACK、Cursor、Checkpoint、恢复数据。 | 作为 Desktop 正常 Repository 或调用 Provider。 |
| Connector | 特定 Provider 的严格本地合同。 | Cloud 侧凭据、共享网络权威或 UI 直接执行。 |

## 数据流

业务写入先在本地业务表与 `sync_outbox` 的同一事务中提交。同步器异步发送字段白名单内的
Mutation；Cloud ACK 只推进复制状态。Cloud Pull 必须先进入本地严格验证和冲突处理，再由本地
事务合并，Renderer 永远不直接读取 Cloud Portfolio。

Provider 读取和操作由 Secure Host 使用本地凭据执行，结果先写本地业务数据库。只有明确允许、
不含第三方账号信息和秘密的业务字段可以进入 Outbox。Cloud 不代表 Desktop 调用 Provider。

## 授权与离线

账号登录、订阅、Entitlement、设备绑定和 ActiveDeviceLease/Epoch 仍是 Cloud 权威。无效授权
必须锁定入口；已有授权可以按产品定义的离线期限继续本地业务。这里不承诺无限离线，也不允许
客户端自行扩大 Lease。锁定入口不改变或清空本地业务数据库。

## 关键不变量

- 本地业务提交不等待 Cloud。
- Cloud 空副本不能删除本地行。
- 第三方平台账号、Provider Account ID、别名、API Key、Token、Cookie、密码、2FA、Browser
  Profile 和 Credential Binding 永不进入同步、Cloud、日志、错误或普通审计。
- Renderer 不接触本地数据库密钥、路径、凭据或通用操作能力。
- 跨模块只通过声明的端口、合同和包导出交互；所有不可信 wire 从 `unknown` 严格解析。

权威数据分类与完整同步不变量见 [ADR-0016](adr/0016-local-business-database-and-cloud-sync-boundary.md)。

## 当前实现

`local-storage` 已具备生产 SQLCipher 活动工作区以及完整业务 schema：DomainAsset 生命周期、
Desired/Observed State、本地 Provider 账号与凭据版本、Operation/Result/History、Inbox/Outbox、
冲突、墓碑和本地备份目录。当前窄业务 API 已原子写入权威表、字段版本和 Outbox；其余未来实体的
Repository、Desktop Host 授权组合、同步 Push/Pull 和恢复执行仍需按[路线图](ROADMAP.md)组合。
Cloud PostgreSQL 最终业务表使用 `workspace_replica_*`，只构成同步/恢复副本。
