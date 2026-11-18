# GoodDealer 工程结构与模块边界

## 目的、读法与状态标签

本文件是运行时、信任域和业务能力的所有权地图。它不拥有 v1 能力矩阵；范围和依赖见
[路线图](ROADMAP.md)，详细验收见 [验证边界](VERIFICATION.md)。新增工作先确定拥有 runtime、
信任域和能力，再放入对应模块；不能创建泛化的 `shared`、`common` 或 `utils` 逃避边界。

阅读本文件时区分以下标签：

| 标签 | 含义 |
| --- | --- |
| **Decision constraint** | 已接受 ADR 固定的范围和约束，不是当前实现声明。 |
| **Current source state** | 本次检查的源码事实；源码变更后必须覆盖更新。 |
| **Local implementation gate** | 在仓库内可以验证并允许有界 Desktop/Cloud API 工作继续的条件。 |
| **External qualification** | 只限制部署、真实提供商、原生、发行或 Gate 的对应声明，绝不序列化本地实现。 |

当前普通文档不能把旧架构或未修复缺陷当作兼容说明保留。历史材料只属于明确的历史记录位置，
而非本文件的当前结构描述。

## 顶层所有权树

```text
apps/
  desktop/        Tauri 壳、Desktop 展示入口和最小应用组合
  cloud/          Cloud 领域、持久化、公开/内部边界及作业组合
  account-web/    独立账户与合规网页边界；开发部署含真实 Stripe test-mode 付款 UI
  admin-web/      future: 独立内部管理展示边界
  marketing-web/  静态营销站点
packages/
  protocol/       严格跨语言 wire 合同
  client-core/    主机无关领域模型、展示模型和端口
  cloud-client/   Cloud 账号控制面与同步恢复客户端；禁止作为 Desktop Repository
  connectors/cloudflare/  唯一 Cloudflare 非秘密合同与测试资产
  ui/             通用展示组件、tokens 和静态 assets
  i18n/           本地化文案和确定性格式化
crates/
  secure-host-core/  受限本地权威与秘密 custody 的基础
  local-storage/     本地数据所有者和受限持久化基础
  automation-host/   future: 浏览器策略基础（不属于 v1）
```

跨包/跨 crate 只能使用 `package.json` 或 crate 的声明公开面、协议合同或端口。禁止深层导入、
未声明 workspace 边、复制另一个模块的 schema/持久化模型、动态导入逃避审查，以及在应用入口
直接访问另一个领域的 repository。

## 应用、信任域和组合责任

| 区域 | 拥有的职责 | Local implementation gate | 外部资格边界 |
| --- | --- | --- | --- |
| `apps/desktop` | 受限展示、已验证投影、最小 Desktop/Host 适配和用户可见失败状态。 | 只消费已声明的合同；UI 不拥有秘密、租户、持久化、网络或授权；需要的 Tauri command/capability 必须是能力专属且可测试。 | 原生签名/公证和平台观察只限制原生/客户构件声明。 |
| `apps/cloud` | 服务器端身份、授权、默认工作区范围、同步副本、恢复与作业组合。 | public route 只能在拥有领域、认证、服务器端范围和严格 schema 实际组合后注册；业务副本不能成为 Desktop Repository。 | 托管环境、部署、监控和运行观察只限制已部署服务声明。 |
| 最小 Host / `secure-host-core` | 秘密 custody 和能力专属本地操作；私有 Cloudflare Service 独占 Provider endpoint/wire、Credential Fence 与加固 HTTPS Transport。 | 不提供通用 bridge、文件/网络/密钥/endpoint 选择面；Provider wire 在 Host 内重建为领域类型；每个新 command/port 都有输入验证、最小权限和负向测试。 | 真实凭据、原生平台和提供商观察只限制外部效果/可用性声明。 |
| `packages/protocol` 与 `packages/cloud-client` | tenant-neutral 账号激活、授权 grant、同步 ACK/Cursor/Checkpoint 与恢复 wire、`unknown` 响应解析。 | transport 请求不携带租户、网络、凭据或提供商权威；grant 解析不替代签名验证；Cloud replica 先合并到本地 SQLCipher 才能供 Query 使用。详见[首切片共享合同](FIRST_SLICE_SHARED_CONTRACT.md)。 | 不产生服务、部署或客户路径证据。 |
| `packages/ui` 与 `packages/i18n` | 无权威的通用展示资源与文案。 | 仅使用 public exports；组件/文案不能决定路由、授权、秘密、网络或副作用。 | gallery、copy 和视觉验证不能成为产品或提供商事实。 |
| connector 包 | 特定 Cloudflare 非秘密合同和测试资产。 | TypeScript connector 不拥有 Provider 实现、Token 或网络；allowlist、脱敏和只读合同可以本地测试。 | 条款、受控 Zone、速率/移除行为和安全审查才限制真实 Cloudflare 观察声明。 |

