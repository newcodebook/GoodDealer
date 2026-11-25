# Afternic 官方所有权复核独立审查

审查范围包括 v2 批次预览及批准、官方 `OWNERSHIP_REVIEW` 复核、Native 固定用途签名、唯一业务 writer 内的持久 claim 与对账，以及 Cloud 两条证据流。现有 v1 上架、改价、下架和旧签名合同保留。依赖与发布边界记录在 [所有权复核工作包](../phase0/AFTERNIC_OWNERSHIP_REVIEW_TASK_FRAME.md)。

## 发现与修复

- Native 独立审查发现旧版本优先调度会让 v2 正常执行和已 claim 的对账饥饿。同一 ProviderLane 现在交替选取两个版本，优先版本无工作时尝试另一版本。原取消、电源、停机和最终提交栅栏继续生效。
- Cloud 独立审查发现无需发送的已签终态会阻塞旧交接判定。现在唯一尝试的终态允许以精确 `preflight_satisfied` 或 `preflight_refused` 审计排空，未接受回执继续阻止封链。父项失败关闭等待子项。无可信前任关闭证据时拒绝新机 claim，已有 claim 仍只读对账。
- Cloud 的拥有模块与 SQL 最终栅栏按租户、工作区、操作及项排斥同一项的无发送与已发送证据。并发和换设备不改变这一判定。批准、配对审计、凭据与 Lease 检查仍绑定各自签发设备。
- 现有受控开发凭据槽不能批准或执行所有权复核。历史槽记录只约束其精确连接、incarnation 和凭据代次。正式复核使用当前目标系统的独立资格及原有 observe/write 商业权威。

## 验证范围

- 真实本地 PostgreSQL 18.6 完成迁移 73→75，前 73 条校验值不变。完整 Desktop OAuth 与执行证据回归 184/184，包括 22 项新增的实际角色、错用途、顺序、并发及跨设备场景。Protocol 588/588，Cloud 848/848。
- SQLCipher 所有权专项 25/25，既有 Afternic 回归 87/87，local-storage 严格 Clippy 通过。覆盖初始来源、当前绑定与最新完整库存、签名与提交回滚、父项失败、终态交接回执、旧版本隔离及重开后 GET。实际 Host 输出的 2 个计划与 5 个状态均通过 Client 严格解析。桌面覆盖混合批次一次批准、独立复核、过期或不可执行，以及恶意 IPC 回复。
- 根 `pnpm check` 退出 0。Desktop 423、Native 179、local-storage 637、Core 101、结构 215 项通过。另有本地平台资格与手动场景保留为独立测试。
- 公共 Afternic Web 构件确认私有认证流程的当前请求路径，匿名验证记录读取返回 401。真实账号库存、`wecin.com` Listing 变更、真实 `OWNERSHIP_REVIEW` 挂牌复核、双系统实机和发行资格分别待验证。Cloud 032/033 仅在本地 PostgreSQL 上运行。
