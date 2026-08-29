# GoodDealer 验证边界与 v1 验收

## 读法与证据分类

本文件拥有 v1 的详细垂直验收定义，而 [路线图](ROADMAP.md) 只拥有简明能力地图和依赖。这里的
每一项证据必须说明它能支持的精确声明；本地实现证据和外部资格不能互相替代。

| 证据标签 | 观察对象 | 可以支持的声明 | 不能支持的声明 |
| --- | --- | --- | --- |
| **Decision constraint** | 已接受 ADR 与决策登记。 | 固定的范围、排除项和信任边界。 | 当前组合、部署、提供商可用性或发行。 |
| **Current source state** | 本次检查的生产入口、注册表、合同和模块源码。 | 该源码当前包含/不包含什么。 | 设计目标已经交付，或未检查入口的不可达性。 |
| **Local implementation evidence** | 可复现的模块、合同、垂直或边界测试。 | 被测试的本地行为和失败关闭边界。 | 部署、真实提供商、原生构件、客户可用性、发行或 Gate closure。 |
| **External qualification evidence** | 真实环境、最终原生构件、受控提供商观察、独立审查或批准。 | 所列的部署、提供商、原生、发行或 Gate 事实。 | 未观察的其他环境或未来能力。 |
| **Historical repository evidence** | 明确以审计/历史为目的的保留记录。 | 该历史时点的事实。 | 当前 readiness、可用性或 Gate closure。 |

本地 Desktop 与 Cloud API 工作可在已接受范围和本地合同下并行开始、继续和验收。通过本地测试只
表示相应的本地实现证据；它绝不证明部署、托管数据库、真实 Cloudflare 行为、原生签名/公证、
客户发行或 Gate。真实外部效果必须在其资格完成前失败关闭。

## 当前源码状态和范围控制

以下是本次源码快照，而不是能力可用性声明：

| 区域 | Current source state | 声明限制 |
| --- | --- | --- |
| Desktop Host | Tauri 精确注册本地业务状态、Portfolio 读取和 DomainAsset 写入三个命令；Runtime 未获授权时锁定；本地数据库 key 的 keychain/CSPRNG/零化材料由 `secure-host-core` 持有。 | 不证明账号 grant/Lease 签名验证、原生平台资格或客户发行已完成。 |
| Desktop production graph | `apps/desktop/src/app.tsx` 只使用窄本地业务 adapter；不导入 `cloud-client`、Provider 或数据库实现。 | 本地纵向存在不等于真实登录、Provider 或发行可用。 |
| Cloud public composition | `publicBusinessRoutes` 精确包含 `POST /v1/account/activation`，public OpenAPI 精确包含两条 boundary route 加该业务 route；路由只授权 `account_web` 主体，拒绝未认证、Desktop 主体和客户端租户选择字段。`adminBusinessRoutes` 与 `periodicJobs` 仍为空。 | 本地 route/HTTP 测试不等于已部署客户 API；PostgreSQL composition 测试需要 `GOODDEALER_POSTGRES_*` 环境。 |
| 首切片共享合同 | `@gooddealer/protocol` 与 `@gooddealer/cloud-client` 已公开 tenant-neutral 激活、授权 grant、Mutation ACK、Pull Cursor、Checkpoint 与恢复输入合同。 | 合同与激活 route 不证明 grant/sync route、Desktop transport、Lease 签名验证或端到端组合已经存在。 |
| Cloudflare Secure Host | `secure-host-core` 已实现私有 Zone/DNS 只读 Service、Credential Fence、固定 `api.cloudflare.com` 的加固 HTTPS Transport，以及自主维护的私有 endpoint/Provider wire。 | 本地实现未组合原生秘密录入、Tauri Command、Cloud API 或真实提供商资格，不能声明客户可用。 |
| 已接受目标 | ADR-0013、连接器规范和 ADR-0017 固定个人默认工作区、Cloudflare API-only 只读观察和无浏览器。 | 决定约束不等于实际账户、资产读取或提供商观察。 |

