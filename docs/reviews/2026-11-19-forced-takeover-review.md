# 强制接管与首次云恢复独立审查

基线 `825878d`，范围见 [工作包](../phase0/FORCED_TAKEOVER_TASK_FRAME.md)。本记录只接受可信 Fresh 或精确终止且未写库目标的强制接管；已有副本恢复、无 held 来源恢复仍待实现。完整产品目标见 [持续任务](../IMPLEMENTATION_GOAL.md)，本切片不能替代 Provider 主线或双系统实机。

## 客户路径及信任边界

设置/无副本 Standby 的专用重新认证 → 新来源 epoch 预览 → 一次确认 → Native 保存原请求 → Cloud 单次消费原五分钟窗口 → 持久等待/取消 → 安装资格落盘 → 到期领取 → 原 checkpoint/mutation 安装和激活 → Active 与新鲜执行上下文后开放非空资产。登录和轮询本身不批准接管。Provider 凭据不恢复，界面提示重新连接与最后成功同步限制。

Identity 拥有会话窗口；Devices 拥有 Lease 历史上限、来源 CAS、工作流与能力；Workspace 拥有允许字段副本。Host 复用原 publication mutex、安装 journal 与最终栅栏。Cloud 025–029 追加迁移，无旧 SQL 改写；新增四条固定 forced 查询/取消意图路由，原 request/claim/receipt 仅窄分支扩展，不授予 Standby 普通来源权限。

## 独立评估及修复

- Storage 对 Cloud 事务、等待期限、生产角色与历史 Lease 迁移复核；发现 claimable 与 evaluatedAt 使用两次时钟、续租签名后可能跨冻结边界，已统一观察时刻并增加写后拒绝栅栏，真实 PG 回归通过。
- Native 对 Host 领取前持久准入、重开与取消复核；发现空闲后台写控制代次会使预览失效，以及 bootstrapping 取消继续走 waiting cancel 的循环。已禁止无变化写入，并沿原意图转既有 bootstrap status/cancel lane；未知激活仍先查 receipt。真实 Host 测试已复现修复。
- Cloud 对 Renderer/Account Web/HTTP 和 Host/Native 独立复核；发现在途预览可在 eligibility 变化后回来重建表单，已用独立预览代次丢弃迟到结果，测试覆盖失去再恢复资格。
- Root 复核 Cloud 严格主体/消费/回滚、Lease high-water 与 block、生产组合和 IPC；发现 raw Uint8Array 与 typed JSON 参数的实际不匹配。IPC 已改为有界原始请求解码，未知/重复键、JSON 包装和超限均拒绝；Native 独立审查和执行通过。
- Cloud 最终复核发现 TAKEOVER_NOT_READY 曾共用 bootstrap 拒绝 schema；现仅 claim 接受，step/checkpoint/activate 增加拒绝测试，避免临时等待状态扩散到已有能力操作。
- 整合检查发现旧 client-core forced fixture、Cloud 合同向量路径、账户证据输入清单与 Desktop 精确权限预期未同步；均按新合同修正并独立复跑，没有放宽权限或忽略失败。

## 证据

- Root 独立完整 OAuth/设备 PostgreSQL 121/121；随后新增 execution-context block 与历史 block 7/7（覆盖最终 122 项中的新增用例）。构建者完整 114/114 加最终 forced/升级历史 22/22，使用实际 PG 18.6 UTF8、gd_account_api 等生产角色，不以 fake 替代 RLS。日志 `target/root-independent-forced-pg.log`、`target/root-independent-context-block-pg.log`、`target/forced-takeover-cloud-pg-full.log`、`target/forced-takeover-cloud-pg.log`。
- Host forced 最终 19/19，包含真实 SQLCipher 非空恢复、Active＋context 发布、取消墓碑、跨租户/代次/forced origin、可能已写库拒绝领取和真实 bootstrap 取消收敛；Native 与 Cloud 两方分别独立复跑。完整 Storage 构建者此前 589＋2 通过、6 项既有规模基准 ignored。
- Native 最终 Tauri 166、Core 85、public 3、doc 4 通过；Linux 与 Windows GNU 三包全 targets 严格 Clippy `-D warnings` 通过。Cloud 独立 Native 22 项（不重复计数）、Host 19 项通过；日志 `target/cloud-independent-forced-*`、`target/forced-takeover-native-tests.log`、`target/forced-takeover-native-clippy.log`、`target/windows-forced-takeover-clippy.log`。
- Account Web 47/47；Desktop forced adapter/UI 10/10，连同精确 native policy 16/16；Cloud HTTP/role/catalog 31/31，完整 Cloud unit 最终 848/848；i18n 19/19，Desktop production build、typecheck 和相关命令策略通过。
- 最终根检查、格式、生成物、链接与差异检查由 root 收敛后记录于 [执行台账](../phase0/PHASE0_EXECUTION_PLAN.md)。失败的中间运行不计通过。

## 限制与经验落实

源码、真实本机 PostgreSQL/SQLCipher 和目标编译分开记录。尚无部署后的第三/第四/第五签名用途、实际两设备、Windows/macOS 实机或发行资格；当前 Fresh 路径不能覆盖已有副本及无来源 Lease。迁移 026 可能增加保守 24 小时等待，不能撤销历史离线签名或修复历史重叠。

后续以 Provider 主线为优先，立即并行上架/改价持久编排及 Linux 原生输入与电源通知，不把相邻恢复场景不断纳入本设备切片。跨运行时验收必须使用真实 adapter wire；未知 initial POST 的 not_found 不等于可以安全取消或重发；冻结期限来自历史已签权威，不能只看最后一行 Lease；局部成功或测试数量都不替代完整客户旅程。
