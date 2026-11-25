# 终止首次安装后接收新交接

基线 `d285644`；完整任务仍见 [实施目标](../IMPLEMENTATION_GOAL.md)。本切片修复实际客户缺口：安装 journal 建立后取消/过期，即使未写库也被旧 requestId 永久挡住。不得用重标 Fresh、删除旧 journal 或既有库替换绕过。

## 客户结果与信任边界

本机上一次首次安装已由 Cloud 精确确认 cancelled/failed、且 Native 能证明业务库从未进入安装写入时，用户可以预览并一次确认新的交接。原终态与原请求证据保留；新确认绑定新 requestId，产生全新批准，不继承旧 nonce/能力/取消意图。未知结果仍先对账。已经写入或不能证明未写入的库保持受限，明确提示需要后续保留原库的恢复路径，仍可取消新的 Cloud 工作流。

local-storage 独占 journal、文件资格、历史与业务事务；Native 保持现有共享安装/终止锁与后台阶段；Renderer 仅使用严格脱敏状态和有界 start。Cloud 合同及数据库迁移在本切片不变，不能改已应用 SQL。

## 已核对事实与强制不变量

- 当前 initial-replica custody 为 Fresh/OrdinaryOpening/Installing/Installed/Initialized，只允许相同 scope/workflow。`start_target_installation` 有旧 journal 就拒绝新 requestId。
- `Installing`、没有 local receipt、文件零长度均不能证明未写入：SQL commit 后 journal 落盘前可能崩溃，截断也不能变 fresh。旧版本只有可信 pin 缺失且无 receipt/activation 时，才有尚未调用安装 SQL 的源码证明；其余缺失证据保持未知。
- 新 journal 必须在第一次打开初装数据库之前持久化 write-started 事实；新状态缺字段不得被默认成 false。失败/重开不能清除该事实。
- 再接收前要求原工作流确切终止（不能把 security epoch 变化产生的本地 Stopped 视图当作 Cloud 终态）、固定数据库身份及未写入证据、同租户/工作区/目标、当前新确认、无 pending activation/未知操作。当前角色、代次与最终提交栅栏保留。
- 新工作流落盘后才可发新 claim；新 journal 与保留的原终态需一次有崩溃恢复证据的 custody 发布。保留原终态不能依赖未被认证引用的孤儿文件。不新增第二 writer 或通用 workflow/archive 框架。
- 原 schema 的读取升级须明确版本、严格校验与保守缺项语义。不得静默丢弃原能力/回执或把历史 unknown 改写成未写入。

## 所有权与最小接口

- device_architecture_review：local-storage 的持久事实、原终态保留、精确新 workflow 准入及公开 Host 脱敏状态，Unix/Windows 同义实现与真实 SQLCipher/重开测试。先向 root/Native 冻结新增状态字段，再实施；历史记录结构由本 owner 给出最小具体设计。
- standby_native：复核 Native 协调器无需新路由或重复批准；配套新 Host 状态到 IPC 映射、严格解析测试与 Windows 全目标检查。只改其拥有文件；root 拥有 command handler/adapter。
- root：Task Frame、客户入口、command handler、TypeScript adapter/i18n/状态投影、当前文档、最终根检查与独立提交。
- standby_cloud：独立复审 Host 终态证据与历史保留、UI/adapter 新确认、Native 与测试，必要时复现有界用例；不改 Cloud 业务合同。

## 验收与声明

至少覆盖取消/过期后新 workflow 一次确认至完成、原终态仍可验证；新 start 丢 ACK 重开不重复批准；旧 nonce/旧 workflow 重放；不同租户/设备/代次、stale preview、并发 cancel/start；write-started 前后各崩溃窗口、SQL已提交但journal未确认、文件截断/替换、旧版本未知证据拒绝；已安装/初始化库绝不重标 Fresh或覆盖。状态轮询不能建立新批准，UI不能隐藏阻塞原因或提供必败接收按钮。

运行相关真实 SQLCipher/Host/Native、UI 与负向边界测试，独立复审；最终根 `pnpm check`、格式/链接/依赖检查。Windows/macOS 实机和断电资格另行取证，目标编译不是实机证据。本切片完成后继续强制接管与价值主线，不改变十二平台、双恢复和双系统总目标。

## 本轮冻结的持久与展示合同

- custody Head v2 在原头中保存最多 8 个终态 `StateFile` 认证引用，保留原 sealed 文件和原 AAD；新工作流通过 Reserved 的 retain-current 意图原子切换 current 与 history。普通同工作流进度仍退休并清理旧 current。部分写恢复不得推进新工作流，完整写恢复沿用同步/读回后发布顺序。历史丢失、篡改或身份混用失败关闭。达到记录数或真实头部序列化字节预算时返回 history_full，不删除历史；这是本轮有界 Native 存储限制，后续记录管理不能被永久排除。
- 原 Head v1 严格校验后升级为 v2；文件 AAD 版本仍为 1。Journal v2 新增必填 write_state 与必填 nullable terminal_evidence。write_state 为 not_started/started/legacy_unknown；旧 v1 仅在可证明未进入安装 SQL 的前缀映射 not_started，其余 unknown。第一次 SQL open 之前持久 started。
- `Stopped` 新增必填 `new_workflow`，IPC 为 `newWorkflow`，五态 allowed/requires_recovery/awaiting_terminal/authorization_changed/history_full。requestId仍标记旧工作流。completed 不能 allowed；新 start 的响应仍须精确绑定新 requestId，失败不能把旧 Stopped 伪装为成功。
- 缺精确旧终态时，复用既有 target bootstrap status 固定路由，后台优先按旧 requestId 对账；真实 pending cancel 优先。取得终态后继续发现新工作流。轮询与 allowed 本身均不构成新批准。
- UI 保持原生表单、显式标签及一次确认，状态区只播报有意义的资格/结果变化，不播报每次轮询的加载状态。Modern Web Guidance 的 accessibility 指南已检索并完整阅读；采用“Don't use live regions for interstitial states”规则。
