# GoodDealer Phase 0 Secure Host 基线

状态：Active foundation; production construction is denying.

## 当前公开面

`secure-host-core` 当前只公开以下窄备份操作类型：`SecureHost`、
`ActiveBackupOperation`、`BackupArtifactAdmission`、`BackupExportOperation`、
`SealedBackupFrame` 和 `BackupOperationError`。

`SecureHost::with_active_backup_operation` 只允许调用方在 Host 保留权威的情况下使用一次
借用操作。工件身份必须精确匹配，导出操作一次性封装有界帧；调用方不能构造、保留、
选择或恢复 Host 权威，也不能获得通用秘密、会话、密钥链、HTTP 或浏览器 API。具体生产
构造保持拒绝。

## 当前关联边界

| 范围 | 当前状态 | 结论 |
| --- | --- | --- |
| Local backup | 没有 Core 备份权威，只有固定 v1 不可用报告。 | 没有备份导出或恢复打开路径。 |
| Browser | 自动化宿主报告 `Unavailable`。 | 没有浏览器执行、页面桥接或 Desktop 组合。 |
| Desktop | Tauri 精确注册三个本地业务命令，未授权时锁定。 | 不能增加路径、密钥、SQL、Provider 账号或 Cloud Repository 参数。 |
| Cloud | 业务路由和周期作业为空。 | Host 基础不构成服务器业务能力。 |

## 已接受的未来约束

任何未来本地受保护操作必须：

- 由拥有模块定义具体、最小且不可泛化的 Host API；
- 将秘密和支撑权威保持在 Host 私有状态中；
- 对调用方输入做严格验证，并在身份、作用域或资源不确定时拒绝；
- 不将备份操作扩展为通用密钥、存储、网络或浏览器控制面；
- 使用真实的原生环境、最终构件和独立审查作为资格证据。

## 未完成的外部前提

ADR-0015 已定义 SQLite 源身份为 Host-owned 的已打开连接，而非路径或可选 VFS。具体生产
组合、原生秘密 custody、签名应用、持久归档、独立审查和 Gate closure 仍未完成。Portable
或本地测试不能替代它们。
