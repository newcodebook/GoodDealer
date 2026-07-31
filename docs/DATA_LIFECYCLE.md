# GoodDealer 数据生命周期与恢复

状态：Draft  
更新日期：2026-08-01

## 1. 域名身份

域名名称和一次持有经历是两个不同实体：

```text
DomainAsset       example.com 这一规范化名称的长期身份
OwnershipEpisode 一次连续持有经历
RegistrarBinding 某段时间内与具体注册商账户的绑定
```

`DomainAsset` 使用内部 UUID，`canonical_name` 在云端 Workspace 和各设备本地副本中唯一。过期、售出或转出不删除 DomainAsset。

### 生命周期规则

- 注册商转移：关闭旧 RegistrarBinding，创建新 Binding；如果所有权未中断，仍属于同一 OwnershipEpisode。
- 售出、丢失或过期删除：结束当前 OwnershipEpisode，历史成本、Listing 和审计保留。
- 重新购回：在同一 DomainAsset 下创建新的 OwnershipEpisode，新的购入成本不覆盖旧记录。
- 首次从注册商列表消失：标记 `unobserved`，不软删除、不立即结束持有。
- 连续多次缺失或其他证据确认后：转为 `missing_review`，由用户选择 transferred、sold、expired、lost 或修正账户绑定。

## 2. 多账户是一等实体

云端共享的 `ProviderConnection` 包含：

```text
id
provider
account_alias
remote_account_id（如可得）
capabilities
status
```

设备本地的 `DeviceCredentialBinding` 包含：

```text
provider_connection_id
device_id
credential_ref
credential_health
```

设备本地的浏览器 Profile 由 browser-automation 独立拥有：

```text
BrowserSessionProfile
  device_id
  provider_connection_id
  session_mode: persistent | private
  profile_ref
  session_health
```

`credential_ref`、`profile_ref` 和 `session_health` 不得进入 Sync Mutation 或服务端数据库。`BrowserSessionProfile` 以 `device_id + provider_connection_id + session_mode` 唯一，不能用 DeviceCredentialBinding 上的单数引用表达多种会话模式。

平台配额的非秘密摘要随 `ProviderConnection` 同步，包括 `quota_scope: credential | provider_account | provider_global | unknown`、剩余配额、重置时间、`backoff_until` 和最近刷新时间。只有当前活动设备读取平台并更新摘要；切换后的设备必须先继承退避状态，不能立即重复全量刷新。摘要可能滞后，不能替代连接器本地的并发控制。

所有 RegistrarBinding、DnsBinding 和 MarketplaceListing 都绑定 `provider_connection_id`，不能只绑定 Provider 名称。

UI、操作计划、冲突和错误必须显示账户别名。例如：`Spaceship / 主账户`、`Atom / Portfolio-B`。

同一域名出现在同平台多个账户时不自动选择权威账户，创建 `account_ownership_conflict` 由用户解决。

## 3. 数据库密钥恢复

只把数据库主密钥存入 OS Keychain 会导致系统重装、签名身份变化或 Keychain 损坏时无法恢复。采用双封装：

1. 首次启动生成随机 Database Master Key。
2. Master Key 存入 OS Keychain。
3. 同时生成一次性 Recovery Secret，并使用 Argon2id 派生 Recovery KEK。
4. 使用经过审计的 AEAD 算法加密 Master Key，把密文、Salt 和参数保存在数据库旁的 Key Envelope 中。
5. Recovery Secret 只显示给用户，不上传服务端、不再次明文显示。
6. Keychain 丢失时，用户输入 Recovery Secret 解封 Master Key 并重新写入 Keychain。

首次设置必须引导用户打印、抄写或保存 Recovery Secret，并立即完成恢复校验。用户可以选择跳过，但 UI 必须明确提示：云端可以重建已同步业务数据，平台凭据、Cookie、本地诊断和未同步数据仍可能永久丢失。

加密备份是本地业务库、允许 Artifact 与用户可选平台凭据的恢复路径；它不承诺迁移 Browser Profile、设备身份或 GoodDealer 授权凭证。备份口令与 Recovery Secret 相互独立。云端重建是业务数据恢复路径，但不能代替设备本地凭据和允许的 Artifact 备份。

### 3.1 Backup Content Manifest

首版只维护一种版本化加密备份包，业务数据和可选凭据区段使用同一 Manifest，不增加独立 Credential Vault 格式。

