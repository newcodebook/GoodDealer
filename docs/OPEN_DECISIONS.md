# GoodDealer 架构与产品决策登记

## 读法

本文件记录已接受、可以指导后续实现的产品和架构边界。它不把尚未发生的部署、密钥
创建、提供商资格或发行写成已完成事实。那些事项是按既定策略在真实环境中实例化的外部
交付条件，不是可以由本地源码代替的“待定方案”。

## 已接受的开发决策

| 决策 | 已接受策略 | 定义文档 |
| --- | --- | --- |
| 默认工作区与租户 | 账户完成激活时，服务器在同一事务中创建一个不可替换的个人默认工作区。首发产品只支持该账户拥有的一个工作区；没有邀请、团队成员、所有权转移或客户端选择租户的旁路。`accountId` 与 `workspaceId` 只从服务器端身份和默认绑定导出。 | [ADR-0013](adr/0013-account-default-workspace.md) |
| 服务器审计签名 custody | 每个生产环境和审计目的使用独立、不可导出的受管 KMS/HSM 非对称密钥。审计服务身份只有针对指定键的签名权；软件私钥、开发者密钥和回退签名器一律禁止。 | [ADR-0014](adr/0014-audit-signer-custody.md) |
| 本地 SQLite 身份与备份源 | 活动工作区由 Rust 所有者以固定 SQLCipher 配置打开；备份只接收与该打开连接绑定的私有不透明能力，绝不接受路径、文件名、VFS 名称或调用方提供的数据库身份。 | [ADR-0015](adr/0015-host-owned-sqlite-backup-source.md) |
| 本地业务库与 Cloud 边界 | 本地 SQLCipher 是 Desktop 业务权威；Cloud 只拥有账号/授权控制面以及允许字段的同步恢复副本。第三方账号、账号 metadata 和秘密全部禁止同步。 | [ADR-0016](adr/0016-local-business-database-and-cloud-sync-boundary.md) |
| 首个提供商能力 | 首发唯一的提供商连接是 Cloudflare API 的只读 Zone/DNS 观察，使用用户创建且仅限 `Zone:Read`、`DNS:Read` 的 Token。实现由私有 Cloudflare Service 独占并自主维护 endpoint、Provider wire、Credential Fence、Transport、闭合错误与领域映射。没有提供商写入、注册商/市场连接、抓取或浏览器回退。 | [连接器规范](CONNECTORS.md) |
| 浏览器产品范围 | 首发产品不包含嵌入式浏览器、DOM 自动化、Cookie/Profile custody、自动登录、下载或上传。需要网页操作时由用户在自己的浏览器中完成；未来引入任何受控浏览器能力必须有新的 ADR。 | [ADR-0017](adr/0017-v1-excludes-browser-automation.md) |
| 运营与首发 Release | 生产采用单区域、受管服务的运行模型，生产、预发布和开发环境严格隔离。首个公开客户发行目标为 `1.0.0` 的 `stable` 渠道，且只在完整首发范围、外部资格和独立批准均具备时发出。 | [ADR-0018](adr/0018-production-operations-and-stable-release.md) |

## 仅在真实发布时实例化的外部输入

下列输入不是本地功能开发的未决产品设计。它们必须在相应的受控生产变更或发行记录中
填写，并以独立证据证明；在此之前，当前仓库继续保持未部署、未签名和未发布状态。

| 外部输入 | 已定策略 | 当前状态 |
| --- | --- | --- |
| KMS/HSM 的具体租户、键标识和责任人身份 | 由 Security Custodian 与 Platform Operations Owner 按 ADR-0014 的最小权限和双人批准规则创建。 | 尚未创建。 |
| 托管商与数据区域 | 由 Data Governance Owner 与 Platform Operations Owner 按 ADR-0018 选择一个生产区域，并在不可变环境记录中声明。 | 尚未选择或部署。 |
| 具体构件、签名、公证、归档与发行批准 | 只为完成首发范围的干净构件建立 `1.0.0` / `stable` 发行记录；所有证据均绑定该构件。 | `release/release-request.json` 仍为 `unissued`。 |
| Cloudflare 条款审查、受控测试 Zone 和生产观察 | 按连接器规范在发布前完成并归档。 | 尚未资格化，连接器不可执行。 |

## 当前仓库基础

- Cloud 的唯一中央目录按字面顺序注册 M001–M014；M002 拥有不含 Provider 连接身份的
  `workspace_replica_*` 完整副本 schema，M014 拥有默认工作区控制面。
- Secure Host 公开窄备份和非秘密 Cloudflare 观察类型；私有 Cloudflare 只读 Service 尚未组合为
  Tauri 业务 Command 或真实 Provider 路径。Local backup 只输出固定不可用证据。
- Desktop 已有三个窄本地业务命令和完整 SQLCipher 业务 schema；授权会话注入、OS 密钥保管、
  各未来旅程 Repository 和完整业务 UI 尚待组合。Cloud 公共业务路由和周期作业为空。
- Browser 自动化不可用，release 请求未发布且不具资格。

上述源码事实不因本文件的目标决策而改变。
