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
| C1 | Local Connector | 按 ADR-0027 逐平台、逐项接入 8 个首发平台的域名能力，先以 Cloudflare 抽象共用框架；当前只有最小 Token 的 Cloudflare Host-local Zone/DNS API read 与现有资产本地绑定，其余写入、Registrar、交易市场、获取与其他平台仍不可执行。 | Provider 账号与凭据只本地；每项新能力具名授权、计划/确认、对账和本地优先结果通过负向测试，真实执行另需对应 Q-CF 或 Q-PROV 资格。 |
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

Cloud 的有序目录包含 27 项 migration（M001–M017、M019、M020、三项 Sync/Observation、Account recovery、后续 account capability migrations 与两项 Desktop 登录 loopback redirect migrations）；M015 是规范化商业领域的 greenfield baseline，M016
增加 Identity refresh recovery，M017 增加 Devices 登录授权加固，M019 增加 Identity transaction
capability，M020 增加 Account access challenge 和加密邮件 outbox，M023 增加密码恢复、challenge-bound
dead-letter outbox 和 Session 撤销；
不存在 M018 compatibility migration。当前 M002 是无 Provider 连接身份的显式业务
副本 schema；连接键控的 Cloud Observation client 和 Repository不存在。Desktop 正常 Query 不经过 Cloud。

部署、真实 Provider、生产 OpenBao custody、原生签名/公证和发行是各自外部资格，只授权对应公开主张。

## v1 阶段任务清单

本清单是 [路线图阶段](../ROADMAP.md#当前执行顺序) 的执行台账。阶段目标与顺序以路线图为准，验收标准以
[VERIFICATION.md](../VERIFICATION.md#多平台交付阶段验收) 为准，本清单不重新定义它们。

维护规则：

- 只有满足对应验收标准且经过独立评估 PASS 时，才把任务勾选为完成，并在行尾写上 PR 链接。
- 单项能力降级时，把任务勾选为完成，并在行尾写“降级：<原因>”，原因同时记入 ADR-0027 的事实快照。
- 暂停待决时，任务保持未勾选，在行尾写“暂停：<待决事项>”。
- 执行中新发现的任务，追加到所属阶段，不另建清单。

### 1. 当前态收口与冻结候选

- [ ] 扫描全仓当前态文档，确保源码实现、局部验证、V1 验收和外部资格四类状态没有混写
- [ ] 清理临时 `P0-*` 任务语义和过时的当前态描述
- [ ] 建立冻结候选快照，附提交引用和可复现的检查输出

### 2. Desktop 设计页面生产组合

- [ ] DNS 健康页接入 Host 投影
- [ ] 设置页接入 Host 投影（平台连接、角色与能力可用性）
- [ ] 销售页接入 Host 投影（资格前显示不可用）
- [ ] 续费页接入 Host 投影
- [ ] 批量页接入 Host 投影（先生成计划，再逐项确认）
- [ ] 历史页接入 Host 投影
- [ ] 人工任务收件箱接入 Host 投影（交给平台页面完成，再回到 Desktop 对账）
- [ ] 每个页面与 `brand/ui_kits/desktop` 对照，生产依赖图中不含 `visual-fixtures`

### 3. Cloudflare 路径稳定

- [ ] 引导流程：欢迎 → 设备门 → 连接 Cloudflare（可跳过）→ 从观察结果导入或手动添加 → 完成
- [ ] 资产创建，并对导入和手动添加去重
- [ ] 绑定 UI
- [ ] Grant/Lease 能力门禁接入生产导航
- [ ] 凭据原子撤销，revoke/deactivate 的 Host capability
- [ ] Cloudflare generation/auth fences 从 `features/connections` 进入生产组合
- [ ] 断网、Token 失效、权限不足、撤销后，都失败关闭并给出可恢复提示

### 4. 当前范围全系统 V1 汇合验收

- [ ] 在同一冻结候选上，为 v1 详细垂直验收表的每一行取得新鲜证据
- [ ] 独立复审 PASS

### 5. 多平台共用框架与 Cloudflare 全能力

- [ ] 平台连接与角色模型（registrar、dns、marketplace、acquisition）
- [ ] binding 增加 `listing` 资源类型
- [ ] 每平台私有 Service 骨架和能力 manifest，以及资格登记
- [ ] 跨平台所有权验证的本地操作计划
- [ ] 对账任务模型
- [ ] 逐笔资金确认组件（含出价）
- [ ] 负向测试：越权、跨租户、伪造 grant/bid、角色串用凭据、批量部分失败
- [ ] Cloudflare Registrar 能力
- [ ] Cloudflare DNS 写入与 DNSSEC
- [ ] Cloudflare 监控
- [ ] 核对 Cloudflare 平台事实并更新快照

### 6. Porkbun

- [ ] 核对官方文档并更新平台事实快照
- [ ] 能力清单映射到四种角色
- [ ] 私有 Service、合同与负向测试
- [ ] 逐项能力资格证据（使用沙箱或 `dryRun`）
- [ ] 证明框架核心模型未改动

### 7. Spaceship（含 SellerHub）

- [ ] 核对官方文档并更新平台事实快照
- [ ] 能力清单映射到四种角色
- [ ] 私有 Service、合同与负向测试（凭据 scope 和资格按角色隔离）
- [ ] 逐项能力资格证据

### 8. Dynadot、Namecheap

- [ ] Dynadot：核对事实、列出能力清单、实现 Service 与测试（HMAC 密钥只在 Host custody）、取得资格证据
- [ ] Namecheap：核对事实、列出能力清单、实现 Service 与测试（IP 白名单不满足时失败关闭并说明如何修复）、取得资格证据

### 9. GoDaddy、Afternic

- [ ] GoDaddy：核对事实、列出能力清单、实现 Service 与测试、取得资格证据
- [ ] Afternic：核对事实、列出能力清单，实现 Portfolio API 的 Listing 与改价，取得资格证据

### 10. Atom（含 AtomRegistrar）

- [ ] 核对官方文档和准入门槛，更新平台事实快照
- [ ] Listing、逐笔确认的出价、AtomRegistrar 的 Service 与负向测试（query-string token 不进入日志、错误或 URL 记录）
- [ ] 逐项能力资格证据，或者带原因标记为不可执行

### 11. 1.0 资格与发行

- [ ] 关闭 Q-CF
- [ ] 关闭 Q-PROV
- [ ] 关闭 Q-OPS、Q-AUDIT、支付与销售资格
- [ ] 关闭 Q-NATIVE、Q-REL；`pnpm gate:validate` 通过
- [ ] 在最终候选上重新通过阶段 4 的 V1 验收
- [ ] 取得 `1.0.0` / `stable` 批准

### 并行补强

- [ ] live PostgreSQL 并发/RLS、容量、崩溃恢复、长时间运行
- [ ] 把 `backup/source.rs` 的快照临时目录改为仅属主可访问（启用生产备份的前提）
