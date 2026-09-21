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
| Tauri / Secure Host | 授权门禁、秘密 custody、Provider 调用和薄 IPC 组合；本地备份由 `local-storage` DesktopLocalHost 独占。 | 通用数据库/文件/网络 IPC，或任何备份 authority/crypto/handle bridge。 |
| local-storage | SQLCipher key 与业务表、事务、任务、历史、Inbox/Outbox、恢复后的本地 Query，以及 DesktopLocalHost 的备份 authority、GDBK/KEK、continuity/rebootstrap 协议、native handle/journal、projection/candidate/restore。 | 依赖 Cloud ACK 提交本地事务，向 sibling crate 暴露存储内部，或把私有测试协议描述成生产资格。 |
| Cloud control plane | GoodDealer 账号、会话、订阅、Entitlement、设备、Lease/Epoch。 | 拥有 Desktop 业务数据或 Provider 凭据。 |
| Cloud sync plane | 脱敏业务副本、Mutation ACK、Cursor、Checkpoint、恢复数据。 | 作为 Desktop 正常 Repository 或调用 Provider。 |
| Connector | 特定 Provider 的严格本地合同。 | Cloud 侧凭据、共享网络权威或 UI 直接执行。 |

## 本地备份与恢复

已接受的本地备份格式是严格 `GDBK v1`：`gooddealer-local-storage` 的 `DesktopLocalHost` 从已打开
SQLCipher 连接取得一致快照和 allowlisted 业务投影，用每个备份的新内容密钥加密，再由安装级、非同步 ThisDeviceOnly
`backup-wrap-v1` Backup KEK 包装。KEK 在普通 session/Lease 更新后保持稳定；可信时间、授权与
operation generation 只作为短期操作 fence。备份只适用于同一安装、账号和工作区，没有口令、
跨设备或 Cloud 托管模式。Provider 凭据/身份、OAuth/session、Lease/Grant/Ticket/ApprovedOperation、
授权状态和同步控制状态不进入工件。

`active` 与 `verified_local_continuation` 可以导出和检查工件，恢复提交仅允许 `active`。导入合同要求
Desktop Local Host 私有的原生稳定文件 handle 进行严格格式、认证、binding、schema 和数据分类验证；Renderer 不取得路径。
导出由两阶段 filesystem/catalog journal 覆盖 create-new、fsync、no-clobber rename 和目录发布。
恢复不是 A/B 旧数据库 pointer swap：隔离 candidate 通过后，`RestoreTransaction` 在当前 active 数据库
中把旧业务内容写成新的 mutation、field version、tombstone、history 和 secret-free Outbox，同时保留
当前 authority、workspace、sync cursor/floor、Inbox、conflict、receipt 和 delivery ownership。

该架构由 [ADR-0023](adr/0023-installation-bound-gdbk-backup-and-honest-business-restore.md) 固定。
当前源码与测试已完成私有开发组合：local-storage-owned SQLCipher source → strict GDBK v1 → isolated
candidate → guarded current-DB restore，并以 `cfg(test)` true-create-only fake 覆盖 continuity/rebootstrap
聚合协议。该证据不包含生产 native picker、稳定文件 handle、真实安装级 KEK custody、独立
non-rollbackable anchor、true create-only slot-key adapter、safe `SQLITE_FCNTL_HAS_MOVED`/custody VFS 或
目标平台文件系统/故障资格。完整 rebootstrap runtime/custody/database 协议仅在 `cfg(test)` 编译；生产
plan facade 在读取 wire/locks 前返回 `Unavailable`，startup 只做固定资源只读缺失检查。任何残留或检查
不确定性都终止 Host 构造且不解析、不清理、不修复、不发布 live quarantine Host；产品备份、continuity
与 rebootstrap 均不可用，也不得称为灾难恢复。

## 数据流

业务写入先在本地业务表与 `sync_outbox` 的同一事务中提交。同步器异步发送字段白名单内的
Mutation；Cloud ACK 只推进复制状态。Cloud Pull 必须先进入本地严格验证和冲突处理，再由本地
事务合并，Renderer 永远不直接读取 Cloud Portfolio。

