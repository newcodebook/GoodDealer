# GoodDealer 架构与产品决策登记

## 读法

本文件记录已接受、可以指导后续实现的产品和架构边界。它不把尚未发生的部署、密钥
创建、提供商资格或发行写成已完成事实。那些事项是按既定策略在真实环境中实例化的外部
交付条件，不是可以由本地源码代替的“待定方案”。

## 已接受的开发决策

| 决策 | 已接受策略 | 定义文档 |
| --- | --- | --- |
| 默认工作区与租户 | 账户完成激活时，服务器在同一事务中创建一个不可替换的个人默认工作区。首发产品只支持该账户拥有的一个工作区；没有邀请、团队成员、所有权转移或客户端选择租户的旁路。`accountId` 与 `workspaceId` 只从服务器端身份和默认绑定导出。 | [ADR-0013](adr/0013-account-default-workspace.md) |
| 生产签名 KMS | 使用自托管 OpenBao Transit；Grant、Lease 和三个审计目的分钥、分策略、固定版本，Cloud 以独立受信公钥复验。应用只使用短期 workload token，软件私钥、静态 root token 和回退签名器一律禁止。 | [ADR-0021](adr/0021-self-hosted-openbao-transit-signing.md) |
| 服务器审计签名 custody | 每个生产环境和审计目的使用独立 OpenBao Transit Ed25519 key；审计服务身份只有针对指定键的签名权。 | [ADR-0014](adr/0014-audit-signer-custody.md) |
| 本地 SQLite 身份与备份源 | 活动工作区由 Rust 所有者以固定 SQLCipher 配置打开；备份只接收与该打开连接绑定的私有不透明能力，绝不接受路径、文件名、VFS 名称或调用方提供的数据库身份。 | [ADR-0015](adr/0015-host-owned-sqlite-backup-source.md) |
| 本地 continuity 与 rebootstrap 资格 | 完整阶段协议仅由 local-storage 私有 `cfg(test)` 后端编译和验证；生产不保留 runtime/custody/database recovery shell，plan facade 在 wire/locks 前拒绝，startup 只做 fixed-resource residue absence gate。启用原生能力前仍须同时具备独立 non-rollbackable anchor、满足全部属性的 true create-only slot-key adapter、safe active-database move detection/custody VFS 和目标平台故障证据。普通 Keychain/upsert、retained-fd 摘要和测试 fake 不构成资格。 | [ADR-0023](adr/0023-installation-bound-gdbk-backup-and-honest-business-restore.md) |
| 本地业务库与 Cloud 边界 | 本地 SQLCipher 是 Desktop 业务权威；Cloud 只拥有账号/授权控制面以及允许字段的同步恢复副本。第三方账号、账号 metadata 和秘密全部禁止同步。 | [ADR-0016](adr/0016-local-business-database-and-cloud-sync-boundary.md) |
| 域名 Provider 能力范围 | 首发目标覆盖项目所需的域名资产生命周期能力，包括 DNS、DNSSEC、Nameserver、注册商操作和监控；非域名产品不在范围。每项能力独立资格化，资金操作逐笔用户确认。当前生产组合仍只有 Cloudflare Zone/DNS 只读观察，新执行路径保持不可用。 | [ADR-0024](adr/0024-domain-provider-capability-coverage-and-financial-confirmation.md) |
| Linux 原生秘密托管 | 启动与登录所需的数据库 key、设备身份、安装绑定、OAuth refresh 与工作区绑定使用 Secret Service；无按应用访问控制，边界等同当前用户会话。Cloudflare 凭据、备份 KEK 与 rebootstrap 写入在 Linux 保持不可用。 | [ADR-0025](adr/0025-linux-secret-service-custody.md) |
| 浏览器产品范围 | 首发产品不包含嵌入式浏览器、DOM 自动化、Cookie/Profile custody、自动登录、下载或上传。需要网页操作时由用户在自己的浏览器中完成；未来引入任何受控浏览器能力必须有新的 ADR。 | [ADR-0017](adr/0017-v1-excludes-browser-automation.md) |
| 运营与首发 Release | 生产采用单区域、受管服务的运行模型，生产、预发布和开发环境严格隔离。首个公开客户发行目标为 `1.0.0` 的 `stable` 渠道，且只在完整首发范围、外部资格和独立批准均具备时发出。 | [ADR-0018](adr/0018-production-operations-and-stable-release.md) |
| 商业计划与支付 | 同一功能档位提供 USD 9.80 月付、USD 98 年付和 USD 498 的 10 年固定期限预付授权；无免费试用；每账号终身唯一的首次 settled acquisition 有 336 小时全额退款窗口，续费不重置，接受即只读；首发只开放 Stripe，PayPal 是不参与首发资格的可选扩展能力；每账号最多一个有效 Provider；优惠不可叠加并由服务端统一映射；价格未含税且只开放合规销售地区。 | [ADR-0020](adr/0020-commercial-entitlement-and-local-access.md) |
| Account Web 身份与邮件 | 注册、邮箱验证/重发、密码登录/恢复、会话查询和退出使用独立 Identity ingress；共享协议不承载秘密。用途隔离的验证码只存 peppered digest，邮件加密进入 durable outbox；登录轮换与退出服务端撤销 Session，密码恢复推进 Security Epoch 并撤销旧会话。开发投递只允许 loopback Mailpit，生产邮件资格完成前保持关闭。 | [ADR-0022](adr/0022-account-identity-and-email-delivery.md) |

