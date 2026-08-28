# Phase 0 执行计划

## 目标

Phase 0 建立“Cloud 控制面授权、本地 SQLCipher 执行业务、Cloud 保存脱敏同步副本”的可验证
纵向，不以部署、Provider 资格或发行证据替代本地实现。

## 工作包

| ID | 所有者 | 结果 | 验收 |
| --- | --- | --- | --- |
| S0 | 架构与数据治理 | ADR-0016、数据分类、同步白名单和禁止字段统一。 | 全仓术语和边界扫描无冲突。 |
| L1 | local-storage | 生产 SQLCipher 迁移、业务事务、本地 Provider 账号、Inbox/Outbox。 | 原子提交、空副本 no-op、秘密 canary、恢复前本地重建测试。 |
| H1 | Secure Host | OS keychain、Host-owned 路径/数据库身份、Provider 凭据生命周期。 | Renderer 无路径/密钥/账号/凭据权威；原生负向测试。 |
| A1 | Cloud identity/devices | 账号、Session、Subscription/Entitlement、Device、Lease/Epoch。 | 签发、验证、续期、吊销和离线期限测试。 |
| D1 | Desktop | 授权门禁后组合本地 Repository 和业务 UI。 | Cloud transport 全失败时，有效授权下本地读写成功；失效授权锁定。 |
| S1 | Sync | secret-free Push/Pull、ACK/Cursor、冲突和恢复副本。 | 不同步 Provider 账号；Pull 先本地合并；Cloud 空副本不删除。 |
| C1 | Local Connector | Cloudflare 最小 Token 的 Host-local API read。 | Provider 账号与凭据只本地；结果先本地提交，再同步允许业务字段。 |
| V1 | 集成所有者 | 本地业务、授权、同步和秘密边界汇合。 | 聚焦测试、根 `pnpm check`、术语扫描和 `git diff --check`。 |

## 依赖

```text
S0 --> L1 --> D1 --> V1
 |      |      ^
 |      `--> S1
 +--> H1 --> D1
 +--> A1 --> D1
 `--> C1 --> L1
```

Cloud M001–M014 目录只提供控制面与同步恢复基础。当前 M002 是无 Provider 连接身份的显式业务
副本 schema；连接键控的 Cloud Observation client 和 Repository不存在。Desktop 正常 Query 不经过 Cloud。

部署、真实 Provider、KMS/HSM、原生签名/公证和发行是各自外部资格，只授权对应公开主张。
