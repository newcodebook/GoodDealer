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
operation generation 只作为短期操作 fence。该 v1 格式只适用于同一安装、账号和工作区，没有口令、
跨设备或 Cloud 托管模式。Provider 凭据/身份、OAuth/session、Lease/Grant/Ticket/ApprovedOperation、
授权状态和同步控制状态不进入工件。

`active` 与 `verified_local_continuation` 可以导出和检查工件，恢复提交仅允许 `active`。导入合同要求
Desktop Local Host 私有的原生稳定文件 handle 进行严格格式、认证、binding、schema 和数据分类验证；Renderer 不取得路径。
导出由两阶段 filesystem/catalog journal 覆盖 create-new、fsync、no-clobber rename 和目录发布。
恢复不是 A/B 旧数据库 pointer swap：隔离 candidate 通过后，`RestoreTransaction` 在当前 active 数据库
中把旧业务内容写成新的 mutation、field version、tombstone、history 和 secret-free Outbox，同时保留
当前 authority、workspace、sync cursor/floor、Inbox、conflict、receipt 和 delivery ownership。

该架构由 [ADR-0023](adr/0023-business-backup-and-recovery.md) 固定。
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

接入方式按 [ADR-0027](adr/0027-multi-platform-domain-providers-and-marketplaces.md)保留已确认的官方 API，当前未找到官方支持的能力缺口
全部自研私有 HTTP 接口，社区代码仅作参考。两种协议路径均由对应平台私有 Service 持有，不产生新的 Cloud 代理或 Renderer 网络权威；必要的会话与
有界表单解析仍在 Native 内，同一写入 attempt 不因失败自动切换协议路径重放。

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

## 当前实现与演进

源码组合及其入口统一维护在 [当前实现](CURRENT_IMPLEMENTATION.md)，Local Host 的私有模块职责
见 [工程结构](ENGINEERING_STRUCTURE.md)。`DesktopLocalHost` 是整个本地数据面的聚合所有者，
不再放在名为 `backup` 的顶层模块之下；授权、业务、同步、Provider 协调、备份和恢复各有私有实现，
共同保留数据库所有权和事务栅栏。

产品负责人已明确要求换机云恢复及独立业务备份。上文安装绑定 GDBK v1 描述的是现有协议，
不能作为排除新恢复需求的理由；新的隔离离线读出、换机恢复与授权语义见
[ADR-0023](adr/0023-business-backup-and-recovery.md)，具体格式与原生实现仍需交付。商业策略允许演进，Cloud Licensing
拥有规则版本及已购事实，Desktop 不复制定价或优惠决策。营销材料不决定技术范围。