## 仅在真实发布时实例化的外部输入

下列输入不是本地功能开发的未决产品设计。它们必须在相应的受控生产变更或发行记录中
填写，并以独立证据证明；在此之前，当前仓库继续保持未部署、未签名和未发布状态。

| 外部输入 | 已定策略 | 当前状态 |
| --- | --- | --- |
| OpenBao 集群/namespace、Transit mount、key/version/kid、公钥批准、workload auth、seal 后端和责任人身份 | 由 Security Custodian 与 Platform Operations Owner 按 ADR-0014/0021 的最小权限和双人批准规则创建；HSM 仅在真实 seal 后端存在时声明。 | 开发单节点实例和 dev key/AppRole 已创建；生产环境输入、HA/HSM、批准和演练尚未创建。 |
| 托管商与数据区域 | 由 Data Governance Owner 与 Platform Operations Owner 按 ADR-0018 选择一个生产区域，并在不可变环境记录中声明。 | 尚未选择或部署。 |
| 具体构件、签名、公证、归档与发行批准 | 只为完成首发范围的干净构件建立 `1.0.0` / `stable` 发行记录；所有证据均绑定该构件。 | `release/release-request.json` 仍为 `unissued`。 |
| Cloudflare 条款审查、受控测试 Zone 和生产观察 | 按连接器规范在发布前完成并归档。 | 尚未资格化，连接器不可执行。 |

## 当前仓库基础

- Cloud 的唯一中央目录按字面顺序注册 25 项 migration（M001–M017、M019、M020、三项 Sync/Observation、Account recovery 及后续 account capability migrations）；M002 拥有不含 Provider 连接身份的
  `workspace_replica_*` 完整副本 schema，M015 是规范化商业领域 greenfield baseline，M016 增加
  Identity refresh recovery，M017 增加 Devices 登录授权加固，M019 建立 Identity transaction
  capability，M020 建立注册 challenge、加密邮件 outbox 和 Identity worker claim；M023 增加密码恢复、
  challenge-bound outbox、bounded dead-letter 和安全 Session 撤销；不存在 M018 compatibility migration。
- Secure Host 公开非秘密 Cloudflare 观察类型（以及 OAuth/授权验签），不包含备份实现或依赖。Local
  SQLCipher key 与 backup 的 authority continuity、GDBK/KEK、rollback-anchor capability、native
  handle/journal、projection、candidate 和 restore 全部由 `local-storage` 的 `DesktopLocalHost` 私有拥有。
  continuity/rebootstrap 完整 runtime/custody/database 阶段仅在 `cfg(test)` true-create-only fake 中编译；
  生产 plan facade 在读取 wire/locks 前 `Unavailable`，startup 固定 presence gate 发现残留即终止 Host
  构造且不解析、不修复、不清理，产品能力保持不可用。
- Desktop 已有具名本地业务、备份和认证命令、完整 SQLCipher 业务 schema、macOS
  Keychain 数据库/device/refresh custody、Native PKCE、带近期 Web 重新认证与同会话约束的首次设备注册、Bearer Grant 拉取与
  build-pinned Grant/Lease 公钥 registry；各后续旅程 Repository 和完整业务 UI 尚待组合。Cloud 已有账号激活、Desktop Grant、billing、OAuth 与
  webhook 边界；独立 Identity 注册/验证/登录 ingress、真实 Account Web session 和 staging Resend
  组合已部署到 `api.gooddealer.com` / `account.gooddealer.com`。无数据库权限测试用户已完成注册、验证、登录、刷新恢复和退出；生产邮件和公开客户注册仍未资格化。
- staging release 已发布并通过真实浏览器旅程；生产发布仍需独立资格与外部配置。
- 隔离开发 VPS 已提供 OpenBao 2.6.2 Transit/TLS/AppRole/audit 集成目标；其单节点、手动 unseal
  和仓库外恢复材料只适用于开发，不能替代生产 OpenBao 或 HSM 资格。

上述源码事实不因本文件的目标决策而改变。
