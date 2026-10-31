# GoodDealer v1 能力路线图

## 读法

本路线图只使用 [Phase 0 执行计划](phase0/PHASE0_EXECUTION_PLAN.md) 定义的正式工作包：
`S0`、`L1`、`H1`、`A1`、`D1`、`S1`、`C1`、`V1`。源码、迁移或开发任务中的
`P0-*` 字符串不是产品里程碑，不能据此增加或宣称 Roadmap 阶段。

状态必须分层理解：

- **源码已实现**：生产入口中存在对应实现，不代表已完成整体验收。
- **局部已验证**：拥有模块的测试或开发环境纵向已有证据；后续改动会使旧结果失效。
- **V1 已验收**：所有依赖汇合后完成新鲜的集成检查、文档一致性检查和独立复审。
- **外部已资格化**：真实环境、真实 Provider 或最终构件取得对应证据；本地测试不能替代。

## 正式工作包与依赖

```text
S0 --> L1 --> D1 --> V1
 |      |      ^
 |      `--> S1
 +--> H1 --> D1
 +--> A1 --> D1
 `--> C1 --> L1
```

## 当前状态

| 工作包 | 当前实现 | 验收状态 | 仍需完成 |
| --- | --- | --- | --- |
| **S0 架构与数据治理** | 本地 SQLCipher 权威、Cloud 控制面/脱敏副本、秘密隔离、同步白名单和 v1 排除项已有 ADR 与协议约束。 | 核心决策已建立；当前文档和实现批次命名仍在一致性收口，不能称为最终通过。 | 清理临时 `P0-*` 任务语义和过时当前态描述；在 V1 做全仓术语、边界和依赖扫描。 |
| **L1 local-storage** | `DesktopLocalHost` 已拥有 SQLCipher 路径/密钥/数据库身份、完整业务 schema、本地资产读写、字段版本、Inbox/Outbox、冲突、墓碑、Provider 本地状态及恢复协议底座。 | 源码已实现并有广泛局部测试；最新跨模块改动之后尚无一次新鲜 V1 验收。 | 完成与 D1/S1/C1 的客户纵向回归、规模/故障回归；生产备份与 rebootstrap 继续保持不可用，直到其独立原生前提成立。 |
| **H1 Native Host** | Native 已组合 PKCE、device/refresh custody、Grant/Lease 双重验签、运行时授权门禁、Sync/Projection/Provider lanes、Cloudflare Keychain v3 发布和窄 IPC。 | Host 源码基本完整，局部负向测试存在；尚未随最终 Renderer 组合做新鲜 V1 验收。 | 验证最终 command/manifest/capability/adapter 精确一致；完成目标平台 Keychain 与最终构件资格；Linux 启动与登录 custody 已按 ADR-0025 接入 Secret Service，Provider 凭据与备份在 Linux 仍不可用。 |
| **A1 Cloud identity/devices** | 当前源码含注册、邮箱验证/重发、密码登录/恢复、Session discovery、登录轮换、服务端退出、默认工作区、设备 PoP、access/refresh、Grant v3、ActiveDeviceLease、商业权威及 Stripe test-mode 商业链路；开发组合保留 loopback Mailpit，staging 组合通过已验证 `gooddealer.com` 域名的 Resend 发件地址发送事务邮件。 | Account access 的本地、PostgreSQL 与 staging 浏览器证据覆盖原子回滚、并发、expiry/replay、邮件 retry/dead-letter、reset epoch、rotation、刷新恢复和 logout；真实测试用户已在无数据库/开发工具权限下完成完整旅程。 | 公开注册和生产邮件资格、Stripe live、税务范围、生产 OpenBao、生产 worker、HA 与灾难恢复继续归入各自外部资格；staging 仍运行在当前共享 VPS/开发数据库上。 |
| **D1 Desktop** | 旧界面层已移除，等待按 `brand/` 重建：生产根组件当前只打开 Host 工作区、跟随 Native 认证状态并在锁定时清空业务数据，不组合任何业务界面。授权门禁、Portfolio list/detail 读取与 edit/delete、冲突解决和 Cloudflare 流程的 generation/auth fences 保留为 `apps/desktop/src/app` 与 `features/connections` 下的独立协调模块，等待新界面重新组合。商业只读/Standby 可进入同步只读视图但没有 resolve admission；locked、retryable、security、recovery surface 均 route-free。冲突解决后只会一次性发布同一 Host generation 的业务状态、资产列表、冲突与同步快照。 | D1+C1 客户路径已有独立评估证据；D1+S1 六项标准及 mutation controls 也已独立复审通过。两者都是有界局部结论，不是全系统 V1 acceptance，且针对的是已移除的旧界面组合，新界面组合后必须重新取得。 | 在冻结候选快照上完成账号、商业授权、本地业务、同步和 Connector 的全系统旅程；revoke/deactivate 等待 Host 原子 custody/fencing capability，当前保持 unavailable。 |
| **S1 Sync** | tenant-neutral Push/ACK/Pull/Checkpoint 合同、Cloud ledger、local materializer、Native fixed-origin transport、SyncLane、ProjectionLane、冲突/墓碑底座和退出 drain 已有实现；客户使用持久化 `SyncSnapshot`（pending/open-conflict/rejected counts、applied revision、last activity）和 `checking`/`reachable`/`offline`/`blocked` transport 状态，冲突查看与单候选本地 resolve 已接入。Host 对已提交的可见 Pull/ACK/reject/recovery 变化线性推进 `readGeneration`，精确重放不重复推进；resolve 首次成功严格返回 `expected + 1`。Push/Pull/Checkpoint 按 fail-closed 固定优先级聚合，取消后的迟到成功不能发布。Native 启动/重启从 `checking` 开始，不复用上次成功状态。内部复制诊断不属于客户状态模型。 | D1+S1 当前范围已通过独立 evaluator：六项标准无 blocker，ACK generation、冲突重放、严格 IPC、聚合优先级和 generation-stable publication 五项 mutation control 均被杀死。该证据不覆盖 live PostgreSQL 或全系统 V1。 | 完成受控环境离线、重启、空副本 no-op、Pull 合并、ACK、容量与并发集成验收；补充 live PostgreSQL 并发/RLS 资格。 |
| **C1 Local Connector** | Cloudflare Zone/DNS 只读 Service、固定官方 origin HTTPS、Host-local Token custody、durable prewrite deny fence、ProviderLane、activation/observation Tauri 命令、bounded status/read 和本地优先结果已存在；现有资产本地资源绑定已持久化，域名能力目录和资金确认协议已定义但不可执行。 | 真实受控 Zone 验证、撤销和 post-marker remediation 仍未取得生产资格；DNS 写入、DNSSEC、Registrar 和监控尚无生产执行链。 | 先补资产创建、绑定 UI、Grant/Lease 能力门禁和原子凭据撤销，再逐项实现 DNS/DNSSEC/Registrar/监控以及真实能力资格；revoke/deactivate 在 Host capability 可用前保持 unavailable。 |
| **V1 集成所有者** | 各底层模块已有大量局部测试和策略检查；此前账户恢复/身份批次已提交，本轮域名协议与文档切片通过固定 Node 24.18.1 下的根 `pnpm check`。 | **未完成。** D1+S1 的独立 PASS 是局部证据；本轮域名合同尚未形成完整 Provider manifest 或生产执行链，也没有冻结、可归因并通过全系统独立验收的 V1 候选快照。 | 收口本轮域名合同后建立冻结候选，再执行账号/商业授权、Desktop 授权、本地业务、同步、Cloudflare、Cloud/PostgreSQL、Tauri/Rust 的全系统验收与独立复审。 |

