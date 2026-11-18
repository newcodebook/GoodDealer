# 新对话执行提示词

以下内容可以完整复制到新的 GoodDealer 项目对话。

---

请继续实施 GoodDealer 已接受的产品与架构目标，直接推进代码、客户旅程和验证，不止于评审、计划、文档或能力骨架。

项目目录为 `/home/sean/Programs/GoodDealer`，工程结构调整已完成，以当前 HEAD 为基线。先检查工作区、AGENTS.md
及已有工作线进度；保留其他工作，不 reset、覆盖或混合提交。基线工作区有独立的 Standby Grant 协议增量，位于
`packages/protocol/src/devices/authorization-grant.ts`、`index.ts`、对应测试及 `test-vectors/standby-grant/`。
它可能已在后续提交中完成，先核对，再接续，不能重复开发或把它误认为完整 Standby 功能。

先阅读以下材料，并按涉及的主题读取 ADR 与源码：

- `docs/adr/README.md`：最终决策索引。
- `docs/CURRENT_IMPLEMENTATION.md`：当前实现入口。
- `docs/IMPLEMENTATION_STRATEGY.md`：工作包、依赖与验收方案。
- `docs/ENGINEERING_STRUCTURE_REVIEW.md`：已完成的结构调整与尚未实现的产品能力。
- `docs/PRODUCT_DISCOVERY.md`、`docs/PROVIDER_API_REVIEW.md`：用户事实及接口证据。
- `docs/ROADMAP.md`、`docs/VERIFICATION.md`、`docs/ORCHESTRATION.md` 与执行台账。

最终 ADR 是已确定的目标，源码决定当前事实。普通文档中的历史阶段前置或过时快照不能反过来缩减目标；
遇到冲突核对并更新普通文档，不再把旧方案和实施日志塞回 ADR。

已确认的产品要求不再重复询问：

1. 用户管理约 300 个域名，资产来自 22.cn、易名、阿里云、GoDaddy、Spaceship、Cloudflare。
   核心价值是统一管理、跨市场批量上下架与自动所有权验证。
2. 首发十二平台：Cloudflare、Spaceship、Atom、Afternic、Namecheap、Dynadot、GoDaddy、Porkbun、Sedo、易名、阿里云、22.cn。
   市场优先级为 Afternic → Atom → Spaceship SellerHub → Sedo → 易名 → 阿里云 → 22.cn。
   易名、阿里云、22.cn 都必须交付资产归集和上下架；其余平台与完整能力目录不能静默删除。
3. 已确认官方能力走官方 API。当前未找到官方支持的能力全部直接进入自研私有 HTTP API 开发；社区代码只作参考。
   私有协议调查属于实施步骤，不能等待更多官方搜索或社区成品。端点与行为必须来自当前证据，不能编造。
4. 非资金操作整批预览确认一次，随后自动完成独立平台步骤及验证；费用、出价与其他资金操作仍逐笔确认。
   新增目标、改价或扩大 DNS 范围须重新预览；未知结果先对账，不能盲目重发。
5. 应用运行时后台继续，退出或休眠暂停，重开自动对账续作；不需要 Cloud 代执行 Provider 操作。
6. Windows 与 macOS 均完整支持。既有 unavailable 分支是待实现状态，不能当成产品排除。
7. 独立业务备份和换机云恢复都要交付。独立备份由用户手动选本地位置；旧机与 GoodDealer 云均不可用时，
   用用户自己的恢复材料在新机查看、导出最近一次备份。无需新增自动调度或固定 RPO。
   外部操作仍需当前授权和重新连接凭据；云恢复只承诺最后成功同步的字段。
8. 营销不指导技术架构。商业计划后续可调整，优先保留现有 Licensing 的受控配置、审计与运营空间。

实施方式：

先简要报告已存在的能力、真正缺口和本轮第一个可验证切片，随即动手。按策略文档的实际依赖推进：

