# Atom 卖家库存审查

- Atom Marketplace OpenAPI 1.0.0 的库存与详情文档 SHA-256 分别为 `70126f473bbaa7be089b6f5f2db1626238ad4dd7845f0c95cebac429d529a508` 和 `0196f56d44573555b9613d269ae06075125c4b91b1275f61c8b609e6c9cd5256`。官方库存匿名实测返回 HTTP 200、`text/html` 和明确缺凭据的错误对象。账号实测仍待取证。 [库存官方文档](https://apidocs.atom.com/api-reference/seller_apis/domains)
- Native 独立审查核对固定 HTTPS、URL query 凭据隔离、专属 OS 槽、跨代次准入与电源/取消/Host 提交顺序，未发现阻断。
- 存储独立审查核对单 writer、读写租户隔离、续读与撤销。修正升级检查的迁移和表数量，追加 Listing 替换及旧身份回放的真实 SQLCipher 用例。
- Cloud 与 Desktop 独立审查核对授权投影、固定 IPC 和客户入口。商业权益由配置显式授予，写与通配能力仍拒绝。
- PostgreSQL 18.6 设备授权及执行证据 184 项、SQLCipher 三项专项、Linux GTK 与隔离 Secret Service 测试通过。Linux 生产前端和 Native 构建、Linux 与 Windows GNU 目标严格 Clippy 通过。
- 根 `pnpm check` 通过，含 Tauri 184 项、SQLCipher Host 647 项和 Secure Host Core 128 项。所有能力的共享 Grant 向量也通过 Rust 与 TypeScript 的 transcript 核对。
- 读取采用空页终止、最大 101 页和 10,000 条记录的本地上限。官方合同没有快照、服务端总数或完整状态字典，验证需核对账户列表和最后一页。观察仅保留有界派生业务字段，市场状态维持未知。
