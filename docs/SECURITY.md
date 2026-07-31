# GoodDealer 安全模型

状态：Draft  
更新日期：2026-07-31

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
- 导出的备份默认加密，并要求用户设置恢复口令。
- 导出的备份文件必须在本机完成加密；用户可以自行复制到其他存储位置。
- 禁止把活跃 SQLite/SQLCipher、WAL 和应用数据目录放入网盘或共享目录做文件级同步。
- 临时 CSV 应放入应用私有目录；用户显式导出时才复制到外部路径。
- 转移 Auth Code 默认不持久化；确需使用时采用短期加密记录并自动清理。

Recovery Secret、迁移和备份格式见 [DATA_LIFECYCLE.md](DATA_LIFECYCLE.md)。

## 4. 密钥与网络

平台连接保存 `credentialRef`，真实密钥存入 OS 密钥库。

连接器向安全 HTTP Gateway 提交：

```text
provider
credentialRef
method
approved endpoint id
path/query/body
idempotency key
```

Gateway 必须：

- 只允许访问连接器声明的 HTTPS Host。
- 禁止任意 URL、重定向到未知 Host 和明文 HTTP。
- 注入 API Key/Secret，并在返回前移除敏感 Header。
- 对 URL、Query、Header、Body 和错误信息统一脱敏。
- 限制响应大小和请求超时。
- 按平台账户进行限流。

Atom Token 可能出现在 Query 中，因此完整 URL 绝不能进入日志。

GoodDealer Cloud 请求使用独立的认证注入通道：

- cloud-client 只构造经过协议校验的 Endpoint ID、Method 和 Payload，并解析脱敏响应；不得读取 Keychain、持有 Access/Refresh Token 或自行生成 `Authorization` Header。
- Desktop TypeScript Tauri Adapter 把请求映射为最小化 IPC Envelope；Rust `secure-http` 校验 GoodDealer Cloud Allowlist 后，从 Keychain 读取 Auth Session 并注入认证头。
- 账号 Token 与平台 `credentialRef` 使用不同的 Keychain 命名空间、Allowlist 和请求类型，禁止把账号 Token 注入平台请求或把平台密钥注入 GoodDealer Cloud 请求。
- Refresh Token 的轮换、持久化和清除都在 Rust Secure Host 内完成；普通 TypeScript、Local App WebView、日志和错误对象不得获得原始 Token。
- Desktop 登录、刷新和撤销使用独立的 Host-owned Session Command。Rust 直接解析含 Token 的响应并保存，只向 TypeScript 返回脱敏会话状态；cloud-client 不解析 Token-bearing Response。
- account-web 使用同源 HttpOnly、Secure、SameSite Cookie 或等效 Web 会话机制，不复用 Desktop Keychain Token 通道。

## 5. WebView 隔离

- 本地应用 UI WebView 不加载远程 JavaScript，并使用严格 CSP。
- 远程平台页面只能在单独的 Remote Browser WebView 中打开。
- Remote Browser WebView 使用独立的 Tauri Capability/ACL，不注册高权限 Command。
- Remote Browser WebView 可以运行平台自身 JavaScript，但其页面内容始终视为不可信。
- 各平台会话使用独立 Profile 或数据目录，避免 Cookie 跨平台共享。
- 导航默认限制在连接器声明的 Host；跳转到新的登录、支付或第三方 Host 时提示用户。
- client-core 的 Port DTO 使用 Zod 校验；Desktop Adapter 的 IPC Envelope 再由 TypeScript 与 Rust Command Handler 双重校验。
- Tauri Command 按最小权限拆分，禁止通用 Shell、通用文件和通用 HTTP 命令。
- 用户可以在 Remote Browser WebView 中完成密码、2FA 和 CAPTCHA；软件不得读取、记录或自动填写这些敏感字段。
- 自动化期间始终提供暂停、用户接管和关闭会话入口。

浏览器自动化只能在用户已登录且对具体执行计划授权后开始。授权记录包含平台、动作、目标域名、预计修改和有效期。

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

普通 DNS Record、价格、销售状态和脱敏操作记录可以同步。连接器标记为设备秘密的验证 Token、请求 Header、Query、Cookie 和敏感 Payload 必须在 Secure Host 内删除后才能上传。

域名业务数据不使用端到端加密，但传输必须使用 TLS，服务端数据库、对象存储和备份必须启用静态加密。租户授权在每个查询和写入路径校验。生产环境运营访问默认拒绝；跨账号访问业务数据必须具有对应 Scope、记录理由/工单标识、限定范围与时间，并产生 Staff AuditEvent，不要求用户逐次授权（详见第 10 节）。

账号刷新凭证、Offline Device Lease 和 ActiveDeviceLease 只保存在 OS Keychain/Credential Manager。未通过账号、设备、活动设备和 Entitlement 门禁时不打开业务数据库或挂载主界面；授权失效不删除本地密文。

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
- 密码重置撤销现有在线 Auth Session；新设备绑定、密码修改、数据导出、删除和设备移除发送邮件通知。
- 导出、删除、移除活动设备等敏感操作需要重新认证；启用 Passkey 时可使用 Passkey 确认。

这里的 GoodDealer 账号安全与域名平台自身认证不同。用户仍需在平台页面自行完成平台密码、2FA 和 CAPTCHA，GoodDealer 不读取或绕过这些机制。

