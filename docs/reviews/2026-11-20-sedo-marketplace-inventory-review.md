# Sedo 卖家库存独立审查

Native 使用官方 Basic XML POST 读取账号列表。Settings 只提交连接、刷新和撤销意图，令牌与账户身份留在 Native。local-storage 绑定工作区、连接 incarnation、设备与 Lease，提交完整扫描、资产、Outbox、挂牌观察和回执。

- Native 与 SQLCipher 独立审查核对了固定端点、四字段、凭据槽及撤销边界。既有二进制独立复跑的 Sedo Native 5 项、SQLCipher 1 项通过。
- 设置与 IPC 独立审查发现能力目录测试遗漏 Sedo。修复后两份能力合同测试 38 项、设置面板 7 项通过。新回归覆盖受限连接意图、拒绝额外账号字段、已保存扫描重开，以及权限撤销后只能本地断开。
- Linux 向官方端点发送匿名只读 POST，返回 HTTP 200、`text/xml;charset=UTF-8` 和 `SEDOFAULT` E1。错误保留为认证失败。真实认证分页与终页语义、Windows/macOS 实机和发行资格仍需分别取证。
- 整合到 Atom 下架之后，补齐活动库 fail-closed schema manifest 和签名向量计数。合并后的 SQLCipher/Host/迁移专项 4 项、Native 5 项、严格 IPC 1 项、协议 40 项、设置面板 7 项及授权签发 20 项通过。隔离 PostgreSQL 18.4 从 77 条既有迁移前缀升级至当前 Cloud 目录，186 项通过，涵盖显式 Sedo 只读权益。Linux 隔离 GTK 验证了两个 Sedo 原生窗口提交、取消、授权撤回及晚派发。
- 在实际 Atom 与 Sedo 整合工作树独立复验，Protocol 40 项、Cloud 签发 20 项、Desktop 设置及权限 13 项和三项策略检查通过。独立检查确认 56 项迁移、96 张表及现有 SQL 文件完整，最终提交栅栏和同一 writer 保持一致。严格 Clippy 修订保留外部 XML 字段名、命令许可和执行分支，修订后本机严格 Clippy 和受影响专项再次通过。