默认包含：

- Active Workspace 的一致性快照、Schema/应用版本和 Server Revision。
- 历史 Operation/Audit 摘要；恢复后只读，不重新入队。
- 用户选择保留的本地 Artifact 索引及其内容 Hash。

默认不包含、但可由用户显式开启“包含平台 API 凭据”的内容：

- 连接器允许导出的 API Key、API Secret 或平台 OAuth 凭据。
- 每个凭据项的 ProviderConnection、类型、导出时间和兼容平台；不保存 OS Keychain 元数据。

永不包含：

- Browser Profile、Cookie、Local Storage 和登录会话。
- 设备签名私钥、ApprovedOperation、AutomationExecutionTicket。
- GoodDealer Auth Session、Entitlement Token、OfflineDeviceLease、ActiveDeviceLease。
- 数据库 Master Key 明文、Recovery Secret、备份口令或解密密钥。

恢复时先展示 Manifest 和不可移植项。凭据只能写入当前设备的新 Keychain 条目，并重新执行健康检查；不得恢复旧设备身份、Lease、批准或执行权。

## 4. 快照保留

默认策略：

- 当前正规化 Observed State：始终保留。
- 未变化的原始快照：按内容 Hash 去重。
- 最近 30 天：每日一个成功快照。
- 31～90 天：每周一个。
- 91～365 天：每月一个。
- 超过一年：默认只保留年度快照和关键状态变化快照。
- 错误诊断、DOM 和截图：默认 30 天，可由用户立即清除。

用户可调整保留期限。清理任务为 P4 Maintenance，运行前确认没有未完成 Operation 引用目标 Artifact。

## 5. 审计完整性

“不可变审计”在用户拥有本机完全权限的情况下无法绝对保证。准确表述为：

- 应用不提供修改历史记录的入口。
- AuditEvent 只追加。
- 事件包含前一事件 Hash，形成完整性链。
- 可选使用 Keychain 中的本机完整性密钥生成 HMAC。
- 检测到链断裂时提示日志可能被修改，不声称能抵御拥有本机管理员权限的攻击者。

业务审计默认长期保留；大体积请求/响应 Payload 按快照策略压缩或清理。

## 6. Schema 迁移

- 数据库记录 `schema_version`、`created_by_app_version` 和 `last_migrated_by_app_version`。
- 每次迁移前自动创建加密快照，Manifest 包含 Schema 版本、应用版本、Hash 和创建时间。
- 迁移尽量在单个 SQLite Transaction 内执行；不可事务化步骤使用两阶段标记。
- 迁移失败时自动恢复迁移前快照，并阻止新版本继续写入。
- 旧应用检测到更高 Schema 时进入兼容性错误，不尝试降级写入。
- 跨版本恢复先校验备份 Manifest，再在副本上逐级迁移，成功后替换当前数据库。
- 每个正式版本测试从所有仍支持的旧 Schema 升级。

## 7. CSV 与文件安全

任何供 Excel/表格软件打开、且包含用户可控值的 CSV，必须对以下开头进行公式注入防护：`=`、`+`、`-`、`@`、Tab、CR。

防护策略由导出目标决定：

- 人类查看型 CSV：在危险值前加单引号，并按 RFC 4180 转义。
- 平台规定模板：只允许进入平台允许的字段和格式；用户备注等不进入模板。若平台字段确实允许危险前缀，导出前显示警告并使用平台验证规则。

下载、临时 CSV 和备份都登记为 Artifact，并有明确保留和清理状态。

## 8. 云端业务数据生命周期