## 10. 管理员后台安全

- `admin-web` 使用独立域名、构建产物、Staff Session、Cookie、CSP 和 CSRF 策略，不复用 account-web 或用户身份的登录态。
- StaffIdentity 与客户 identity 分离；首版只有一名管理员（Owner），正式环境要求 Passkey 登录。Role/Scope 机制保留为结构约束，首版仅签发单一 Owner 身份；未来引入更多 Staff 时再启用细分角色。
- Public HTTP 与 Admin HTTP 使用独立 Fastify Composition Root、认证 Hook 和 Route 注册；不能通过一个运行时角色开关把 Public Session 提升为 Staff Session。
- Admin API 只调用模块显式公开的 Admin Application Port，不直接注入 Repository、共享 ORM Entity、执行任意 SQL 或跨模块修改表。
- 管理员默认只查看完成工单所需的账号、License、设备和健康摘要。跨账号查看域名业务明细必须有对应 Scope、记录理由/工单号，并产生 Staff AuditEvent。
- 管理员不能查看或恢复平台 API Key、OAuth Token、Cookie、Browser Profile、数据库密钥、Recovery Secret 或本地备份秘密，也不能代表用户调用域名平台。
- 管理员不能直接创建用户 Desired State、SyncMutation、ApprovedOperation 或把任务标记为成功。修复云端元数据必须使用模块拥有的受控 Repair Command，并记录前后摘要。
- 高风险管理操作（账号删除介入、设备强制移除、License 人工调整、Sunset/发布通道变更）要求重新认证（Passkey 确认）。单管理员模式下不设多人审批，以重新认证、操作前后摘要和 Staff AuditEvent 作为控制；未来出现多名 Staff 时再补审批流。

普通用户不强制 2FA 的产品决定不适用于内部 Staff。管理员权限不是依靠隐藏 URL、前端按钮或管理员协议包不可见来保证，最终授权必须发生在 Admin API。

## 11. 活动设备与切换安全

- 服务端按账号唯一保存当前 `active_device_id` 和单调递增的 `lease_epoch`。
- 有效绑定且 License 有效的 Standby 只获得 `account:manage` 和 `workspace:read`；ActiveDeviceLease 才授予 `workspace:mutate`、`platform:read`、`platform:write` 和 `operation:approve`。
- Standby 只读 API 不接受 Mutation、凭据引用、执行计划批准或连接器请求；只读缓存不得包含 Outbox、DeviceCredentialBinding 或平台秘密，并遵循与主业务库同等级的落盘加密要求。
- Worker 在平台副作用前校验 ActiveDeviceLease、本机设备 ID、Epoch、本机签名 ApprovedOperation 和本地资源锁。
- 云故障时只允许当前活动设备在签名的 `offline_execute_until` 前继续平台访问，最长 24 小时；许可到期立即停止领取和提交新任务。
- 强制切换必须等待旧设备离线许可到期。旧设备重新联网后发现 Epoch 过期，应停止 Worker、降级到 Cloud Read-Only View，并按语义上传 LateExecutionEvent 与 `StaleDeviceCandidate`。
- 正常切换先停止领取新任务、完成或隔离当前原子请求、上传 Outbox，经服务端核对最后 `client_sequence` 的排空验收后再释放 ActiveDeviceLease。
- 云端同步来的 Desired State 不能直接触发平台副作用，必须由当前活动设备本地预览并签署 ApprovedOperation。
- 旧 Epoch 上传内容按语义分流：经过旧 Lease 窗口、可信时间锚点、单调时钟增量、签名和防重放验证的 Operation 结果与审计事件通过独立 Ingest 作为 LateExecutionEvent 追加保存；Desired State 等可变修改只能成为 StaleDeviceCandidate。
- LateExecutionEvent 不直接修改当前 Desired/Observed State，不触发副作用；无法验证的旧设备报告进入安全隔离记录。

外部平台无法识别 GoodDealer 的 Epoch，因此强制切换后的 24 小时等待是明确接受的残余可用性代价，不能通过立即给新设备发放写权限规避。

## 12. 合规网页入口与停服密钥

- License 过期后客户端业务入口保持锁定，但账号网页端仍允许用户导出服务端持有的数据、申请删除，以及管理会话和设备。
- 网页导出不包含 API Key、Cookie、Browser Profile、本地 Artifact 或数据库密钥，并要求重新认证、限流、审计和邮件通知。
- 删除流程覆盖主库、索引、对象存储、分析副本和备份轮转，并向用户披露延迟删除周期。
- `Sunset Signing Key` 与日常 Auth/License 私钥物理或逻辑隔离，日常服务无权使用；仅在正式停服流程中经多人审批启用。
- 最终 `LocalContinuationMode` 安装包和永久凭证必须签名并通过多个静态渠道验证发布。

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

审计日志为“应用层只追加并带完整性校验”，而不是绝对不可变。应用不提供修改入口，并使用前序 Hash/可选 HMAC 检测篡改；拥有本机管理员权限的用户仍可能修改本地文件。Cloud Staff AuditEvent 与用户业务 Mutation、LateExecutionEvent 分流保存，记录 actor、Scope、理由/工单标识和前后摘要；普通 Admin API 不提供修改或删除入口。

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
