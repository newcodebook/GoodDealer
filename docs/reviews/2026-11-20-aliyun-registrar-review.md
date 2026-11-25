# 阿里云注册域名归集审查

- Native 使用中国站固定 HTTPS endpoint、`QueryDomainList` 及 ACS3。官方文章 `QueryDomainList` 与 `V3 request structure and signature` 的取证 SHA-256 分别为 `2b479fe9d124cb5244958626b1cdfa912b196c455bb0325a9a62782e1fe93e62` 和 `310b2343a7287fd6d0d068abe74db8998c43f64a5cfc885d90bee2ca046ebf8b`。官方 `@alicloud/domain20180129` 5.1.1 归档通过 registry 完整性校验，SHA-256 为 `20c6aa003ae8f985591d9cb9244715b9c082fdf498ae0a0440ae7fc47547da14`。
- 独立 Native 审查核对官方请求、TLS、签名、分页、固定托管、ProviderLane、电源与最终栅栏、IPC 以及与 Spaceship 的隔离。独立存储审查核对追加迁移、单 writer 事务、撤销及恢复，确认未知自动续费与转移锁不落成 false。首次审查无阻断。
- ACS3 哈希和完整签名与官方公开示例一致。官方端点在不传凭据时返回 HTTP 400 `MissingTimestamp`。原生托管使用单独 Service，Linux GTK 与隔离 Secret Service 合成测试通过。新 PostgreSQL 权益投影和设备/执行证据矩阵共 184 项通过。
- 根 `pnpm check` 通过，含 Tauri 183 项及 SQLCipher Host 644 项。Linux 生产前端和 Native 构建、Linux 与 Windows GNU 目标严格 Clippy 通过。
- 真正的账户验收需要具名开发准入、仅具备所需 RAM 只读权限的中国站 AccessKey 和账户内可核对域名。原生窗口输入，核对完整计数与资产后重开重复检查。国际站、卖家私有接口、macOS/Windows 实机与发行验证继续分别跟踪。
