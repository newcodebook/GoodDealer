# ADR-0007：管理员安全边界、Fastify 与本地/云端接口复用

状态：Accepted  
日期：2026-07-31
修订：2026-08-03（AdminPurposeRef、跨账号重新认证与可撤销授权上下文）

## 背景

GoodDealer Cloud 不仅需要面向桌面客户端与 account-web 的公开 API，还需要内部运营入口处理账号、License、设备绑定、ActiveDeviceLease、同步健康、合规请求、隔离事件和异步作业。把管理员页面隐藏在 account-web 或让管理员直接查询数据库，会混合用户与 Staff 身份、扩大跨账号数据访问面，并绕过模块所有权与审计。

Cloud 首版是运行在 Node.js LTS、以 PostgreSQL 事务为正确性来源的模块化单体，同时具有 Public HTTP、Admin HTTP 和 Jobs 三类入口。它需要成熟的请求生命周期、结构化日志、Schema/OpenAPI、上传下载和长期运行的连接池管理；当前没有必须部署到边缘 Worker 的约束。

本地 Active Workspace 与 Cloud Workspace 存储相似的域名业务概念，但两者分别承担本地事务/Outbox 与多租户 Mutation/Revision 语义。Active 和 Standby 又需要向 UI 提供尽可能一致的只读体验，因此必须明确哪些接口可以共享，哪些复用会破坏运行时与安全边界。

## 决策

### 独立 Staff 管理边界

- 新增 `apps/admin-web`，使用独立域名、构建产物、Session Cookie、CSP 和 CSRF 策略；它不是 account-web 的隐藏路由或角色切换模式。
- 新增 `apps/cloud/src/entrypoints/admin-http.ts`，作为独立 Admin API Composition Root；可以与 Public API 共用构建产物和业务模块，但可独立进程/端口部署。
- 新增 Cloud `admin-access` 模块，拥有 StaffIdentity、StaffSession、Role/Scope 和管理授权判定，不复用客户账号 Session。
- 正式环境 Staff 登录要求 Passkey 或企业 SSO。客户账号“不强制 2FA”的产品决定不适用于内部管理员。
- 首版只有一名管理员（Owner）并强制 Passkey；Role/Scope 结构保留但只签发 Owner 身份。首版不做多角色职责分离或多人审批，未来增加 Staff 时重新启用。
- Admin API 只能调用业务模块显式公开的 Admin Application Port，不得直接注入 Repository、共享 ORM Entity 或执行跨模块 SQL。
- 所有管理操作记录 Staff actor、Scope、原因、工单标识和前后摘要；AuditEvent 由 Cloud `audit` 模块拥有。
- 首版 SupportCase 使用外部 Helpdesk，GoodDealer 只保存可信 SupportCaseReference、账号关联、外部 revision/同步水位、映射后的必要状态和审计；跨账号访问不要求用户逐次授权，但业务明细读取与修改必须有 Scope、理由、判别联合 `AdminPurposeRef` 和新鲜 Passkey 重新认证。
- 跨账号明细读取消费独立短期 `AdminReadAuthorization`，绑定 actor/Staff Security Epoch、Tenant/目标及目标 `account_security_epoch`、字段/实体 Scope、规范 Query Shape Hash、AdminPurposeRef 状态/revision、重新认证证明与有效期；每次请求复验且不能兑换写授权。异步管理动作引用独立 `AdminActionAuthorization`，绑定 Tenant/目标、目标客户 `account_security_epoch`、命令参数 Hash、命令相关 Aggregate Revision、Owner actor、Staff Security Epoch、Scope 快照、AdminPurposeRef 状态/revision、重新认证时间、有效期、消费/幂等与取消状态；删除、设备、License 命令分别额外绑定 `deletion_epoch`、`credential_epoch`、`entitlement_revision`，执行/重放时全部复验，并持久化前后摘要。`admin-access` 只授权，具体 Repair Command 由目标业务模块拥有。
- 管理员不能获取平台 API Key、Cookie、Browser Profile、本地数据库密钥或备份秘密，不能创建用户 Desired State、SyncMutation、ApprovedOperation，也不能代表用户访问域名平台。
- 云端元数据修复必须使用模块拥有的受控 Repair Command，不能把数据库管理工具包装成产品功能。

首版管理范围包括账号/设备/License 查询、Lease 与同步诊断、Checkpoint/Candidate/隔离事件查看、合规请求、作业状态、版本通道、连接器政策与功能开关。跨账号业务数据访问遵循最小权限、理由记录和审计。

### Cloud HTTP 框架

