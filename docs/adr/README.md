# 架构决策

本目录按主题只保留最终接受的决策。每个主题有一个权威文件；后续修订直接更新其完整有效规则，
不在正文并列旧方案、备选方案、接受过程或实施日志。编号保留为稳定标识，不要求连续。

`Accepted` 表示目标与约束已确定，不表示功能已经实现、部署或通过资格。当前落地见
[当前实现](../CURRENT_IMPLEMENTATION.md)，交付顺序见 [路线图](../ROADMAP.md)，平台事实见
[API 核查](../PROVIDER_API_REVIEW.md)，实施证据见 [执行台账](../phase0/PHASE0_EXECUTION_PLAN.md)。

| 决策 | 主题 |
| --- | --- |
| [ADR-0006](0006-runtime-and-security-boundaries.md) | 工程所有权、运行时与信任边界 |
| [ADR-0011](0011-device-identity-lifecycle.md) | 设备身份、原子绑定与 Native OAuth 登录 |
| [ADR-0016](0016-local-business-database-and-cloud-sync-boundary.md) | 本地优先业务权威与 Cloud 同步边界 |
| [ADR-0018](0018-production-operations-and-stable-release.md) | 单区域生产运行与 stable 首发 |
| [ADR-0019](0019-complete-local-business-schema-and-cloud-replica-model.md) | 业务模型、同步结果与存储修复 |
| [ADR-0020](0020-commercial-entitlement-and-local-access.md) | 商业授权、本地访问与运营配置 |
| [ADR-0021](0021-self-hosted-openbao-transit-signing.md) | OpenBao 签名托管、用途隔离与轮换 |
| [ADR-0022](0022-account-identity-and-email-delivery.md) | 账户身份、个人工作区与邮件交付 |
| [ADR-0023](0023-business-backup-and-recovery.md) | 独立业务备份、换机云恢复与数据库发布 |
| [ADR-0025](0025-linux-secret-service-custody.md) | Linux Secret Service 的秘密托管边界 |
| [ADR-0027](0027-multi-platform-domain-providers-and-marketplaces.md) | 十二平台范围、批量工作流与 API 接入 |
| [ADR-0028](0028-refused-cloudflare-custody-purge.md) | Cloudflare 凭据清理与连接退役 |
| [ADR-0029](0029-domain-tombstone-purge-and-re-adding.md) | 域名添加、删除与 generation |
| [ADR-0032](0032-desktop-device-switch-and-drain-handoff.md) | 设备切换、drain 与无 Lease 的 Standby 会话 |

修改决策时同步更新受影响合同、当前文档和引用。开发缺口不能缩减已接受的产品目标；技术实现进度不写回为
产品排除项。跨主题引用指向拥有该规则的 ADR，不复制整套政策。
