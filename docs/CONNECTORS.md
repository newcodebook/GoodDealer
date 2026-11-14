# GoodDealer 连接器规范

## 适用范围

连接器合同定义提供商集成的边界。仓库中目前唯一的连接器包是 Cloudflare 的非秘密域名 Provider
合同；它不代表任何 Provider 能力已经取得真实资格或可执行。

## 已接受的目标模型

### 首发范围：多平台域名资产生命周期

首发连接器覆盖 8 个平台：Cloudflare、Spaceship、Atom、Afternic、Namecheap、Dynadot、GoDaddy、Porkbun
（[ADR-0027](adr/0027-multi-platform-domain-providers-and-marketplaces.md)）。一个平台连接可同时承担
`registrar`、`dns`、`marketplace`、`acquisition` 角色；接入一个平台时一次实现它全部域名相关能力：
注册商生命周期（注册、续费、恢复、转入/转出与授权码、转移锁、联系人/WHOIS 隐私、Nameserver/glue）、
DNS/DNSSEC、交易市场（Listing、价格、成交、所有权验证）、获取（搜索、竞价、补抢、购买）与监控。
每项能力使用具名 manifest 和最小权限；平台不支持、准入未获批或尚未资格化的能力显式标记为不可执行。
Token、Provider 身份和原始响应始终由本地受限 Host 保有。

没有 API 的操作只能交接到用户自己的浏览器，回桌面只触发对账，不构成成功回执。所有资金操作
（含每一次出价）必须逐笔单独确认；难以撤销的操作也需逐项明确确认。用户 CSV 导入、网页抓取、
嵌入式浏览器和非域名产品能力不在范围内。每项能力的条款审查、受控资源、速率/错误观察和独立审查
都是其发布资格。

### 每平台私有 Service 与协议所有权

每个平台的协议归 `secure-host-core` 内该平台的一个私有 Service：endpoint、查询、认证构造、Provider wire
和领域映射均由它自主维护，Provider wire 在 Service 内有界解析并重建为 GoodDealer 领域合同，不得跨 IPC、
Cloud 或 TypeScript 边界；每个平台只有一条运行时路径。各 Service 共用凭据 custody、固定 authority、加固
Transport、按平台速率限制、闭合错误、能力准入与未知结果对账框架；该框架不对外暴露通用 Provider 代理。
跨平台流程（例如在另一平台的 DNS 上发布交易市场的所有权验证记录）由本地 operations 编排为独立计划，
Service 之间不直接调用、不共享凭据。

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

`secure-host-core` 已实现私有 Cloudflare Zone/DNS 只读观察、Credential Fence、固定来源的加固
HTTPS Transport，以及自主维护的私有 endpoint、查询参数和 Provider wire；
`packages/connectors/cloudflare` 只公开 Host-local 非秘密领域合同。Cloud 中连接键控的 Observation
Repository 已移除，M002 仅存允许字段的脱敏副本，`cloud-client` 也不再公开 Cloudflare Observation submit/read。
Desktop 已组合用户触发的原生 Token 激活、状态、观察、本地读取，以及从已提交且已验证的 Zone 观察派生的现有资产本地绑定。绑定仅持久化本地关联，不创建资产、不执行 Provider API 写入；绑定 UI、完整 Grant/Lease 能力门禁和原子撤销仍待完成。缺少真实受控 Provider
资格，因此不能声称客户环境中的读取、写入或 Registrar 能力可用。协议覆盖目录与单项资金
确认引用已定义，仍不可执行；Provider-specific 最小权限及未知结果对账资格尚需逐项确证。
Cloudflare 以外的 7 个首发平台尚无 Service、合同或 Desktop 组合。

## 证据边界

描述符、合同测试、夹具、静态扫描和本地报告仅证明仓库结构。它们不证明提供商授权、
网络结果、秘密 custody、部署或商业可用性。
