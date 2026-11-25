# 目标设备终止引导

总任务见 [实施目标](../IMPLEMENTATION_GOAL.md)。本工作包补齐 ADR-0032 在切换界面启用前要求的 `bootstrapping` 终结路径；接续执行证据切片，不把它当作完整目标安装/激活、强制接管或换机恢复。

## 客户结果、固定合同与边界

目标设备即使尚无业务副本，也可发现本机待引导工作流，确认停止该次引导；Native 先持久化精确意图再发送，未知响应和重开先查原工作流，必要时只重发原取消。取消不恢复来源 Lease、不授予 Active、不删除旧库、不新建空业务库、不自动取消随后出现的新工作流。

- 固定 `POST /v1/device-switch/bootstrap/status`：严格 `{schemaVersion:1, requestId:null|string}`。null 仅发现本会话设备作为目标的唯一 bootstrapping 工作流；精确 id 只读本目标历史。响应为严格 `{schemaVersion:1, found:false}` 或 `{schemaVersion:1, found:true, request:DeviceSwitchRequestViewV2}`。
- 固定 `POST /v1/device-switch/bootstrap/cancel`：复用严格 lookup `{schemaVersion:1, requestId}`，返回现有严格 DeviceSwitchResponse。两个路由请求 2 KiB、响应 8 KiB；已绑定 Active/Standby 会话均可调用，但只允许该工作流的精确目标。未领取引导能力仍可终止，不要求 capability。
- 身份、默认工作区和设备仅由服务端当前会话派生。保持来源 cancel 既有 Active-only 应用准入，来源 bootstrapping UI 不再提供取消并恢复语义。
- Cloud 在原锁序与同一事务内验证 pending 为最高已分配且大于 current、无对应 Lease、工作流/能力/目标一致；烧 epoch、消费能力和全部 active nonce、清空 authority 下一步、释放 checkpoint pin，再终结 workflow。保留 highest、来源释放/封链/proof/普通交接 receipt。复用 expiry 的具名终结逻辑，不创建泛化引擎。
- 精确 id 已 cancelled 幂等返回原完整历史；completed/failed 不得修改。activation 先赢不得取消已激活 epoch，cancel 先赢后续 step/activation 必须拒绝；任何失败整体回滚。旧 id 重放不影响新工作流。
- local-storage 用固定用途 Native 控制记录保存取消意图及终态，绑定安装、账户、默认工作区、设备和精确请求；不依赖业务库，不建立第二 writer。所有持久化和回执发布通过原 publication mutex、角色代次与最终栅栏。秘密、路径和 handle 不进入 Renderer。
- Renderer 只展示脱敏目标状态、确认一次和读取状态；Native 负责恢复及固定网络路由。取消成功仅表示引导终止，重新获得执行权限仍走现有授权流程。

## 所有权与实施顺序

Cloud/protocol 由 standby_cloud 实施；local-storage Host/custody 由 device_architecture_review 实施；Native 固定 transport/协调器由 standby_native 实施；root 负责冻结合同、共享导出/路由/应用组合、IPC、客户 UI、策略与当前文档。构建者先提交精确 API 给相邻 owner，不能猜接口或改对方文件。独立审查分别由其他 owner 和 root 完成；最终 root 收敛与运行根检查。

## 验收与允许声明

真实 PostgreSQL 覆盖跨租户/目标、撤销、cancel 与 activation/expiry/step 的竞争、失败回滚、来源 receipt 保留及旧 id 重放。Host 覆盖无业务库、意图落盘前后崩溃、丢 ACK、重开、角色代次/凭据/电源栅栏变化及严格未知输入；UI 覆盖来源/目标区分、未知结果禁止改目标和终止语义。运行模块、独立评估、根 pnpm check、目标平台编译、文档链接与 diff 检查，按完整切片提交。

Windows/macOS 实机、真实 OpenBao/双设备及 Provider 资格继续单独取证；目标安装、激活、强制接管、云恢复和独立离线备份不因此完成。执行经验及证据记录在审查和执行台账，最终 ADR 仅更新两个目标专用路由的授权规则。
