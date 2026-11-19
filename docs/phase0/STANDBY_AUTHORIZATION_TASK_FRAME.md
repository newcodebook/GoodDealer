# Standby 授权与只读客户闭环

基线 `2b3a67c`。工作区 Standby Grant 协议增量是既有独立工作；先验证和复用，不重复开发、不混入其他切片。

- 目标：第二台已绑定设备通过正常登录取得 Standby，显示已有本地只读工作区与设备目录；没有副本时明确显示待副本状态，不创建空库；Active 收到合法 Standby 时原子停写；重启不接受旧 Grant 恢复已失去的权限。
- 最终合同：ADR-0032 的 v4 role exchange、独立 Standby v1 签名域与用途、固定只读 scope；Cloud 由锁定身份/设备/Lease状态派生角色；删除 v3 请求/裸响应运行路径。
- 所有者：Cloud devices/identity 签发、资格与路由权威；secure-host-core 校验/固定运输/秘密；local-storage 独占工作区事务及持久授权地板；Renderer 仅显示 Host状态。
- 持久规则：已接受 issuedAt/security epoch/Standby lease floor 单调，Active epoch 严格高于 Standby floor。与现有 publication mutex/最终提交栅栏一致；备份读取不授执行权。
- 角色规则：Cloud 与 Native 各自关闭清单；每条 Desktop 路由明确 active 或 active_or_standby。Standby 不要求有效权益，不得 push、执行Provider或业务写入；本切片默认冻结只读Inbox；后续由持久正常交接成功证据决定专用Inbox准入，现有barrier不算成功证据。
- 当前事实：协议增量已存在，Cloud/Host仍v3 Active；过期引导回收已交付；目标引导、强制接管与新机云恢复尚未组合。不得为完成本切片假造Provider或设备结果。
- 共享面与整合：主代理拥有 protocol、local-storage、跨runtime合同与最终整合；Cloud构建者拥有apps/cloud及第三用途配置说明；Native构建者拥有secure-host-core、Desktop Native和明确委派的Host sync/business/device-switch接口；Renderer等共享入口由主代理整合。
- 独立评估：device_architecture_review 只读设计/最终评估；主代理修复并最终接受。公开API和方法变更先对齐，不允许交叉覆盖。
- 验收：错用途签名/混合角色/未知字段、跨租户、撤销与锁等待、期限、重放、原子降级、并发写入、持久化后崩溃/重启；Cloud PG、Host SQLCipher、IPC/UI、根check。
- 资格：真实Cloud/OpenBao与双设备Windows/macOS演练另行取证；Linux与测试签名器只能证明本地实现。实际平台和硬件缺失只阻断对应验收。
