# 当前工程结构评估与调整顺序

评估基线：`60d00f8` 及其工作区。结论：顶层所有权与信任域划分适合 GoodDealer；当前内部结构尚不是
支撑十二平台、双系统与恢复目标的最佳落地形态。应保留现有主架构，在真实功能切片中改善内部内聚性、
资源模型和原生实现，避免把已经完成的目录拆分当作全部架构工作完成。

本次依据当前源码、导出面、SQL 约束和组合入口进行结构评估；上一轮根 `pnpm check` 通过，证明相应源码检查，
不证明目标平台能力、生产性能或真实 Provider 行为。

## 应保留的结构

- **Monorepo 按运行时分工。** Desktop、Cloud、Account Web 与营销有独立入口；协议、领域模型、UI 和文案有明确所有者。
  对本地资产管理产品，Cloud 控制面与本地业务数据面的分工合理。
- **单一事务所有者。** SQLCipher 业务事实与 Outbox 同事务提交；Provider 观察先落本地，Cloud 仅保存允许字段的副本。
  一个数据库 writer 和提交栅栏能维持本地编辑、同步、凭据维护及恢复的原子边界。
- **Native 秘密边界。** `secure-host-core` 持有平台与身份秘密，`local-storage` 拥有数据库密钥及备份/恢复，
  普通 TypeScript 只消费严格的非秘密合同；这与平台私有 API 所需的 Cookie/CSRF custody 相容。
- **模块化 Cloud。** 领域模块拥有 repository、迁移与端口，入口组合 HTTP、OAuth、webhook 和作业。
  现有结构足以承载设备权威、商业配置及副本，不需要为了增加平台而改写 Cloud 的运行模型。
- **Host 私有能力拆分。** [desktop_local_host](../crates/local-storage/src/desktop_local_host/mod.rs)
  已分为授权、业务、同步、Provider 和恢复模块，并共享一个状态所有者。这是正确方向。
- **可执行的边界检查。** 包导出、拓扑、import、Tauri capability、unsafe policy、compile-fail 与跨语言向量共同约束边界。
  这些应继续保护重构，而非为了拆分放宽公开 API。

## 需要优先调整的结构

### 高优先级：业务数据库模块仍混合多个能力

[business/mod.rs](../crates/local-storage/src/active_workspace/business/mod.rs) 为 19,746 行，主测试模块从 8,274 行开始。
前半还包含部分测试辅助，不能把全部行数当作生产逻辑；但其确实同时承载资产编辑/删除/重新添加、Provider 绑定、
Outbox、Inbox、冲突、checkpoint 和 wire 编码。增加每个平台或恢复路径都会触碰这个共同修改面。

按业务能力在同一私有模块树内拆分：资产生命周期、Provider 绑定、Outbox、Inbox、冲突、checkpoint 安装与
确定性 wire 编码；测试随所属能力迁移，保留跨能力事务测试。`mod.rs` 保留数据库所有者、必要类型和内部组合。
事务由上层一次创建，内部步骤使用同一个受限 transaction；不能拆成各自提交的 repository、公开 SQL 或通用回调接口。
先提取首个市场与恢复切片要修改的部分，再扩展拆分，不要求完成全文件搬迁才开发功能。

### 高优先级：平台名称扩展尚未转化为资源模型扩展

[绑定 SQL](../crates/local-storage/src/active_workspace/domain_provider_binding.sql) 的 `resource_kind` 只允许
`zone/registration`，主键是 `(workspace_id, entity_id, resource_kind)`，且绑定身份不可变。
这无法表示同一域名在多个市场、不同连接下的独立 Listing，目录里有十二个平台并不能解决这个限制。

实现 Listing 模型时保持现有注册商/DNS 约束，使用包含连接身份的 Listing 唯一性；明确同平台多账户语义、
资源生命周期、绑定代次和观察归属。通过新迁移、schema guard 和读取/恢复合同同步交付，不能直接修改已应用 SQL。

[manifest](../packages/protocol/src/domain-providers/capability-manifest.ts) 的执行字段只接受 `not_executable`；
[Host 资格登记](../crates/local-storage/src/active_workspace/capability_qualification.rs) 为空。这是当前状态的诚实表达，
但不是最终能力模型。首个实际能力要同时补齐可执行合同、风险/权限/幂等/对账证据、Host 准入与 UI 投影；
manifest 描述和 Host 的运行授权仍是不同职责，不能靠一个 UI 布尔值合并。

