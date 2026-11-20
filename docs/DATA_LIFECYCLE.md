# GoodDealer 数据生命周期与恢复

产品恢复目标与新边界以 [ADR-0023](adr/0023-business-backup-and-recovery.md)为准：
独立备份由用户保存并跨机离线恢复，云恢复取得最近成功同步的副本；Windows/macOS 均需完整支持。
下文 GDBK v1 描述既有安装绑定协议，不是新备份的产品限制，也不表示生产恢复已可用。

## GDBK v2 独立备份

设置页创建时由 Native 生成 256 位随机恢复材料，编码为 49 字节 ASCII，固定 `GDBK2-` 前缀加无填充 Base64url。用户分别选择 `.gdbk` 和 `.gdkey` 文件，恢复材料先持久发布，加密备份随后无覆盖发布。第二步失败时可留下已保存的独立密钥，界面会说明部分结果。重新打开外部备份时再次由用户选择两份文件。

`GDBK\0V2\0` 工件固定 XChaCha20-Poly1305 与 HKDF-SHA256。header 含套件、业务投影长度、随机 32 字节 salt 和随机 16 字节 nonce 前缀。manifest 与每个数据帧使用 header 和连续序号作为附加认证数据。manifest 记录备份时间、允许字段版本与投影 digest。每帧至多 1 MiB，投影至多 64 MiB。解析检查精确总长、认证和业务投影规则。

离线数据集使用独立随机 SQLCipher 密钥和只读查询。登录、商业授权、旧安装、Provider 账号、秘密、执行任务和当前同步状态均不参与工件认证。可读 JSON 由用户明确选择导出位置。当前字段为域名、备注、标签、组合标识和目标价格。

当前 Active 工作区可以逐域名预览并一次批准新增。在原事务中重新比对当前数据，只对安全可创建的域名写入常规创建 mutation，并保存导入回执。已存在的资产、删除记录和不匹配的历史代次保留。预览随打开的备份会话关闭或放弃，已提交的资产和回执可在重开后读取。历史备份的离线读取仍独立于活动工作区 revision 和授权。

## 数据分类

| 类别 | 权威位置 | 生命周期规则 |
| --- | --- | --- |
| GoodDealer 账号、订阅、设备、Lease | Cloud 控制面 | 按账号和商业规则创建、吊销、保留和审计。 |
| Desktop 业务数据、任务、历史 | 本地 SQLCipher | 本地事务创建和修改；Cloud 仅保存允许字段的副本。 |
| 第三方平台账号及账号 metadata | 本地 SQLCipher/Host | 不同步、不上传；退出登录不应隐式删除。 |
| Provider 凭据与数据库解锁材料 | OS/Host 秘密边界 | 不进入普通持久化、wire、Cloud、日志、错误或审计。 |
| 脱敏同步副本 | Cloud sync plane | 受租户隔离、保留、导出和显式删除规则约束。 |
| Provider 观察 | 先写本地业务库 | 只有允许字段可复制，保留来源和时间。 |
| GDBK v1 备份工件 | 本地受限备份边界 | 只含 allowlisted 业务 root；由安装级 Backup KEK 绑定同一安装/账号/工作区，不能替代日常本地数据库。 |

## 创建与修改

本地业务修改和 Outbox 在同一事务提交。Cloud ACK 之后只更新复制状态。Provider 结果必须先进入
本地数据库，再异步复制脱敏字段；Cloud 不发起 Provider 调用。

## 删除

本地删除是业务事务并生成显式墓碑；Cloud 空副本或读取失败不能触发本地清空。第三方账号和
凭据删除是独立的本地安全操作，不通过同步传播。账号注销、订阅失效或 Lease 失效可以锁定入口，
但不能静默删除本地数据。

## 备份与恢复

