# GoodDealer v1 能力路线图

## 目标顺序

```text
S0  冻结本地业务权威与数据分类
 |
 +-- L1 local-storage 生产 SQLCipher + migrations
 |      `-- L2 本地业务事务 + Inbox/Outbox + 恢复
 |
 +-- H1 OS keychain / Host-owned DB identity
 |      `-- H2 Provider 本地凭据与窄操作
 |
 +-- A1 Cloud 账号/订阅/Entitlement/设备/Lease 控制面
 |
 +-- D1 Desktop 授权门禁 + 本地 Repository 组合
 |
 `-- S1 secret-free sync push/pull + Cloud replica
        `-- V1 离线本地业务、同步、恢复与权限回归
```

## 能力矩阵

| 工作流 | 权威 | 当前基础 | 完成条件 |
| --- | --- | --- | --- |
| 账号与授权 | Cloud control plane | 身份、默认工作区、设备和持久化模块 | 真实登录、订阅、Lease 签发/吊销与 Desktop 验证组合。 |
| 本地业务库 | local-storage SQLCipher | 完整业务 schema、最小业务读写、本地 Provider 凭据版本、字段版本、Inbox/Outbox、冲突与墓碑 | 为各旅程实现拥有模块 Repository、Host-owned 路径/密钥、恢复和规模资格。 |
| Desktop 业务 | Desktop + client-core + Tauri Host | UI/领域组件和本地库底座 | 有效授权后只通过窄 IPC 读写本地库；Cloud 失败回归通过。 |
| Provider | Secure Host | 私有 Cloudflare read service | 本地凭据录入、Host 组合、结果先写本地、真实 Provider 资格。 |
| 同步 | local Inbox/Outbox + Cloud replica | 本地复制 schema、Cloud mutations/cursors/checkpoints 与显式 `workspace_replica_*` 基础 | 实现严格白名单 push/pull materializer、冲突解决、ACK 和恢复回归。 |
| 发行 | Release | 工程与检查基础 | 最终构件、签名/公证、部署、运行证据和独立审查。 |

## 当前优先级

1. 完成 Desktop Host-owned 本地数据库路径、OS 密钥保管和窄业务命令。
2. 将本地完整 schema 的各旅程 Repository 通过窄 Host 端口组合，正常 Query 禁止接入 Cloud。
3. 完成结构化 Outbox 到 Cloud Mutation、Inbox materializer、字段冲突和墓碑生命周期。
4. 增加有效授权 + Cloud transport 全失败的本地业务纵向及规模测试。
5. 完成备份恢复、本地 Provider 凭据轮换操作和原生资格。

外部部署、真实 Provider、原生签名和发行证据只授权对应公开主张，不改变本地业务权威。
