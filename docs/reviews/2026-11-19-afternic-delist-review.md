# Afternic 整批下架审查

基线 `35d409a`；范围见 [Task Frame](../phase0/AFTERNIC_DELIST_TASK_FRAME.md)，总目标见 [实施目标](../IMPLEMENTATION_GOAL.md)。本切片实现下架的生产源码旅程，不代表创建 Listing、改价、私有所有权验证、DNS 或真实平台资格已经完成。

## 实现与独立责任

- local-storage 迁移、业务状态机、Host、读投影：device_architecture_review 构建，root 独立静态审查与最终复验。
- Native/Core 电源通知、原 ProviderLane worker、严格 IPC 与生成物：standby_native 构建，standby_cloud 独立审查并运行实际源码/测试二进制。
- client-core、Tauri adapter、批量页与 i18n：standby_cloud 构建，root 独立审查并复验。
- root 整合最终 ADR-0006 的窄 unsafe 例外、精确策略、目标源码编译、文档、完整检查与独立提交。复用原数据库 writer、publication mutex 和 operation 模型，仅追加 `202611180004`。

## 发现及落实的经验

1. 确认动作必须绑定当前选中计划，而非任意仍合法的旧 DTO。切换历史/创建新预览时撤去旧批准入口，增加选中状态和失去响应后的只读恢复测试；摘要和详情都校验状态/计数组合。
2. 持久批准不能只验证 JSON hash：实体、连接、能力、动作、模式、风险、顺序、项数和原始完整扫描/观察也须精确匹配。已增加篡改列和伪造来源负测。
3. SQLite `GROUP BY status` 会优先匹配原表列。两个原始 unknown 尝试分别已解决/未解决时，按独立 projected_status 分组，使用真实数据库回归验证结果分桶。
4. 重复批准与空后台轮询不代表可见提交。仅在实际本地提交序号改变时推进 readGeneration；并发测试使用 Barrier 同时竞争批准和 claim，不以连续重复调用代替并发。
5. 保存完整合法 Retry-After，不能先接受 Core u32 再在 Host 任意截断到一天。普通指数退避仍封顶 900 秒，服务器提示可延长；172800 与 u32::MAX 持久化、严格时间和提前一秒不调度均受测。
6. 最后发送检查须覆盖可能阻塞的 Host 锁等待：power/cancel 在复核前后检查。系统关闭信号只唤醒一次，同 epoch 不能造成永久 ready 热循环。缺失/损坏 credential slot 转持久 remediation，暂时 custody 不可用仅退避。
7. 未知结果不能改成可重试写入。不可变原始尝试、追加只读对账事实与一次性 claim 分离；精确缺席观察、detach 和聚合结果同事务提交，普通 detach/新 incarnation 不能借旧结果伪装成功。
8. 共享 Cargo target 的编译与测试串行交接；独立目标编译使用单独目录。新增迁移同时检验专属负测和通用 manifest。失败/沙箱受限日志与最终通过日志分别保留。

9. 跨能力整合发现旧 drain 仍无条件声明空 execution_fact/device_audit，且只保护 Outbox 的屏障不能拦下架本地计划。补齐 progress/proof 独立拒绝已有尝试、预览/批准/claim/发送的屏障检查和数据库触发器；真实并发测试防止空证明与批准同时成功。真实两流同步未交付，临时拒绝不能冒充完整交接。

10. 独立策略探针发现 `deny(unsafe_code)` 可被未检查的 `warn` 降级，电源类型新增公开方法也未受精确清单约束。现拒绝非白名单 warn/allow/expect，并钉住同步/异步方法及安全快照字段；原攻击探针与新增 OS-handle/async 负测均已独立复验拒绝。

## 有界验证证据

- Native 独立复验实际最终 binary 的 helper 3、lane 11、IPC 1；Core 实际安全模块独立 harness 4 通过，unsafe 策略通过。两项竞态 finding 均闭合，报告 `/tmp/independent-cloud-delist-review.md`。构建者 Native 全部 94（包括另行提升权限运行的真实 loopback 1）、Core power 4、命令与证据 collector 9、Core/Tauri all-targets Clippy `-D warnings` 通过。
- root 以最终 power 文件原样复制到独立最小 crate，Windows `x86_64-pc-windows-gnu` 与 macOS `aarch64-apple-darwin` 离线 `cargo check` 均通过；哈希记录 `/tmp/gooddealer-power-target-source-sha256.txt`，日志 `/tmp/gooddealer-power-{x86_64-pc-windows-gnu,aarch64-apple-darwin}.log`。这只验证该模块的目标 API 编译，不是完整应用交叉构建。
- root 独立 Storage/Host/迁移 Afternic 全组 39、通用 manifest 3、既有 drain 回归 1 通过，日志 `/tmp/independent-root-delist-{storage,manifest,drain}-final.log`。包括真实并发、SQLCipher 重开、所有终结历史拒绝假空流与屏障。构建者 local-storage all-targets Clippy `-D warnings` 通过。
- root 独立 client-core 7、Desktop adapter/panel/真实写入口/权限 49 通过；全仓 typecheck 和 Desktop production build 通过。Native 独立评估者对 root 的 unsafe/精确公开面策略 13 项及攻击探针复验 PASS，目标源码哈希逐一匹配。
- 最终根 `pnpm check` exit 0，日志 `/tmp/gooddealer-delist-final-passing-check.log`：结构 207、Protocol 488、Cloud 798、Desktop 350、client-core 425、local-storage 485（6 项既有 ignored）、Desktop Native 94、Core 60。完整 SQLCipher 测试实际运行 441 秒。
- 首轮根检查因拓扑目录未登记四个 macOS 电源依赖失败；已精确补齐，独立拓扑 20/20 复验后完整重跑通过。`/tmp/gooddealer-delist-final-check.log` 是失败记录，不作为最终通过证据。Desktop production build、全仓 typecheck 和 `cargo fmt --all -- --check` 通过；最终三个 Native crate 的 all-targets Clippy `-D warnings` 通过（`/tmp/gooddealer-delist-final-clippy.log`）。

## 声明边界

Host 真实能力资格登记仍为空。没有真实 Afternic 账号与目标 macOS 设备，尚未取得受限录入/实际 DELETE/GET 客户验收；Windows custody、Linux/Windows capture 仍有实现缺口。电源通知的目标源码编译不证明 OS 注册或实机休眠行为。新 power guard 仅覆盖下架批准/worker，旧连接/刷新流程还需接入。完整双系统、实际 Cloud/OpenBao、跨机恢复与发行资格均未因本次源码测试取得。
