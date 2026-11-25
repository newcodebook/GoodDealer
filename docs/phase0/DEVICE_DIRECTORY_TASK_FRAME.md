# 设备目录与本机命名切片

基线 `b5bcee2`；现有未提交 Standby Grant 协议增量由原工作线拥有，本切片不修改或提交它。

- **目标**：已登录 Desktop 从设置读取本账户真实设备，为本机命名，保存后及重新打开页面读取持久结果。
- **边界**：Cloud devices 拥有目录和事务；Native 固定目的 HTTP、严格解析及脱敏；Renderer 只提交本机名称。
  复用迁移 `202611180001`，没有新的数据库 writer、角色字段或本地目录副本。
- **合同**：Cloud device-management v1 保持严格字段；新增脱敏 IPC 仅含设备展示信息。平台由 Native 构建目标派生；
  账户和设备由会话派生；未知字段、无效名称、重复设备、撤销及过期会话失败关闭。
- **基线现状与依赖**：Cloud list/self 已实现；Host 固定路由、IPC 和客户组合缺失。当前 Native 仍需 Active 授权。
  Standby v4/签名/持久地板另行实施；目录角色不授予执行或交接权。引导和 pending epoch 终结完成前不开放交接。
- **所有者**：主代理实现并串行整合公开导出、Native 注册、IPC、UI、文案及文档；
  `device_architecture_review` 为独立架构评估及实现评估者，不修改实现。
- **验收**：协议/Native 严格解析及响应身份栅栏；Cloud PostgreSQL 跨租户、密钥撤销、并发与持久化；
  Renderer 保存/刷新/失败/过时响应测试；根 `pnpm check`、差异及术语扫描。
- **声明限制**：测试支持本地源码旅程；Linux 不证明 Windows/macOS 最终构件、真实 Cloud 部署或发行资格。
  不将本切片称为 Standby、设备交接或云恢复完成。

验收结果：独立评估 PASS；最终根 `pnpm check`、Desktop production build、Native clippy、格式与差异检查通过。
PostgreSQL 18.6 UTF8 12 项、协议 62 项及 Native/IPC/DOM 回归通过；证据范围按上述声明限制执行。
