# ADR-0016：本地业务数据库与 Cloud 同步边界

状态：Accepted

## 背景

GoodDealer 从项目建立之初就是 Desktop 本地执行业务的产品。账号与商业授权需要 Cloud，但
业务运行不能依赖 Cloud 业务数据库。授权控制面和业务数据面必须明确分开。

## 决策

```text
登录与授权：Desktop <-> Cloud control plane -> 本地缓存的已签名授权

业务写入：UI -> client-core -> local-storage transaction
                                  |-> business tables
                                  `-> secret-free sync_outbox

Provider：UI intent -> Secure Host + local credential -> Provider
                                                   |
                                                   `-> local-storage transaction -> local Query

同步上行：sync_outbox -> strict allowlisted wire -> Cloud sync replica -> ACK
同步下行：Cloud sync replica -> strict Inbox -> local merge transaction -> local Query
```

### 权威划分

| 数据或能力 | 权威所有者 | Cloud 是否保存 | 说明 |
| --- | --- | --- | --- |
| GoodDealer 账号、登录会话 | Cloud 控制面 | 是 | 身份认证与会话管理 |
| 订阅、Entitlement、设备绑定、Lease/Epoch | Cloud 控制面 | 是 | 能力门禁与并发副作用控制 |
| Desktop 业务实体、业务事务、任务、历史 | 本地 SQLCipher | 仅允许字段的副本 | 本地是正常读写和恢复后的运行仓储 |
| 同步 ACK、Cursor、Checkpoint | Cloud 同步面 | 是 | 描述复制进度，不拥有本地事务 |
| 第三方平台账号、Provider Account ID、账号别名 | 本地 Host/SQLCipher | 否 | 即使不含密码也禁止同步 |
| API Key、Token、Cookie、密码、2FA、Browser Profile、Credential Binding | 本地秘密边界 | 否 | 不得进入 wire、Cloud、日志、错误或普通审计 |
| Provider 调用与观察 | 本地 Secure Host | 仅脱敏结果副本 | Cloud 不持有凭据且不调用 Provider |

## 强制不变量

1. 本地业务提交不等待 Cloud ACK；业务表和 Outbox 必须原子提交。
2. Cloud 不可达只产生未同步状态，不使已授权的本地 Repository 不可用。
3. Cloud 空副本不能删除本地行；删除必须是经过验证的显式同步 mutation。
4. 第三方平台账号、账号 metadata 和秘密不得进入 Outbox、wire、Cloud、日志、错误或审计。
5. Cloud 不能代表 Desktop 调用 Provider。
6. 账号、订阅和 Lease 可以锁定业务入口，但不拥有业务数据。
7. Pull 必须经过严格输入验证、冲突处理和本地事务，不能被 UI 直接读取。
8. 恢复必须先在本地重建、解锁并验证 SQLCipher 数据库，再开放本地 Query。
9. Renderer 不能提供数据库路径、密钥或 Provider 凭据，也不能调用通用数据库命令。

## 允许的同步内容

同步协议按实体和字段建立显式白名单。V1 `domain_asset` 可以同步业务字段，例如 note、
portfolioId、tags 和 targetPrice；实体扩展必须同时更新本地事务、wire schema、Cloud 副本、
secret-canary 测试和恢复测试。没有进入白名单的字段默认禁止同步。

## 后果

Cloud Portfolio/Observation 表和服务只能命名并实现为同步副本、恢复或受控导出能力。
`cloud-client` 不能向 Desktop 暴露将 Cloud Portfolio 当作正常业务查询源的组合。Desktop 的
业务功能测试必须证明 Cloud transport 全失败时，在有效授权窗口内本地读写仍成功。
