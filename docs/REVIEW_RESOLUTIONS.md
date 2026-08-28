# 当前架构审查处理结论

## 目的与权威

本台账记录已纳入当前架构的处理结论，不保留已被替代的串行工作指令。ADR-0013 至 ADR-0018 保持决策权威；[ROADMAP.md](ROADMAP.md) 是唯一 v1 能力/依赖矩阵，[PHASE0_EXECUTION_PLAN.md](phase0/PHASE0_EXECUTION_PLAN.md) 协调本地工作包，[PHASE0_GATE_REGISTER.md](phase0/PHASE0_GATE_REGISTER.md) 只记录外部资格。

当前源码优先于普通说明。本台账不声称任何客户、Desktop 或 Cloud v1 能力已经组合；需要作出当前组合或就绪主张时，必须重新核验拥有源码。

## 当前处理结论

| 主题 | 当前结论 | 外部资格边界 |
| --- | --- | --- |
| v1 范围与本地协调 | Cloud 账号/授权控制面、本地域名资产业务库、脱敏同步恢复和 Host-local Cloudflare API-only read 按各自合同汇合。 | 外部资格不是这些本地工作启动、继续或本地验收的前提。 |
| 当前组合主张 | 尚不对客户、Desktop 或 Cloud v1 能力作出已组合主张。 | 本地测试只能说明其精确的本地行为，不能说明部署、客户可用或 Gate closure。 |
| A：账户/个人默认工作区 | ADR-0013 的服务器导出范围和原子创建约束由 A1/A2 实现，不扩展到团队、多工作区、所有权转移或凭据迁移。 | `Q-OPS` 只在声称受管/已部署账户能力时适用。 |
| P：本地域名资产 | 本地 SQLCipher 是读写权威；业务事务与 secret-free Outbox 原子提交，Cloud 仅是同步恢复副本。 | `Q-OPS` 只在声称已部署同步服务时适用。 |
| C：Cloudflare 只读观察 | Provider 账号、账号 metadata、Token 与执行全在本地 Host；Cloud Observation client/repository 已移除，M002 只保留脱敏副本。 | `Q-CF` 只在声称真实提供商观察/可用性时适用。 |
| Desktop 源图范围一致性 | 当前生产入口只使用窄本地业务 adapter，Tauri 精确注册三个本地业务命令；没有通用数据库、Provider 或 Cloud Repository 命令。 | 本地范围控制不证明产品就绪。 |
| 外部运行与发行 | 托管数据库、生产审计 signer/KMS/HSM、部署、原生构件资格、提供商资格和 `1.0.0` / `stable` 发行仍未由本台账宣称。 | 各项只授权其精确外部/公开主张，责任人和证据见 Gate 台账。 |

## 保留的仓库历史证据

| 历史仓库证据 | 保留的事实 | 不得推断 |
| --- | --- | --- |
| Cloud audit | M013 已接入迁移目录；ADR-0014 的 custody 模型仍是决策约束。 | 托管 PostgreSQL、生产 signer/KMS/HSM、轮换、部署或审计 Gate 已取得。 |
| Secure Host / 本地备份 | 窄备份操作 API、本地 SQLCipher 业务库与仍不可用的备份导出/恢复组合。 | 存在备份/恢复成功路径，或备份未完成阻止本地业务实现。 |
| Browser | `Unavailable` 记录与 ADR-0017 的首发排除。 | 浏览器是待接线、回退或临时 v1 路径。 |
| 旧 Desktop/Cloud 基线快照 | 旧“静态 Desktop/空 Cloud 业务注册表”文字保留其被记录时的仓库事实。 | 它仍是当前源码快照，或禁止后续已定范围本地组合。 |
| Release | `unissued` release 请求和仓库检查输出。 | 签名、发行、提供商执行、原生资格或 Gate closure。 |

这些都是**历史仓库证据**，不是当前 v1 能力、外部资格或本地工作阻塞项；它们不能被用于推断发布、提供商执行、原生资格或 Gate closure。

## 维持规则

- 不以临时适配器、别名、双路径、运行时夹具、运行时 `brand/` 依赖、宽泛 Host 权威或浏览器回退绕过已定边界。
- 任何本地工作只受其已定范围、拥有合同和本地依赖约束；不得因缺少托管数据库、部署、提供商资格、原生资格、发行批准或 Gate closure 而被串行化。
- 外部证据只在实际取得后记录，并且只能授权其精确主张；设计、仓库检查和本地报告不能声称部署、原生、提供商、发行或 Gate closure。