Desktop production 图的范围控制由源码测试持续验证；后续组合任何 feature、Host 或 connector 时必须
更新当前态并重新执行 production-entrypoint reachability 检查，不得恢复已删除的 connector 注册、
兼容或过渡路径。

## 本地实现通用验收门槛

每个 v1 垂直路径在被称为“本地已验收”前都必须有以下证据：

1. 仅使用已声明的公开合同/端口；所有 wire 或不可信输入从 `unknown` 严格验证，未知字段和
   不匹配响应失败关闭。
2. 服务器端从认证主体和默认绑定导出租户范围；Desktop、Host、缓存和请求参数不能选择或扩大
   `accountId`、`workspaceId`。
3. 展示层没有秘密、直接持久化、直接网络/提供商权威或通过 callback/fixture 获得的结果。
4. 对应的正向垂直测试和负向控制都已实际运行，并记录准确命令、退出状态和适用范围。
5. 本地路径没有引入浏览器、写入、市场/注册商、团队/多工作区、凭据迁移、CSV import 或任何
   compatibility/transition/fallback 路径。
6. 所有共享入口、公开导出、协议、迁移和当前文档由具名整合负责人重新检查。

账户、授权和同步实现必须采用[首切片共享合同](FIRST_SLICE_SHARED_CONTRACT.md)的 operation id、schema、
ACK 关联和恢复语义；不得在 Cloud 或 Desktop 内复制或放宽这些 wire 定义。

Cloud boundary 门禁在 activation application port 尚未进入同一集成树时报告 `pending-integration`；
一旦该 port 存在，就 fail closed 地要求唯一 activation 业务 route、三条 public OpenAPI path、protocol
public schema、认证主体派生范围以及租户选择字段/未认证/Desktop 主体的负向观察。Repository topology
同样以 `secure-host-core` 的本地数据库 key capability 为接线标记：标记存在时，Desktop Tauri manifest
必须声明 `gooddealer-secure-host-core`，且 `getrandom`、`security-framework`、`zeroize` 不得下沉到
Desktop 或 `local-storage`。

## v1 详细垂直验收

这是 [路线图](ROADMAP.md) 三项 v1 能力的详细验收表，不是第二份能力地图。每行都必须保持
授权走 UI → Host → Cloud control plane；业务走 UI → Host → local SQLCipher，随后由 Outbox 异步
复制到 Cloud。任一未组合层都不能由其他层的测试替代。

| v1 能力 | Desktop UI | Host 边界 | Cloud API | 持久化 | 本地正向证据 | 必须失败关闭的负向控制 | 后续外部资格及其唯一授权声明 |
| --- | --- | --- | --- | --- | --- | --- | --- |
| **账户激活与个人默认工作区** | 只收集协议定义的激活意图，呈现 pending/accepted/rejected；不选择账户或工作区。 | 只在必要时提供最小、已声明的 transport/wire 适配；没有通用 Tauri bridge、秘密、业务策略或租户选择。 | 已认证激活从服务器主体解析范围，并在同一业务流程中创建/解析默认所有者绑定。 | 单一服务器事务创建不可变 Account、不可变个人默认 Workspace 和唯一所有者绑定；失败不留下半成品路径。 | 严格请求/响应解析；Desktop→Host→Cloud 的本地合同集成；原子创建/回滚与重试语义；拥有模块的事务测试。 | 未认证调用、客户端指定/替换 `accountId` 或 `workspaceId`、未知 wire 字段、重复/部分激活、跨租户读取都被拒绝。 | 部署与受管数据库/运行证据只授权“已部署账户服务”声明；原生/发行资格只授权对应客户构件或发行声明。 |
| **本地域名资产读写** | list/detail/edit 使用本地 Query/Command；显示本地提交和待同步状态。 | Host 拥有路径和密钥，只公开具名命令。 | Cloud 只接收字段白名单 Mutation 并返回 ACK/Cursor。 | 本地业务表与 Outbox 原子提交；Pull 经本地事务合并。 | Cloud transport 缺失仍可读写、原子回滚、空副本 no-op、Pull 不回声 Outbox。 | 未授权、路径/密钥/租户注入、秘密字段、Cloud 空副本删除和直接 Cloud Query 均失败关闭。 | Cloud 部署只授权同步服务主张；本地行为不依赖该资格。 |
| **Cloudflare API-only Zone/DNS 只读观察** | 显示本地保存的连接状态和本地 Provider 观察。 | 本地 Host 独占第三方账号、Provider Account ID、别名、Token 和 HTTPS read。 | 无 Cloud Observation submit/read；Cloud 不调用 Provider。 | Provider 账号和密封凭据只写本地；允许的业务字段经 DomainAsset Outbox 同步。 | no-secret Mutation、无 Cloud connection persistence、Host read allowlist 和本地结果持久化测试。 | 账号 metadata/Token 泄漏、Cloud Provider 调用、DNS 写、浏览器 fallback 和任意网络均被拒绝。 | 条款、最小 Token、受控 Zone 和独立审查才授权真实 Provider 可用性。 |

