# GoodDealer 连接器规范

## 适用范围

连接器合同定义提供商集成的边界。仓库中目前唯一的连接器包是 Cloudflare 的非秘密域名 Provider
合同；它不代表任何 Provider 能力已经取得真实资格或可执行。

## 已接受的目标模型

### 首发范围：多平台域名资产生命周期

首发连接器目标覆盖十二个平台：Cloudflare、Spaceship、Atom、Afternic、Namecheap、Dynadot、GoDaddy、Porkbun、
Sedo、易名、阿里云、22.cn（[ADR-0027](adr/0027-multi-platform-domain-providers-and-marketplaces.md)）
（[ADR-0027](adr/0027-multi-platform-domain-providers-and-marketplaces.md)）。一个平台连接可同时承担
`registrar`、`dns`、`marketplace`、`acquisition` 角色；按用户工作流纵向交付，完整能力目录覆盖：
注册商生命周期（注册、续费、恢复、转入/转出与授权码、转移锁、联系人/WHOIS 隐私、Nameserver/glue）、
DNS/DNSSEC、交易市场（Listing、价格、成交、所有权验证）、获取（搜索、竞价、补抢、购买）与监控。
每项能力使用具名 manifest 和最小权限；平台不支持、准入未获批或尚未资格化的能力显式标记为不可执行。
Token、Provider 身份和原始响应始终由本地受限 Host 保有。

按 [ADR-0027](adr/0027-multi-platform-domain-providers-and-marketplaces.md)，已确认官方支持的能力使用官方 API；当前未找到
官方支持的缺口全部进入自研私有 HTTP 适配开发，社区代码仅作参考；缺口不转为永久人工流程。私有适配可在 Native 内保管必要会话并
有界解析平台表单，仍由同一平台 Service 拥有，不执行远程脚本或开放任意网页抓取。尚未实现或需要
登录挑战的步骤可交接用户浏览器，回桌面后重新对账，回跳不构成成功回执。所有资金操作（含每次出价）
逐笔确认；难以撤销的操作也需逐项明确确认。用户 CSV 导入、嵌入式浏览器和非域名产品能力不在范围内。
每项能力的条款、受控资源、速率/错误观察和独立审查都是其发布资格，核查记录见 [接入核查](PROVIDER_API_REVIEW.md)。

### 每平台私有 Service 与协议所有权

每个平台的协议归 `secure-host-core` 内该平台的一个私有 Service：endpoint、查询、认证构造、Provider wire
和领域映射均由它自主维护，Provider wire 在 Service 内有界解析并重建为 GoodDealer 领域合同，不得跨 IPC、
Cloud 或 TypeScript 边界；每个平台只有一条运行时路径。各 Service 共用凭据 custody、固定 authority、加固
Transport、按平台速率限制、闭合错误、能力准入与未知结果对账框架；该框架不对外暴露通用 Provider 代理。
跨平台流程（例如在另一平台的 DNS 上发布交易市场的所有权验证记录）由本地 operations 编排为父计划中的独立步骤，
非资金操作整批预览确认一次；按 ADR-0027 限定 DNS 修改范围，重开先对账再续作，
Service 之间不直接调用、不共享凭据。

十二个平台的 Service 骨架位于 `crates/secure-host-core/src/provider_services/`，每个平台一个模块，`IMPLEMENTED` 列出本地已实现、待资格的能力，必须与协议 manifest 的 `qualification_pending` 条目一致（协议测试 `domain-provider-host-mirror.test.ts` 校验）。修改协议 manifest 的已实现清单时同步修改对应模块。

### 连接器所有权

- 每个提供商连接由具体连接器领域拥有，公开最小、严格的请求、响应和错误合同。
- 连接器可产生允许字段的业务投影；第三方账号、Provider Account ID、账号别名、Credential
  Binding、平台凭据、浏览器会话和原始秘密响应必须全部留在受限本地所有者。
- 连接器不能让调用方选择任意网络目标、秘密、适配器或持久化路径。
- 读、写、验证、导入和人工辅助是不同的能力，应分别定义输入、授权、结果和失败语义。

### 外部副作用

每个待接入的提供商操作需要精确能力范围、适用条款、可丢弃测试资产、最小权限授权、前后
观察、清理策略和独立审查。未知、未审查或未资格化的提供商能力必须保持不可执行；首发平台
清单以外的所有提供商能力也同样不可执行。

## 当前实现

`secure-host-core` 已实现私有 Cloudflare Zone/DNS 只读观察、Registrar 账户库存、Credential Fence、固定来源的加固
HTTPS Transport，以及自主维护的私有 endpoint、查询参数和 Provider wire；
`packages/connectors/cloudflare` 只公开 Host-local 非秘密领域合同。Cloud 中连接键控的 Observation
Repository 已移除，M002 仅存允许字段的脱敏副本，`cloud-client` 也不再公开 Cloudflare Observation submit/read。
Desktop 已组合用户触发的原生 Token 激活、状态、观察、本地读取，以及从已提交且已验证的 Zone 观察派生的现有资产本地绑定。原生 Grant/Lease 门禁和原子撤销已组合。缺少真实受控 Provider
资格，客户环境尚不能执行相应读取与写入。已组合的 Registrar 设置入口使用受限原生连接、独立签名权益及资格，完整导入后读取持久汇总。协议覆盖目录（版本 2：每项能力带
registrar/dns/marketplace/acquisition 角色，覆盖 ADR-0027“完整域名能力目录”的全部能力）、每平台 capability manifest 骨架
（十二个平台 × 全部目录能力，逐项写明不可执行原因：`platform_facts_pending` 或 Cloudflare、GoDaddy、Spaceship、阿里云、Atom 与 Sedo 只读观察的
`qualification_pending`，没有可执行状态）与单项资金确认引用已定义，仍不可执行；Provider-specific 最小权限及未知结果
对账资格尚需逐项确证。
Afternic 的原生库存已通过真实 Linux 开发账户读取。Spaceship Registrar 已通过 Native 连接、设置页、ProviderLane 和单 SQLCipher writer 组合完整归集，使用独立签名权益及资格。阿里云按相同客户入口组合同一批量资产事务，采用独立 ACS3 签名及 Native 托管。GoDaddy 用自己的 PAT 槽和官方 v3 读取作用域，复用原 Registrar 资产事务。各平台实测与发行状态见 [当前实现](CURRENT_IMPLEMENTATION.md)。
Atom 使用官方卖家库存、精确详情和 Standard 下架接口。设置页读取持久库存，批量页读取签名确认和逐域名对账结果。原生专属托管和 Listing 绑定沿用各自所有者。实际账户、认证缺席及目标系统资格仍待验收。
Sedo 使用官方 Basic API 卖家库存接口和 Native 专属托管，复用原 Listing 绑定与设置持久计数。认证账户和实机资格仍待验收。

## 证据边界

描述符、合同测试、夹具、静态扫描和本地报告仅证明仓库结构。它们不证明提供商授权、
网络结果、秘密 custody、部署或商业可用性。
