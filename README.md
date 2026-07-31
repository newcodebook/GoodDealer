# GoodDealer

GoodDealer 是面向域名投资人的“本地执行、云端同步”域名资产管理客户端，用于统一管理分散在不同注册商、DNS 服务商和销售平台上的域名。

首发平台为 Windows 与 macOS，技术框架为 Tauri 2 + TypeScript；后续在相同核心模块基础上支持 iOS 与 Android。

## 产品原则

- 域名资产、价格、状态和已脱敏业务记录强制同步到 GoodDealer 服务端，不提供永久关闭或纯本地模式。
- 平台 API 密钥、OAuth Token、Cookie、密码、2FA、Auth Code 和数据库密钥只保存在用户设备。
- GoodDealer 不是代管平台操作凭据或代表用户执行域名操作的 SaaS 服务。
- 用户必须登录账号并通过 License/设备门禁后才能进入业务界面；所有平台合计最多绑定两台设备，任意时刻只有一台拥有业务修改和平台执行权。
- Standby 可以查看 GoodDealer Cloud 已有资产、状态、告警和任务进度，但不能产生 Mutation、读取外部平台、批准或执行任务。
- 服务端承担账号、License、设备绑定、ActiveDeviceLease、业务数据同步和未来用户主动发布的资产展示。
- GoodDealer 内部运营使用独立 Admin Web 与 Staff Admin API；管理员不持有平台秘密、不能直接修改用户业务状态或代表用户访问域名平台。
- 平台连接器可插拔，核心领域逻辑不依赖 Spaceship、Afternic、Atom 或 Cloudflare。
- 支持用户登录授权后的隔离浏览器自动化，为无 API 或 API 不完整的平台提供本地执行能力。
- 所有批量变更都必须可预览、可审计，并允许部分成功与安全重试。

## 首批连接器

| 平台 | 首版职责 | 接入形式 |
| --- | --- | --- |
| Spaceship | 注册商、DNS、SellerHub | API，同步及异步任务 |
| Cloudflare | DNS Zone 与解析记录 | API |
| Atom | 销售列表、价格、状态、分析 | Seller API |
| Afternic | 销售列表和所有权验证 | CSV、状态导入、人工辅助 |

## 文档

- [产品需求](docs/PRODUCT_REQUIREMENTS.md)
- [系统架构](docs/ARCHITECTURE.md)
- [工程结构与模块边界](docs/ENGINEERING_STRUCTURE.md)
- [用户旅程审理基线](docs/USER_JOURNEYS.md)
- [安全模型](docs/SECURITY.md)
- [连接器规范](docs/CONNECTORS.md)
- [浏览器自动化](docs/BROWSER_AUTOMATION.md)
- [同步与冲突语义](docs/SYNC_SEMANTICS.md)
- [操作编排与任务语义](docs/OPERATIONS.md)
- [数据生命周期与恢复](docs/DATA_LIFECYCLE.md)
- [核心 UX 流程](docs/UX_FLOWS.md)
- [License 与商业授权](docs/LICENSING.md)
- [账号、设备与云同步](docs/ACCOUNT_AND_SYNC.md)
- [开发路线图](docs/ROADMAP.md)
- [产品决策记录](docs/OPEN_DECISIONS.md)
- [架构审查处理记录](docs/REVIEW_RESOLUTIONS.md)
- [ADR-0001：采用本地执行的 Tauri 客户端](docs/adr/0001-local-first-tauri.md)（已由 ADR-0004、ADR-0005 修订）
- [ADR-0002：隔离且由用户授权的浏览器自动化](docs/adr/0002-isolated-browser-automation.md)
- [ADR-0004：服务端同步域名业务数据，凭据保持设备本地](docs/adr/0004-cloud-business-data-sync.md)
- [ADR-0005：最多两台绑定且仅一台执行](docs/adr/0005-single-active-device-and-continuity.md)
- [ADR-0006：按运行时与安全边界组织工程结构](docs/adr/0006-runtime-and-security-boundaries.md)
- [ADR-0007：管理员安全边界、Fastify 与本地/云端接口复用](docs/adr/0007-admin-boundary-and-interface-reuse.md)

历史 ADR：

- [ADR-0003：账号门禁、授权与 WebDAV 备份](docs/adr/0003-account-license-and-webdav.md)（Superseded by ADR-0004/0005）

## 当前状态

项目处于需求和架构设计阶段，尚未初始化应用代码。
