# 过期引导后的重新登录恢复

基线 `6e81e57`；独立 Standby Grant 协议增量继续保留。

- 目标与入口：引导过期后正常 Desktop OAuth 登录/刷新先原子终结过期引导，再按既有授权规则取得更高 epoch；不新增请求字段或路由。
- 所有者：Cloud devices 拥有工作流、pending allocation、能力与 nonce；workspace/checkpoints 通过声明端口释放 pin；identity 仍拥有登录证明。
- 当前事实：登录 allocationReserved 会阻断任何 pending，尚无过期清理；真实 drain 仅创建能力，未创建 authority/nonce；旧 state_deadline 可能长于能力期限。
- 合同：账户/设备/安全 epoch 来自既有登录；工作区由默认绑定解析。过期判断使用数据库当前时钟；未到期、孤立或不一致记录不放行。
- 原子性：同一事务烧毁 epoch、消费能力及 nonce、清除下一步骤、释放 pin、失败终结工作流。保留历史与 epoch 上界；分配仍经原 guard。
- 依赖与共享面：复用已迁移字段，无新表；主代理串行拥有 devices 实现、OAuth 组合、声明导出、检查与文档。
- 验收：真实 PostgreSQL 登录→引导到期→更高 epoch、重复/并发、跨租户、撤销、不完整记录、故障回滚；根检查与独立评估。
- 独立评估：device_architecture_review；主代理负责修复与最终接受。
- 声明边界：不代表 Standby、取消、引导安装、云恢复或双系统发行已完成。真实 Cloud/双系统设备演练仍需单独取证。

验收结果：PostgreSQL 18.6 UTF8 48/48，独立评估复跑 PASS；最终根 `pnpm check`、差异与本地文档链接检查通过。
