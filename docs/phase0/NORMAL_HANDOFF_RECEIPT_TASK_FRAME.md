# 普通交接回执与 Standby 只读同步续作

基线 `1218e18`。目标：普通交接成功的来源设备在重启或响应丢失后先查状态，只有持久成功证据匹配才继续 Inbox；强制接管或未排空旧库保留且冻结。

- 基线事实（`1218e18`）：barrier 只能证明停写；当前 status wire 没有被消费 proof 与来源 Lease，不能证明成功。所有 Standby Inbox 暂冻结。
- 合同：既有 switch view 增加严格 nullable `normalHandoffReceipt`，字段 `sourceLeaseEpoch`、`proofId`、`proofDigest`、`releasedAt`；request/source/target 取外层严格 view，workspace/account 来自可信 scope。forced 永不带 receipt；normal 必须由唯一一致的 consumed handoff proof、normal workflow 与同 source/epoch/reason=normal_handoff 的 released Lease 连接生成，不能只看 status。bootstrap 之后失败/完成仍可查已释放结果。
- 所有权：Cloud devices 只读历史事实并执行账户/工作区隔离；Native 固定 HTTPS/会话栅栏；local-storage 唯一 writer 保存发出前的 proof 身份与对账成功事实。复用原 publication mutex/提交 guard，不新增签名系统、路由、数据库 writer 或通用工作流。
- Host：持久 proofId/digest/request/source/target/epoch 先于 HTTP；成功 receipt 与 attempt/barrier 精确匹配。记录 Native 最近本机 Active epoch（不能以混入 Standby global floor 的 maximum 替代），阻止旧普通交接证据解冻后来被强制接管的旧库。现有 floor 升级缺少 lastActive 时保持未知并冻结，不推断历史执行权。
- 同步：专用 Standby Inbox gate 仅开放 pull/page application/必要 reader 状态；当前角色、期限、generation、现存同 workspace 库和成功证据全匹配。Outbox/Provider/普通业务写仍关闭；页/cursor/readGeneration 沿用既有原子事务与最终提交 guard。未知先 status 对账；只有当前 Active、精确请求/目标且明确未消费时恢复 Native 保存的同一 signed body，不生成新 proof。Native 先落盘再业务 attempt，再 HTTP；无业务 attempt 的孤儿可清理，确定拒绝追加不可变 refusal。
- 文件所有权：`standby_cloud` 仅拥有 apps/cloud 与 packages/protocol/src/devices 的 switch view 合同/对应 devices tests；root 拥有 protocol public exports（如需要）、local-storage 迁移及 Host/Native 组合，Afternic 切片不改 devices 协议；共享迁移由 root 统一安排。Cloud 构建者不得提交，先交独立评估。
- 验收：错 proof/source/target/epoch、forced 假 normal、跨租户、旧 epoch 证据、新 Active 后强制接管、Cloud 成功但本地未记、证据落盘后崩溃、页提交前撤权/刷新、重复页/坏 token/retired cursor。真实 PostgreSQL、SQLCipher、Native 客户路径及根 check；独立审查后按完整切片提交。
- 资格：本地测试不构成双设备 Windows/macOS 或生产 Cloud 资格；目标 bootstrap/强制接管整体功能仍需后续组合，不通过开放按钮假称完成。

- 独立评估：device_architecture_review 评估 Cloud/protocol；standby_cloud 评估 Host/DB/custody 与 Native 协调器；standby_native 补查协调器崩溃窗口。构建者不接受自己的变更，root 汇总并执行最终检查。
