# GoodDealer License 与商业授权

状态：Draft  
更新日期：2026-08-01

## 1. 商业模式

计划提供：

- 月付 License。
- 年付 License。
- 终身 License。

License 控制的是软件使用权和版本权益，不参与域名平台操作。GoodDealer Sync Service 可以保存域名业务数据，但不得保存平台操作凭据。用户必须登录 GoodDealer 账号并通过设备与授权门禁后才能进入主界面。

## 2. 控制面边界

远程服务只负责：

- 账号注册、登录、会话刷新和安全恢复。
- 支付结果同步。
- License 签发、激活、续期和撤销。
- 所有平台合计最多两台设备的绑定、查询和解绑，以及单活动设备切换。
- 版本权益和更新通道。

Account/License 模块不处理域名业务 Payload；独立 Sync Service 处理业务数据。平台凭证不得经过任何 GoodDealer 服务端模块。

GoodDealer Staff 通过独立 Admin API 查询和处理订单、退款、Entitlement 与设备问题。License 人工调整、退款介入、设备强制移除和版本/Sunset 通道变更必须经过 Staff Scope、重新认证和审计；管理员仍不得接触平台凭证或代表用户执行域名操作。

## 3. 登录与授权凭证

客户端使用四类职责分离的凭证：

- `Auth Session`：用于在线账号请求，由短期 Access Token 和可轮换 Refresh Token 组成。
- `Offline Device Lease`：证明账号曾登录、当前安装已绑定，并允许在 `access_until` 前离线进入门禁。
- `Entitlement Token`：证明计划、有效期、离线宽限和设备名额权益。
- `ActiveDeviceLease`：证明本设备是当前唯一执行设备，并在 `offline_execute_until` 前允许业务 Mutation、平台访问、批准和执行。

四者均与 `account_id + device_id` 绑定。刷新凭证、Offline Device Lease 和 ActiveDeviceLease 存入 OS Keychain/Credential Manager；普通 WebView、配置和日志不得保存。

Desktop 的 cloud-client 不读取或持有这些 Token。它只构造不含原始 Token 的类型化账号/Cloud 请求，并通过 TypeScript Tauri Adapter 交给 Rust `secure-http`；Secure Host 校验 Endpoint Allowlist 后从 Keychain 注入短期 Access Token。登录、刷新、撤销和轮换属于 Host-owned Session Command，Rust 直接解析 Token-bearing Response 并保存，只向 TypeScript 返回脱敏 AuthSessionStatus。account-web 使用独立的同源 HttpOnly/SameSite Web Session，不复用 Desktop Token 存储。

应用启动先进入 Account Gate。在线时以可刷新 Auth Session 校验账号，离线时以有效 Offline Device Lease 校验账号；同时要求设备绑定和 Entitlement 有效，随后 Standby 可以进入 Cloud Read-Only View。只有本机 ActiveDeviceLease 也有效时，Secure Host 才打开完整业务数据库、Outbox、连接器和 Worker。普通 Access Token 到期只触发后台刷新，不单独导致 Locked。用户启用“记住此设备”后可静默恢复登录，不要求每次手输密码。

服务端签发带数字签名的 Entitlement Token，客户端内置公钥并在本地验证。Token 至少包含：

```text
license_id
account_id
plan
issued_at
expires_at 或 lifetime
offline_grace_until
device_id
device_limit: 2
active_device_limit: 1
standby_cloud_read: true
feature_entitlements
all_major_versions: true（Lifetime）
signature
```

签名建议使用 Ed25519。私钥只存在于 Account/License 控制面，客户端只包含公钥。

## 4. 月付与年付

- 激活后允许一定离线宽限期。
- 客户端在 Token 剩余有效期进入刷新窗口后后台换取新 Entitlement Token。
- 刷新失败使用指数退避，不因一次网络失败立即降级。
- 退款、拒付或欺诈撤销在下一次成功联网刷新时传导；离线期间受已签名 Token 和宽限期约束。
- 宽限期内无法访问授权服务仍可继续使用。
- 宽限期结束后退出业务主界面，回到账号/续费门禁页。
- 过期状态不允许查看资产、导出、备份、恢复或发起紧急下架；本地数据库保持加密且不删除。
- 恢复订阅并取得有效 Token 后重新进入主界面，恢复原有数据和任务状态。

离线宽限期的具体天数在商业策略阶段确定，建议不少于 7 天。

### 可信时间与时钟回拨

- 每次成功访问授权服务时记录服务端签名时间 `last_trusted_time`。
- 本地同时保存单调时钟进度和上次墙上时钟。
- 检测到系统时间明显早于 `last_trusted_time` 时，不延长 Token 或宽限期，而进入受限校时宽限。
- 休眠、时区切换和夏令时不视为回拨；所有判断使用 UTC。
- 可信时间记录带本地完整性校验，但不声称能抵御拥有本机管理员权限的攻击者。

## 5. 终身 License

- 终身 License 包含 GoodDealer 所有未来大版本，不设置 `max_major_version`。
- 终身 Entitlement 永久有效，不依赖周期性订阅租约或再次付费。
- Offline Device Lease 仍为有限期并需要偶尔联网免费续签，以执行账号安全状态、远程解绑和两设备上限；具体周期在商业参数阶段确定。
- 首次设备绑定、换机、主动解绑、账号安全恢复和获取更新仍需要登录账号。
- 终身授权不绕过账号门禁；已记住的设备可以在 Offline Device Lease 有效期内离线进入主界面。
- 日常运行仍需有效 ActiveDeviceLease；永久停服时按第 9 节的延续承诺解除该依赖。
- 退款、欺诈或违反付款约定导致的撤销在客户端下次联网时传导；不声称能让离线设备实时撤销。

