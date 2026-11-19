# GoodDealer 持续实施目标

本次目标不是“继续已接受目标”这一简称，也不是某个授权或 Provider 切片；目标是完成下列核心客户旅程及其全部约束。

本文件保存本次持续任务的完整目标和不可丢失约束。每次恢复上下文先读取本文件、AGENTS.md、当前 Git 状态和执行台账；不能把压缩摘要、旧阶段顺序或上一轮完成的局部切片当作整个任务。

## 核心交付

在 `/home/sean/Programs/GoodDealer` 直接实现并验证可用的桌面域名管理产品。用户约有 300 个域名，资产来自 22.cn、易名、阿里云、GoDaddy、Spaceship、Cloudflare。核心客户价值是统一资产归集、跨市场批量上下架、自动所有权验证，以及退出/休眠后重开自动对账续作；不能只交评审、计划、文档、能力目录或空 Service。

首发完整范围为 Cloudflare、Spaceship、Atom、Afternic、Namecheap、Dynadot、GoDaddy、Porkbun、Sedo、易名、阿里云、22.cn。市场实施优先级为 Afternic → Atom → Spaceship SellerHub → Sedo → 易名 → 阿里云 → 22.cn。易名、阿里云、22.cn 均须交付资产归集和上下架；其余首发平台及完整能力目录不得静默删除。Windows 与 macOS 均需完整实现和分别验收，现有 unavailable 分支不是产品排除。

## 按实际依赖完成的客户旅程

1. **设备授权、交接与换机云恢复。** 接续已有独立 Standby Grant 协议，完成匹配的 v4 Cloud/Host 合同、独立签名用途、严格角色路由准入、Host 持久防重放地板、第二台设备登录/只读、Active→Standby 原子停写；随后打通普通交接、目标引导与激活、丢机强制接管和云恢复。Cloud 是身份/设备/Lease/Epoch 权威；最多两台绑定设备、单 Active，遵守最终 ADR 的期限、重新认证、撤销和 pending epoch 终结规则。云恢复只承诺最后成功同步的允许字段；保留强制接管后旧机未同步库，不覆盖或推送它。目标设备重新连接 Provider 凭据。
2. **资产归集与市场批量闭环。** 从真实连接经分页完整扫描和资源绑定进入资产库，先完成 Afternic Listing，并由 local-storage 的持久父计划编排必要 DNS/私有验证步骤，贯通预览、确认、上下架、所有权验证、未知结果对账、崩溃及重启续作。非资金整批预览确认一次，之后自动完成独立平台步骤；费用、出价等资金操作逐笔确认。新增目标、改价或扩大 DNS 范围必须重新预览。未知结果先对账，不能盲重发。应用运行时后台继续，退出/休眠暂停，重开自动续作；Cloud 不代执行 Provider 操作。不等待全部 Cloudflare 写能力或整个注册商目录完成再做 Afternic。
3. **独立业务备份与离线恢复。** 用户手动选择本地备份位置，使用独立新版本工件和用户保管的恢复材料；旧机和 GoodDealer Cloud 均不可用时，仍能在新机认证并打开最近一次备份为隔离加密数据集，离线查看/导出。之后实现有当前授权的业务差异预览和导入。安装绑定 GDBK v1 不算换机备份；不能把活动库替换的防回滚条件强加给历史备份的隔离读取。恢复材料、文件 handle 留在 Native。无需添加自动备份调度或固定 RPO。
4. **后续平台、双系统与运营。** 按市场优先级扩大真实能力，补齐六个资产来源和十二平台目录中的产品能力；实现 Windows 加密工作区启动/关闭重开、设备与平台秘密 custody、恢复，完成 Windows/macOS 双向恢复和真实构件验收。保留 Licensing 的受控配置、审计与运营空间，商业计划变化不指导技术架构。

## 实施与信任边界

