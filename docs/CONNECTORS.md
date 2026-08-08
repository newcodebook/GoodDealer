# GoodDealer 连接器规范

状态：Accepted Design Baseline / Evidence Pending
更新日期：2026-08-05

## 1. 目标

新增平台时只新增连接器包、能力描述和映射测试，不修改资产、DNS、销售、价格和任务模块的核心逻辑。

连接器是编译期模块，不是可下载并执行任意代码的插件。

## 2. 能力接口

连接器按能力实现独立 Port：

```typescript
interface RegistrarReader {}
interface RegistrarWriter {}
interface DnsReader {}
interface DnsWriter {}
interface ListingReader {}
interface ListingWriter {}
interface ListingFileExchange {}
interface BrowserAutomationConnector {}
interface VerificationConnector {}
interface AsyncOperationReader {}
interface ProviderHealthCheck {}
```

不得要求一个连接器实现全部接口。

`DnsWriter` 必须声明写入粒度（单 record 或整个 RRset）、是否支持条件写以及可用的 ETag/Revision/远端版本；不能用统一的 `writeRecord()` 隐藏整组替换语义。

`VerificationConnector` 负责获取/刷新挑战、触发验证、读取状态并声明所需证据等级和记录保留策略；它不直接写 DNS/Nameserver，也不拥有 VerificationAttempt 状态机。详细工作流见 [VERIFICATION.md](VERIFICATION.md)。

## 3. Capability Descriptor

```typescript
type ExecutionMode =
  | "immediate_api"
  | "async_api"
  | "file_exchange"
  | "browser_automation"
  | "manual_assisted";

type QuotaScope =
  | "credential"
  | "provider_account"
  | "provider_global"
  | "unknown";

interface ConnectorCapabilities {
  provider: string;
  executionModes: ExecutionMode[];
  features: Record<string, {
    readable: boolean;
    writable: boolean;
    batchLimit?: number;
    requiresApproval?: boolean;
  }>;
  changeDetection: {
    listMode: "full" | "cursor" | "modified_since" | "per_item";
    pushMode: "none" | "optional_relay";
  };
  rateLimit: {
    model: "headers" | "configured" | "unknown";
    quotaScope: QuotaScope;
  };
}
```

Connector/Provider 级不得声明统一 `supportsIdempotency`：同一平台的不同 Endpoint/Operation 可能具有不同安全等级。重试语义只由 EndpointManifest 的逐 Endpoint `retrySafety` 和对应 Operation Contract 拥有。

连接器必须在运行时报告账户实际权限，不能只依赖平台理论能力。

首版本地客户端的 `pushMode` 固定为 `none`。只有未来用户主动启用并单独评审可选中继服务后，才能出现 `optional_relay`；不保留无法工作的 `supportsWebhook: true` 布尔值。

`quotaScope` 定义限流桶的共享边界：

- `credential`：每个 API Key/Token 独立配额。
- `provider_account`：同一远端平台账户下的多个凭据共享配额。
- `provider_global`：按平台客户端、出口 IP 或其他全局边界共享。
- `unknown`：无法确认时采用最保守的共享与退避策略。

持久化时可使用字段名 `quota_scope`。桶键只能使用凭据摘要、远端账户 ID 或 ProviderConnection ID 等非秘密稳定标识，不得包含原始 API Key。

## 4. 统一结果

所有写操作按 `ProviderConnection` 执行并返回统一的远端操作结果：

```typescript
type RemoteOperation =
  | { kind: "completed"; remoteRef?: string }
  | { kind: "accepted"; operationId: string; pollAfterMs?: number }
  | { kind: "file_required"; artifactId: string }
  | { kind: "browser_authorization_required"; sessionId: string; planId: string }
  | { kind: "manual_required"; actionId: string }
  | { kind: "rejected"; error: ConnectorError };
```

错误必须归一化为：认证、权限、限流、校验、冲突、暂时不可用、结果未知、平台不支持和最终失败。

`ProviderConnection` 是一等实体。同一 Provider 可以存在多个账户。平台、账户别名、远端账户 ID 和能力作为共享元数据同步；脱敏凭据健康状态属于每台设备 Active Workspace 的 `DeviceCredentialBindingStatus`，Standby 仅能读取独立 `DeviceCredentialCandidateStatus` 的非秘密存在性提示，`credentialRef`、Namespace、强类型 SlotId/SecretKind 只存在 Rust Secure Host 私有的 `HostCredentialBinding`。Host Binding 与 Browser Profile 都以 strict 身份 scope 判别 Active device 或 Sunset installation；前者按 `device_id`，后者按安装/Workspace/Sunset credential generation/设备签名 Key，使用不同 Keychain/Profile namespace，generation 推进时旧 scope 失效并重新录入或复验。Browser Profile 由 automation-host 按 `profile_scope + provider_connection_id + session_mode` 独立管理。这些设备本地记录都不得上传服务端，Candidate 提示也不得用于选择秘密或通过平台访问门禁。

