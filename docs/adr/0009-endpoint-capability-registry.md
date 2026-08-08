# ADR-0009：EndpointManifest 单向生成 Secure HTTP Capability

状态：Accepted

日期：2026-08-01

修订：2026-08-03（Host-owned Active/Sunset 授权联合）

## 背景

连接器需要访问外部平台，但普通 TypeScript 不能获得任意 HTTP、任意 URL 或任意凭据注入能力。如果 TypeScript 把 Host、规则或 `credentialRef` 直接交给 Rust，Secure Host 会退化为可被混淆的代理；如果 Rust 手写第二份 Endpoint 表，则连接器声明和实际网络权限会漂移。

## 决策

每个编译期连接器拥有一个版本化、声明式、不可执行的 `EndpointManifest`。Manifest 是 Endpoint ID、显式 `platformAction: read | write`、`credentialAccessPolicy: healthy_only | health_reverification`、固定 HTTPS Origin、Method、公开参数、版本化 Credential Profile、固定注入位置、超时、响应上限、重试安全级别、脱敏和响应分类的唯一事实源；动作 Scope 不从 HTTP Method 推导。普通业务 Endpoint 只能使用 `healthy_only`。`health_reverification` 只允许无业务副作用的 `platformAction=read + retrySafety=safe + responseExtractor=host_owned + bodySchema=none + idempotencyInjection=null`，其 Rust 私有 typed extractor 必须按 Provider 固定健康响应 Schema 裁决并在 Host 事务中更新 Binding health/generation；Manifest 不能自行选择 extractor。Manifest 对秘密响应只能声明 `responseExtractor: "host_owned"`，不能声明 extractor ID、函数名、JSONPath、脚本或其他可执行选择器；具体 typed extractor 只能由 Rust 私有编译期绑定表按 Endpoint ID 选择。

Credential Profile 在 Provider 级声明 `profile_id + version + credential_namespace + slots(slot_id + secret_kind)`；Endpoint 只能引用一个已存在的 Profile，并以 `slot_id + 固定 Header 名 + raw/bearer` 映射完整 Slot 集。Phase 0 不允许动态 Header/Query 名、模板表达式、任意前缀、Cookie 注入或秘密 Query。本机绑定的身份键是 strict `binding_scope`：Active 分支固定 `device_id`，Sunset 分支固定 `sunset_installation_id + workspace_id + sunset_credential_generation + device_signing_key_id/version`，两者使用不同 Namespace/唯一索引并拒绝跨分支或跨 generation 的 ID/Ref。完整绑定必须同时匹配 `binding_scope + provider_connection_id + provider + namespace + profile_id + profile_version + 完整 slot/secret_kind 集`；Keychain 读取也必须携带这组完整作用域，不能退化为只按 `credential_ref` 查找。

Path 继续使用严格不透明 Segment；Query 与 JSON Body 使用封闭字段 AST，只允许 string、integer、boolean、必填标记、有限 UTF-8 字节长度上限和字符串枚举。Integer 只接受 JavaScript Safe Integer；Query 与 Body 另有 Endpoint 级编码后总字节上限。字段 ID 与 Wire Name 固定，未知字段、类型强转、默认值、正则、`$ref`、`oneOf`、动态 Hook 和预编码 Query 一律不支持。`provider_idempotency_key` 必须绑定一个固定、非保留、且不与凭据冲突的 Header，否则不能声明该重试级别。

公开 JSON 响应也必须有封闭字段 Schema。Host 先拒绝未知、缺失、类型错误或超限字段，再按公开 Field ID 重建结果；`redactJsonPointers` 不能作为 Public JSON 的 denylist 清洗机制。`host_owned` Endpoint 不进入普通 TypeScript JSON Response union。JSON Schema 由生成器实际执行，手写校验只补 Origin、占位符、Profile/Slot、Header 冲突和重试策略等跨字段规则。Manifest 单向生成 TypeScript Endpoint ID/公开请求与公开响应类型以及诊断 Hash，完整安全注册表只生成到 Rust；Rust 校验是最终授权边界。

构建工具只允许从 Manifest 单向生成：

- `connector-sdk` 的 Endpoint ID、公开请求/响应类型和诊断 Hash，不含 Origin、注入或网络策略；
- `secure-host-core` 的嵌入式注册表、Manifest Hash、凭据注入与响应处理规则。

生成物只读并进入版本控制；CI 重建后做差异检查。运行时不得从 Cloud、配置文件、环境变量、远程 Feature Flag 或普通 TypeScript 扩展注册表。

普通 TypeScript 只提交 `provider_connection_id + endpoint_id + 公开参数 + idempotency_key`，不提交 Host、Origin、端口、凭据 Header、`credentialRef`、RuntimeMode、Lease、Epoch 或授权 variant。Secure Host 紧邻请求从 Rust 权威状态取得不可克隆、按值单次消费的 `HostPlatformAuthorization = ActivePlatformAccessContext | SunsetAuthorization(platform_access, host_binding)`。Active 分支就是日常 `PlatformAccessContext`，绑定当前设备、Active、已验签 ActiveDeviceLease、`lease_epoch`、可信时间、`offline_execute_until`、目标 ProviderConnection 和 Lease 动作 Scope；Sunset 分支绑定 LocalContinuation、Sunset Credential/安装/Workspace/设备签名 Key、runtime/Sunset credential generation、本地可信时间、目标 ProviderConnection、authorized capabilities 与 Host Binding Profile/Slot digest/health generation。两种 Schema、Key Purpose、Transcript 与解析器双向拒绝；`browser_connection_establishment`、`browser_profile` 或未知 Sunset variant 不能进入 Secure HTTP。调用方不能选择分支，两者都不预先把凭据健康的普通层投影视为权威。

