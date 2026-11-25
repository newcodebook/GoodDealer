# 目标引导终结与安全发布审查

范围见 [Task Frame](../phase0/BOOTSTRAP_TERMINATION_TASK_FRAME.md)。接续 [执行证据切片](2026-11-19-execution-evidence-review.md)，补齐 ADR-0032 切换入口前必须提供的引导终结；目标实际安装/激活、强制接管、云恢复和独立备份仍在完整任务内。

## 所有权与独立审查

Cloud/protocol 由 standby_cloud 实施，root 在独立 UTF8 PostgreSQL 18.6 数据库重跑；Host/custody 由 device_architecture_review 实施，root 检查持久事实和提交栅栏；Native 固定网络/终止协调器由 standby_native 实施，standby_cloud 独立检查；客户 UI、IPC、后台调度与共享组合由 root 实施，standby_cloud 独立评估。构建者不接受自己的结果。

## 已修复发现和经验

1. 来源设备释放 Lease 后的取消不是恢复原执行权限。保留来源 Active-only 取消规则，新增精确目标专用 status/cancel；目标未领取能力和未安装业务库也能停止。源 UI 在 bootstrapping 时撤去取消按钮，目标结果明确不自动成为 Active。
2. 本地确认不是“取消当前任意工作流”。安装/账户/工作区/设备/精确 id/原字节先持久化，重开与丢 ACK 先查原 id。新工作流需要新确认；旧 security epoch 的意图退休并返回该原工作流的重新确认，不能永久 pending 或自动重发。
3. 建立标记需区分合法首次创建前缀与已建立后丢失。record 已写、marker 未建时严格验证原绑定/字节后补齐；marker 已建立而 record 丢失或损坏时拒绝，不能重新当成首次安装。
4. 真实 OAuth 组合暴露 mutation drain 与登录 Lease allocation 的不匹配。旧 guard 强制 allocation.workspace_id 等于工作区，但 desktop_login 分配为 null；追加迁移 021 仅接受已激活 desktop_login 的精确账户个人默认绑定。旧 SQL 不改写，错误绑定和其他用途继续拒绝，测试不伪造 allocation 来掩盖问题。
5. 身份 reader 先取账户共享锁再升级 writer 会产生双取消死锁；目标控制在 session reader 前先取账户 writer。目标取消与 activation/step/expiry 共用账户/工作流锁序，在一事务烧 pending epoch、消费 capability/nonce、清除 authority 下一步、释放 pin；highest、来源 Lease release、三流 seal 和 normal receipt 保留。最终会话拒绝抛出事务外，回滚全部终结效果。
6. target discovery 空闲也会发 HTTP，不能沿用来源 Idle 的纯本地假设。成功与闭合拒绝保留独立 60 秒轮询期限，失败独立退避；evidence 每 10ms 的唤醒不会放大查询。期限到期后遇到 NotAttempted 则移除过期定时器，避免暂停时自旋；未来退避不受影响。
7. OS custody 不得放在电源提交锁内。context 验签、数据库准备与 anchor 持久化先完成并关闭旧执行权威，之后只在最终 power/session/Host 栅栏内消费 opaque one-shot stage、发布内存状态。丢弃 stage 不丢原 t0，也不保留旧执行上下文；测试持有 custody 锁证明最终 publish 不触及它。
8. SessionAttempt 不能阻止并发数据面 401 撤销 credential_instance。context 获取、初始完成、refresh failure/retry、access commit 与刷新凭据持久化均绑定原实例，发送前和最终发布时重新核对；陈旧成功/失败不能写入或清除当前凭据，也不能先发布 Host context 再被 access fence 拒绝。

## 验证与剩余边界

- Cloud/protocol：Cloud 833/833、Protocol 503/503；真实 PostgreSQL 63 项迁移、九套相关测试 175/175，其中新增目标终结 16/16。
- OAuth/签名测试使用本地测试账户与测试密钥，执行生产服务和真实 PostgreSQL 事务；这不等于已部署的真实双设备/OpenBao 验收。
- root 独立数据库：16/16 通过，70 项未选用例明确为 skipped，不计通过。日志 `target/root-independent-target-bootstrap-pg.log`。
- root 固定路由/角色边界 9/9；UI/adapter 31/31，目录/生产构建组合 7/7；i18n 19/19。独立 UI/adapter 37/37。
- root 独立固定二进制复验：无业务库目标控制最终 14/14、stage/context 11/11；后续终态不回退增量已在新二进制再次验证。Storage 构建者全套 538/6 项既有 ignored、公开面 2/2、编译拒绝 28/28。
- 精确 Host/Native 公开面与 Tauri 策略 17/17；基础策略补齐两个目标命令后，root 聚焦 2/2，独立完整文件 3/3。首次根检查的该项失败保留于 `target/root-handoff-termination-first-check.log`，修复后重新运行完整检查。
- 最终根 `pnpm check` exit 0，日志 `target/root-handoff-termination-final-check.log`：结构 213、Protocol 503、Cloud 833、Desktop 366、client-core 425、Storage 539/6 项既有 ignored、Native 127、Core 82。全仓格式与变更文档本地链接检查通过。
- 独立最新 Native 二进制：session 30/30、target coordinator 10/10、sync lane 8/8，日志 `target/cloud-independent-{session,bootstrap,sync}-final.log`。Linux Native 严格 Clippy、最终格式化快照的 Windows Storage/Tauri 全目标严格 Clippy 均通过，后者日志 `target/windows-bootstrap-final-formatted-clippy.log`。

上述证据不表示 Windows/macOS 实机、真实 OpenBao/双设备旅程或 Provider 已取得资格。完整目标引导、强制接管、云恢复、可携带独立备份和后续市场继续实施。