## 5. 安全 HTTP Gateway

连接器不能直接使用浏览器 `fetch`。它只能调用受控 Gateway，并引用预先声明的 Endpoint：

```typescript
secureHttp.execute({
  providerConnectionId,
  endpointId: "cloudflare.dns.records.create",
  path: { zoneId },
  body,
  idempotencyKey,
});
```

每个编译期连接器使用版本化、声明式、不可执行的 `EndpointManifest`。Provider 级 Credential Profile 声明版本、凭据命名空间和完整 Slot/SecretKind 集；Endpoint 只引用一个 Profile，并显式声明 `platformAction: read | write`、`credentialAccessPolicy: healthy_only | health_reverification`、固定凭据 Header、可选的固定幂等 Header、封闭 Path/Query/JSON Body 字段 AST、请求/响应上限、逐 Endpoint 重试安全级别、公开响应白名单或 `host_owned` 响应分类。动作权限不能从 HTTP Method 推导，因为 POST 可能是读取而 GET 也可能触发远端动作。普通业务 Endpoint 只能使用 `healthy_only`；`health_reverification` 只允许 `platformAction=read + retrySafety=safe + responseExtractor=host_owned + 无 Body/幂等 Header` 的无业务副作用健康 Endpoint，其 Rust 私有 extractor 必须原子裁决并更新 HostCredentialBinding health/generation。Manifest 不能声明具体 extractor ID、函数、JSONPath 或脚本；Host-owned Endpoint 的具体 typed extractor 只能由 Rust 私有编译期表绑定。Manifest 的 JSON Schema 与跨字段校验在构建时执行，并单向生成 TypeScript Endpoint ID/公开请求与公开响应类型和 Rust 嵌入式安全表；`host_owned` Endpoint 不进入普通 TypeScript JSON Response union，TypeScript 不导出完整安全注册表，运行时配置与 Cloud 不得扩权。

TypeScript 不提交 Host、端口、绝对 URL、Method、原始 Query、凭据 Header、`credentialRef`、RuntimeMode、Lease、Epoch 或授权 variant。Secure Host 紧邻请求从自身权威状态取得不可由调用方构造、不可克隆且按值单次消费的 `HostPlatformAuthorization` 判别联合：日常分支是 `ActivePlatformAccessContext`（现有 `PlatformAccessContext`），先校验 Active RuntimeMode、当前设备、已验签 ActiveDeviceLease、当前 `lease_epoch`、可信时间不晚于 `offline_execute_until`、目标 ProviderConnection，并携带 Lease 动作 Scope；停服分支只能是 `SunsetAuthorization(purpose=platform_access, credential_source=host_binding)`，先校验 LocalContinuation、Sunset Credential/安装/Workspace/设备签名 Key、runtime/Sunset credential generation、本地可信时间、目标 ProviderConnection、authorized capabilities 及 Binding Profile/Slot digest/health generation。两个解析器和字段联合双向拒绝，Browser Profile 或 `browser_connection_establishment` 分支不能进入 Secure HTTP。

基础授权无效时在 Endpoint 查询前统一拒绝。其后两个分支共用同一不可扩权 Endpoint Registry、Rust 私有 Host-owned extractor 双向一致性检查、DNS/Transport 和响应投影顺序：从 Registry 取得 `platformAction`、Profile 与 `credentialAccessPolicy` 后，按 Active Lease Scope 或 Sunset authorized capabilities 校验动作，再以各自权威身份作用域查询 `HostCredentialBinding`，验证 Provider、Namespace、Profile 版本、强类型 SlotId/SecretKind、health/generation 与授权中固定的 generation/digest。`healthy_only` 只接受 `healthy`；`health_reverification` 只接受 `retained_unverified | healthy`，且其 Host-owned 健康裁决在成功时原子推进 generation，`invalid` 必须先重新录入。完成 Endpoint、公开参数和总字节上限校验后解析 DNS并拒绝任一非公网地址。Executor 在秘密读取前和 Transport 提交前重新读取当前 RuntimeMode、对应授权 generation/可信时间及相同 Binding health generation/profile；变化时失败关闭，随后才按完整 Binding 作用域加载秘密并把已验证地址集合交给 Host Transport。`DeviceCredentialBindingStatus` 只用于 UI/普通层状态，不参与授权。凭据 Header 值与凭据/幂等 Header 总量使用固定安全上限；公开 JSON 响应拒绝未知字段并按白名单重建。Phase 0 Path 参数只允许有界不透明 Segment，带凭据 Endpoint 禁止系统代理与重定向。LocalContinuation 响应只能写其独立本地状态/Fact/Audit，不得生成 SyncMutation、Outbox 或 Cloud Ingest。完整决策见 [ADR-0009](adr/0009-endpoint-capability-registry.md)。

