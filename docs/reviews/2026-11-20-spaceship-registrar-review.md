# Spaceship 注册域名归集审查

- 官方合同为 Spaceship Domain Management OpenAPI 1.0.0，证据摘要为 `82eae9bbaf69e1e124fd69fbca4b85e2c09e4bcdff33719c21ea9faa871a86a0`。Native 只读取该账户域名列表，最小权限为 `domains:read`。注册商观察仅保存规范域名、日期、自动续期、转移锁及可用状态。账户、联系人引用和原始响应在 Native 内终止。
- 独立存储审查发现迁移目录漏登记，以及空准备槽在重开后占用连接名额。已同步迁移及 schema 清单，区分确认不存在和托管不可读，使用原准备 admission 完成无槽清理。复审确认已持久化的待扫描标志、旧回执和最终提交栅栏相符。
- 独立 Native 审查发现 Spaceship 操作结果可能出现在 Cloudflare 投影。已以具名 Cloudflare 操作类型过滤，覆盖跨平台结果。复审发现准备槽转撤销后如果清理失败，恢复可能过早报告就绪。恢复结束前重新读取持久状态，保留未清理撤销的恢复门禁。
- 实测 Linux GTK 捕获与隔离 D-Bus Secret Service 槽使用合成数据。SQLCipher 专项覆盖重开、重复扫描、错连接、撤销和最终事务回滚。PostgreSQL 18.6 设备授权及执行证据 184 项通过，包含签发全部五种显式读取或写入权益的用例。
- 根 `pnpm check` 完整通过。Linux Desktop 前端和 Native 构件通过构建，Core、Storage 与 Tauri 严格 Clippy 通过。相同三个 crate 的 Windows GNU 目标全目标严格 Clippy 通过。
- 真实账户验证待具名开发验收，需原生录入 Spaceship `domains:read` 凭据并核对一项已知注册域名和完整账户数量。Windows/macOS 源码接入同一业务流程，与目标系统实机资格分别取证。
