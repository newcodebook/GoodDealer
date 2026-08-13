# GoodDealer 产品决策记录

状态：Closed D-series Archive
更新日期：2026-08-05

以下 D 系列产品决策已由产品负责人确认，并已转入正式需求与专题设计。当前产品决策状态的唯一入口是 [USER_JOURNEYS.md §7](USER_JOURNEYS.md#7-产品决策状态)；Gate 的实现与证据状态仍以 [PHASE0_GATE_REGISTER.md](phase0/PHASE0_GATE_REGISTER.md) 为准。

## D-001 浏览器会话默认模式

决定：桌面默认持久会话，同时在连接时明显提供“私密会话”选项。

- 持久会话体验好，但 Cookie 安全依赖 OS 用户隔离。
- 私密会话关闭即清除，安全更强但需重复登录。

状态：Closed / Accepted。

## D-002 License 过期后的软件访问

决定：不设置客户端资产保护例外。订阅过期且离线宽限结束后不能进入主界面，也不能通过客户端查看、导出、备份、恢复或执行紧急下架。本地数据不删除，续费并取得有效授权后恢复访问。

账号网页端的合规数据导出、删除以及会话/设备安全管理不属于授权业务功能，License 过期后继续提供；网页导出只覆盖服务端实际持有的数据。

应用需要账号系统，用户必须先登录并通过设备与授权门禁才能进入主界面。

状态：Closed / Accepted。

## D-003 双设备与云同步策略

决定：日常账号/Cloud 路径强制启用云同步，不提供永久关闭或可选纯本地模式。一个账号在 Windows、macOS、iOS、Android 合计最多绑定两台设备，但任意时刻只有一台 Active 设备拥有 Mutation、平台读取、批准和执行权。Standby 可以进入 Cloud Read-Only View 查看 GoodDealer Cloud 已有数据，但不能修改业务数据或访问平台。D-010 的正式停服 LocalContinuation 是域分离的独立 Sunset 路径，不属于该双设备策略。

活动设备使用 ActiveDeviceLease 和单调递增的 `lease_epoch`。GoodDealer 云故障时允许继续平台读写最多 24 小时；正常切换先分别冲刷 Mutation、ExecutionFact、Workspace-scope DeviceAuditEvent 并通过签名 handoff DrainManifest 后释放 Lease，Account-scope DeviceAuditEvent 独立续传且不阻塞 handoff；强制切换必须等待旧设备离线许可到期。

域名资产和非秘密业务数据强制同步到 GoodDealer 服务端并允许服务端读取；API Key、OAuth Token、Cookie、Auth Code、Browser Profile 和数据库密钥只留在设备本地。

原生云同步负责日常多设备一致性；产品只提供用户主动操作的本地加密备份导出/恢复，不集成第三方远程备份服务。未来域名资产展示必须由用户显式选择发布内容。

状态：Closed / Revised on 2026-07-31。原备份交接方案由 [ADR-0004](adr/0004-cloud-business-data-sync.md) 取代。

## D-004 终身 License 的升级权益

决定：终身 License 包含所有未来大版本。

状态：Closed / Accepted。

## D-005 首发语言

决定：从 `MVP-Core` 建立 i18n 基础，正式版同时提供简体中文和英文。

状态：Closed / Accepted。

## D-006 浏览器自动化的平台政策

决定：保留逐平台 ToS、robots 和账户政策评估及风险记录，但不把它设为统一的连接器发布硬门槛。

具体流程仍不得绕过 CAPTCHA、访问控制或平台安全机制；发现明确禁止、封号或资产风险时由产品逐项决定降级、提示或停用。

状态：Closed / Accepted。

## D-007 云端业务数据可见性

决定：域名、价格、成本、Listing、状态和脱敏业务记录不做端到端加密，GoodDealer 服务端可以读取、查询并用于同步及未来产品能力。HTTPS、数据库/磁盘和备份静态加密仍为强制基线。

同步不自动公开；公开展示使用用户显式选择的独立 Publication Projection。

状态：Closed / Accepted。

## D-008 单执行设备与移动端额度

决定：Windows、macOS、iOS 和 Android 共享同一个“两台绑定、一台活动”额度，不为移动端预留额外席位。移动端发布时如需改变额度，必须形成新的商业决策并更新既有用户权益说明。

状态：Closed / Accepted。

## D-009 GoodDealer 账号认证复杂度

决定：采用消费级常规安全，包括邮箱验证、安全密码哈希、限流、Refresh Token 轮换、会话/设备管理和可选 Passkey。不提供强制 2FA、TOTP、恢复码或企业组织安全策略。域名平台自身的 2FA/CAPTCHA 不受此决定影响。

状态：Closed / Accepted。

## D-010 终身授权停服延续

决定：永久停运时向终身用户及停服时订阅有效的用户提供本地延续版本或永久离线凭证。使用独立 Sunset Signing Key，最终 `LocalContinuation` 取消账号、设备 Lease 和云同步依赖，并在停服前提供云端全量数据下载。LocalContinuation 的平台能力只使用域分离的 `SunsetAuthorization`/`SunsetApprovedOperation`，浏览器路径再使用 `SunsetBrowserSessionAccessContext`/`SunsetAutomationExecutionTicket`，并绑定本机可信时间、设备 Key、runtime/Sunset credential generation 与所选 HostCredentialBinding 或 Browser Profile generation；连接建立使用不要求健康凭据且不能业务提交的 `credential_source=none` 变体，不伪造或绕过日常 ActiveDeviceLease。

状态：Closed / Accepted。

## D-011 Standby 云端只读与移动端定位

决定：单活动设备是“单执行设备”，不是“单查看设备”。License 有效且仍绑定的 Standby 获得账号管理和 `workspace:read`，可以查看服务端已有资产、价格、状态、告警和任务进度；ActiveDeviceLease 独占 `workspace:mutate`、`platform:read`、`platform:write` 和 `operation:approve`。

移动端 Standby 支持查询、告警、计划审阅、发起切换和紧急平台官网人工处置引导。“审阅”不形成 ApprovedOperation；正式批准、经批准的平台紧急下架执行、平台刷新和编辑必须先切换为 Active。首版不提供无人值守紧急下架；未来若提供 RemoteApprovalToken 或无人值守能力，必须另行进行产品与安全决策。

状态：Closed / Accepted。

## D-012 管理员后台、Cloud HTTP 框架与接口复用

决定：GoodDealer 提供独立 `admin-web` 与 Staff Admin API，不把管理员功能隐藏在 account-web。StaffIdentity、Session、Passkey/企业 SSO、Role/Scope、Cookie、CSP、CSRF 和审计与用户账号分离；管理员不能获取平台秘密、直接修改用户 Desired State、创建 ApprovedOperation 或代表用户访问域名平台。

Public HTTP 与 Admin HTTP 首版采用 Fastify 的独立 Composition Root，Jobs 保持 HTTP 框架无关；没有明确边缘运行时需求前不采用 Hono 或同时维护两套 HTTP 框架。

本地与 Cloud 共享 protocol DTO/Schema/版本转换/确定性 Codec，并通过 client-core 只读 Query Port 统一 Active/Standby 页面查询。Local/Cloud Adapter、Repository、ORM、Migration、事务和写接口保持分离；Active 写入仍以本地事务和 Outbox 为正确性来源，Standby 不提供写实现。

2026-07-31 补充：首版只有一名管理员（Owner），Role/Scope 结构保留但仅签发 Owner 身份；跨账号访问业务数据不要求用户逐次授权，以 Scope + 理由/工单 + Staff AuditEvent 为控制；单管理员模式下不设多人审批，高风险操作以重新认证与审计控制。

状态：Closed / Accepted by [ADR-0007](adr/0007-admin-boundary-and-interface-reuse.md)。

## D-013 本地备份中的平台凭据

决定：首版只维护一种版本化加密备份包，不增加独立 Credential Vault 文件格式。

- “包含平台 API 凭据”为用户显式开关，默认关闭；允许迁移的 API/OAuth 凭据作为同一包内的独立加密区段，并在 Manifest 中逐项列明。
- Browser Profile、Cookie、Local Storage、设备签名私钥、ApprovedOperation、AutomationExecutionTicket、GoodDealer Auth/Entitlement/OfflineDeviceLease/ActiveDeviceLease、数据库 Master Key 明文和 Recovery Secret 永不进入备份。
- 恢复凭据时写入当前设备的新 Keychain 条目并重新健康检查，不恢复旧设备身份、批准、Lease 或执行权。

状态：Closed / Accepted。

## D-014 首版客服工单系统

决定：首版不自建完整客服工单系统，接入外部 Helpdesk。

- GoodDealer 内部只保存可信 SupportCaseReference、账号关联、必要状态和 Staff AuditEvent，不复制外部工单的全部消息或附件。
- Helpdesk 不接收平台 API Key、Cookie、Browser Profile、Recovery Secret、未脱敏诊断包或不必要的完整域名资产清单。
- DataRightsRequest 与 SecurityIncident 仍由 GoodDealer 内部领域模块拥有，不能由外部 SupportCase 状态代替。
- 首版单 Owner 的跨账号访问继续遵循 D-012：Scope、理由/AdminPurposeRef、重新认证与审计；不要求用户逐次授权，也不设置多人审批。

状态：Closed / Accepted。

## D-015 同步备份与紧急本地快照

决定：首版使用同一种版本化加密容器，提供两种语义不同、必须显式标识的备份工件。

- `SynchronizedBackup` 创建前必须通过 Mutation、ExecutionFact、Workspace-scope DeviceAuditEvent 三流 `DrainProof(purpose=synchronized_backup)`；其 `synchronized_snapshot_binding` 绑定 Server Revision 与本地提交序号，Backup Manifest 引用确切 `proof_id + proof_digest`，并与逐流连续确认水位、短写门禁和 SQLite 一致性读取源共享同一冻结边界。Account-scope DeviceAuditEvent 不在该 Workspace 快照证明中；该 Proof 不得绑定 DeviceSwitchRequest，也不能释放 Lease 或推进 Epoch。
- `EmergencyLocalSnapshot` 仅在 GoodDealer Cloud 不可达或排空失败时由用户主动创建；它可以保存尚未同步的白名单业务投影，但恢复时这些差异只能形成 RestoreCandidate，不得回放旧 Outbox、Queue、批准、Ticket 或执行权。
- 两种工件都从一致性读取源生成字段级白名单 `BackupExportSchema`。SQLite Backup API 只用于建立一致性读取源，完整 Active Workspace、SQLCipher 数据库、WAL、锁文件和运行时表不得成为最终备份 Payload。
- 平台凭据仍遵循 D-013 的默认关闭独立加密区段；Browser Profile、设备身份、GoodDealer Auth/Entitlement/Lease、原始验证挑战和运行时恢复能力永不进入备份。

状态：Closed / Accepted。

## D-016 首版紧急下架保持人工批准

决定：首版不承诺无人值守售出发现，也不允许无人值守平台执行。当前 Active 应用仅在用户主动刷新或其他已批准业务读取本来就要访问平台时形成 SaleSignal；形成后立即生成 `Priority-0 Asset Protection` 计划，但每次执行仍需用户查看差异并签署 ApprovedOperation。`Priority-0` 只承诺 SaleSignal 形成后的优先调度，不承诺用户未运行应用时的发现时延。

后台周期轮询、OS 后台唤醒、Cloud Relay、Standing Emergency Policy、RemoteApprovalToken 和无人值守执行均不属于首版。未来引入其中任一能力都必须建立新的产品与安全决策，不能复用本决定扩权。

状态：Closed / Accepted。

## D-017 Lifetime 停服兑现与 Sunset 密钥运营

决定：首版不采购外部商业托管。Sunset Root/Signing Key 与日常生产、CI 和在线控制面隔离，使用离线硬件介质保存；恢复材料至少跨两个物理地点，以 2-of-3 管理控制启用。每个正式版本都准备可验证的 LocalContinuation 制品、离线签发材料和恢复 Runbook，每年至少完成一次完全脱离生产服务的恢复、签发与导入演练。

Lifetime SKU 只有在最近一次演练通过、离线材料可恢复且商业条款完成披露时才允许销售。承诺范围是最后可用版本的本地延续、数据访问/导出和当时仍可工作的本地平台能力，不承诺永久兼容未来 OS、第三方 API、网页结构或平台政策。

状态：Closed / Accepted。

## D-018 删除、保留与数据导出期限

决定：账号删除在验证后立即冻结危险写入，并提供 7 天可撤销冷静期；冷静期结束后，主库、搜索、对象存储、分析副本和外部 Helpdesk 的可删除内容须在 30 天内清除或取得带法律依据的保留回执。PITR 与隔离备份最长保留 35 天，恢复前必须应用 AntiResurrectionLedger；导出下载链接保留 7 天。

普通 Support 内容在工单关闭后保留 180 天；账号删除的 30 天清除期限优先于该普通保留期，除非存在显式 Legal Hold。最小化安全与访问审计保留 365 天；支付、税务和法定会计事实与业务内容分离并限制访问，保留 7 年。AntiResurrectionLedger 只保存不可逆最小标识和删除水位，至少覆盖最长可恢复窗口加 30 天，初始保留 90 天。Legal Hold 必须逐对象记录依据、范围、Owner、复核时间和到期条件，不允许隐含永久保留。目标市场的强制法律优先，Privacy/Legal 在商业上线前复核本矩阵。

状态：Closed / Accepted。

## D-019 生产可靠性与备份兼容目标

决定：Account、License 与 Cloud Sync API 的初始月度可用性 SLO 为 99.5%；用户设备、本地平台操作以及第三方 Registrar、Marketplace、DNS 或网络服务不计入该 Cloud SLO。生产数据目标为 RPO 15 分钟、RTO 4 小时，PITR 保留 35 天，每季度至少完成一次恢复演练。Priority-0 告警目标为 15 分钟内确认；重大事故提供状态通告和事后报告。首期只承诺 SLO，不提供赔付型 SLA。

用户备份导入支持当前及前两个 Major，并至少覆盖最近 24 个月产生的受支持 Schema；更旧备份只通过仍受支持的中间版本迁移或人工恢复处理，不承诺最新版直接读取任意历史格式。

状态：Closed / Accepted。

## D-020 支付、退款与 Entitlement 商业映射

决定：首个支付接入使用 Paddle Merchant of Record，领域模型和 ProviderPaymentEvent Adapter 保持供应商中立。订阅续费失败进入 7 天 `grace`，宽限内付款成功恢复 `active`，宽限结束仍失败转 `suspended`；取消在当前已付周期结束生效且不自动退款；升级在补差价确认后立即生效，降级在下一续费周期生效。

首次购买默认提供 14 天全额退款窗口，但服从销售地强制法律和数字内容规则。部分退款默认只改变支付余额，不改变 Entitlement；只有明确 Provider 原因码或受审计 ManualEntitlementAdjustment 才改变权益。已确认拒付或欺诈零宽限并立即 `suspended`，不得把普通支付失败归为欺诈。Lifetime 全额退款撤销 Lifetime Entitlement；部分退款默认不撤销。退款、拒付和人工调整均追加事实，不改写既有 ProviderPaymentEvent。

日常 Entitlement Token 有效期为 30 天并在剩余 7 天进入刷新窗口；OfflineDeviceLease 有效期为 30 天并在剩余 7 天进入续签窗口；ActiveDeviceLease 的平台离线执行上限独立保持 24 小时。

状态：Closed / Accepted。

## D-021 首发 Cloud 区域、环境隔离与 KMS/IaC

决定：首个生产处理区域为 AWS `ap-southeast-1`（新加坡），加密灾备副本位于 AWS `ap-southeast-2`（悉尼）；隐私说明、DPA、子处理者清单和删除传播必须披露新加坡到悉尼的复制。首版不承诺中国大陆境内数据驻留，也不接受强制境内驻留的客户；EU/EEA 用户进入前必须完成适用的 DPA、SCC、跨境机制与供应商清单复核。

Development 只允许 Fixture 和纯员工合成数据。Development、Staging、Production 使用独立云账号、网络、数据库、对象存储、IAM、KMS Key 与密钥管理员；生产数据不得复制或恢复到更低信任环境。Cloudflare 等边缘层只用于 DNS、TLS、WAF 和无状态转发，不作为未披露的持久业务数据区。

版本库中的 IaC 是基础设施唯一事实源。Cloud Platform 负责拓扑和可重跑证据，Security 审批 IAM/KMS，Privacy/Legal 审批驻留、跨境与子处理者，Product 批准市场范围。主库 Multi-AZ、PITR、备份、删除回执和 KMS 轮换 Runbook 在首份真实数据进入前启用；KMS 至少每年轮换一次并支持紧急轮换。

状态：Closed / Accepted。