- 接续设备授权线：完成 Standby Cloud/Host 合同、签名与角色准入，再打通交接、引导、强制接管和云恢复。
- 推进价值主线：资产归集 + Afternic Listing + 本地父计划 + 必要 DNS/私有验证步骤，形成从真实连接到重启续作的闭环。
  不等待所有 Cloudflare 写能力或整个注册商目录完成；后续市场按已定优先级扩展。
- 推进独立恢复：新版本工件与恢复材料、Native 文件准入、隔离加密数据集、离线查看/导出，再实现有当前授权的业务导入。
  不把安装绑定 v1 当作换机备份，也不把活动库替换的防回滚条件强加给历史备份的隔离读取。
- 两个平台的实际需求验证复用面；不先铺十二个空 Service，不新增通用 Provider 代理、泛化工作流引擎或规则引擎。

遵守所有权：每个平台一个 `secure-host-core` 私有 Service；`local-storage` 拥有业务事务、计划/尝试/结果、
备份与恢复；Cloud 拥有身份、设备、商业和允许字段的副本；Renderer 只传有界业务意图、展示脱敏结果。
保持单一数据库所有者和最终提交栅栏。秘密、Cookie、CSRF、恢复材料与文件 handle 留在 Native；
Provider 账号身份和凭据不进入 Cloud、普通 TypeScript、日志或业务备份。

复用已经完成的工程结构，不重复进行结构重写：

- `active_workspace/business/` 已拆分资产、Provider 观察、读投影、Inbox/Outbox、冲突、checkpoint、数据库、wire 和修复，测试随能力组织；仍只有一个数据库 writer。
- 迁移 `202611180001` 已扩展原资源绑定表：Listing 身份含连接与资源 digest，同域名/连接仅一个未 detached 的绑定，旧 incarnation 保留；Registrar/DNS 仍为单资源约束。实现真实绑定准入、观察归属、代次检查、对账与客户路径，不另建重复的 Listing repository。
- Host 已使用 WorkspaceAuthority 语义，BackupArtifactState 独立表达工件状态，仍共享原 publication mutex 与提交栅栏。备份读取不能推导 Active 执行能力。
- Native Provider facade 的 Cloudflare 私有适配已明确；新平台按相同所有权接入，持久业务状态机仍放在 local-storage。
- Unix custody 的 OS 密钥库实现已提取。Windows custody 仍不可用，需要真正实现加密工作区启动、关闭重开、设备/平台秘密托管与恢复；不能把已有拒绝分支或目录当成交付。

这些调整不代表 Afternic、其他平台、Standby 或跨设备恢复已经实现。直接从用户旅程推进功能，
不建立第二个数据库 writer、通用代理或秘密桥接。
每个切片同时交付严格合同、持久化与迁移、拥有模块实现、真实组合、客户入口及相应测试。
所有外部输入从 unknown 验证；测试覆盖错用途签名、跨租户、代次变化、撤销、并发、崩溃、未知结果和重放。
不改写已应用迁移 SQL；生成物改源后重生成。保持 Windows/macOS 目标一致，原生资格分别取证。

真实账号、会话或设备确实缺失时，只提出当前阻塞步骤的最小需求；秘密通过受限原生流程输入，不索要粘贴到聊天。
继续所有不依赖该条件的工作，准确列出未验证项，不把假数据、测试 fake、空 manifest 或开放开关当作交付。
资金操作遵循逐笔确认，不擅自进行真实付费交易。

完成一个切片后继续下一个已具备条件的切片，不要每完成一个文件就停下来询问是否继续。仅在确有新的产品选择、
信任边界变化或无法取得的外部条件时解释具体阻塞。合理的实现选择自行判断；必要时更新对应主题的最终 ADR。

运行与变更相称的模块和数据库检查，整合时运行根 pnpm check。按仓库规则完成独立审查及目标平台/真实接口验收，
清楚区分源码测试、实际平台验证与发行资格。更新当前实现和执行台账，按完整切片提交本轮拥有的变更。
最终报告真实完成的用户旅程、提交、测试结果、未完成项及下一步，不以“骨架已就绪”替代功能落地。
