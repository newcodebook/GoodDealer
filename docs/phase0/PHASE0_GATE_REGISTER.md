# GoodDealer Phase 0 外部资格台账

状态：Active。没有 Gate 因为本仓库文档、本地命令、源码检查、夹具、可移植测试或本地报告而关闭。

## 使用规则

本台账只记录外部资格：与真实环境、最终构件、真实提供商观察、独立审查或批准绑定的证据。它不是本地实现调度器，也不记录 Desktop、Cloud API、持久化或 Host 工作包的实施状态。

资格项只授权其“授权的主张”列中明确的外部/公开结论。所有本地实现和本地验收继续依据 [ROADMAP.md](../ROADMAP.md)、[PHASE0_EXECUTION_PLAN.md](PHASE0_EXECUTION_PLAN.md) 与 [VERIFICATION.md](../VERIFICATION.md)；本地证据永远不能被写成 Gate closure。

## 外部资格项

| 资格 ID / 范围 | 必须取得的外部证据 | 授权的主张 | 未来责任人 | 不是本地实现阻塞项？ | 当前 closure 状态 |
| --- | --- | --- | --- | --- | --- |
| **Q-AUDIT：生产审计/KMS-HSM custody** | 最终环境的受管、不可导出 KMS/HSM 密钥、目的隔离、批准、轮换演练和独立审查。 | 生产审计签名 custody 已存在且按 ADR-0014 运行。 | Security Custodian 与 Platform Operations Owner。 | 是；不阻止本地业务、账号控制面或同步恢复工作。 | 未记录 closure。 |
| **Q-CF：Cloudflare 只读提供商资格** | 条款审查、最小 `Zone:Read`/`DNS:Read` Token 指南、受控测试 Zone 的真实观察、速率/错误/移除行为和独立安全审查。 | Cloudflare API-only Zone/DNS 只读观察可作为真实提供商能力或客户可用性的一部分主张。 | 未来 Cloudflare 能力所有者与 Security Custodian。 | 是；不阻止 C1/C2/V3 的本地只读合同实现。 | 未记录 closure。 |
| **Q-OPS：受管生产运行与部署** | 获批区域中的受管 PostgreSQL、部署、监控、环境隔离和相关运行证据。 | 已部署 Cloud 控制面与同步副本在指定环境可用。 | Data Governance Owner 与 Platform Operations Owner。 | 是；不阻止本地业务库或 Cloud 控制面/同步实现。 | 未记录 closure。 |
| **Q-NATIVE：原生 Desktop 构件资格** | 最终构件的签名/公证、目标平台证据和构件归档。 | 指定原生构件已完成其签名/公证或平台资格。 | Platform Operations Owner。 | 是；不阻止 Desktop 本地 UI、窄 Host 接线或本地测试。 | 未记录 closure。 |
| **Q-REL：`1.0.0` / `stable` 客户发行** | 干净最终构件、签名/公证、受控归档、适用的提供商资格、独立审查和 ADR-0018 所列四角色批准。 | `1.0.0` / `stable` 已作为公开客户发行建立。 | Product Owner；与其余 ADR-0018 责任人共同批准。 | 是；不阻止任何已定范围本地工作包开始、继续或汇合。 | 未记录 closure。 |

## 证据记录要求

每项外部证据必须绑定其环境或最终构件，并记录来源、时间、完整性、审查者、适用范围和所授权的精确主张。缺少任何必要事实时，只能说该外部主张尚未取得，不能把仓库结果、局部实现或本地验收升级为部署、提供商可用、原生资格、发行或 Gate closure。

## 保留的历史仓库证据

以下内容因审计/基础记录目的保留为**历史仓库证据**，不是外部资格也不是当前产品可用性：M013 迁移目录记录及其校验和、固定不可用的本地备份证据、仓库策略/测试输出，以及 `unissued` release 请求。这些记录不关闭任何 Gate，不阻止已定范围的本地实现，也不改变浏览器、提供商写入、市场/注册商、团队/多工作区、凭据迁移、CSV 导入或外部变更的 v1 排除状态。
