# 工程结构调整结果与后续边界

2026-11-18：已完成本轮工程结构调整。顶层运行时、信任域和单一数据所有者保持不变，
后续可以直接进入真实功能切片。本文件记录结构结论；运行时能力状态统一见
[当前实现](CURRENT_IMPLEMENTATION.md)，下一轮任务见 [执行提示词](IMPLEMENTATION_PROMPT.md)。

## 已完成的调整

| 问题 | 当前实现 | 保持的不变量 |
| --- | --- | --- |
| 业务数据库混合多个能力 | `active_workspace/business/` 分为 assets、provider_observations、reads、inbox、outbox、conflicts、checkpoint、database、wire、repair 私有模块；测试在同一模块树下按能力分组 | 单一 BusinessDatabase；原有事务步骤、提交栅栏和调用 API 保持；没有独立 repository writer |
| Listing 无法表达多市场、多账户 | 新迁移 `202611180001` 扩展原有资源绑定表，Listing 包含连接与资源身份；同域名/连接最多一个未 detached 的 Listing，旧 incarnation 保留 | Registrar/DNS 保留单资源唯一性；绑定身份不可变；平台必须匹配连接；跨工作区 FK 和禁止物理删除保持 |
| 工作区授权被备份命名掩盖 | verifier、可信绑定、已验证快照和替换下限使用 WorkspaceAuthority 语义；BackupArtifactState 单独持有容器与原生发布状态 | 工件状态不能产生执行授权；仍在同一个 publication mutex 下原子约束；锁顺序、epoch、签名用途与既有错误码不变 |
| Cloudflare 协调器看似通用平台实现 | Native `provider_credential_orchestrator/mod.rs` 只导出窄操作面，实际协调在私有 `cloudflare.rs`，测试独立 | 持久计划与提交裁决属于 local-storage；秘密和 HTTPS 属于 Secure Host；未引入通用 Provider 引擎 |
| Unix custody 混合 OS 密钥库细节 | macOS Keychain、Linux Secret Service 与其他 Unix 拒绝实现位于 `desktop_custody/` 私有后端，文件身份和事务策略仍属于 custody 所有者 | 没有新增跨 crate 的路径、key slot 或秘密接口；Windows 仍有独立的 handle 实现位置 |
| 源码布局检查会因拆分失效 | rebootstrap 策略扫描所有拆出的生产文件；平台清单检查只有在测试模块确实受 cfg(test) 约束时才排除它 | 保留生产/test 隔离的反例测试，不能通过搬文件隐藏执行路径 |

本轮迁移不修改任何已应用 SQL。原有 Zone 绑定 UPSERT 对应新的部分唯一索引；Listing 的身份和
生命周期继续由同一个资源绑定表拥有，没有新增平行的 Listing repository。
`marketplace_listing_observations` 仍拥有观察事实；绑定不复制价格/状态，也不代表已获得 owner 验证。
平台原始身份只留在本地，Cloud 同步和业务备份仍按各自白名单投影。

业务拆分迁移了全部 137 个原有测试，没有通过删减行为测试缩小覆盖。跨能力的共享 fixture 保留在
`business/tests/mod.rs`，实际测试按资产生命周期、Provider、读投影、同步、checkpoint 和事务组织。
结构移动不修改业务 wire；跨语言金向量继续用于协议一致性。

## 验证结果

- 根 `pnpm check` 通过：构建、类型、TypeScript 测试、205 项结构策略检查与 Rust workspace 测试。
  `local-storage` 为 408 项通过、6 项既有忽略测试未运行。
- `cargo clippy -p gooddealer-local-storage --all-targets` 通过且无警告；
  `cargo test -p gooddealer-local-storage --doc` 的 28 项公开边界编译测试通过。
- Listing 新迁移覆盖旧绑定/校验和保留、DNS/Registrar 唯一性、多市场/多账户、跨工作区与平台错配、
  不可变身份、detached 替换，以及重建中途失败的 schema/数据/迁移回执原子回滚。
- 验证环境为 Linux x86_64。上述结果不替代 Windows/macOS 真机资格、真实 Provider 调用或生产恢复验收。

## 下一轮需要实现的产品能力

- **Listing 真实写入闭环。** 数据库能表示绑定，不等于 Service、扫描归集、Host 绑定准入、观察关联、
  批量父计划、重启对账和客户入口已经完成。后续 Afternic 归集/下架的实际组合见 [当前实现](CURRENT_IMPLEMENTATION.md)；创建/改价/验证仍需接续，真实 Provider 证据和当前授权必须在同一拥有模块落实。
- **Windows 原生实现。** 现有 Windows custody 仍返回 unavailable；先完成加密工作区创建、关闭重开与
  秘密 custody，再覆盖连接及恢复。macOS 同样需要真实原生资格，Linux 单元测试不能替代。
- **两条恢复旅程。** 独立可携带业务备份、离线隔离查看/导出，以及有当前授权的换机云恢复仍待实现。
  现有安装绑定格式与测试文件后端不构成生产恢复能力。
- **设备授权与可执行资格。** Cloud/Host Standby 角色准入已接续，继续完成目标引导/激活、强制接管与实际设备旅程；
  按真实能力补合同和资格。空 manifest/拒绝分支只是现状，不改变首发目标。

后续变更直接进入对应拥有模块，按两种真实平台需求决定是否提取窄机制。继续保持应用入口薄、
单一数据库 writer 和 Native 秘密边界；不需要再做一轮全仓结构重写，也不将剩余产品开发包装成结构完成。
