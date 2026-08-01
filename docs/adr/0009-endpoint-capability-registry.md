# ADR-0009：EndpointManifest 单向生成 Secure HTTP Capability

状态：Accepted

日期：2026-08-01

## 背景

连接器需要访问外部平台，但普通 TypeScript 不能获得任意 HTTP、任意 URL 或任意凭据注入能力。如果 TypeScript 把 Host、规则或 `credentialRef` 直接交给 Rust，Secure Host 会退化为可被混淆的代理；如果 Rust 手写第二份 Endpoint 表，则连接器声明和实际网络权限会漂移。

## 决策

每个编译期连接器拥有一个版本化、声明式、不可执行的 `EndpointManifest`。Manifest 是 Endpoint ID、固定 HTTPS Origin、Method、Path 参数、凭据命名空间、注入方式、超时、响应上限、重试安全级别、脱敏和 Host-owned Response Extractor 的唯一事实源。

构建工具只允许从 Manifest 单向生成：

- `connector-sdk` 的 Endpoint ID、公开请求参数类型和只读注册信息；
- `secure-host-core` 的嵌入式注册表、Manifest Hash、凭据注入与响应处理规则。

生成物只读并进入版本控制；CI 重建后做差异检查。运行时不得从 Cloud、配置文件、环境变量、远程 Feature Flag 或普通 TypeScript 扩展注册表。

普通 TypeScript 只提交 `provider_connection_id + endpoint_id + 公开参数 + idempotency_key`，不提交 Host、Origin、端口、凭据 Header 或 `credentialRef`。Secure Host 根据当前 `device_id + provider_connection_id` 读取本机 `DeviceCredentialBinding`，并验证 Provider、凭据命名空间、RuntimeMode 和 Endpoint 完整绑定。

Host 按以下固定顺序失败关闭：查找编译期条目，解析绑定，校验公开参数，构造规范 HTTPS URL，解析 DNS 并拒绝非公网地址，然后才允许发网。Phase 0 Path 参数只接受 `[A-Za-z0-9_~-]+` 的不透明 Segment，不接受点、斜杠、反斜杠、百分号或 TypeScript 预编码值；更复杂格式必须以后以新的强类型参数策略单独评审。Phase 0 所有带凭据请求禁止重定向；HTTP Client 必须关闭自动重定向。Host 固定使用 443，不接受 userinfo、自定义端口、绝对 URL 或路径穿越。

GoodDealer Cloud 和外部平台使用不同请求类型、注册表、凭据命名空间与注入器，不能只靠字符串 Provider 区分。

## 后果

- 新增或扩大 Endpoint 是代码审查可见的权限变更，并同时改变 TS/Rust 生成物和 Manifest Hash。
- Connector 无法在运行时临时拼接未登记网络能力；未知条目直接失败。
- DNS 解析、连接地址和 TLS Server Name 必须由同一 Host 请求执行路径控制，不能只校验字符串 URL。
- R0-02 只有在生成物、Fake Provider、DNS/IP/编码/跨绑定负向矩阵及 Windows/macOS 原生网络证据齐全后才能关闭；本 ADR 只把状态推进为 `In Progress`。

## 不采用的方案

- 不信任 TypeScript 传入的 Host、Allowlist、Header 或 `credentialRef`。
- 不维护 Rust 与 Connector 两份人工 Endpoint 表。
- 不在 Phase 0 支持同源重定向、运行时插件或远程下发 Endpoint。
