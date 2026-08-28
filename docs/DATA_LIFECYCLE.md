# GoodDealer 数据生命周期与恢复

## 数据分类

| 类别 | 权威位置 | 生命周期规则 |
| --- | --- | --- |
| GoodDealer 账号、订阅、设备、Lease | Cloud 控制面 | 按账号和商业规则创建、吊销、保留和审计。 |
| Desktop 业务数据、任务、历史 | 本地 SQLCipher | 本地事务创建和修改；Cloud 仅保存允许字段的副本。 |
| 第三方平台账号及账号 metadata | 本地 SQLCipher/Host | 不同步、不上传；退出登录不应隐式删除。 |
| Provider 凭据与数据库解锁材料 | OS/Host 秘密边界 | 不进入普通持久化、wire、Cloud、日志、错误或审计。 |
| 脱敏同步副本 | Cloud sync plane | 受租户隔离、保留、导出和显式删除规则约束。 |
| Provider 观察 | 先写本地业务库 | 只有允许字段可复制，保留来源和时间。 |
| 备份工件 | 本地受限备份边界 | 从 Host-owned 已打开连接取得，不能替代日常本地数据库。 |

## 创建与修改

本地业务修改和 Outbox 在同一事务提交。Cloud ACK 之后只更新复制状态。Provider 结果必须先进入
本地数据库，再异步复制脱敏字段；Cloud 不发起 Provider 调用。

## 删除

本地删除是业务事务并生成显式墓碑；Cloud 空副本或读取失败不能触发本地清空。第三方账号和
凭据删除是独立的本地安全操作，不通过同步传播。账号注销、订阅失效或 Lease 失效可以锁定入口，
但不能静默删除本地数据。

## 备份与恢复

备份源只能是 `local-storage` 按固定配置打开并由 Host 持有的 SQLCipher 连接。调用方不能提供
数据库路径、密钥、VFS 或输出身份。恢复流程必须在隔离环境中验证工件、解密、迁移和数据分类，
重建本地 SQLCipher 后再开放 Query。Cloud 同步副本可作为恢复输入，但不能绕过本地重建，也不能
包含第三方账号或秘密。

详细源能力约束见 [ADR-0015](adr/0015-host-owned-sqlite-backup-source.md)，完整权威边界见
[ADR-0016](adr/0016-local-business-database-and-cloud-sync-boundary.md)。