连接器还必须为返回字段声明云同步分类：`PUBLIC_BUSINESS`、`SENSITIVE_BUSINESS`、`DEVICE_SECRET` 或 `DIAGNOSTIC_LOCAL`。Secret-bearing Endpoint 必须由 Rust typed extractor 消费秘密响应 Body，以完整作用域直接把 `DEVICE_SECRET` 原子写入 Keychain，并重建专用脱敏结果；普通 TypeScript 永远不能取得完整响应、通用 JSON、Token 或 Keychain Ref。Sync Outbox 的封闭 Projection 由 Workspace Protocol 与 local-storage 写入口强制，不能依赖网络层事后删除。

## 6. Browser Transport

连接器可以为没有 API 或 API 不完整的操作实现浏览器传输。浏览器传输必须声明：

- 登录入口和允许导航的 Host。
- 登录完成的可验证页面状态。
- 需要用户亲自完成的步骤。
- 自动化动作、目标元素约束和完成条件。
- 最终提交前是否再次确认。
- 页面版本或脚本兼容范围。
- 失败时需要保留的脱敏诊断信息。

同一功能存在 API 时默认优先 API。切换到浏览器执行必须显示原因并取得用户授权，不得静默降级。

浏览器 `ActionReport` 只属于 Observation。连接器必须声明写操作需要 `PAGE_CONFIRMED`、`API_CONFIRMED` 或 `USER_CONFIRMED` 中的哪一级才能完成，不能用“点击成功”结束任务。

## 7. 首批连接器

### Spaceship

实现：

- 域名列表和详情。
- 自动续费、联系人、Nameserver、隐私和转移锁。
- DNS Record。
- 异步 Operation 查询。
- SellerHub Listing、售出报告和验证记录。

认证使用 `X-API-Key` 与 `X-API-Secret`，权限按创建密钥时的 Scope 控制。

### Cloudflare

首版仅实现 DNS：

- Zone 定位。
- DNS Record 列表、创建、修改和删除。
- TXT 所有权验证。
- DNSSEC 状态读取。

连接器必须校验 Token 是否只有目标 Zone 所需权限。

### Atom

实现：

- Portfolio 与 Listing 读取。
- 添加 Listing。
- 修改售价、描述和分类。
- Standard Listing 移除。
- Sales、Analytics 和 DNS 验证状态。

Premium Listing 移除等限制操作返回人工任务。若 Atom API 只能使用 Query Token，对应 Endpoint 在 Phase 0 保持禁用；日志仍不得记录完整 Query 或 URL。

### Afternic

实现：

- CSV 模板版本管理。
- 新增模式和替换模式文件生成。
- 上传前校验与风险摘要。
- Bulk Upload 历史结果导入。
- Listing 冲突和所有权验证人工任务。
- 最长 24 小时的等待状态。
- 在用户自行登录后上传 CSV、读取 Upload History 和处理 Listing 冲突。

Afternic 浏览器流程是正式但可降级的连接器能力。页面改版或选择器无法确认时必须停止并交还用户，不能猜测点击。

## 8. Contract Test Kit

每个连接器必须通过相同的契约测试：

- 分页、游标和空列表。
- 字段缺失和未知枚举。
- 401/403、429、5xx 和超时。
- `rateLimit.model`、`quotaScope` 与限流桶键稳定性；原始凭据不得进入桶键、日志或共享摘要。
- 部分成功。
- 异步任务恢复。
- 幂等重试。
- 敏感字段脱敏。
- 云同步分类不会把 Token、Cookie、Auth Code 或敏感验证值写入 Mutation。
- 切换后的活动设备缺少匹配的 DeviceCredentialBindingStatus/HostCredentialBinding 时返回 `credential_missing_on_device`，不能误用前一设备的健康状态或 Host 引用。
- Desired/Observed 映射稳定性。
- 浏览器页面 Fixture、选择器唯一性和页面改版失败保护。
- 自动化授权范围与过期处理。

Afternic 额外使用 Golden File 测试，保证生成 CSV 的列、编码、换行和模式不会意外变化。

