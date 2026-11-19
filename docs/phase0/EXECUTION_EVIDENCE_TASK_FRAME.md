# Provider 执行事实、设备审计与真实交接

基线 `b0ba6fc`。完整任务和不可缩减条件见 [实施目标](../IMPLEMENTATION_GOAL.md)。下架已具有持久执行与未知对账，但两条真实执行审计流没有来源和上传，不能释放有执行历史设备的 Lease。本工作包直接补齐该客户旅程，不以空证明、schema 或开放资格清单替代。

## 客户结果和完成条件

用户整批批准后，本机在一次性下架执行及未知对账的业务事务中保存真实签名事实；后台自动上传脱敏证据，丢失回执仅重传同一不可变事件。发起普通交接时停止新执行，明确保留未决项，只有真实三流全部获 Cloud 精确确认并封链后才释放 Lease。失败/取消不丢本地事实。跨机不转移平台身份、凭据、绑定或可执行队列。

保留 execution_fact v1、device_audit v1 及最终 ADR 的全部时间、设备、批准、用途和租户约束。缺少真实来源是实施工作，不得填常量或删校验。

## 已核对的缺口和依赖

- v1 合同和 Cloud ledger/seal 表已存在；生产 ingest/verifier/receipt、Native uploader 和本地持久来源缺失，不能另建平行 ledger。
- Provider credential_generation 不是 device credentialEpoch；后者来自当前 Cloud 设备绑定。旧 Grant issuedAt 可沿用旧 Lease 时间，不能用本次接收 Instant 当作新鲜时间锚。
- 首先接入新鲜签名执行上下文：固定 Active-only 端点由服务器派生当前授权、签发当前 Active Grant 和与其摘要/Native nonce 绑定的独立用途时间证明；不信任客户端自报授权摘要。精确 wire 在实现前冻结。
- Native 须使用真实、含休眠时间的连续时钟和同 boot 身份，支持退出重开；跨 boot 或连续性不明不得伪造锚。Windows/macOS API、custody 和原生资格分别取证，不能以一个平台 unavailable 结束实现。
- 签名批准 envelope 来自真实冻结计划和本次用户批准；签名失败或最终栅栏变化不能发起 Provider 写入。保留一次性 claim 和未知先对账。

## 事实语义与封链

- 原执行事实准确表示持久认领/所观测阶段；claim 不声称请求一定发出或远端成功。不得回填一个晚到 GET 的时间，使其伪装成旧 Lease 窗口内执行。
- 晚到对账在当前授权下形成新的观察审计，关联原不可变执行证据；它不能重开旧 epoch producer 或触发 Cloud 业务写入。
- drain 关闭批准和新 dispatch，等待本机在途 producer 到安全边界；未决远端结果保留为 unknown 并停止该旧 epoch producer，不伪造成功。界面显示未决数量和本机保留含义；取消仅按现有屏障规则恢复，成功交接后不得继续旧 epoch 追加。
- 封链后精确重复已接受事件可取得原回执，新 sequence/改写内容必须拒绝；本地只有匹配 event/domain/sequence/digest 的持久回执才算确认。
- 对账审计若先于原事实到达，Cloud 返回 `ORIGINAL_FACT_MISSING`，不占 sequence 或生成回执；Native 先上传原 claim fact，再重试完全相同的审计字节。Cloud ingest 和 seal 使用同一设备/epoch 域锁与事务规则。

## 所有权、共享面和审查

- Cloud devices/identity 拥有身份、Lease、credentialEpoch 与签名执行上下文；execution-ledger/audit 各自拥有事实接收、裁决、回执和原有表，复用所属事务端口。
- local-storage 是批准、事实来源、队列/确认、三流折叠和最终提交的唯一 writer；持久化与业务跃迁原子提交。签名/时间锚 custody 与 Provider 秘密留在 Native。
- secure-host-core 拥有用途明确的 verifier、设备签名和真实 OS 时钟安全面；Tauri 只组合固定网络与原 lane，不提供通用 signer、Provider 代理或第二工作流引擎。
- Renderer 继续传有界批准/交接意图，只读脱敏进度；不接收 Grant、上下文原文、私钥、Provider 身份或秘密。
- root 冻结合同、整合 ADR/公开面/入口/文档和最终验证；standby_cloud 调查并负责 Cloud/协议面，standby_native 调查 Native/OS 面，device_architecture_review 接续 Storage 面。具体文件与实现阶段在合同冻结时派发，构建者不能接受自己的结果。

## 验收与允许声明

覆盖错用途、nonce/授权摘要错配、跨租户/设备/epoch、设备撤销和凭据轮换、延迟响应/时间回退/休眠/应用重开/boot 变化；批准 CAS、签名失败、发送前后崩溃、未知 ACK、导入历史隔离；真实 PostgreSQL ingest/seal 并发与精确重放；SQLCipher 关闭重开与最终栅栏。完成严格合同、真实拥有模块/组合/客户入口后，运行根 `pnpm check`、独立审查和完整切片提交。

源码测试与模块目标编译分别陈述；没有真实设备、签名用途部署、真实 Provider 账号和发行证据时不宣称相关资格。当前临时 drain 拒绝只有在上述真实两流完整接入后才移除。其余市场、目标设备引导、强制接管、两条恢复旅程与 Windows custody 的总目标不因本工作包改变。

## 验证执行纪律

同一 Cargo target 的编译与测试全过程由单一工作线持有，测试子进程仍在运行时不得释放给另一构建者。
需要并行复验时使用固定复制的已编译测试二进制和独立 TMPDIR，并记录其源码快照；长时 SQLCipher 测试、
独立构建和大型产物使用工作区内的忽略目录，先检查空间，避免耗尽 `/tmp` 导致沙箱和数据库创建失败。
失败必须依据具体堆栈归因，修复环境后重新取得通过证据。PostgreSQL 复验前核对实际服务进程和专用测试库，
连接失败或 skipped 不是数据库验证通过。Node 独立策略检查使用 `--test-isolation=none` 记录实际测试数，
不以默认隔离模式的一项文件通过冒充其内部断言已逐项取证。


## 初始交接请求的恢复合同

来源初始 request 独立升 v2，包含 Native 从当前准入派生的 expectedSourceLeaseEpoch；先持久化原幂等键和字节，再发送。Cloud 在当前锁定来源 Lease 下创建，精确旧键只返回原历史。独立 resolve 路由固定读取本会话设备的原请求，2 KiB 请求/8 KiB 响应，mandatory nullable sourceLeaseEpoch 保留旧行未知事实。同 epoch not-found 才允许原字节重发；更高 epoch 消解旧意图但不自动新建，旧 epoch 非终态不能建立新屏障。回答落盘与屏障/冻结在 local-storage 同一最终栅栏事务中提交。请求协议变化不改变 role v5、Grant v4、Lease v1、device_audit v1 或 execution_fact v1。

签名 proof 的密钥版本来自当前已验证执行上下文并匹配 Native signing key id，不允许固定为 1 或使用 Provider 凭据代次。没有上下文时刷新后再推进，不能制造空证据授权。
