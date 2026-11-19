# 执行证据与来源交接审查

基线 `b0ba6fc`，完整范围见 [Task Frame](../phase0/EXECUTION_EVIDENCE_TASK_FRAME.md)，不可缩减的总任务见 [实施目标](../IMPLEMENTATION_GOAL.md)。本切片连接真实本地批准/执行来源、Cloud 精确回执、三流 drain 与来源设置入口；不代表目标安装/激活、全部 Listing 能力或真实 Provider/双系统资格完成。

## 所有权与独立审查

- Cloud/协议：standby_cloud 实施；root 独立检查签发公钥快照、历史时间和撤销、批准/claim/audit 配对、单 ledger 与最终凭据事务，并在独立 UTF8 PostgreSQL 测试库复验。
- local-storage：device_architecture_review 实施；root 独立复验真实 SQLCipher 批准/claim/结果/冻结、交接持久请求、未知响应与同/跨 epoch 恢复。保持原 writer、publication mutex 和最终提交栅栏。
- Native 网络、背景推进、严格 IPC、Renderer 设置与整合策略：root 实施；device_architecture_review 独立复验 Native 106/106、UI/adapter 28/28；standby_cloud 独立审查固定公共路由及 production composition。
- Windows custody/输入与 OS 连续时钟：standby_native 实施；Windows 子片独立检查和目标编译证据单独记录，不能由 Linux 源码测试推导实际 OS 可用。

## 已关闭的发现与经验

1. 原 Grant issuedAt 可能沿用 Lease 时间，不能拿收到旧 Grant 的新 Instant 伪造新时间锚。独立签名上下文绑定 Native nonce、当前 Grant 摘要与原 t0/t1；同 boot 重开保留 t0，boot 变化先刷新。历史 verifier 使用签发时不可变的三用途公钥，不依赖当前 keyring。
2. 执行事实只表述本地持久认领；真实整批批准和每项批准必须在原事务同时形成。不能把队列、HTTP 发出或远端成功混为一谈，也不能给旧未签名历史补造来源。
3. 异步晚到结果不能写回已经冻结的旧 epoch producer。冻结、未决数量与停止新准入在同一事务完成；取消递增代次，使旧 GET 失效，新 GET 才能继续对账。
4. 重传必须保留原事件字节和精确回执身份。因果前项缺失不占位；reconciled audit 等原 fact 到达后再重试。合法签名语义隔离可阻止首次 seal，伪造签名不能污染猜测的 domain，拒绝新事件也不能撤销已接受 seal。
5. 初始交接请求也有“Cloud 已创建、本地未收到”的崩溃窗口。原幂等键/目标/epoch/字节先持久化，resolve-before-POST；新建请求带来源 epoch CAS，更高 epoch 消解旧意图但不能自动新建。回答与 barrier/freeze 原子提交。
6. 数据库 CAS 触发器必须区分普通交接与首次设备引导。九套真实 PostgreSQL 回归发现初版 019 误拒 first_device；保持已应用 019 不变，追加 020 限定 purpose，并验证 first_device null 成功、普通 switch null 拒绝、其他 purpose 非 null 拒绝。
7. 防止旧请求改动状态时，必须把“锁定工作流”与“终结过期工作流”分开：沿用 workflow→Lease 锁序，但验证来源 Lease 前不得改变工作流。
8. proof 的签名密钥版本须来自当前已验签 context，并匹配 Native key id，不能把现有 keyVersion=1 的环境当作通用真值。新版测试使用真实 context 的 version 4，错误 key 和无上下文拒绝。
9. 独立 UI 审查发现同名/未命名目标不可辨识；按钮与确认预览现在都带设备编号尾号。状态轮询不驱动 Native，也不播报每次加载，未知请求不能伪装成空闲或重发新目标。
10. 证据积压可每 10ms 唤醒原同步 lane，交接网络失败须有独立退避，不能随每个批次立即重试。独立测试覆盖 evidence 持续成功时 handoff 失败期限保持不变。
11. 真实数据库竞争测试须重新签署不同 epoch 的全部相关事件，并实际控制两个 production INSERT 同时到达唯一栅栏；只改 fixture epoch 或顺序重复调用不能证明并发防重放。UTF8 测试库显式由 template0 创建，默认 SQL_ASCII 的 Unicode 故障不能误判为产品实现失败。
12. Windows 目录/文件不能先创建再修改 ACL：中途崩溃会留下拒绝后无法重开的工件。现在以精确安全描述符原子创建，保持无 share-delete 的身份 pin；SQLCipher sidecar 只接受私有目录继承的精确本用户 ACL，不预先锁住其正常删除。首次数据库初始化位只在成功打开后持久化，已建立数据库缺失/截断不能变成空库。
13. Cargo 主 target 单线交接；稳定测试副本使用独立 TMPDIR。跨平台 C 编译也必须设置工作区 TMPDIR，避免 SQLCipher 汇编临时文件耗尽 `/tmp`；环境失败只作诊断，不计资格。

## 已取得的有界证据

- Cloud 构建者：Protocol 501/501、Cloud 828/828；真实 PostgreSQL 18.6 UTF8 九套 159/159。该库先应用 61 项迁移发现 bootstrap 回归，追加 020 后升级到 62 项并通过，不声称之前失败的运行通过。
- root 独立 PostgreSQL：执行证据、当前/历史授权、公钥快照、安全 epoch、真实跨 epoch 并发重放、初始请求恢复 16/16；锁序修正后请求 4/4；020 用途修正后首次引导 9/9。过滤跳过项不计通过。
- root 独立 Storage 稳定源码副本：执行上下文 7/7、初始请求事务/关闭重开 2/2、Afternic 批准/事实/对账/冻结/回执 34/34、最终真实 keyVersion 与完整 device-switch 7/7。OS custody 使用测试 store 的用例不证明真实 OS。
- Native/UI 独立审查：106/106 与 28/28；生产构建图和真实目录→交接组合测试另由 root 验证 6/6。来源后台与 UI 两项发现均关闭。
- Windows：独立 owner 审查及 29 项源码测试通过；真实 Core、含 SQLCipher/OpenSSL 的 Storage、Tauri 均在 `x86_64-pc-windows-gnu` 目标以 `--all-targets`、`-D warnings` 通过 Clippy（日志 `target/windows-{core,storage,tauri}-clippy.log`）。使用实际依赖，不是 API stand-in；仍不证明 Windows 实机行为。恢复 reservation 尚未实现。
- 平台无关根检查 exit 0：结构 213、Protocol 501、Cloud 828、Desktop 357、client-core 425；三个 Native crate 的 all-targets strict Clippy exit 0。执行证据/Windows 合并基线完整根 `pnpm check` exit 0：Storage 521/6 项既有忽略、Native 106、Core 82；随后接续目标终结和 context 分阶段发布，最终完整根检查也已 exit 0；最新计数与独立证据见 [目标终结审查](2026-11-19-bootstrap-termination-review.md)。

## 声明边界

真实 OpenBao Standby/context 用途部署、实际 Afternic 账号、目标引导/激活、强制接管、云恢复、独立可携带备份及 Windows/macOS 实机仍分别需要验证或实现。Host 资格登记保持实际证据准入，不用 fake、空 manifest 或开放开关代替真实功能资格。旧未签名历史仍拒绝伪空流，升级客户路径继续实施。
