# ADR-0004：Cloud 保存业务数据的同步副本，不提供 Desktop 运行仓储

状态：Accepted

## 决策

Cloud 可以持久化允许同步的业务字段，用于跨设备同步、恢复、检查点和合规导出。该持久化是
本地业务数据库的副本或物化，不是 Desktop 的正常查询 Repository，也不能直接成为业务操作
的提交点。

Desktop 的 Provider 观察必须在本地 Host 使用本地凭据取得，先原子写入本地 SQLCipher，立即
供本地 UI 使用，再将明确允许的脱敏业务字段写入 Outbox。Cloud 不调用 Provider，也不接收
Provider Account ID、账号别名、API Key、Token、Cookie、密码、2FA、Browser Profile、
Credential Binding 或其他可识别第三方账号和解锁 Provider 的材料。

## 约束

- 同步 wire 采用字段白名单和严格 schema；出现秘密 canary 或未知字段时必须失败关闭。
- Cloud ACK 只确认副本接收，不决定本地业务事务是否提交成功。
- Cloud 空副本、过期副本或暂时不可达不得被解释为删除本地业务行。
- Pull 数据必须经过本地验证、冲突处理和本地事务后，才能被本地 Query 看见。
- Cloud 的租户隔离、授权、保留规则和事务边界仍必须独立成立。

完整数据分类见 ADR-0016。
