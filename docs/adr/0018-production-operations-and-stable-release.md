# ADR-0018：单区域生产运行与 stable 首发

状态：Accepted

## 运行、责任与发行

首发生产服务采用单个受管云区域：公共 Cloud 服务、受管 PostgreSQL、自托管 OpenBao Transit 与运行监控位于
同一获批区域；生产、预发布和开发环境在账户、身份、数据和密钥上严格隔离。客户端不直接
连接数据库，生产变更只可通过可审计的部署流程进行。跨区域复制、自动故障转移和多区域
数据驻留不属于首发范围。

实际托管商、区域、账户标识和责任人身份由 Data Governance Owner 与 Platform Operations
Owner 在创建生产环境时共同记录为不可变环境证据。Platform Operations Owner 负责基础设施、
可用性、监控、备份恢复演练和事件协调；Security Custodian 负责 OpenBao、密钥/seal 策略和安全
事件；Data Governance Owner 负责数据区域、保留、删除和通知义务；Product Owner 负责产品
范围和客户发行批准。任何单一运行时身份都不能同时获得部署、密钥策略和发行批准的完整
权力。

首个公开客户发行固定为语义版本 `1.0.0`、渠道 `stable`。它必须覆盖 ADR-0022、ADR-0023、
[连接器规范](../CONNECTORS.md)和 ADR-0027 定义的首发范围，并且只有在干净构件、签名/公证、受控归档、提供商
资格、独立审查和上述四个角色的发行批准均存在时才能建立。发行请求不能仅凭本策略从 `unissued` 变为已发行。
