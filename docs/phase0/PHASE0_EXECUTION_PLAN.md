# Phase 0 执行计划

## 目标

Phase 0 建立“Cloud 控制面授权、本地 SQLCipher 执行业务、Cloud 保存脱敏同步副本”的可验证
纵向，不以部署、Provider 资格或发行证据替代本地实现。

## 工作包

| ID | 所有者 | 结果 | 验收 |
| --- | --- | --- | --- |
| S0 | 架构与数据治理 | ADR-0016、数据分类、同步白名单和禁止字段统一。 | 全仓术语和边界扫描无冲突。 |
| L1 | local-storage | 生产 SQLCipher 迁移、业务事务、本地 Provider 账号、Inbox/Outbox。 | 原子提交、空副本 no-op、秘密 canary、恢复前本地重建测试。 |
| H1 | Native Host | `local-storage` 拥有 SQLCipher key/路径/数据库身份，`secure-host-core` 拥有 OAuth/device/Provider 凭据生命周期。 | Renderer 无路径/密钥/账号/凭据权威；两个拥有边界均有原生负向测试。 |
| A1 | Cloud identity/devices | 账号、Session、Subscription/Entitlement、Device、Lease/Epoch。 | 签发、验证、续期、吊销和离线期限测试。 |
| D1 | Desktop | 授权门禁后组合本地 Repository 和业务 UI；独立 `sync.conflicts` 路由只在 Active/Standby workspace surface 暴露。 | Cloud transport 全失败时，有效授权下本地读写成功；商业只读/Standby 仅查看且 resolve 不可用；locked、retryable、security、recovery surface route-free。 |
| S1 | Sync | secret-free Push/Pull、ACK/Cursor、冲突和恢复副本；客户状态由持久化 `SyncSnapshot` 与 Native transport observation 组成。 | 不同步 Provider 账号；Pull 先本地合并；Cloud 空副本不删除；snapshot 暴露 durable pending/open-conflict/rejected counts 和 applied revision，transport 仅为 `checking`、`reachable`、`offline`、`blocked`。重启从 `checking` 开始；内部复制诊断不属于客户状态。 |
| C1 | Local Connector | Cloudflare 域名 Provider 能力逐项接入；当前已有最小 Token 的 Host-local Zone/DNS API read 与现有资产本地绑定，Provider 写入与 Registrar 仍不可执行。 | Provider 账号与凭据只本地；每项新能力具名授权、计划/确认、对账和本地优先结果通过负向测试，真实执行另需对应 Q-CF 资格。 |
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

Cloud 的有序目录包含 25 项 migration（M001–M017、M019、M020、三项 Sync/Observation、Account recovery 及后续 account capability migrations）；M015 是规范化商业领域的 greenfield baseline，M016
增加 Identity refresh recovery，M017 增加 Devices 登录授权加固，M019 增加 Identity transaction
capability，M020 增加 Account access challenge 和加密邮件 outbox，M023 增加密码恢复、challenge-bound
dead-letter outbox 和 Session 撤销；
不存在 M018 compatibility migration。当前 M002 是无 Provider 连接身份的显式业务
副本 schema；连接键控的 Cloud Observation client 和 Repository不存在。Desktop 正常 Query 不经过 Cloud。

部署、真实 Provider、生产 OpenBao custody、原生签名/公证和发行是各自外部资格，只授权对应公开主张。