- 已确认官方能力使用官方 API；当前未找到官方支持的能力直接实施自研私有 HTTP API。私有协议调查属于开发步骤，端点/行为须来自当前证据，社区代码仅供参考，不猜端点，不以继续找官方文档或等社区成品拖延。
- 每个平台一个 secure-host-core 私有 Service；local-storage 独占业务事务、绑定、观察、计划/尝试/结果、备份与恢复；Cloud 只拥有身份、设备、商业与允许字段的副本；Renderer 只传有界业务意图和展示脱敏结果。
- 保持单一业务数据库 writer、原 publication mutex、锁序与最终提交栅栏。秘密、Cookie、CSRF、恢复材料与文件 handle 不离开 Native；Provider 账号身份/凭据不进入 Cloud、普通 TypeScript、日志或业务备份。所有不可信输入从 unknown 严格验证；授权、租户隔离、签名用途与依赖边界失败关闭。
- 复用已完成的工程结构、WorkspaceAuthority/BackupArtifactState 分离、业务私有模块、Native Provider facade 和 Unix custody。复用已追加的 Listing 资源绑定迁移：连接+资源 digest 身份，同域名/连接一个未 detached 绑定，保留历史 incarnation；不再建重复 repository 或第二 writer。不预铺十二个空 Service，不新增通用 Provider 代理、工作流或规则引擎；由两个平台真实需求验证复用面。
- 最终 ADR 决定目标，源码决定现状。阅读 ADR 索引、CURRENT_IMPLEMENTATION、IMPLEMENTATION_STRATEGY、ENGINEERING_STRUCTURE_REVIEW、PRODUCT_DISCOVERY、PROVIDER_API_REVIEW、ROADMAP、VERIFICATION、ORCHESTRATION 与执行台账。普通文档冲突应核对更新，不能据过时快照缩减目标；必要的架构修订更新对应最终 ADR，不塞入实施日志。

## 工作区保护与完成条件

- 开始/恢复工作先检查 HEAD、工作区、AGENTS.md 与已有工作线。保留其他改动，不 reset、不覆盖、不混合提交。基线独立 Standby 协议位于 packages/protocol/src/devices/authorization-grant.ts、index.ts、对应测试和 test-vectors/standby-grant；核对其最新状态后接续，不能重复开发或当作完整 Standby。
- 每个切片同时交付严格合同、必要持久化/追加迁移、拥有模块实现、真实组合、客户入口与测试。不得改写已应用迁移；生成物改源后重生成。按完整切片独立提交。
- 验证覆盖错用途签名、跨租户、代次变化、撤销、并发、崩溃、未知结果、重放与重启；运行相关模块/数据库检查，整合运行根 pnpm check；按仓库规则完成独立审查。同步更新当前实现和执行台账，准确区分源码测试、真实 Provider/Cloud 接口、目标平台实机与发行资格。
- 真实账号、会话、设备确实缺失时，仅提出当前阻塞步骤的最小需求；秘密经受限原生流程输入，绝不要求粘贴到聊天。继续不依赖它的工作，不以 fake、空 manifest 或开放开关宣称交付，不擅自进行真实付费交易。
- 一个切片完成后继续下一项具备条件的切片，不停在逐文件汇报或反复询问是否继续。只有确实需要用户的新产品选择、信任边界决定或无法取得的外部条件才打断。目标只有在上述核心旅程及要求均实际完成后才可标记完成。

进度与证据仅记录在 [当前实现](CURRENT_IMPLEMENTATION.md) 和 [执行台账](phase0/PHASE0_EXECUTION_PLAN.md)，不要以改写本目标掩盖未完成项。


## 恢复上下文后的执行约束

- 不以摘要中的“已完成”推导整项产品已交付：先核对对应提交、生产入口、测试与真实资格。
- 不把停写屏障、协议签名、空能力目录或单模块测试当作成功交接或可用 Provider。跨运行时的客户旅程须有匹配的持久事实和组合测试。
- 先检查已有工作线和文件所有权，再接续实现；未知外部结果先对账。崩溃续作必须覆盖每个落盘与网络发送之间的窗口，不能用永久停止代替自动恢复。
- 工具中的 goal 当前只支持状态变更，不能改写活动 objective；完整任务以本文件逐条追踪。不得为更换标题把未完成目标标成 complete。