### 高优先级：双系统原生能力还没有闭环

[Windows custody](../crates/local-storage/src/desktop_custody_windows.rs) 的 `load_or_create` 返回 `Unavailable`，
`open_workspace` 返回拒绝，说明缺口包括数据库启动与秘密托管，超出备份文件选择器的范围。
[native_backup](../crates/local-storage/src/desktop_local_host/native_backup.rs) 的生产组合也只有 `Unavailable`，
开发实现位于 `cfg(test)`。

按用途分别实现 Windows/macOS 原生后端：数据库/key custody、设备与平台凭据、稳定文件 handle、备份材料输入和
安全发布。共享业务策略与合同，保留 OS 特有实现；不做能任意访问路径、槽位或秘密的通用平台服务。
Windows 最早切片应验证启动→创建加密工作区→关闭重开，再验证连接与恢复，尽早发现操作系统层约束。

### 中优先级：Host 总授权仍带有备份专属命名与状态

[DesktopLocalHost](../crates/local-storage/src/desktop_local_host/mod.rs) 共享字段仍包含 `BackupAuthorityVerifier`、
`BackupAuthorityPublicationState` 与 `BackupOperationState`。单一状态所有者是必要的，但整体授权与备份工件授权
在命名和内部模型上仍紧密耦合。加入 Standby、商业只读和离线备份阅读时，容易误把不同能力当成同一套授权。

在对应能力实现时，把工作区授权/角色的内部语义与备份 binding、工件准入、恢复提交语义明确分开。
共享可信时间、epoch 和最终提交栅栏，不建立第二套业务执行权威，也不能由备份状态推导 Active 能力。
优先澄清类型与状态转换，再评估文件拆分；保持公开面最小。

### 中优先级：多平台扩展容易复制壳层编排

[Provider 协调器](../apps/desktop/src-tauri/src/provider_credential_orchestrator.rs) 串联录入、远端观察、准备、
prewrite、marker、custody 发布与最终事务。它现有多次 Host 复核与类型状态有明确价值；跨 crate 的异步协调
放在 Native 适配层并非本身错误。

扩展 Afternic 时，应保留 Tauri 调度、取消及平台 API 适配在壳层，把持久计划、状态裁决与恢复语义留在拥有模块。
根据第二个真实 Service 的共同需求提取窄机制，避免为十二个平台复制整套业务状态机。
复用不能暴露任意请求、凭据选择、签名、文件操作或把两个 crate 的秘密与数据库权威合并。

### 中优先级：对称合同与测试应减少维护漂移

TypeScript 协议与 Rust 解码必须分别在各自不可信边界校验；现有金向量是合理手段。
平台清单目前在两种运行时各有一份，并由测试对齐；这个规模尚不需要引入大型 schema 生成框架。
随着字段增加，优先补齐规范样本、错误样本和确定性编码向量，只对稳定且确有重复维护成本的非秘密清单考虑生成。

部分策略测试直接检索源码文本，能约束公开面与生产/test 隔离，也会因纯结构调整而受影响。
拆分时同步更新这些检查，并保留事务、授权与故障行为测试。不能仅为满足字符串匹配保留过时的目录或类型名。

## 推荐调整顺序

1. 核对共享面与在途 Standby 工作；本次结构分析不触发运行时重构或改动他人实现。
2. P1 市场切片：先提取本地 Provider 绑定和相关生命周期代码，迁移 Listing 模型，交付实际 Afternic Service 与父计划。
3. A 授权切片：明确工作区授权与备份授权的内部语义，完成 Active/Standby 的 Cloud/Host 验证及准入。
4. Windows 原生启动与 custody 从早期进入验证；R1 独立恢复不等待所有平台或活动库替换机制完成。
5. 再按实际修改面提取同步、冲突及 checkpoint 内部模块；每次保留同一事务、锁顺序、代次和崩溃恢复不变量。
6. 以第二个平台和跨系统恢复证明复用价值，再完善可复用的私有机制与合同一致性检查。

因此，最佳实施策略是：保留清晰的顶层边界，优先修复阻塞目标能力的数据模型与原生后端，并让内部模块拆分
与可验收的用户旅程一起交付。目录整齐、文件数量或抽象层数都不单独构成架构完成标准。
