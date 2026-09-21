# 当前架构审查处理结论

## 目的与权威

本台账记录已纳入当前架构的处理结论，不保留已被替代的串行工作指令。ADR-0013 至 ADR-0018 保持决策权威；[ROADMAP.md](ROADMAP.md) 是唯一 v1 能力/依赖矩阵，[PHASE0_EXECUTION_PLAN.md](phase0/PHASE0_EXECUTION_PLAN.md) 协调本地工作包，[PHASE0_GATE_REGISTER.md](phase0/PHASE0_GATE_REGISTER.md) 只记录外部资格。

当前源码优先于普通说明。本台账只记录拥有源码和本地测试已证明的精确本地组合；这些事实不构成
客户可用、生产部署、原生资格、提供商资格、发行或外部 Gate closure。需要扩大当前组合或作出
就绪主张时，必须重新核验拥有源码和对应外部证据。

## 当前处理结论

| 主题 | 当前结论 | 外部资格边界 |
| --- | --- | --- |
| v1 范围与本地协调 | Cloud 账号/授权控制面、本地域名资产业务库、脱敏同步恢复和 Host-local Cloudflare API-only read 按各自合同汇合。 | 外部资格不是这些本地工作启动、继续或本地验收的前提。 |
| 当前组合 | Cloud public composition 已注册账号激活、Desktop Grant 与六条账号 billing 路径，共八条公共业务路径；Desktop OAuth 和支付 webhook 使用独立入口。Desktop Native 已组合 Keychain device/refresh custody、PKCE、challenge/PoP、access/refresh、Bearer Grant 拉取、Grant/Lease 双重验签与本地 runtime 激活。共享开发环境已部署 Account Web、Stripe test-mode Checkout/webhook、开发 OpenBao signer 与 self-hosted worker；生产 Provider/worker/signer 和客户发行仍未组合或资格化。 | 本地与共享开发证据只证明这些精确边界，不证明客户可用、生产部署、生产 OpenBao custody、原生签名/公证、live 提供商资格、发行或 Gate closure。 |
| A：账户/个人默认工作区 | ADR-0013 的服务器导出范围和原子创建约束由 A1 实现，并在 D1/V1 汇合；不扩展到团队、多工作区、所有权转移或凭据迁移。 | `Q-OPS` 只在声称受管/已部署账户能力时适用。 |
| P：本地域名资产 | 本地 SQLCipher 是读写权威；业务事务与 secret-free Outbox 原子提交，Cloud 仅是同步恢复副本。 | `Q-OPS` 只在声称已部署同步服务时适用。 |
| C：Cloudflare 只读观察 | Provider 账号、账号 metadata、Token 与执行全在本地 Host；Cloud Observation client/repository 已移除，M002 只保留脱敏副本。 | `Q-CF` 只在声称真实提供商观察/可用性时适用。 |
| Desktop 源图范围一致性 | 当前 Renderer 入口只使用窄本地业务与认证 adapter；Tauri 精确注册具名本地业务、备份、认证和 Cloudflare 命令，没有通用数据库、Provider 网络或 Cloud Repository 命令。Cloudflare Host 命令尚未进入 Renderer adapter。 | 本地范围控制和 Native 组合不证明 Renderer 旅程、真实 Provider 或产品就绪。 |
| 外部运行与发行 | 托管数据库、生产 OpenBao signer custody、部署、原生构件资格、提供商资格和 `1.0.0` / `stable` 发行仍未由本台账宣称。 | 各项只授权其精确外部/公开主张，责任人和证据见 Gate 台账。 |

## 保留的仓库历史证据

| 历史仓库证据 | 保留的事实 | 不得推断 |
| --- | --- | --- |
| Cloud audit | M013 已接入迁移目录；ADR-0014/0021 的 OpenBao custody 模型仍是决策约束。 | 托管 PostgreSQL、生产 OpenBao cluster/key/workload identity、轮换、部署或审计 Gate 已取得。 |
| Local Host / 本地备份 | `gooddealer-local-storage::DesktopLocalHost` 独占 SQLCipher key、窄备份 API 与 GDBK/current-DB restore；完整 continuity/rebootstrap runtime/custody/database 协议仅在 `cfg(test)` 编译，生产 plan facade 在 wire/locks 前拒绝且 startup 只保留 fixed-resource residue absence gate。 | 注入式开发成功路径等于生产 picker/handle、独立 monotonic anchor、true create-only slot custody、safe active-DB move detection 或目标平台故障资格，或产品备份/灾难恢复已可用。 |
| Browser | `Unavailable` 记录与 ADR-0017 的首发排除。 | 浏览器是待接线、回退或临时 v1 路径。 |
| 旧 Desktop/Cloud 基线快照 | 旧“静态 Desktop/空 Cloud 业务注册表”文字保留其被记录时的仓库事实。 | 它仍是当前源码快照，或禁止后续已定范围本地组合。 |
| Release | `unissued` release 请求和仓库检查输出。 | 签名、发行、提供商执行、原生资格或 Gate closure。 |

这些都是**历史仓库证据**，不是当前 v1 能力、外部资格或本地工作阻塞项；它们不能被用于推断发布、提供商执行、原生资格或 Gate closure。

## 维持规则

- 不以临时适配器、别名、双路径、运行时夹具、运行时 `brand/` 依赖、宽泛 Host 权威或浏览器回退绕过已定边界。
- 任何本地工作只受其已定范围、拥有合同和本地依赖约束；不得因缺少托管数据库、部署、提供商资格、原生资格、发行批准或 Gate closure 而被串行化。
- 外部证据只在实际取得后记录，并且只能授权其精确主张；设计、仓库检查和本地报告不能声称部署、原生、提供商、发行或 Gate closure。
