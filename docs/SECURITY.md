# GoodDealer 安全模型

状态：Accepted Security Baseline / Evidence Pending
更新日期：2026-08-05

## 1. 安全目标

GoodDealer 管理的是可直接影响域名所有权、解析和销售的高价值凭证。安全目标按优先级排列：

1. 防止 API 密钥和域名转移凭证泄露。
2. 防止误操作导致域名、DNS 或销售状态被批量破坏。
3. 防止云同步、账号、更新或遥测链路获得平台操作凭据和未授权的敏感数据。
4. 保证任务可审计、可恢复且不会因重试重复执行。

## 2. 信任边界

| 区域 | 信任级别 | 可接触内容 |
| --- | --- | --- |
| Rust Secure Host | 最高 | 密钥、数据库密钥、受控请求、账号与 License Token |
| TypeScript Domain/Application | 中 | 域名数据、目标状态、脱敏响应 |
| Local App WebView | 中 | 本地 UI、脱敏数据和受限 Tauri IPC |
| Remote Browser WebView | 不可信 | 平台页面、Cookie、登录会话和网页自动化 |
| Account/License 服务 | 外部受控信任 | 账号身份、订单、License、设备标识摘要、版本权益 |
| GoodDealer Sync Service | 外部受控信任 | 服务端可读的域名资产、价格、状态、脱敏操作和同步元数据 |
| Admin Web / Staff Admin API | 内部高敏入口 | 经角色授权的跨账号运营数据、License、设备、同步和合规状态；无平台秘密 |
| Publication Service | 外部公开边界 | 仅用户显式选择发布的域名投影 |
| 平台 API | 外部 | 仅接收该连接器所需请求 |

## 3. 本地数据保护