Provider 读取和操作由 Secure Host 使用本地凭据执行，结果先写本地业务数据库。只有明确允许、
不含第三方账号信息和秘密的业务字段可以进入 Outbox。Cloud 不代表 Desktop 调用 Provider。

## 同步客户表面

客户状态由 Native 读取的持久化 `SyncSnapshot` 提供：`pendingMutationCount`、`openConflictCount`、
`rejectedMutationCount`、`recoveryRequired`、`appliedThroughServerRevision`、最近复制活动时间和
transport 观察时间。Native transport 只有 `checking`、`reachable`、`offline`、`blocked` 四种值；
启动与重启先报告 `checking`，不会沿用上次成功观察，也不读取 `navigator.onLine`。同步是强制异步
复制，不提供手动同步开关或按钮。旧的 mutation/execution-fact/device-audit 三流进度属于内部
协议诊断，不是客户状态合同。

`sync.conflicts` 是独立的 workspace 主导航。Active 可对单个候选提交显式选择；商业只读/Standby
仍可读取投影但 resolution admission 为 unavailable。locked、retryable、security、recovery 等
非 workspace surface 是 route-free。resolution receipt 只代表本地事务提交和 Outbox 排队（或幂等
重放），不代表 Cloud ACK；页面完成后重新读取本地状态与冲突投影。

## 授权与离线

账号登录、订阅、Entitlement、设备绑定和 ActiveDeviceLease/Epoch 仍是 Cloud 权威。有效授权
可以按产品定义的离线期限继续本地业务，客户端不能扩大 Lease。商业到期、商业暂停或退款只保留
既有本地工作区的查看与受控导出；设备撤销、账号安全恢复和本地完整性失败进入安全锁定。任何
限制都不改变、覆盖或清空本地业务数据库。详细能力边界见 [ADR-0020](adr/0020-commercial-entitlement-and-local-access.md)。

## 关键不变量

- 本地业务提交不等待 Cloud。
- Cloud 空副本不能删除本地行。
- 第三方平台账号、Provider Account ID、别名、API Key、Token、Cookie、密码、2FA、Browser
  Profile 和 Credential Binding 永不进入同步、Cloud、日志、错误或普通审计。
- Renderer 不接触本地数据库密钥、路径、凭据或通用操作能力。
- 备份不能恢复秘密、Provider/OAuth/session/authority 或同步控制状态，也不能通过旧数据库替换或伪造
  水位改变当前权威。
- 跨模块只通过声明的端口、合同和包导出交互；所有不可信 wire 从 `unknown` 严格解析。

权威数据分类与完整同步不变量见 [ADR-0016](adr/0016-local-business-database-and-cloud-sync-boundary.md)。

## 当前实现

`local-storage` 已具备生产 SQLCipher 活动工作区以及完整业务 schema：DomainAsset 生命周期、
Desired/Observed State、本地 Provider 账号与凭据版本、Operation/Result/History、Inbox/Outbox、
冲突、墓碑和本地备份目录。当前窄业务 API 已原子写入权威表、字段版本和 Outbox；其余未来实体的
GDBK 导出/恢复与 continuity/rebootstrap 状态机已在私有开发工作流中完成组合和测试，但在生产 native
资格完成前不构成产品能力。当前 retained-fd 身份/摘要证据可以拒绝发布错误 inode，不能证明抵抗同
UID active-path swap-and-swap-back 所造成的 SQLite 副作用。
当前 `domain_asset` Repository、Desktop Host 授权门禁、同步 Push/Pull、Renderer Conflict Center
和 Cloudflare 激活/只读观察旅程均已进入生产源码组合；D1+S1 的 generation、精确 CAS、原子重读和
transport 聚合已通过有界独立复审。该局部结论不等于跨模块 V1 验收，也不证明真实 Provider、目标
平台原生构件或未来实体；这些工作仍按[路线图](ROADMAP.md)推进。
Cloud PostgreSQL 最终业务表使用 `workspace_replica_*`，只构成同步/恢复副本。