- Public HTTP 与 Admin HTTP 首版统一使用 Fastify，但分别创建实例和 Composition Root，不共享认证 Hook 或自动注册全部 Route。
- `entrypoints/jobs.ts` 直接调用模块 Application Port，不依赖 Fastify、HTTP Request 或 Web 中间件上下文。
- Route Adapter 只负责认证、协议校验、错误映射和调用 Application Port，业务规则不进入 Fastify Plugin。
- 使用 Zod/JSON Schema 适配与 OpenAPI/契约测试保持 protocol、Route 和消费者一致。

Hono 暂不采用。只有明确出现 Cloudflare Workers 等边缘运行时、Web Standard 多运行时或冷启动目标后才重新评估；首版不同时维护两套 HTTP 框架。

### 管理协议

- 首版在单一 `@gooddealer/protocol` 包中增加 `/admin` 子路径，包含 Staff Admin DTO、Scope、错误码和兼容转换。
- import-boundary 禁止 desktop、account-web、client-core、cloud-client 和连接器导入 `/admin`；只有 admin-web、admin-http 和相应契约测试可以使用。
- 当 Admin API 出现独立发布、权限隔离或版本节奏后，再考虑拆为独立 admin-protocol 包。

### 本地与 Cloud 的共享边界

允许共享：

- protocol 中的 Workspace Entity DTO、ID、枚举、字段分类和错误码。
- Mutation、Revision、Cursor、Checkpoint、Candidate 与脱敏事件 Schema。
- Schema Version、兼容转换、确定性序列化 Codec 和 Anti-Entropy Golden Test Vector。
- 经证明在两端语义完全相同的纯函数；必须放入命名具体的能力模块，不创建 shared/common/utils 杂物包。

client-core 定义宿主无关的只读 Query Port。Active 使用 Local Query Adapter，Standby 使用 Cloud Query Adapter；Desktop Composition Root 按 RuntimeMode 注入。查询结果必须携带数据来源、Server Revision、最后云同步时间、最后平台读取时间和 `can_edit`。共享 Query Port 只返回可同步的非秘密业务投影；DeviceCredentialBindingStatus、Browser automation 非秘密编排状态和本地 Artifact 使用模式限定的专用 Port，DeviceCredentialCandidateStatus 使用独立本机 Standby-safe Port 且仅返回三态提示。Browser Profile 原件、Ref、health、generation、sequence、Keychain 状态与 HostCredentialBinding 只在 Host 内消费，不进入任何普通 Query Port。

禁止共享：

- Local/Cloud Repository 接口、ORM Entity、数据库 Schema 和 Migration。
- SQLite/PostgreSQL 事务实现、Outbox/Queue/WAL 内部结构和 Device Secret。
- 用同一个通用 CRUD 方法在 Active 写本地、Standby 写 Cloud。
- 绕过 RuntimeMode、ActiveDeviceLease、本地事务或 Outbox 的远程 UI 写入。

Active 写操作始终先在本地事务提交业务状态和 Outbox，再异步上传 SyncMutation；Standby 不提供写实现。Cloud Mutation API 是同步协议而不是 UI 的远程 Repository。

## 结果

优点：

- Staff 跨账号权限与普通用户会话物理、协议和部署边界清晰。
- 管理工具复用 Cloud 模块能力，但无法绕过模块 Repository 与审计。
- Fastify 满足首版 Node/PostgreSQL/长运行服务需求，Jobs 保持框架无关。
- Active/Standby 可以复用页面和查询语义，同时保留本地正确性来源与 Standby 只读门禁。
- DTO、Codec 和 Golden Vector 复用降低本地/Cloud 物化偏移风险。

代价：

- Public/Admin Route、Session、Scope 和测试需要双套 Composition Root。
- Local/Cloud Adapter 需要分别实现 Query Port，不能通过通用 Repository 减少代码量。
- protocol/admin 需要严格 import-boundary，避免进入普通客户端依赖图。

## 不采用的方案

### 在 account-web 中隐藏管理员路由

不采用。它会混合用户与 Staff Session、构建产物、Cookie 和 CSP，并增加权限配置错误影响普通用户的风险。

### 管理员直接访问数据库

不采用。直接 SQL 绕过模块规则、租户隔离、Repair Command 和 Staff 审计，只保留为严格受控的基础设施应急流程，不是管理员产品能力。

### 首版采用 Hono 或同时维护 Hono/Fastify

不采用。当前正确性和运维模型以 Node.js LTS、PostgreSQL 事务和后台作业为中心，没有边缘运行时收益足以抵消两套框架成本。

### 本地与 Cloud 共用 Repository/CRUD

不采用。两端的事务、权限、租户、Revision、Outbox 和秘密字段语义不同，共用接口会形成可选参数堆积并弱化 RuntimeMode 门禁。

相关工程规则见 [工程结构与模块边界](../ENGINEERING_STRUCTURE.md)，安全要求见 [安全模型](../SECURITY.md)，运行时架构见 [系统架构](../ARCHITECTURE.md)。
