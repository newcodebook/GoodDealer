# GoodDealer 连接器规范

## 适用范围

连接器合同定义提供商集成的边界。仓库中唯一连接器包是 Cloudflare 的非秘密域名 Provider
合同；它不代表任何 Provider 能力已经取得真实资格或可执行。

## 已接受的目标模型

### 首发范围：域名资产生命周期

首发唯一连接器是 Cloudflare 的域名资产 Provider。能力覆盖连接与资源绑定、Zone/DNS、DNSSEC、
Nameserver、Registrar 生命周期、联系人/WHOIS 隐私、转移授权码和监控。每项能力使用具名
manifest 和最小权限；Token、Provider 身份和原始响应始终由本地受限 Host 保有。

Provider 页面可用于转入/转出等流程，但回桌面只触发对账，不构成成功回执。所有资金操作
必须逐笔单独确认；难以撤销的操作也需逐项明确确认。CSV 上传、网页抓取、嵌入式浏览器和非域名产品能力不在范围内。
每项能力的条款审查、受控资源、速率/错误观察和独立审查都是其发布资格。

### Cloudflare 私有 Service 与协议所有权

Cloudflare 同时是目标中的 DNS/权威 NS 平台和域名注册商。当前源码只组合前述 Zone/DNS 读取，
但实现不能把 Provider 协议散落在 Desktop、普通 TypeScript 或多个 HTTP 客户端中。所有当前与
未来 Cloudflare 能力都归 `secure-host-core` 内的一个私有 Cloudflare Service，并共享同一凭据
custody、固定 authority、加固 Transport、闭合错误和能力准入。

Zone/DNS endpoint、查询、Provider wire 和领域映射均由该私有 Service 自主维护。Provider wire
必须在 Service 内完成有界解析并重建为 GoodDealer 领域合同，不得跨 IPC、Cloud 或 TypeScript
边界。DNSSEC、完整 RRset、批量操作与 Registrar 能力仍在同一 Service 中按具名 capability
增加；禁止建立第二条直接 REST 运行时路径。

### 连接器所有权

- 每个提供商连接由具体连接器领域拥有，公开最小、严格的请求、响应和错误合同。
- 连接器可产生允许字段的业务投影；第三方账号、Provider Account ID、账号别名、Credential
  Binding、平台凭据、浏览器会话和原始秘密响应必须全部留在受限本地所有者。
- 连接器不能让调用方选择任意网络目标、秘密、适配器或持久化路径。
- 读、写、验证、导入和人工辅助是不同的能力，应分别定义输入、授权、结果和失败语义。

### 外部副作用

每个待接入的提供商操作需要精确能力范围、适用条款、可丢弃测试资产、最小权限授权、前后
观察、清理策略和独立审查。未知、未审查或未资格化的提供商能力必须保持不可执行；首发
Cloudflare 以外的所有提供商能力也同样不可执行。

## 当前实现

`secure-host-core` 已实现私有 Cloudflare Zone/DNS 只读观察、Credential Fence、固定来源的加固
HTTPS Transport，以及自主维护的私有 endpoint、查询参数和 Provider wire；
`packages/connectors/cloudflare` 只公开 Host-local 非秘密领域合同。Cloud 中连接键控的 Observation
Repository 已移除，M002 仅存允许字段的脱敏副本，`cloud-client` 也不再公开 Cloudflare Observation submit/read。
Desktop 已组合用户触发的原生 Token 激活、状态、观察、本地读取，以及从已提交且已验证的 Zone 观察派生的现有资产本地绑定。绑定仅持久化本地关联，不创建资产、不执行 Provider API 写入；绑定 UI、完整 Grant/Lease 能力门禁和原子撤销仍待完成。缺少真实受控 Provider
资格，因此不能声称客户环境中的读取、写入或 Registrar 能力可用。协议覆盖目录与单项资金
确认引用已定义，仍不可执行；Provider-specific 最小权限及未知结果对账资格尚需逐项确证。

## 证据边界

描述符、合同测试、夹具、静态扫描和本地报告仅证明仓库结构。它们不证明提供商授权、
网络结果、秘密 custody、部署或商业可用性。