## 6. 设备管理

- 使用随机安装 ID 加不可逆设备摘要，不采集完整硬件序列号。
- 一个账号最多绑定两台设备。
- 任意时刻只有一台活动设备，另一台为 Standby；Standby 可读取 GoodDealer Cloud 已有业务数据，但不能产生 Mutation、读取外部平台、批准或执行任务。
- 第三台设备只能进入设备管理流程，解绑一台旧设备后才能绑定。
- 重装系统或换机可由用户自助解绑。
- Windows、macOS、iOS 和 Android 共享同一两设备额度与单活动设备规则。
- 远程解绑在目标设备下次联网或 Offline Device Lease 到期时生效；不能声称对离线设备实时生效。
- 正常切换要求旧设备暂停任务、上传 Outbox 并释放 ActiveDeviceLease；新设备先取得绑定切换请求的短期只读 Bootstrap Capability，完成重建和摘要校验后才取得递增 `lease_epoch` 的 ActiveDeviceLease 并进入可编辑主界面。
- 旧设备不可达时允许强制切换，但必须等待旧设备的 24 小时 `offline_execute_until` 到期。
- 绑定设备通过 Sync Service 交接业务数据；平台凭据仍按设备单独配置，详见 [ACCOUNT_AND_SYNC.md](ACCOUNT_AND_SYNC.md)。

## 7. 过期与锁定行为

出现以下任一权威失败时进入 Locked：Entitlement 过期且离线宽限结束；设备绑定被移除；Offline Device Lease 到期且在线刷新被权威拒绝；本地凭证/数据库完整性校验失败。普通 Access Token 到期、暂时无法刷新或账号服务短时不可用不单独触发 Locked。

- 不打开业务数据库，不挂载主界面。
- 只显示登录、续费、设备管理、网络诊断、语言和退出入口。
- 不允许只读查看、导出、备份/恢复、平台写入或已售域名紧急下架。
- 在确认授权失效时，调度器不再领取新任务；已经发出的原子请求不强行中断，保存最小恢复标记后停止后台业务处理。
- 锁定前尽力冲刷 Sync Outbox；冲刷失败不推迟锁定，未同步增量保留在本地，恢复授权后先上传再继续同步。
- 重新取得有效授权后，首先对未确认任务进行远端对账，再允许用户继续操作。

客户端不会因授权失效删除、改写或上传用户的本地业务数据；恢复授权后可继续使用。这里的“不能使用软件”指业务功能和数据入口被锁定，并非销毁数据。

授权失效后 Sync Worker 和 ActiveDeviceLease 停止。云端业务数据按正式发布前公布的保留期保存；保留期结束、账号删除或用户依法请求删除时进入异步清理流程。具体保留天数属于独立商业与合规参数。

客户端功能锁定不影响法定数据权利。账号网页端在订阅过期后仍提供服务端业务数据的机器可读导出、账号/云端数据删除，以及会话和绑定设备安全管理；这些入口需要重新认证、限流、审计和邮件通知，且不包含服务端从未持有的本地秘密。

## 8. Token 刷新协议

建议初始参数：

- 月付/年付 Token 有效期 30 天。
- 剩余 7 天进入刷新窗口；应用启动、恢复网络和每日维护时尝试刷新。
- 离线宽限独立于 Token 有效期，具体天数由商业策略确认。
- Auth Session 使用短期 Access Token 和可轮换 Refresh Token；Refresh Token 每次成功使用后轮换，复用旧 Token 触发会话风险处理。
- Offline Device Lease 具有独立 `renew_after` 与 `access_until`；续签失败时指数退避，超过 `access_until` 后回到账号门禁。
- ActiveDeviceLease 具有 `lease_epoch`、`renew_after`、`online_expires_at` 和 `offline_execute_until`；在线续签滚动延长最多 24 小时的离线执行许可。
- 服务端返回新签名 Auth/Entitlement Token、可信时间、计划、设备状态和撤销原因码。
- 刷新响应不得包含或请求任何域名业务摘要。
- 撤销只影响后续授权能力，不删除本地数据；离线设备在本地签名期限内可能延迟生效。
- Lifetime Entitlement 不失效且覆盖所有大版本，但 Offline Device Lease 与 ActiveDeviceLease 仍需按周期联网续签；该续签只验证账号/设备状态，不产生续费费用。

## 9. 终身授权停服延续

如果 GoodDealer 永久停止运营，将向终身用户及停服时订阅有效的用户提供最终本地延续版本或永久离线凭证，使其能够访问、导出本地数据并继续设备本地的平台操作。

- 使用与日常 License 私钥隔离的 `Sunset Signing Key` 签发延续凭证。
- 最终版本支持 `LocalContinuationMode`，取消账号登录、Offline Device Lease、ActiveDeviceLease 和云同步依赖。
- 停服前提供云端业务数据全量下载，并通过多个静态渠道分发签名安装包和凭证。
- 商业条款明确适用用户、触发条件和可继续使用的最后版本。

## 10. 支付提供商

支付和税务可接入 Paddle、Lemon Squeezy 或其他 Merchant of Record，也可以自建 Stripe Billing。领域层只依赖统一的支付事件，不绑定具体供应商。

## 11. 反盗版原则

- 目标是提高批量盗版成本，不追求不可破解。
- 不安装内核驱动或侵入式反篡改组件。
- 不采集域名资产作为授权验证依据。
- 不因反盗版机制降低密钥和本地数据安全。

账号、设备绑定、业务数据同步、凭据隔离与备份边界见 [ACCOUNT_AND_SYNC.md](ACCOUNT_AND_SYNC.md) 和 [ADR-0004](adr/0004-cloud-business-data-sync.md)。