- 数据库使用 SQLCipher 或经安全评估的等效全库加密方案。
- 数据库主密钥由系统 Keychain、macOS Keychain 或 Windows Credential Manager 保护。
- Standby 的可丢弃只读缓存同样使用 SQLCipher 或等效静态加密存储，独立随机缓存密钥保存在 OS Keychain/Credential Manager；不得把域名、成本、备注或索引以明文 SQLite/文件形式落盘。
- 数据库主密钥同时使用用户离线保存的 Recovery Secret 加密封装，Keychain 丢失时可以恢复。
- 不把数据库密钥写入配置文件、日志或前端存储。
- `localStorage` 和普通前端持久化不得保存平台凭证。
- 导出的备份必须加密，并要求用户设置恢复口令；不存在明文导出模式。
- 导出的备份文件必须在本机完成加密；用户可以自行复制到其他存储位置。
- 首版只有一种版本化加密备份包；“包含平台 API 凭据”是默认关闭的显式选项。永不包含项以 [D-013](OPEN_DECISIONS.md#d-013-本地备份中的平台凭据) 和 [DATA_LIFECYCLE.md](DATA_LIFECYCLE.md) 的 Backup Content Manifest 为单一事实源，不得用本节摘要缩减该清单。
- 禁止把活跃 SQLite/SQLCipher、WAL 和应用数据目录放入网盘或共享目录做文件级同步。
- 临时 CSV 应放入应用私有目录；用户显式导出时才复制到外部路径。
- 转移 Auth Code 默认不持久化；确需使用时采用短期加密记录并自动清理。

Recovery Secret、迁移和备份格式见 [DATA_LIFECYCLE.md](DATA_LIFECYCLE.md)。

## 4. 密钥与网络

平台连接在普通应用层只保存共享的 `provider_connection_id` 和脱敏绑定状态；设备本地 `credentialRef` 与真实密钥都由 Rust Secure Host 和 OS 密钥库拥有。

连接器向安全 HTTP Gateway 提交：

```text
provider_connection_id
approved endpoint id
typed public path/query/body parameters
idempotency key
```

Gateway 必须：

- 只接受构建期 `EndpointManifest` 生成并嵌入制品的 Endpoint；Method 也由 Manifest 决定，TypeScript 不能提交 Host、端口、绝对 URL、Method、凭据 Header 或 `credentialRef`。
- Rust `runtime-gate` 紧邻请求取得 Host-owned `HostPlatformAuthorization = ActivePlatformAccessContext | SunsetAuthorization(platform_access, host_binding)` 判别联合；普通 TypeScript 不能提交或选择 RuntimeMode、授权 variant 或任何权威字段。Active 分支证明当前 ActiveDeviceLease、设备/`lease_epoch`、可信时间/`offline_execute_until`、ProviderConnection 与 Lease 动作 Scope；Sunset 分支证明 LocalContinuation、Sunset Credential/安装/Workspace/设备签名 Key、runtime/Sunset credential generation、本地可信时间、ProviderConnection、能力及 Host Binding 摘要。两种 Schema、Key Purpose、Transcript 和解析器双向拒绝。固定顺序是：分支基础授权 → 编译期 Registry 查找 → 从 Registry 取得 `platformAction`、Profile 与 `credentialAccessPolicy` 并校验分支动作 Scope → 按分支身份作用域查询 HostCredentialBinding 的权威 `credential_health + health_generation` → 参数/DNS → 秘密 → Transport。普通业务 Endpoint 只能声明 `healthy_only`；无业务副作用、`platformAction=read`、`retrySafety=safe`、`responseExtractor=host_owned` 的窄健康复验 Endpoint 才能声明 `health_reverification`，并只允许 `retained_unverified | healthy`，`invalid` 必须先重新录入形成新 generation。Executor 在秘密读取前和 Transport 提交前复核相同 mode/授权/binding generation/profile；变化时失败关闭。健康响应只能由 Host-owned extractor 裁决并原子更新 health/generation，普通层响应不能解除隔离。DeviceCredentialBindingStatus 只供普通层展示，不能成为授权来源；Keychain 读取继续携带全部 HostCredentialBinding 作用域，普通调用方不能选择绑定或 Ref。
- 只允许固定 HTTPS Origin 和 443 端口；拒绝 userinfo、路径穿越、预编码路径、私网/回环/链路本地地址及 DNS 解析异常。
- Query/JSON Body 只能由封闭字段 AST 编码，字符串必须有有限 UTF-8 字节上限，Integer 必须在 JavaScript Safe Integer 范围，编码后 Query/Body 还需满足 Endpoint 总字节上限；拒绝未知字段、类型强转、动态 Hook、原始 Query 和预编码值。
- 将本次 DNS 验证通过的地址集合固定到 Transport；连接 IP 必须属于该集合，TLS SNI/证书与 HTTP Host 使用 Manifest Host，禁止隐式重解析、系统代理和自动重定向。
- 注入 API Key/Secret，并在返回前移除敏感 Header。
- `provider_idempotency_key` 只能注入 Manifest 固定的非保留 Header；凭据 Header 自动纳入脱敏集合，禁止 Host、Cookie、代理认证和逐跳 Header。秘密值只接受非空可见 ASCII；编码后单值不超过 8 KiB，全部凭据与幂等 Header 合计不超过 16 KiB。
- Transport 接收的所有原始响应 Body 都进入不可 Clone、Debug 脱敏并在释放时清零的 Rust 秘密包装；公开 JSON 路径只借用 Body 做封闭白名单投影，含秘密路径直接消费 Body 进入 Rust typed extractor，不使用 JSON Pointer denylist 清洗。
- 对 URL、Query、Header、Body 和错误信息统一脱敏。
- 限制请求超时，并在流式读取和解压后同时限制响应大小。
- 按平台账户进行限流。

若 Atom 或其他平台只提供 Query Token，相关 Endpoint 在 Phase 0 不进入 Secure HTTP Registry；必须改用 Header 认证或通过新的安全决策后才能启用。作为纵深防御，完整 URL 始终不得进入日志。

GoodDealer Cloud 请求使用独立的认证注入通道：

- cloud-client 只构造经过协议校验的 Endpoint ID、Method 和 Payload，并解析脱敏响应；不得读取 Keychain、持有 Access/Refresh Token 或自行生成 `Authorization` Header。
- Desktop TypeScript Tauri Adapter 把请求映射为最小化 IPC Envelope；Rust `secure-http` 校验 GoodDealer Cloud Allowlist 后，从 Host 内存 Session Store 读取短期 Access Token 并注入认证头。
- Refresh Token 持久化在账号专用 Keychain Namespace；短期 Access Token 只驻 Host 内存。账号凭证与平台 `credentialRef` 使用不同的 Namespace、Allowlist 和请求类型，禁止把账号 Token 注入平台请求或把平台密钥注入 GoodDealer Cloud 请求。
- Access Token 获取、Refresh Token 轮换、持久化和清除都在 Rust Secure Host 内完成；应用启动时由 Host 使用 Refresh Token 换取新 Access Token。普通 TypeScript、Local App WebView、日志和错误对象不得获得原始 Token。
- Desktop 登录、刷新和撤销使用独立的 Host-owned Session Command。Rust 直接解析含 Token 的响应并保存，只向 TypeScript 返回脱敏会话状态；cloud-client 不解析 Token-bearing Response。
- account-web 使用同源 HttpOnly、Secure、SameSite Cookie 或等效 Web 会话机制，不复用 Desktop Keychain Token 通道。

平台 API Secret、OAuth Token、Recovery Material 等秘密只能通过 Rust Host 创建的原生秘密输入面进入。主应用 WebView 只能开始或取消 Capture Session，不能提交秘密值；成功后只取得 `credential_binding_id`、fingerprint、版本和脱敏状态，Keychain `credentialRef` 仍留在 Host 内。原生输入面不可用或 Keychain 写入失败时必须失败关闭，禁止降级到普通 WebView、剪贴板、配置、SQLite 或临时文件。

含秘密的网络响应由 Manifest 标记为 `host_owned`，具体 typed extractor 只能由 Rust 私有编译期表按 Endpoint 绑定。Host 只接受 2xx 和封闭 typed contract，直接消费秘密 Body，并以 Device/Account 或 Provider Connection/Profile/来源 Endpoint 的完整作用域原子写入 Keychain；Store 的不透明回执只表达整批已提交，不返回数量、部分成功或 Ref，`Err` 必须表示零条目提交。3xx、其他非 2xx、超限、无效响应或 Store 失败都失败关闭，只允许返回专用脱敏状态。禁止把完整 Body、通用 JSON、Token、Secret Ref 或 Keychain Ref 返回 TypeScript。具体决策见 [ADR-0009](adr/0009-endpoint-capability-registry.md)、[ADR-0010](adr/0010-host-owned-secret-path.md) 和 [Phase 0 Secure Host 决策基线](PHASE0_SECURE_HOST_BASELINE.md)。

## 5. WebView 隔离

- 本地应用 UI WebView 不加载远程 JavaScript，并使用严格 CSP。
- 远程平台页面只能在单独的 Remote Browser WebView 中打开。
- Remote Browser WebView 使用独立的 Tauri Capability/ACL，不注册高权限 Command。
- Local App 与 Remote Browser 必须使用不同且明确的 WebView label。若二者位于同一 Window，Local App Capability 只能用 `webviews` 精确匹配本地 WebView，不能用 `windows` 或 `*` 把权限授予该窗口内全部 WebView；Remote 主页面、iframe、弹窗和导航后页面都不得匹配 Local App Capability。
- Remote Browser WebView 可以运行平台自身 JavaScript，但其页面内容始终视为不可信。
- Remote Browser Profile 按 Host 私有 `profile_scope + provider_connection_id + session_mode` 使用独立数据目录；Active scope 使用 device ID，Sunset scope 使用安装/Workspace/Sunset credential generation/设备签名 Key，两个根 namespace 互相拒绝。同一平台的不同账户以及持久/私密会话不得共享 Cookie。
- 导航默认限制在连接器声明的 Host；跳转到新的登录、支付或第三方 Host 时提示用户。
- client-core 的 Port DTO 使用 Zod 校验；Desktop Adapter 的 IPC Envelope 再由 TypeScript 与 Rust Command Handler 双重校验。
- Tauri Command 按最小权限拆分，禁止通用 Shell、通用文件和通用 HTTP 命令。
- 每个自定义 Tauri Command 必须同时出现在 `tauri_build::AppManifest::commands`、`tauri::generate_handler!` 注册集合和对应 Local App Capability 的逐命令 Permission 中，三者由结构测试证明集合完全一致；未进入 AppManifest 或未被显式 Capability 授权的 Command 不得发布。静态 Permission 仍不能替代 Handler 内的 RuntimeMode、Lease/Epoch、可信时间和资源绑定复验。
- 用户可以在 Remote Browser WebView 中完成密码、2FA 和 CAPTCHA；软件不得读取、记录或自动填写这些敏感字段。
- 自动化期间始终提供暂停、用户接管和关闭会话入口。

浏览器业务自动化只能在用户已登录且对具体执行计划授权后开始。日常首次登录、获取 API Key 等连接建立流程使用独立 BrowserSessionConsent 和 Host-owned `BrowserSessionAccessContext`，只允许受 NavigationPolicy 约束的导航和非秘密登录状态检测，不能获得填写业务字段、上传、秘密读取或最终提交权限；该日常 Context 要求 Active/Lease/Epoch/可信时间有效，但不要求已有健康凭据，也不能替代 Secure HTTP 的 `PlatformAccessContext`。LocalContinuation 只能使用域分离的 `SunsetBrowserSessionAccessContext`，绑定 `purpose=browser_connection_establishment + credential_source=none` 的 SunsetAuthorization、安装实例/Workspace/设备 Key、runtime/Sunset credential generation、本地可信时间、Session Sequence 与 NavigationPolicy；它不要求已有健康凭据，也不能业务提交。两种 Context 的解析器和 Profile Namespace 互相拒绝。

## 6. 操作安全

以下操作必须显示逐项预览并二次确认：

- 批量下架或标记已售。
- Nameserver 变更。
- DNS Record 删除或覆盖。
- DNSSEC 关闭。
- 自动续费关闭。
- 单次价格变动超过配置阈值。
- Afternic “替换整个 Portfolio”文件。
- 浏览器自动化中的最终提交、批量上传或批量修改。

系统只对明确可重试的操作自动重试。对结果未知的写请求先查询远端状态，不直接重新提交。

## 7. 账号、云同步与凭据隔离

GoodDealer 服务端可以接收并读取：

- 账号、订单、License、设备和必要安全事件。
- 域名、Portfolio、标签、备注、成本、价格、Listing 和销售状态。
- Registrar、DNS 和 Marketplace 的非秘密账户/连接元数据。
- Desired/Observed State、冲突和脱敏后的 Operation/Audit 摘要。
- Mutation、Revision、Device Cursor、ActiveDeviceLease 和非秘密限流摘要。

GoodDealer 服务端不得接收：

- API Key、API Secret、OAuth Access/Refresh Token。
- Cookie、平台密码、2FA、恢复码、CAPTCHA 或 Auth Code。
- Browser Profile、Local Storage 或平台登录会话。
- SQLCipher Master Key、Recovery Secret 或本地完整性密钥。
- 备份口令、解密密钥或备份明文。
- 未脱敏的 HTTP Header、URL/Query、原始响应或敏感 DNS 验证值。

普通 DNS Record、价格、销售状态和脱敏操作记录可以同步。Phase 0 Secure HTTP 不允许秘密 Query 或 Cookie；来自浏览器流程、导入工件或诊断上下文的验证 Token、请求 Header、Query、Cookie 和敏感 Payload 必须通过封闭 Sync Projection 排除，不能依赖上传前再清洗。

域名业务数据不使用端到端加密，但传输必须使用 TLS，服务端数据库、对象存储和备份必须启用静态加密。租户授权在每个查询和写入路径校验。生产环境运营访问默认拒绝；跨账号访问业务数据必须具有对应 Scope、记录理由/工单标识、限定范围与时间，并产生 Staff AuditEvent，不要求用户逐次授权（详见第 10 节）。

账号 Refresh Token、Entitlement Token、OfflineDeviceLease 和 ActiveDeviceLease 只持久化在 OS Keychain/Credential Manager；Desktop Access Token 只驻 Rust Secure Host 内存。未通过账号、设备和 Entitlement 门禁时不挂载任何业务界面；通过这些门禁的 Standby 只能挂载 Cloud Read-Only View 和独立加密缓存。只有额外通过 ActiveDeviceLease、Lease Epoch 与 RuntimeMode 门禁的设备才能打开完整 Active Workspace、Mutation Outbox、连接器、Worker 和可编辑主界面；授权失效不删除本地密文。

本地备份文件使用 AEAD、Hash 和版本 Manifest 保护。用户把备份复制到其他介质后，该介质视为不可信存储；备份口令和解密密钥不得随文件保存。详细边界见 [ACCOUNT_AND_SYNC.md](ACCOUNT_AND_SYNC.md)。

遥测默认关闭。崩溃报告必须显式授权，并在发送前展示脱敏规则。

## 8. 同步与公开展示隔离

- 私有 Workspace API 与公开 Publication API 使用不同路由、存储投影和授权策略。
- 同步到云端不产生公开页面。
- 发布时由用户选择域名和允许公开的字段，展示最终预览后写入 Publication Projection。
- 公开服务不能回查成本、备注、账户、审计、冲突或完整 Workspace。
- 下线公开域名后清理 CDN/缓存，并保留必要审计，不删除私人资产实体。

## 9. GoodDealer 账号安全

账号采用适合个人消费者的常规安全设计，不引入强制 2FA、TOTP、恢复码或企业组织策略：

- 邮箱验证，密码使用经安全评估的自适应哈希算法及独立 Salt。
- 注册、登录、验证码、密码重置、导出和删除接口按账号、IP 与设备限流。
- Access Token 短期有效；Refresh Token 每次使用后轮换，并检测旧 Token 复用。
- 提供可选 Passkey；未启用 Passkey 的用户可使用密码完成账号操作。
- 账号网页端展示当前会话和绑定设备，并允许远程退出、移除设备。
- 密码重置、账号接管恢复或安全遏制原子递增 `account_security_epoch`，撤销全部在线 Auth/Refresh Session、未消费 Challenge/Bootstrap 与后续 Lease 续签，并冻结新绑定、切换、邮箱修改、删除和 License 转移，直到恢复状态机完成；新设备绑定、密码修改、数据导出、删除和设备移除发送邮件通知。
- 导出、删除、移除活动设备等敏感操作需要重新认证；启用 Passkey 时可使用 Passkey 确认。

这里的 GoodDealer 账号安全与域名平台自身认证不同。用户仍需在平台页面自行完成平台密码、2FA 和 CAPTCHA，GoodDealer 不读取或绕过这些机制。

## 10. 管理员后台安全

- `admin-web` 使用独立域名、构建产物、Staff Session、Cookie、CSP 和 CSRF 策略，不复用 account-web 或用户身份的登录态。
- StaffIdentity 与客户 identity 分离；首版只有一名管理员（Owner），正式环境要求 Passkey 登录。Role/Scope 机制保留为结构约束，首版仅签发单一 Owner 身份；未来引入更多 Staff 时再启用细分角色。
- Public HTTP 与 Admin HTTP 使用独立 Fastify Composition Root、认证 Hook 和 Route 注册；不能通过一个运行时角色开关把 Public Session 提升为 Staff Session。
- Admin API 只调用模块显式公开的 Admin Application Port，不直接注入 Repository、共享 ORM Entity、执行任意 SQL 或跨模块修改表。
- 管理员默认只查看完成案件所需的账号、License、设备和健康摘要。跨账号查看域名业务明细必须消费短期 `AdminReadAuthorization`：绑定 actor/Staff Security Epoch、Tenant/目标及目标 `account_security_epoch`、字段/实体 Scope、规范 Query Shape Hash、理由、有效 `AdminPurposeRef` 状态/revision和新鲜 Passkey 证明；每次读取复验并产生 Staff AuditEvent。长时 StaffSession 本身不足以读取明细，该授权不能用于修改、异步 Job 或兑换 `AdminActionAuthorization`。
- 管理员不能查看或恢复平台 API Key、OAuth Token、Cookie、Browser Profile、数据库密钥、Recovery Secret 或本地备份秘密，也不能代表用户调用域名平台。
- 管理员不能直接创建用户 Desired State、SyncMutation、ApprovedOperation 或把任务标记为成功。修复云端元数据必须使用模块拥有的受控 Repair Command，并记录前后摘要。
- 高风险管理操作（已冻结 DataRightsRequest 的删除重试/推进、设备强制移除、License 人工调整、Sunset/发布通道变更）要求重新认证（Passkey 确认）。普通删除的 `identity_verified -> frozen` 只能由 compliance 在消费用户一次性删除授权后以 CAS 自动推进；Owner 不得代用户新建请求或触发冻结。首版 SecurityIncident 遏制只允许隔离、冻结入口、撤销 Session/凭据、证据保全和通知，不允许对象或账号破坏性删除；后者若有真实需要，必须先另立并完整定义法律/安全授权类型，不能复用普通 AdminActionAuthorization。单管理员模式下不设多人审批，以重新认证、操作前后摘要和 Staff AuditEvent 作为控制；未来出现多名 Staff 时再补审批流。
- 异步管理动作必须引用短期 `AdminActionAuthorization`，其绑定 Tenant/目标、目标客户 `account_security_epoch`、命令与参数 Hash、命令相关 Aggregate Revision、Owner actor、Staff Security Epoch、Scope 快照、`AdminPurposeRef` 状态/revision、重新认证时间、有效期、消费/幂等与取消状态。删除命令额外绑定 `deletion_epoch`，设备命令绑定 `credential_epoch`，License 命令绑定 `entitlement_revision`。执行与重放时复验全部绑定；Session/Scope 撤销、PurposeRef 状态/Revision 变化、参数变化、过期或任一 Epoch/Revision 变化时拒绝。`admin-access` 只授权，具体 Repair Command 由目标模块拥有。PurposeRef 允许状态与动作范围以 [用户旅程 §6.6](USER_JOURNEYS.md#66-案件与管理员权限) 为准。
- 首版唯一 Owner 丢失 Passkey 时，Admin 高权限操作保持失败关闭；在 JF-14 关闭并通过双人离线恢复材料、身份核验、旧凭据撤销、通知、冷静期和审计演练前，不得降级为普通邮箱找回或隐式 Break Glass。

普通用户不强制 2FA 的产品决定不适用于内部 Staff。管理员权限不是依靠隐藏 URL、前端按钮或管理员协议包不可见来保证，最终授权必须发生在 Admin API。

## 11. 活动设备与切换安全

- 设备 Ed25519 私钥由 Rust Secure Host 生成并保存在 OS Keychain/Credential Manager。首次绑定使用账号重新认证、服务端一次性短期 Nonce Challenge 和新私钥 PoP；普通 Auth Session 不能直接替换公钥。
- 正常轮换要求旧钥和新钥对同一域分离 Transcript 双 PoP，并以 `expected_key_version` 做事务 CAS。旧钥丢失时走独立 Recovery/Rebind，撤销旧 Session、Lease 和签名能力。
- 移除设备推进 Credential Epoch，并立即撤销在线 Session、Cloud Scope、未消费 Challenge 与后续 Lease 续签能力。若目标是当前 Active，服务端仍必须把旧 `offline_execute_until` 作为独占执行隔离截止：截止前可以释放设备名额并绑定新设备，但不得向任何新设备签发平台执行权。Credential Epoch 不能即时撤回离线设备已经持有的外部平台能力。
- 撤销后到达的 ExecutionFact/DeviceAuditEvent 不能只凭设备自报时间接受。原始签名 Envelope 在 Active 时已先于 Attempt 结果提交进入与业务库分库分钥的追加式 evidence-spool；设备已移除时只允许经 `RemovedEvidenceSpool` 窄读口和服务端签名 RemovedDeviceTombstone + 一次性 RemovedEvidenceChallenge + 旧 Key 对批次摘要的实时 PoP 提交 evidence-only Ingest。eligible 集合同时包含 Cloud `removed_at` 前记录，以及其后本机尚未确认撤销且可信 `request_start_boundary/occurred_at <= offline_execute_until`、原 Lease/批准有效的记录。Host 在恢复 Cloud 连接前先停止新请求并完成/隔离在途请求、持久化 Envelope；首次确认 Tombstone 时原子保存 removal-observed 可信时间锚点，停止 Worker/Sequencer、关闭业务库并把旧私钥转为 `removed_evidence_pop_only`。该状态只允许签 `GOODDEALER-REMOVED-EVIDENCE-POP-V1`，禁止新签普通 Fact/Audit 或任何业务授权。Challenge 绑定 Tombstone、账号/设备、Key ID/Version、purpose、Nonce/JTI、batch digest、stream ranges、原 `offline_execute_until`、本机 removal-observed anchor 与短期有效期并原子消费；历史 Envelope 签名不能替代实时 PoP。该入口不授予 Session/Scope、查询、Mutation、Proposal 或平台能力。ExecutionFact 验证当时有效的 ApprovedOperation/Plan 授权摘要；DeviceAuditEvent 按事件类型验证对应的账号、设备、操作或安全授权上下文。两者都必须验证 Tombstone、Credential/Lease Epoch、可信时间边界和各自防重放序列，否则进入各自隔离区。全部 eligible 证据取得不可变接收/隔离回执并满足本地审计保留条件后，Host 才原子擦除 Spool 记录、Spool Key 和旧设备私钥；缺少旧私钥或 Spool Key 必须失败关闭，不能无 PoP 上传。User/Staff/Service AuditEvent 使用独立服务端身份与链，不伪造设备字段。
- 除永久离线 Sunset Credential 外，账号作用域的服务端签名在线凭证使用 strict lowerCamelCase、强类型、域分离 JSON Wire Envelope；解析器固定校验 `typ/iss/aud/kid/schemaVersion/accountId/deviceId/accountSecurityEpoch/jti` 后才验签和解析 Payload。snake_case 仅是领域语义名，由 `protocol/devices` Codec 一对一映射，Wire 不同时接受两种大小写。Sunset Credential 使用无账号/设备/Epoch/JTI/到期字段的独立永久 Envelope、独立 Key Purpose 和解析器，日常路径必须拒绝。设备身份决策见 [ADR-0011](adr/0011-device-identity-lifecycle.md)。
- 服务端按账号唯一保存当前 `active_device_id` 和单调递增的 `lease_epoch`。
- 有效绑定且 License 有效的 Standby 只获得 `account:manage` 和 `workspace:read`；ActiveDeviceLease 才授予 `workspace:mutate`、`platform:read`、`platform:write` 和 `operation:approve`。
- Standby 只读 API 不接受 Mutation、凭据引用、执行计划批准或连接器请求；只读缓存不得包含 Outbox、DeviceCredentialBindingStatus、HostCredentialBinding 或平台秘密，并遵循与主业务库同等级的落盘加密要求。Standby 可从独立普通本机加密状态读取 `DeviceCredentialCandidateStatus` 的 `never_configured | configured_candidate | unknown` 提示；该状态不得查询秘密存储、证明 credential health 或参与任何授权。
- Secure HTTP 的唯一 Host 入口是上述 `HostPlatformAuthorization` 联合：日常 Worker 在任何平台 API 读取或副作用前使用 Active 分支 `PlatformAccessContext`，LocalContinuation 只能使用 `SunsetAuthorization(purpose=platform_access, credential_source=host_binding)` 分支；两者共享不可扩权 Registry/Transport，但解析器和身份作用域互相拒绝。Browser Host 的日常业务自动化消费 `AutomationExecutionTicket` 后使用绑定同一 Active/Lease/Epoch 权威状态的业务执行 Guard。仅用于首次登录、获取 API Key 或修复连接的日常 Browser Session 使用权限更窄的 `BrowserSessionAccessContext`，两类 Context 不可互换。正式停服后的 LocalContinuation 还使用独立 `SunsetApprovedOperation`、`SunsetBrowserSessionAccessContext` 与 `SunsetAutomationExecutionTicket`：绑定 Sunset Credential ID/Key Purpose、安装实例、Workspace、设备签名 Key、授权能力、runtime/Sunset credential generation、本地可信时间锚点，以及按 `credential_source` 选择的 HostCredentialBinding Profile/Slot/health generation 或 Browser Profile generation，使用不同签名域、Nonce 表与解析器，不能被 Active 路径解析或兑换。连接建立使用 `purpose=browser_connection_establishment + credential_source=none` 的窄 Authorization，不要求已有健康凭据且不能业务提交。写操作还必须校验对应模式的批准/Ticket 和本地资源锁；不得把调用方传入的 RuntimeMode 当成最终授权。LocalContinuation 的结果和审计只能写入独立本地 `SunsetExecutionFact`/`SunsetDeviceAuditEvent` 链，使用 `gooddealer.sunset.execution-fact.v1`/`gooddealer.sunset.device-audit.v1` 与各自 Transcript；不得伪造 Active Lease/Epoch，不进入 Cloud Ingest、MutationOutbox、三流 Drain 或日常解析器。
- 云故障时只允许当前活动设备在签名的 `offline_execute_until` 前继续平台访问，最长 24 小时；许可到期立即停止领取和提交新任务。
- 强制切换必须等待旧设备离线许可到期。旧设备重新联网后发现 Epoch 过期，应停止 Worker、降级到 Cloud Read-Only View，并按语义上传 ExecutionFact、独立 DeviceAuditEvent 与签名 `StaleChangeProposal`；Cloud recovery 才能生成 `StaleDeviceCandidate`，服务端只把通过旧 Epoch 裁决的 ExecutionFact 标记为 LateExecutionEvent。
- ExecutionFact、DeviceAuditEvent 与 StaleChangeProposal 使用彼此独立、窄化的设备 Ingest Scope；仍绑定的 Standby 可以上传原 Epoch 已持久化记录，但这些通道不能创建当前 Mutation、批准或平台副作用。User/Staff/Service AuditEvent 由服务端身份直接追加，不使用这些设备 Scope。
- 正常切换先停止领取新任务，在 Active 前置屏障中完成或隔离已提交原子请求，再进入不具平台访问权的 Draining，冲刷 Mutation、ExecutionFact、Workspace-scope DeviceAuditEvent 并提交签名 `DrainManifest`。Account-scope DeviceAuditEvent 与 User/Staff/Service AuditEvent 不属于 Workspace Drain。服务端独立验证连续接收水位、Gap、摘要、签名和请求/Epoch 绑定，再与设备签名的最后分配序号/待上传为零声明比对；本地声明只保证完整、协作客户端，不能被描述成 Cloud 对恶意遗漏尾部的独立证明。任一可观察不一致拒绝释放 ActiveDeviceLease；单一最大序号不能证明排空。
- 云端同步来的 Desired State 不能直接触发平台副作用，必须由当前活动设备本地预览并签署 ApprovedOperation。
- 旧 Epoch 上传内容按语义分流：经过旧 Lease 窗口、可信时间锚点、单调时钟增量、域分离设备签名、事件类型授权上下文和防重放验证的 Operation 结果作为 ExecutionFact 追加并标记为 LateExecutionEvent；DeviceAuditEvent 仍通过独立 Audit Ingest 进入其唯一登记的 `(workspace, device, epoch, device_audit)` Hash 链；Desired State 等可变修改只能作为签名 StaleChangeProposal 提交，再由 Cloud recovery 裁决为 StaleDeviceCandidate。
- LateExecutionEvent 不直接修改当前 Desired/Observed State，不触发副作用；无法验证的旧设备报告进入安全隔离记录。

外部平台无法识别 GoodDealer 的 Epoch，因此强制切换后的 24 小时等待是明确接受的残余可用性代价，不能通过立即给新设备发放写权限规避。

## 12. 合规网页入口与停服密钥

- License 过期后客户端业务入口保持锁定，但账号网页端仍允许用户导出服务端持有的数据、申请删除，以及管理会话和设备。
- 网页导出不包含 API Key、Cookie、Browser Profile、本地 Artifact 或数据库密钥，并要求重新认证、限流、审计和邮件通知。
- 删除流程覆盖新加坡主库、搜索、对象存储、分析副本、悉尼灾备/PITR 和外部 Helpdesk 删除/匿名化请求。验证后立即冻结危险写入，提供 7 天冷静期，结束后 30 天内清除可删除业务内容；PITR 最长 35 天，恢复前强制重放 AntiResurrectionLedger。处理者级 `AccountDeletionTombstone` 保留到传播、重试和外部回执完成或记录 Legal Hold；Ledger 只保留不可逆最小标识/水位，初始 90 天且不得短于最长恢复窗口加 30 天。
- `Sunset Signing Key` 与日常 Auth/License 私钥物理隔离，使用生产与 CI 均不可访问的离线硬件介质保存。恢复材料至少跨两个地点并采用 2-of-3 管理控制；每年至少完成一次无生产服务的恢复、签发和导入演练，首版不采购外部商业托管。单一 Owner StaffIdentity 不等于 Sunset 密钥可由单人启用。
- 最终 `LocalContinuation` 安装包和永久凭证必须签名并通过多个静态渠道验证发布。

## 13. 更新安全

- 更新包必须签名。
- 客户端只信任内置的更新公钥。
- 更新清单通过 HTTPS 获取并校验签名。
- Account/License 控制面不能下发任意脚本或连接器代码。
- 自动化规则包只能由独立更新通道下发，必须签名、版本化、可回滚，并在受限解释器中运行。
- 连接器随签名应用版本发布，不支持未签名的运行时插件。

## 14. CSV 公式注入

供 Excel/表格软件打开的 CSV 中，用户可控字段若以 `=`、`+`、`-`、`@`、Tab 或 CR 开头，必须按导出目标转义。平台规定模板只导出允许字段；不得为了通用性把备注、标签等任意文本写入平台 CSV。

## 15. 审计完整性

审计日志为“应用层只追加并带完整性校验”，而不是绝对不可变。应用不提供修改入口，并使用前序 Hash/可选 HMAC 检测篡改；拥有本机管理员权限的用户仍可能修改本地文件。Cloud Staff/User AuditEvent 与 SyncMutation、ExecutionFact 分流保存，记录 actor、Scope、理由/工单标识和前后摘要；ExecutionFact 只能引用 AuditEvent 的 ID/Hash，不能替代审计链。普通 Admin API 不提供修改或删除入口。

## 16. 威胁模型重点

- 恶意或被篡改的平台响应。
- WebView XSS 试图调用高权限 Tauri Command。
- 恶意平台页面尝试越权访问本地资源或诱导自动化执行错误操作。
- 平台页面改版导致脚本点击错误元素。
- 浏览器 Cookie 或登录会话被本机其他进程窃取。
- 日志或崩溃报告泄露 API Token。
- 本地数据库或备份被复制。
- 批量任务重试导致重复写入。
- DNS 验证覆盖现有 TXT。
- Account/License 控制面或第三方支付服务被攻破。
- 账号被盗、第三台设备滥用、Refresh Token 重放或远程解绑延迟生效。
- Sync Service 租户隔离错误、批量导出滥用或内部人员越权读取域名资产。
- Staff Session 被盗、管理员 Scope 配置错误、Public/Admin Route 混装或管理员绕过模块 Port 直接修改业务表。
- 同步 Payload 脱敏失败导致 API Token、Cookie 或验证秘密进入云端。
- 旧活动设备在 24 小时离线许可内仍可写入，以及强制切换过早造成双客户端并行操作平台。
- 旧 Epoch Mutation、旧备份或被篡改的恢复文件静默覆盖当前云端数据。
- 旧 Epoch 的真实执行结果被误当作可丢弃 Candidate，导致审计链或 `outcome_unknown` 跟踪丢失。
- 活动设备在未同步增量上传前永久损失，导致该增量不可恢复。
- 同步实现缺陷或部分拉取失败导致本地与云端静默不一致且长期未被发现。
- 被攻破的 Sync Service 篡改 Desired State 或伪造 Operation，诱导持有凭据的客户端执行。
- 私有 Workspace 数据因发布投影错误被意外公开。
- 外部存储读取、篡改、回滚或覆盖用户导出的备份文件。
- 更新供应链被劫持。
- 日常 License 私钥或 Sunset Signing Key 泄露导致伪造延续凭证。

产品明确接受：GoodDealer 云端被攻破时域名清单、价格、成本、状态和投资策略可能泄露或被篡改。通过不上传平台凭据降低直接资产操作能力；同时规定云端数据不能直接产生副作用，外部写操作必须由执行设备本地预览、签署 ApprovedOperation 并验证设备绑定。业务数据泄露和服务端诱导风险都不能描述为零风险。

正式发布前必须进行 Tauri Command 权限审计、租户隔离测试、同步脱敏测试、Public/Admin Route 隔离与 Staff Scope 测试、依赖审计、密钥泄露测试和更新签名演练。

## 17. 开源实现参考

以下来源包含 Adopted、Baseline Selected 与 Candidate 等不同采用状态，均不改变本文件的信任边界；具体状态、版本和许可证规则以 [OPEN_SOURCE_REFERENCES.md](OPEN_SOURCE_REFERENCES.md) 为准。

| 来源 | 建议用途 | 安全约束 |
| --- | --- | --- |
| [keyring-rs](https://github.com/open-source-cooperative/keyring-rs) | OS Keychain/Credential Manager 抽象、平台测试和秘密 Heap 泄漏测试 | 只存数据库解锁材料、设备私钥、Auth/Lease Token 等小型秘密；不得保存业务数据库或把秘密返回普通 TS |
| [SQLCipher](https://github.com/sqlcipher/sqlcipher) + [rusqlite](https://github.com/rusqlite/rusqlite) | Active Workspace、Standby Cache 和 Staging DB 的 Rust 持久化 | Repository 留在 `local-storage`；不向 React 暴露 Tauri SQL Guest API；显式验证 Key、WAL、临时文件、崩溃和错误口令路径 |
| [Stronghold](https://github.com/iotaledger/stronghold.rs) | 加密 Vault 与秘密生命周期的对照 Spike | 若采用只能由 Rust Host 包装；vault key 不得进入 JS Guest API、DOM、普通 IPC 或日志 |
| [SimpleWebAuthn](https://github.com/MasterKale/SimpleWebAuthn) | Account Web 的可选 Passkey 与敏感操作重新认证 | Passkey 不替代设备私钥 PoP、签名 Envelope、轮换/撤销和 ActiveDeviceLease |
| [Tauri Capability](https://github.com/tauri-apps/tauri) | Window/WebView IPC 的静态最小权限基线 | 仍需 Rust Runtime Gate、资源绑定和每次命令授权；Remote Origin 不获得通用 `invoke` |

依赖选型必须通过同一 Canary Secret 验收，而不是分别证明“Keychain 可写”“数据库已加密”或“插件可以运行”。Stronghold 与 Keychain 的关系是可选 Vault 和根解锁材料分层，不得出现两套互相绕过的秘密事实源。