## 跨越三条路径的负向边界

| 边界 | 必须验证的拒绝行为 |
| --- | --- |
| 授权与租户 | 客户端或缓存不能创建、选择、替换或扩大 Account/Workspace 范围；所有读取首先由服务器端绑定授权。 |
| 协议 | 未知、缺失、类型错误或与请求不一致的 wire 数据从 `unknown` 拒绝，不能隐式 fallback。 |
| 秘密与外部效果 | 秘密不进入普通应用状态、Cloud、日志、错误、审计或夹具；外部动作没有明确最小权限合同时不得发生。 |
| v1 排除项 | 浏览器、提供商写入、市场/注册商、团队/多工作区、凭据迁移、CSV import 和所有外部 mutation 没有可达产品路径。 |
| 视觉与夹具 | `brand/`、视觉 fixture/gallery、样例数据和 disabled 控件只能用于展示 QA，不能证明状态、授权或外部结果。生产 UI 只消费 `@gooddealer/ui` public exports、声明的 tokens/assets 与 `@gooddealer/i18n` public exports。 |
| 过渡面 | 不存在旧路由、双 data/session 路径、兼容 API、别名、临时 adapter、迁移桥或浏览器/提供商 fallback。 |
| 当前 Desktop 图 | production 入口只允许具名本地业务 adapter；任何新增命令需同步 manifest、handler、capability、adapter 与策略测试。 |

## 外部资格不是本地完成门槛

| 外部资格 | 所需证据 | 它限制的声明 | 它不限制的工作 |
| --- | --- | --- | --- |
| Cloud 部署与托管数据库 | 已批准环境、迁移应用、运行监控和运行时观察。 | 已部署服务、托管数据和客户可用 Cloud API。 | 已冻结合同下的本地身份、投影、API 和持久化实现。 |
| Cloudflare 资格 | 条款、最小 Token 指南、受控 Zone 观察、限流/错误/移除验证和独立安全审查。 | 真实提供商观察或连接器可用性。 | API-only 只读合同、秘密隔离、脱敏投影和失败关闭的本地测试。 |
| 原生资格 | 最终平台构件、签名/公证或 Windows/macOS 观察。 | 原生已签名/已公证或可交付客户端。 | Tauri/React/Host 的本地受限实现和测试。 |
| 发行与 Gate | 干净构件、持久归档、独立审查和 ADR-0018 所需批准。 | `1.0.0` / `stable`、客户发行和 Gate closure。 | 已接受 v1 范围内的本地工作包和垂直验收。 |

## 运行与报告规则

完整仓库变更运行根 `pnpm check`；每个变更还运行其拥有模块的测试、必要的协议/边界检查、当前
源码检查、内部链接验证、受影响术语扫描和 `git diff --check`。报告只记录本次实际命令与输出。

任何“通过”都必须使用限定语：`本地实现证据通过`、`当前源码状态已检查` 或明确的 `外部资格
已取得`。不得把本地或历史仓库证据称为部署、提供商、原生、发行或 Gate 通过。