## 9. 版本兼容

- 每个连接器声明 `connectorVersion` 与支持的远端 API 版本。
- 保存原始快照时同时保存 Schema 版本。
- 新版本映射器必须能读取当前支持范围内的旧快照。
- 平台新增未知字段时忽略并保留；未知状态值不得自动映射为成功。

## 10. Connector 与 Recipe 发布治理

Connector 和 Browser Recipe 只通过签名、不可变的版本化 Bundle 发布。Bundle 至少固定 Provider、Capability、Connector/Recipe 版本、Endpoint/Selector/AST 摘要、最低/最高 Host 与 App 版本、支持引擎矩阵、平台政策版本、发布时间和签名 Key Purpose。运行时不得下载或执行未签名脚本、任意 JavaScript 或可扩权 Hook。

发布通道固定为 `internal -> canary -> stable -> deprecated | revoked`：

- `internal` 只使用 Fixture、专用测试账号和可丢弃资产；`canary` 只对明确选择的账号/Capability 开放；`stable` 仍按 provider+capability 独立授权，不能以 Connector 整体状态扩权。
- Policy Registry 对每个 provider+capability 标记 `enabled | manual | prohibited`。未知状态默认 `manual`；明确禁止、签名无效、Host/App 不兼容或安全撤销时为 `prohibited` 并失败关闭。
- 每次晋级必须通过 Endpoint Contract、敏感数据扫描、双引擎 Browser Fixture、回退、Anti-Rollback 和版本兼容测试。浏览器能力只有对应 WebView2/WKWebView 证据均通过才可进入该平台的 stable 通道。
- Kill Switch 只能把具体 Capability 降级到 Manual/Disabled，不能下发新代码或改变批准语义。客户端保存签名撤销水位并拒绝版本回退；离线期间只使用未过期且未低于本机撤销水位的 Bundle。
- 退役先停止新计划、保留读取/确认现有 Attempt 所需的兼容解码和人工导出路径，再按审计确认移除；不得让升级把 `outcome_unknown` 或远端任务变成不可确认状态。
- 每个正式平台写入仍必须分别通过 R0-13 Safety Envelope 和 R0-14 operation/endpoint retrySafety 证据；发布通道批准不能替代逐操作安全证明。

## 11. 开源实现参考

实现连接器时优先从已核验的上游语义和 Fixture 开始，但上游默认行为不构成 GoodDealer 契约。完整来源、许可证和引入检查清单见 [OPEN_SOURCE_REFERENCES.md](OPEN_SOURCE_REFERENCES.md)。

| 来源 | 允许迁移 | GoodDealer 必须保留的边界 |
| --- | --- | --- |
| [go-acme/lego](https://github.com/go-acme/lego) | Spaceship Provider 的 API 路径、Header、DTO、Zone 发现、TXT 生命周期、传播参数、错误和 Fixture | 只迁移语义/Fixture；HTTP、凭据注入、Allowlist、脱敏和网络错误分类由 Rust Secure Host 拥有 |
| [libdns](https://github.com/libdns/libdns) | Getter/Appender/Setter/Deleter 等小 Port | 增加条件写、RRset Hash、资源锁、审计、Sync Projection 和 RuntimeMode 门禁 |
| [ExternalDNS](https://github.com/kubernetes-sigs/external-dns) | Desired → Plan → Provider、dry-run、Fake Provider、所有权标记思想 | 不引入 Kubernetes Controller；不得未经规范批准向 Zone 增加所有权 TXT |
| [DNSControl](https://github.com/DNSControl/dnscontrol) | 规范化 IR、Preview/Push、Provider 测试矩阵 | 禁止采用整区声明/删除语义执行 GoodDealer 增量记录写入 |
| [Smithy](https://github.com/smithy-lang/smithy) | `http/readonly/idempotent/sensitive` 等操作级 Trait 思路 | 保留 Zod/规范 Schema 事实源；EndpointManifest 必须生成到 Rust 注册表并失败关闭 |
| [Airbyte](https://github.com/airbytehq/airbyte) / [Meltano Singer SDK](https://github.com/meltano/sdk) | Connector Registry、Spec/Check、脚手架、Fixture、兼容等级和 CI 组织 | Airbyte 为 ELv2，只作架构参考；两者的读取模型不能代替批准、Attempt 和 `outcome_unknown` |

Spaceship 首个实现 Spike 应锁定 lego 上游 Commit，并把原始 Fixture、GoodDealer 适配后的 Fixture 和差异说明一起保存在 Spaceship Connector 测试目录。不得把上游测试通过视为本项目 Contract Test Kit 已通过。