备份源只能是 `gooddealer-local-storage` 的 `DesktopLocalHost` 按固定配置打开并持有的 SQLCipher 连接。调用方不能提供
数据库路径、密钥、VFS、nonce、key slot 或输出身份。源先生成由新临时 key 加密的一致 SQLCipher
快照，再生成确定性完整集合的业务 root 投影。工件只接受严格 `GDBK v1`；每个工件使用新内容密钥，
并由同一所有者在 OS 非同步、ThisDeviceOnly custody 中稳定的安装级 `backup-wrap-v1` Backup KEK 包装；
独立 rollback anchor 防止可回滚的 KEK registry blob 为自身背书。普通
session/Lease 更新不轮换该 KEK，短期可信时间/授权/generation 只阻止陈旧操作发布。

GDBK 只支持同一安装、账号和工作区，没有口令、跨设备或 Cloud 托管/传输模式。Provider 凭据和
账号/连接身份、OAuth/session、数据库解锁材料、Lease/Grant/Ticket/ApprovedOperation、授权状态、
sync delivery ownership、cursor、Inbox、conflict、receipt、rebootstrap journal 和 backup catalog
明确排除。`includePlatformCredentials=true` 必须拒绝。

`active` 与 `verified_local_continuation` 可以导出和检查工件；只有 `active` 可以恢复。
外部文件每次都通过原生 picker 取得的新 handle 重新准入；路径和 catalog metadata 不构成打开权威。
导出按 `reserved -> writing -> fsynced -> renamed -> catalog_available` 两阶段日志发布，失败或身份不匹配
进入 `invalid`/`quarantined`。临时快照始终为 SQLCipher 密文，所在临时目录在 Unix 上以 `0700` 创建并校验属主与权限（不随进程 umask），不符即失败关闭；临时 key、内容 key 和明文缓冲从首次
分配起即由 owner-private zeroizing 容器持有；清理失败阻止工件变为可用。

导入先在隔离 candidate 中完成容器认证、binding、schema、完整集合和数据分类验证。最终恢复在当前
active 数据库的一个 `IMMEDIATE` 事务中精确 CAS revision、positive candidate set/version、artifact/
dialog/operation identity 和 owner-internal authority generation，
将备份业务内容写成新的 mutation、field version、显式 tombstone、history 和 secret-free Outbox。
它保留当前 workspace identity、server cursor/floor、Inbox、receipt、conflict、delivery ownership、
catalog 与授权状态；不得切换到旧数据库 pointer，也不得把旧 revision/epoch/cursor 伪装成当前水位。
并发编辑或冲突拒绝并回滚，提交 receipt 保证 crash replay 不重复。

Cloud 同步副本的 rebootstrap 是另一条恢复输入，不改变 GDBK 的安装绑定，也不能绕过本地验证或包含
第三方账号和秘密。当前源码与测试已在 `gooddealer-local-storage` 私有边界内完成 SQLCipher source、
strict GDBK v1、isolated candidate、guarded current-DB restore、严格 client 合同和 Desktop 四命令
raw-wire 工作流的开发组合；continuity/rebootstrap 完整阶段只由私有 `cfg(test)` create-only fake
验证。`secure-host-core` 不参与数据库 key 或备份。生产 native picker、稳定文件 handle、真实安装级
KEK、独立 non-rollbackable anchor、true create-only slot-key adapter、safe
`SQLITE_FCNTL_HAS_MOVED`/custody VFS 与目标平台文件系统/故障资格仍未完成。生产 rebootstrap 在任何
plan wire/locks 前返回 `Unavailable`；startup 仅以固定只读 presence gate 接受完全无残留状态，任何已有
journal/key/candidate/sidecar 或检查不确定性都终止 Host 构造，不解析、不修复、不清理。完整状态机、
quarantine Host 与恢复执行只在 `cfg(test)`。retained-fd 证据
不覆盖同 UID swap-and-swap-back SQLite 副作用。因此 GDBK、continuity 与 rebootstrap 均不可用。

详细源能力约束见 [ADR-0023](adr/0023-business-backup-and-recovery.md)，完整权威边界见
[ADR-0016](adr/0016-local-business-database-and-cloud-sync-boundary.md)，GDBK 与恢复语义见
[ADR-0023](adr/0023-business-backup-and-recovery.md)。
