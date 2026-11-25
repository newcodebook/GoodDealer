# Afternic create/update Native 组合独立审查

日期：2026-11-19。审查者：`device_architecture_review`。审查目录：Provider worktree，审查时 HEAD `3a0f5ae5b4677b2e034c0ad99492782ca21e484b`，包含尚未提交的 Listing 切片。审查者没有实现本记录接受的 Native worker、IPC、lane 或 Core 签名代码；Storage 的实现和测试由同一审查者拥有，因此本记录不作为 Storage 的独立接受。

结论：接受本轮 Native Listing create/update 的源码与本地组合测试范围，未发现尚未解决的阻塞缺陷。真实 Provider 账号旅程与目标系统资格不在此次源码接受中。

## 核验的实际生产调用链

- `main.rs` 的 Tauri handler 注册和 `build.rs` 命令生成源已包含三个具名命令；`command_handlers/afternic_listing_write.rs` 直接接收有长度上限的 raw JSON bytes。共同 `provider_ipc` 解码器先拒绝重复键、超长输入、尾随数据及非 raw body，再进入封闭 DTO。秘密、URL、请求方法和凭据代次没有 Renderer 入参。
- Preview 在取消栅栏内获取当前 Host admission。Approve 先检查真实执行可用状态，再持有当前 power epoch 的短提交守卫及取消互斥锁，调用 Host 批准，成功后唤醒同一 Provider lane。Status 从 Host 读取 DTO，由 Native 填写 `executionAvailable`；不会由 Renderer 或 qualified/entitled 推导。
- `native_cloud_runtime.rs` 的生产闭包调用 `provider_credential_orchestrator/afternic_listing_write.rs::step`。它与 delist、连接恢复和刷新共用 `ProviderLane` 的一个执行槽。后台唤醒轮流给 delist 与 listing-write 各一步，空工作返回 false；持久退避由 Storage 决定，lane 的空闲检查不产生写重试。
- Work 与 Claim 由 Host 产生。凭据从 `load_afternic_credential_guarded` 的精确 incarnation、generation、proof 槽加载，加载前后重新核对 Host/取消/power。凭据缺失或损坏进入显式 remediation，不重新捕获或换用另一槽；临时 custody 不可用进入只读退避。
- Preflight 对一个已批准域名调用固定官方精确 GET。只有 Host queued→running 事务胜者返回不可复制 Claim；Native 把该 Claim 的 action 和已冻结字段映射为一个 Create 或 Update。显式 0/false 保留，PATCH 未选字段保持省略。worker 只有一次 `provider.execute` 调用，随后消费 Claim 为 Reconcile work。HTTP 接受、拒绝、未知结果都不生成第二次 POST/PATCH。
- Core 生产运输固定 Afternic HTTPS origin/path，禁重定向、自动重试和环境代理，共享 410ms 请求间隔。guard 覆盖限流等待、实际发送前、响应后和每个 body await 前后。只有认证 `RESOURCE_NOT_FOUND` 返回 absence；精确域名、状态和响应结构校验失败不能变成 absence。
- worker 的 HTTP future 与 power epoch 改变竞争；Host 校验可能等待数据库锁，因此 power/cancel 在 Host recheck 前后各核对一次。Claim、结果、读退避的最终同步事务持有 power→取消→Host→SQLite 的既定锁序，无锁跨 HTTP/custody await。已持久 claim 后取消、休眠、断线或进程终止保留不确定性，重开仅领取 Reconcile。
- `execution_context_native.rs` 将新 approval purpose 送入 Core 的固定 `sign_afternic_listing_write_approval_transcript`，没有任意签名或 Provider 代理入口。Core 拒绝 remove purpose、错 device/key 和非封闭 claims，并继续验证 audit/fact 的既有领域及原 approval 绑定。Core 金向量/负测的独立记录由 Cloud 审查者提供，本次另追踪了生产 trait 调用接线。

## 交接时的准确边界

[ADR-0032](../adr/0032-desktop-device-switch-and-drain-handoff.md) 的“旧设备的 drain”明确允许把远端未决结果冻结为 unknown，要求冻结后到达的 HTTP 响应不得追加旧 epoch 结果或审计。当前 `install_handoff_barrier` 在同一业务事务中记录未决数量并冻结两条签名来源流；新 plan/approval/dispatch 被拒绝，Listing 的 next 返回 None，结果触发器也拒绝新观察。

这符合最终 ADR。TaskFrame 中“原已发送 GET 对账继续”需要限定为未进入冻结屏障的运行期，或权威取消交接并重开来源之后。交接成功后旧 epoch 不重开；原机以后取得新的 Active epoch，必须重新 GET，再以当前上下文追加关联旧 fact 的新观察，不能为旧响应补造签名或时间。不能为普通文档中的宽泛表述放开已冻结的审计链。该文档校正由 root 拥有。

电源核验中曾检查“已知休眠后监控失效是否重新允许 GET”的疑点。Linux 的 D-Bus closed、logind owner 改变及非法信号均调用 `State::close()`；closed latch 独立于 ready，之后的 registration failure 不能重开它。因此未确认该生产路径存在放行缺陷，未据此修改实现。

## 独立执行与资格界限

审查者直接执行已有 Tauri 测试二进制，没有占用 Windows Cargo 构建：

```text
target/debug/deps/gooddealer_desktop_tauri-53c0eec184c51871 --test-threads=4
153 passed; 0 failed; 0 ignored
```

日志：`target/storage-independent-native-listing-review.log`。
执行时二进制 SHA-256：`d67797b22e5a3b9d261d84204bca20f559d3fd7640989dad9ddbc39f035bf2b0`。
覆盖包括新 IPC/worker 6 项、lane 11 项、取消互斥及其他实际组合测试；这属于源码测试，不代表启动了真实客户应用或调用了真实 Provider。

另由 Native 所有者报告并留日志：Linux 三 crate `--all-targets` strict Clippy、Windows GNU 三 crate `--all-targets -D warnings` 通过；后者日志 `target/windows-listing-native-clippy.log`。Windows GNU 是交叉编译证据，不是 Windows 实机、MSVC 发行资格或真实休眠/恢复测试。macOS 的设备/签名/休眠与发行资格也不能从这些结果推导。

真实账号的受控 `wecin.com` 连接、官方 API create/update、审核/所有权状态、应用重启续作仍需受限 Native 凭据流程及当前设备实际执行取证。本记录未输入 Provider 秘密、未进行真实付费交易、未把 fake transport 或此测试结果视为实际平台资格。