应用入口必须保持薄：它们组合已验证的合同和拥有模块，不能直接承载领域决策、认证绕过、
租户范围、数据库访问或未审查的外部调用。

## v1 的本地组合规则

v1 的 Provider 目标是域名资产生命周期能力；当前源码已组合的 Provider 能力仍只有 Cloudflare
API-only Zone/DNS 只读观察，其余 DNS/DNSSEC/Registrar/监控能力必须按具名 capability 逐项接线。
这些工作可在相互独立的 Desktop 展示、Host 合同准备、Cloud API 和持久化领域中并行进行，
但每一条垂直路径都必须满足自己的真实本地依赖。具体验收行在 [验证边界](VERIFICATION.md)，
本文件不重复能力矩阵。

所有本地组合都满足下列规则：

1. Account 与唯一个人默认 Workspace 的身份/范围只由服务器端主体和默认绑定导出；客户端不选择
   `accountId` 或 `workspaceId`。
2. 资产路径读写本地 SQLCipher；展示层只能调用具名业务端口，不能直接访问 SQLite。业务事务与
   Sync Outbox 原子提交，Cloud 恢复投影不能被 UI 直接读取。
3. 当前 Cloudflare 实现为 API Zone/DNS read；其余已接受的域名能力按各自合同继续实现。Token 只在受限本地所有者内；Cloud、普通 TypeScript、
   日志、错误、审计 payload 和 fixture 都不能接触它。GoodDealer 私有 Service 自主维护 Zone/DNS
   endpoint、Provider wire、Transport、Credential、authority、错误与能力准入，私有 Provider 类型
   不得跨出 Host。
4. `brand/` 是视觉参考，绝不作为运行时或设计权威。生产共享 UI 只能从 `@gooddealer/ui` public
   exports、声明的 tokens/assets 和 `@gooddealer/i18n` public exports 消费；没有 `@gooddealer/ui-brand`、
   别名、深层 import 或临时共享 UI 路径。
5. 没有兼容/过渡接口、双 data/session 路径、旧路由、迁移桥、通用 adapter、未经声明的提供商 fallback 或
   浏览器 fallback。[ADR-0027](adr/0027-multi-platform-domain-providers-and-marketplaces.md)允许同一平台 Service 内的具名私有 HTTP
   实现，不允许失败后隐式切换接口重放写入。夹具、gallery、样例数据和视觉 callback 不得进入生产依赖图，也不授予权威。
6. v1 不组合浏览器、非域名 Provider 产品、首发清单外平台、团队/多工作区、凭据迁移或 CSV import；域名 Provider
   写入、Registrar、交易市场、获取和外部 mutation 只有在具名能力、审批、对账和资格完成后才能接线。

## 当前实现与 Local Host 内部结构

源码组合状态统一见 [当前实现](CURRENT_IMPLEMENTATION.md)。命令以 Tauri `generate_handler!`、
manifest 与 capability 为准，Cloud 路由以对应 composition factory 和注册表为准，迁移顺序以
`apps/cloud/src/db/migrations.ts` 为准。本文件不维护另一份会过期的命令、路由或迁移数量。

`crates/local-storage/src/desktop_local_host/` 是唯一 Local Host 聚合所有者：

