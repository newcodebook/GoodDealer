# 终止安装后接收新交接审查

范围见 [Task Frame](../phase0/TARGET_INSTALLATION_RETRY_TASK_FRAME.md)。在 `d285644` 首次安装旅程上，增加精确取消/失败且可证明未写库后的新确认接收；已有副本保留恢复仍为后续工作。源码证据不能替代 Windows/macOS 实机、真实双设备或部署资格。

## 所有权与独立复审

Storage/custody 由 device_architecture_review 实施，standby_cloud 独立审查并直接运行最终测试二进制，root 复核终态与 SQL 交界。Native 协调器由 standby_native 实施并取得双目标严格检查，standby_cloud 独立检查无自动批准及共享取消锁。root 拥有 IPC、adapter、客户入口和当前文档；standby_cloud 独立运行 UI/adapter 41 项。最终根检查由 root 收敛。

## 发现与修正

1. 没有本地回执或数据库文件为零长度，都不能证明安装未写入。journal v2 在首次 SQL open（包含 migrations）前持久化 started；v1 只有无 pin、无 receipt、无 activation 的源码可证明前缀映射 not_started，其余 legacy_unknown。不得从 Installing 重标 Fresh。
2. started 发布与实际 SQL 阶段之间可能完成取消。Native 串行锁不能充当 Host 安全边界；两段均重验 Running、原工作流终态与取消。实际阶段要求 Started 且无 terminal_evidence，取消收敛清除 pending 后仍拒绝写库。
3. receipt 终态曾清除 pending，仅存响应里的 operation selector/digest，导致原 nonce 请求字节丢失。现在保留完整原 pending，Stopped 永不发送它；新流程使用全新批准。回归验证原能力和请求字节进入原始加密历史。
4. 本地安全代次变化产生的 Stopped 不能充当 Cloud 终态。缺证据时复用固定 status 路由对账原 requestId；新 Available 不得抹掉 last_finished，真实取消意图先处理。跨租户、设备、代次与旧 preview 均拒绝。
5. 原 journal 文件及 AAD 保持原字节，Head v2 原子发布 current 与 terminal_history。Reserved 的完整、部分、缺失写入分别恢复；历史文件逐一核验 identity/digest/AEAD，重复名称、身份、revision、跨 scope、缺失/损坏失败关闭。最多 8 条，容量满明确拒绝，不自动删历史。Head v1 升级不改变文件 AAD v1。
6. terminal_evidence 的重开读取投影此前已校验的 Native 记录，不是新外部授权入口。独立追踪确认 v1 拒绝额外证据字段；Control 输入严格解析并经 authority/revision/scope 校验；receipt 写前匹配原 exchange、原 body、workflow 与 operation；历史受同一安装、账号、工作区、设备的 AEAD custody 约束。未发现公开或 legacy 输入可伪造终态的写入路径。
7. 新工作流出现时保留旧停止原因，五类 newWorkflow 必填且闭集。completed+allowed 拒绝；新 start 的返回仍要求新 requestId。轮询 allowed 不开始，不跨工作流继承确认；资格变化撤回预览，开始丢 ACK 只读状态。Native 只为 Running 唤醒安装。

## 验证与限制

- 独立 UI/adapter 41/41，日志 `target/cloud-independent-target-retry-ui.log`；Desktop typecheck、i18n 19/19 和品牌策略通过。
- Storage 独立首轮安装 16、custody 11、target control 14，共 41/41；日志 `target/cloud-independent-retry-storage-{installation,custody,control}.log`。覆盖实际 SQLCipher 写入、关闭重开、原请求历史、legacy unknown、原终态后新 Available、SQL commit 未 ACK、截断与历史上限；最终冻结 binary 的并发、跨租户、最大预算另各 1/1 通过，合计独立唯一 44 项。日志 `target/cloud-independent-retry-storage-{concurrent,scope,budget}-final.log`；最坏 head 21,101 字节，低于 65,536 字节上限。
- 构建者 Storage 47 targeted/public 2/doc 28 通过；Native 147/Core 84/public 3/doc 4 通过；Linux/Windows 三包全目标严格 Clippy 通过。独立 Native 安装及 IPC 16、终止 10，共 26 项通过；IPC 单独重跑 2 项不重复计数，日志 `target/cloud-independent-retry-native-{installation,termination,ipc}-final.log`。
- 最终根 `pnpm check` 通过：TypeScript 2378、结构策略 214、Rust 861（Storage 572，6 项规模基准 ignored），日志 `target/root-target-installation-retry-check.log`。首轮公共导出清单漏列新枚举，被结构策略拒绝；精确补入后独立复核并完整重跑。全仓 fmt、依赖/拓扑、生成 desktop/macOS schema 一致性、本地文档链接和 diff 检查通过。
- 此切片未修改 Cloud 合同或迁移，未重跑不受影响的 PostgreSQL 全套。此前真实 PG 证据仍属于其首次安装提交，不当作本轮新证据。
- Windows/macOS 实机 custody、目录同步断电、真实双设备与 OpenBao 第五用途部署尚未验证。可能已写库的终止恢复仍不可重新接收，后续须实现保留原库的恢复，不能扩大当前 allowed 判定。

## 后续执行教训

按客户路径追踪停止、重开与下一次使用，才能发现成功路径测试遗漏的永久阻塞；每条安全拒绝都应说明后续可行路径。网络未知结果保存原请求和精确回执，文件发布保存每个崩溃前缀的认证事实。跨两段的动作须各自重验，不借上层串行性推断底层始终安全。上述经验继续用于强制接管、市场未知结果和独立备份恢复；不以本切片完成替代总任务。
