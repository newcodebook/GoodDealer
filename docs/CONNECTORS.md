# GoodDealer 连接器规范

状态：Draft  
更新日期：2026-08-01

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
  supportsIdempotency: boolean;
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

`ProviderConnection` 是一等实体。同一 Provider 可以存在多个账户。平台、账户别名、远端账户 ID 和能力作为共享元数据同步；`credentialRef` 和凭据健康状态属于每台设备的 `DeviceCredentialBinding`。Browser Profile 由 browser-automation 的设备本地 `BrowserSessionProfile` 按 `device_id + provider_connection_id + session_mode` 独立管理。两类本地记录都不得上传服务端。

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

每个编译期连接器使用版本化、声明式、不可执行的 `EndpointManifest`。Provider 级 Credential Profile 声明版本、凭据命名空间和完整 Slot/SecretKind 集；Endpoint 只引用一个 Profile，并声明固定凭据 Header、可选的固定幂等 Header、封闭 Path/Query/JSON Body 字段 AST、请求/响应上限、逐 Endpoint 重试安全级别、公开响应白名单或 `host_owned` 响应分类。Manifest 不能声明具体 extractor ID、函数、JSONPath 或脚本；Host-owned Endpoint 的具体 typed extractor 只能由 Rust 私有编译期表绑定。Manifest 的 JSON Schema 与跨字段校验在构建时执行，并单向生成 TypeScript Endpoint ID/公开请求与公开响应类型和 Rust 嵌入式安全表；`host_owned` Endpoint 不进入普通 TypeScript JSON Response union，TypeScript 不导出完整安全注册表，运行时配置与 Cloud 不得扩权。

TypeScript 不提交 Host、端口、绝对 URL、Method、原始 Query、凭据 Header 或 `credentialRef`。Secure Host 先校验 RuntimeMode，再对 Endpoint Registry 与 Rust 私有 Host-owned extractor 表做全表双向一致性校验；非 Active 模式或坏表都不查询本机 DeviceCredentialBinding。随后根据当前设备和 `providerConnectionId` 验证 Provider、Profile 版本、完整 Slot/SecretKind、Endpoint、公开参数和总字节上限。解析 DNS 并拒绝任一非公网地址后，才按完整绑定作用域加载秘密并把已验证地址集合交给 Host Transport；凭据 Header 值与凭据/幂等 Header 总量使用固定安全上限。公开 JSON 响应拒绝未知字段并按白名单重建。Phase 0 Path 参数只允许有界不透明 Segment，带凭据 Endpoint 禁止系统代理与重定向。完整决策见 [ADR-0009](adr/0009-endpoint-capability-registry.md)。

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
- 切换后的活动设备缺少 DeviceCredentialBinding 时返回 `credential_missing_on_device`，不能误用前一设备的健康状态。
- Desired/Observed 映射稳定性。
- 浏览器页面 Fixture、选择器唯一性和页面改版失败保护。
- 自动化授权范围与过期处理。

Afternic 额外使用 Golden File 测试，保证生成 CSV 的列、编码、换行和模式不会意外变化。

## 9. 版本兼容

- 每个连接器声明 `connectorVersion` 与支持的远端 API 版本。
- 保存原始快照时同时保存 Schema 版本。
- 新版本映射器必须能读取当前支持范围内的旧快照。
- 平台新增未知字段时忽略并保留；未知状态值不得自动映射为成功。
