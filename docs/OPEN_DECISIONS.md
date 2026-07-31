# GoodDealer 产品决策记录

状态：Closed  
更新日期：2026-07-31

以下产品决策已由产品负责人确认，并已转入正式需求与 ADR。

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

决定：云同步强制启用，不提供永久关闭或纯本地模式。一个账号在 Windows、macOS、iOS、Android 合计最多绑定两台设备，但任意时刻只有一台活动设备拥有 Mutation、平台读取、批准和执行权。Standby 可以进入 Cloud Read-Only View 查看 GoodDealer Cloud 已有数据，但不能修改业务数据或访问平台。

活动设备使用 ActiveDeviceLease 和单调递增的 `lease_epoch`。GoodDealer 云故障时允许继续平台读写最多 24 小时；正常切换先上传 Outbox 并释放 Lease，强制切换必须等待旧设备离线许可到期。

域名资产和非秘密业务数据强制同步到 GoodDealer 服务端并允许服务端读取；API Key、OAuth Token、Cookie、Auth Code、Browser Profile 和数据库密钥只留在设备本地。

原生云同步负责日常多设备一致性；产品只提供用户主动操作的本地加密备份导出/恢复，不集成第三方远程备份服务。未来域名资产展示必须由用户显式选择发布内容。

状态：Closed / Revised on 2026-07-31。原备份交接方案由 [ADR-0004](adr/0004-cloud-business-data-sync.md) 取代。

## D-004 终身 License 的升级权益

决定：终身 License 包含所有未来大版本。

状态：Closed / Accepted。

## D-005 首发语言

决定：P0 建立 i18n 基础，正式版同时提供简体中文和英文。

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

决定：永久停运时向终身用户及停服时订阅有效的用户提供本地延续版本或永久离线凭证。使用独立 Sunset Signing Key，最终 `LocalContinuationMode` 取消账号、设备 Lease 和云同步依赖，并在停服前提供云端全量数据下载。

状态：Closed / Accepted。

## D-011 Standby 云端只读与移动端定位

决定：单活动设备是“单执行设备”，不是“单查看设备”。License 有效且仍绑定的 Standby 获得账号管理和 `workspace:read`，可以查看服务端已有资产、价格、状态、告警和任务进度；ActiveDeviceLease 独占 `workspace:mutate`、`platform:read`、`platform:write` 和 `operation:approve`。

移动端 Standby 支持查询、告警、计划审阅、发起切换和紧急平台官网人工处置引导。“审阅”不形成 ApprovedOperation；正式批准、自动紧急下架、平台刷新和编辑必须先切换为 Active。未来若提供 RemoteApprovalToken，必须另行进行产品与安全决策。

状态：Closed / Accepted。

## D-012 管理员后台、Cloud HTTP 框架与接口复用

决定：GoodDealer 提供独立 `admin-web` 与 Staff Admin API，不把管理员功能隐藏在 account-web。StaffIdentity、Session、Passkey/企业 SSO、Role/Scope、Cookie、CSP、CSRF 和审计与用户账号分离；管理员不能获取平台秘密、直接修改用户 Desired State、创建 ApprovedOperation 或代表用户访问域名平台。

Public HTTP 与 Admin HTTP 首版采用 Fastify 的独立 Composition Root，Jobs 保持 HTTP 框架无关；没有明确边缘运行时需求前不采用 Hono 或同时维护两套 HTTP 框架。

本地与 Cloud 共享 protocol DTO/Schema/版本转换/确定性 Codec，并通过 client-core 只读 Query Port 统一 Active/Standby 页面查询。Local/Cloud Adapter、Repository、ORM、Migration、事务和写接口保持分离；Active 写入仍以本地事务和 Outbox 为正确性来源，Standby 不提供写实现。

2026-07-31 补充：首版只有一名管理员（Owner），Role/Scope 结构保留但仅签发 Owner 身份；跨账号访问业务数据不要求用户逐次授权，以 Scope + 理由/工单 + Staff AuditEvent 为控制；单管理员模式下不设多人审批，高风险操作以重新认证与审计控制。

状态：Closed / Accepted by [ADR-0007](adr/0007-admin-boundary-and-interface-reuse.md)。