Host 按以下固定顺序失败关闭：取得 `HostPlatformAuthorization` 后先按判别分支完整校验 Active Lease/Epoch/离线截止/Scope，或 LocalContinuation/Sunset Credential/安装/Workspace/设备 Key/runtime generation/可信时间/authorized capabilities/Binding 摘要；基础授权无效时在查询 Registry 前统一拒绝。随后查找编译期条目，并对 Endpoint Registry 与 Rust 私有 Host-owned extractor 表做全表双向一致性校验；从 Registry 取得 `platformAction`、Profile 与 `credentialAccessPolicy` 后，才按分支校验 Lease 动作 Scope 或 Sunset authorized capabilities。再以对应身份作用域查询 `HostCredentialBinding`，读取权威 health/generation，校验 Provider、Namespace、Profile 版本、强类型 SlotId/SecretKind，以及 Sunset 授权固定的 Binding digest/generation；`healthy_only` 只接受 `healthy`，`health_reverification` 只接受 `retained_unverified | healthy`，`invalid` 必须先重新录入并推进 generation。每个 `host_owned` Endpoint 必须恰有一个绑定，不得指向公开 JSON、未知或重复 Endpoint。完成公开参数与请求上限校验后构造规范 HTTPS URL，解析 DNS 并拒绝任一非公网地址，固定本次连接地址集合；秘密读取前与 Transport 提交前必须重新读取 RuntimeMode、对应授权 generation/可信时间及相同 Binding health generation/profile，随后才按完整作用域从 Keychain 加载秘密并注入固定凭据/幂等 Header。除 `health_reverification` 的上述窄例外外，凭据未验证或无效都不能触碰秘密或 Transport；健康响应只能由 Host-owned extractor 裁决，成功时原子置为 `healthy` 并推进 health generation，失败时原子置为 `invalid` 并推进 generation，普通层不能提交或覆盖结果。Standby、Activating、Draining、过期/旧 Active Lease、超出离线窗口、非 LocalContinuation Sunset 输入、Sunset generation/能力/绑定变化或绑定表不一致都不能触碰秘密或 Transport。凭据值必须是非空可见 ASCII，拒绝空白、控制字符和非 ASCII；编码后的单个凭据 Header 值不超过 8 KiB，全部凭据与幂等 Header 的名称、值与线格式开销合计不超过 16 KiB。Transport 只能连接本次已验证 IP，TLS SNI、证书校验和 HTTP Host 使用 Manifest Host；不得隐式重新解析 DNS、继承系统代理或自动重定向。响应上限必须在流式读取和解压后同时执行，公开响应还必须经过白名单投影。Phase 0 Path 参数只接受 `[A-Za-z0-9_~-]+` 的有界不透明 Segment，不接受点、斜杠、反斜杠、百分号或 TypeScript 预编码值；更复杂格式必须以后以新的强类型参数策略单独评审。Host 固定使用 443，不接受 userinfo、自定义端口、绝对 URL 或路径穿越。Sunset 响应只进入独立 LocalContinuation 本地状态与 Sunset Fact/Audit 链，不能生成 Active Workspace Mutation/Outbox 或 Cloud Ingest。

`health_generation` 是每个 HostCredentialBinding 独立的单调安全整数，初值为 1。Binding 创建、credential health 变化、Profile/Namespace/SlotId/SecretKind/credentialRef 变化、秘密替换或删除必须在同一 Host 事务中递增 generation，并同步刷新普通层的脱敏 DeviceCredentialBindingStatus；普通层副本不参与授权。generation 达到安全整数上限时必须停用该 Binding，并通过新的协议/存储版本重建，禁止回绕。

Fake Provider 使用独立 Fixture Manifest，Registry 与 Executor seam 都只在 `#[cfg(test)]` 编译；四个生产 Connector Manifest 保持空 Endpoint/Profile 列表。Fixture Registry、测试 CA、回环放宽或测试 Transport 不得通过 Cargo Feature、环境变量、配置或远程 Flag 进入生产构造路径。当前纯 Rust Fake Transport 只证明执行顺序、参数编码、作用域化 Slot 注入、公开响应投影和失败关闭，不证明平台原生 Socket/TLS 行为。

GoodDealer Cloud 和外部平台使用不同请求类型、注册表、凭据命名空间与注入器，不能只靠字符串 Provider 区分。

## 后果

- 新增或扩大 Endpoint 是代码审查可见的权限变更，并同时改变 TS/Rust 生成物和 Manifest Hash。
- Connector 无法在运行时临时拼接未登记网络能力；未知条目直接失败。
- DNS 解析、连接地址、TLS Server Name、代理策略和响应上限必须由同一 Host 请求执行路径控制，不能只校验字符串 URL。
- R0-02 只有在生成物、Fake Provider、DNS/IP/编码/跨绑定负向矩阵及 Windows/macOS 原生网络证据齐全后才能关闭；Fixture Executor 完成后仍保持 `In Progress`。

## 不采用的方案

- 不信任 TypeScript 传入的 Host、Allowlist、Header 或 `credentialRef`。
- 不维护 Rust 与 Connector 两份人工 Endpoint 表。
- 不在 Phase 0 支持同源重定向、运行时插件或远程下发 Endpoint。
