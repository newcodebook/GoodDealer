# GoodDealer Phase 0 Secure Host 基线

状态：Active foundation; production construction is denying.

## 当前公开面

`secure-host-core` 当前不公开任何 SQLCipher key 或备份类型、操作、依赖、桥接 API。它只拥有 OAuth、
授权验签、设备身份和 Cloudflare 只读等非存储 Host 能力。SQLCipher key 与完整备份边界都由
`gooddealer-local-storage` 的 `DesktopLocalHost` 独占。

完整备份边界由 `gooddealer-local-storage` 的 `DesktopLocalHost` 独占：authority continuity protocol、
strict `GDBK v1`、安装级 `backup-wrap-v1` KEK、rollback-anchor capability、native handle/journal、
projection、ephemeral candidate 与 current-DB restore 均为 crate-private。Desktop 只做有界 raw IPC、单次
`spawn_blocking` 和脱敏映射；client-core 只做严格一次性/CAS 合同。

## 当前关联边界

| 范围 | 当前状态 | 结论 |
| --- | --- | --- |
| Local backup | local-storage 私有 `DesktopLocalHost` 已完成 strict GDBK v1、allowlisted candidate/诚实恢复、严格 client/IPC 合同，以及仅在 `cfg(test)` 编译的 continuity/rebootstrap runtime/custody/database 协议。 | 私有状态机不等于原生实现；生产不保留 recovery shell，只保留 fixed-resource residue absence gate，且缺少 native picker、稳定 handle、真实 KEK custody、独立 non-rollbackable anchor、true create-only slot key、safe `SQLITE_FCNTL_HAS_MOVED`/custody VFS 与目标平台资格，备份、continuity、rebootstrap 均为 `unavailable`。 |
| Browser | 自动化宿主报告 `Unavailable`。 | 没有浏览器执行、页面桥接或 Desktop 组合。 |
| Desktop | Tauri 精确注册当前具名本地业务、备份、认证与 Cloudflare 命令；未授权时锁定。 | 不能增加路径、密钥、SQL、Provider 账号或 Cloud Repository 参数。 |
| Cloud | 公共账号/授权/billing route 与五类 Licensing provider 周期作业已经组合；共享开发环境部署了 self-hosted worker 和 Stripe test mode。 | Host 基础与开发部署不证明生产 worker、live provider 或客户发行。 |

## 已接受的受保护操作约束

任何本地受保护操作必须：

- 由拥有模块定义具体、最小且不可泛化的 Host API；
- 将秘密和支撑权威保持在 Host 私有状态中；
- 对调用方输入做严格验证，并在身份、作用域或资源不确定时拒绝；
- 不将备份操作扩展为通用密钥、存储、网络或浏览器控制面；
- GDBK 只支持同一安装/账号/工作区；`active` 与 `verified_local_continuation` 可导出/检查，恢复只允许 `active`，且 Provider/OAuth/session/authority/sync-control 数据全部排除；
- 最终备份恢复只在当前数据库创建新 mutation/field/tombstone/history/outbox，不使用旧数据库 pointer swap 或伪造 revision/cursor/epoch floor；
- 使用真实的原生环境、最终构件和独立审查作为资格证据。

## 未完成的外部前提

ADR-0015 已定义 SQLite 源身份为 Host-owned 的已打开连接，而非路径或可选 VFS；
[ADR-0023](../adr/0023-installation-bound-gdbk-backup-and-honest-business-restore.md) 固定 strict GDBK、
安装级 KEK、handle-based 两阶段 journal 与诚实业务恢复。生产 Backup KEK、独立 non-rollbackable
anchor、create-only rebootstrap slot custody、safe active-database move detection/原生 handle/crash 资格、
签名应用、持久归档、独立审查和 Gate closure 仍未完成。Portable 或本地测试不能
替代它们，能力在完成前保持不可用。