| 私有模块 | 职责 |
| --- | --- |
| `mod.rs` | 构造、共享状态、数据库所有权和锁/代次不变量；crate 根继续导出原有窄 API。 |
| `authorization.rs` / `authority.rs` | 授权状态发布与限制转换 / 严格签名授权验证。 |
| `business.rs` | 业务读取、修改、冲突处理与最终提交栅栏。 |
| `sync.rs` | Native Cloud 准入、复制阶段和受栅栏保护的持久化提交。 |
| `provider.rs` | Provider 本地观察与凭据变更事务协调；实际秘密 custody 和 HTTPS 仍属于 Secure Host。 |
| `backup_workflow.rs` / `native_backup.rs` | 备份意图、检查、恢复工作流 / 原生文件准入与发布。 |
| `container.rs` / `source.rs` / `restore.rs` / `continuity.rs` | GDBK 加密容器、业务投影、当前数据库恢复事务与授权连续性。 |
| `recovery.rs` | Cloud rebootstrap 的 Host 入口；当前生产实现缺口不能被测试组合替代。 |
| `test_support.rs` / `tests.rs` | 私有测试组合及跨能力故障/并发回归，不是运行时可选后端。 |

这些模块共享同一个 Host 状态，不各自创建数据库 writer。授权转换先发布代次，业务、同步与备份
仍遵守原有锁顺序和提交栅栏；拆分不增加跨 crate 的数据库、密钥、明文或任意回调接口。

## Cloud 领域与持久化所有权

| 领域 | 拥有内容 | 必须保持的边界 |
| --- | --- | --- |
| identity / workspace | 账户激活、默认绑定、服务器端租户范围、允许字段的同步副本和恢复投影。 | 认证后导出范围；副本不是 Desktop Repository；没有成员、选择器、转移或跨账户共享。 |
| workspace / observation | 拥有 allowlisted Cloudflare 计数观察副本与 ingress；经服务器端认证与工作区范围准入。 | 不保存 Provider 账号身份或凭据；不把本地不透明连接引用提升为第三方账号身份或执行权威；不代表 Desktop 调用 Provider。 |
| audit | 服务器审计记录与其受限签名边界。 | 审计不成为通用秘密、密钥或授权旁路。 |
| job/runtime | 由具体领域拥有的后台作业。 | 空注册表不是未来 capability 的占位授权；有作业时先取得领域、租户、幂等、失败和审计合同。 |

每个领域拥有自己的迁移、repository、端口和测试。共享协议不等于共享数据库权限；Cloud route、
内部入口和作业都不能在实际服务器端授权与租户隔离之前注册。

## 本地门槛与外部资格的分界

| 需要继续本地实现的条件 | 只限制外部声明的条件 |
| --- | --- |
| 已接受的 ADR 范围、唯一拥有模块、严格合同、`unknown` 验证、服务器端授权/范围、领域持久化和对应负向测试。 | 托管 PostgreSQL/部署、生产 OpenBao 集群/key/workload identity、真实 Cloudflare Token/Zone、原生签名/公证、归档、独立审查、发行和 Gate。 |
| 已命名的共享面整合负责人，以及本地 UI→Host→Cloud API→persistence 验收。 | 这些资格只能授权它们观察到的真实环境、提供商、构件或发行事实。 |

因此，外部资格不能阻止已冻结、已授权范围内的 Desktop 和 Cloud API 本地实现；反过来，本地
实现或测试不能被提升为部署、提供商、原生、发行或 Gate 事实。

## 变更与验证规则

1. 在写代码前识别拥有 runtime、信任域、业务能力、公开合同和共享面负责人。
2. 在拥有模块中建立最小实现、严格输入和比例适当的正/负测试；应用入口只组合，不重写领域规则。
3. 跨边界设计由架构角色先冻结；共享入口、导出、迁移和当前源码快照由具名整合负责人收敛。
4. 任何修复后重新运行相关验证；独立评估者而非构建者接受工作。
5. 搜索所有受影响的术语、排除项和当前状态断言，更新当前文档、合同、配置、示例和检查；完整
   仓库变更运行根 `pnpm check`，最终运行 `git diff --check`。