- DomainAsset、OwnershipEpisode、ProviderConnection 共享元数据、Desired/Observed State 和脱敏审计摘要强制同步。
- 云端使用自己的正规化 Schema、Mutation Log、Server Revision 和软删除墓碑，不保存客户端数据库文件。
- Mutation Log 使用周期性服务端 Checkpoint；设备重建 = 最近 Checkpoint + 后续 Mutation 回放，不从历史起点回放。
- 早于保留策略的 Mutation 由压缩任务清理；压缩不得越过最慢的 Device/Reader Cursor、未解决的 StaleDeviceCandidate 或 RestoreCandidate 引用。审计摘要和 LateExecutionEvent 不随 Mutation 压缩删除，遵循各自的保留策略。Checkpoint 数量与 Mutation 保留期属于正式发布前确定的运维参数。
- Staff 跨账号读取、Repair Command、License/设备/合规管理产生独立 Staff AuditEvent，保存 actor、Scope、理由/工单标识和前后摘要；不得与用户业务 Mutation 合并或因 Workspace 压缩而删除。具体保留期在商业发布前写入内部安全与合规政策。
- 客户端删除先产生 Tombstone；在恢复窗口结束前可撤销，之后由压缩任务清理历史版本。
- 订阅过期时停止同步但不立即删除云端数据；具体保留期必须在正式发布前写入隐私政策和用户协议。
- 账号网页端的数据导出覆盖服务端持有的当前业务记录、必要历史和机器可读关系标识，不包含从未上传的设备秘密。
- 账号删除或合规删除请求需要覆盖主库、搜索索引、对象存储、分析副本和备份轮转，并向用户说明备份延迟删除周期；删除 Tombstone 保留到所有副本和轮转任务确认完成。
- 从云端重建设备只能恢复业务数据，不能恢复 API Key、Cookie、Browser Profile、Recovery Secret 或其他设备秘密。

## 9. 本地备份恢复与云端对账

- 备份必须从 SQLite Backup API 或等效一致性快照产生，不复制运行中的数据库、WAL 或锁文件。
- 本地加密备份的创建、导出、选择文件和恢复都由用户主动发起。
- 备份文件在离开应用私有目录前完成加密；GoodDealer 不集成远程备份服务，也不持有备份口令。
- 用户可以自行复制备份文件到任意存储介质，软件不负责该介质的版本、可用性和删除保证。
- 恢复前先创建当前数据库的加密恢复点，把备份打开到隔离的 Staging Database，并在副本完成 Schema 迁移和完整性检查。
- 校验 Workspace、Schema、备份时间和备份时的 Server Revision 后拉取当前云端状态；云端当前值作为业务基线。
- 备份差异生成 `RestoreCandidate`，不得直接生成 Mutation、覆盖当前数据库或重新入队旧 Operation。
- 用户选择重新应用的字段后，才基于当前 Server Revision 生成新 Mutation；Sold、Nameserver、DNS 删除、所有权和价格等高风险字段必须逐项预览。
- 云端不可用时，Staging Database 只能在隔离只读区打开；不能替换当前同步库。只有用户明确创建全新 Workspace 时，才允许以备份业务数据初始化云端。
- 平台凭据等本地秘密可以在当前设备单独恢复，不参与云端业务数据覆盖。

## 10. 旧 Epoch 的事实与恢复候选

强制切换后，旧设备可能在旧 `lease_epoch` 下保留执行事实和可变业务修改。服务端必须按语义分流：

- Operation 尝试、平台响应、远端任务 ID、结果状态、确认等级、`outcome_unknown` 和审计事件写入追加式 `LateExecutionEvent`，不能由用户丢弃。
- LateExecutionEvent 保存来源设备、旧 Epoch、Event ID、设备序列号、发生/接收时间、ApprovedOperation/计划摘要、证据等级和脱敏结果。
- LateExecutionEvent 通过独立追加式 Ingest 接收，不伪装成 SyncMutation。入库前验证旧 Lease 在动作发生/开始时仍处于离线执行窗口内、设备签名、ApprovedOperation、计划 Hash、可信时间锚点、单调时钟增量和防重放序列；验证失败的报告进入安全隔离记录。
- LateExecutionEvent 只补全历史和审计，不直接覆盖当前 Desired/Observed State；当前活动设备必须重新读取平台完成对账。
- 服务端拒绝把旧 Epoch 的 Desired State、价格目标、标签、备注、Portfolio 等可变修改直接写入当前 Workspace，并保存为 `StaleDeviceCandidate`。
- Candidate 保存来源设备、旧 Epoch、原始基线、候选值、当前云端值、创建时间和处理状态；不包含执行结果或审计事实。
- 用户在当前活动设备选择重新应用的字段后，基于当前 Revision 生成新 Mutation。
- 候选默认保留 90 天；涉及合规删除时随账号数据一起清理，用户也可提前丢弃。
- 旧 Operation 不得恢复到队列；其有效执行事实永久与 Operation 历史关联，Candidate 被丢弃也不删除事实。

云同步、凭据隔离和本地备份边界见 [ACCOUNT_AND_SYNC.md](ACCOUNT_AND_SYNC.md)。