## 当前执行顺序

1. **收口 S0/V1 当前态治理。** 使路线图、验收矩阵、迁移目录、模块 README 和执行台账准确区分源码实现、局部验证、V1 验收与外部资格。
2. **建立冻结候选快照。** 将当前域名协议和文档切片归入可归因、可审查的集成边界；冻结前不得把 D1+C1 或 D1+S1 的局部 PASS 写成 Phase 0 完成。
3. **执行全系统 V1 汇合验收。** 在同一候选快照上覆盖账号/商业授权、Desktop OAuth/Grant/Lease、本地业务、同步/Conflict Center、Cloudflare、Cloud/PostgreSQL 和 Tauri/Rust，再进行独立复审。
4. **分轨补强同步、持久化和外部资格。** 完成 live PostgreSQL 并发/RLS、容量、崩溃恢复和长时间运行验证，并分别关闭 Q-OPS/Q-AUDIT、Q-CF、payment/live sales、Q-NATIVE 和 Q-REL；这些证据不得互相替代。
5. **核心纵向完成后再推进生产备份/rebootstrap。** native picker/稳定 handle、真实 KEK custody、独立 non-rollbackable anchor、true create-only slot custody、safe active-DB move detection 和目标平台故障验证缺一不可；此前能力保持 `unavailable`，且不属于当前 V1 acceptance 主路径。

## 外部资格与发行轨道

以下项目全部仍为开放状态，并由 [Phase 0 外部资格台账](phase0/PHASE0_GATE_REGISTER.md) 管理。它们不会阻止本地功能开发，也不能替代本地功能完成：

| 资格 | 当前边界 |
| --- | --- |
| **Q-AUDIT** 生产 OpenBao custody | 开发 Transit 已用于功能验证；生产集群、不可导出 key、workload identity、seal/轮换和独立审查未取得。 |
| **Q-CF** Cloudflare 真实资格 | Host-local 只读实现存在；真实受控 Zone、最小 Token、限流/移除行为和独立安全审查未取得。 |
| **Q-OPS** 生产运行 | 共享 VPS 开发组合不等于生产；生产 PostgreSQL、邮件、scheduler/worker、监控、灾备和环境隔离未资格化。 |
| **支付与销售资格** | Stripe test mode 已验证；Stripe live、生产商户值、税务/销售地区尚未启用。PayPal 保持可选且不阻断首发。 |
| **Q-NATIVE / Q-REL** 原生与发行 | 最终构件签名/公证、目标平台验证、归档、独立审查和 `1.0.0` / `stable` 批准均未取得。 |

## v1 范围边界

首发目标包含个人默认工作区、本地域名资产、secret-free 同步、Cloudflare 域名相关的 Zone/DNS、
DNSSEC、Nameserver、Registrar 生命周期与监控，以及商业授权；每项 Provider 能力必须单独
实现和资格化。所有资金操作逐笔用户确认，转入/转出可由 Provider 页面完成后在 Desktop 对账。
浏览器自动化、非域名 Provider 产品、市场连接、团队/多工作区、凭据迁移和 CSV import 仍是排除项。
当前生产源码仍只组合 Cloudflare Zone/DNS 只读观察，不得把目标范围当作已完成能力。
完整验收定义见 [VERIFICATION.md](VERIFICATION.md)。
