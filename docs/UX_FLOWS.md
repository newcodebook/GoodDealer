# GoodDealer 核心 UX 流程

状态：Accepted Product Flow Baseline / Evidence Pending
更新日期：2026-08-05

## 1. 批量差异预览

面对 `1,000 域名 × 4 平台` 时，默认不直接渲染 4,000 个展开卡片。界面分三层：

### 摘要层

- 目标域名数、平台数和预计请求/文件数。
- 可自动执行、需登录、需人工、冲突和不支持的数量。
- 高风险操作、最大价格变化和预计执行时间。

### 分组层

按平台、账户、动作和结果类型分组，例如：

```text
Atom / 主账户 / 修改价格 / 823
Afternic / 主账户 / 生成 CSV / 1,000
Cloudflare / DNS-A / 新增 TXT / 17
冲突 / 同字段被远端修改 / 6
```

### 明细层

虚拟滚动表格显示域名、字段、旧值、新值、来源、风险和执行方式。支持筛选、导出预览和排除个别项目。

最终确认固定显示实际会提交的数量，不使用仅有“确定”的模糊按钮。

## 2. 冲突中心

冲突中心按字段展示三方值：

```text
编辑基线 Base
本地目标 Local
平台当前 Remote
```

操作：保留本地、接受平台、编辑新值、对同类冲突批量应用。DNS、Nameserver 和 Sold 状态不提供无预览的全选覆盖。

## 3. 人工任务收件箱

人工任务以可完成的 Checklist 展示：

- 为什么需要人工。
- 目标平台和账户。
- 将影响的域名。
- 已准备的文件或验证值。
- “打开平台并登录”“授权执行”“我已在平台操作，立即重新检查”“取消/放弃后续动作”入口；打开或取消都不直接标记成功。只有 Task Policy 的 `risk_acceptance_policy` 为 `allowed | fresh_reauth_required` 时才显示“接受残余风险并关闭”，默认或未知策略不显示；需要新鲜重新认证时，必须在确认页完成并绑定当前任务 Revision。风险接受始终展示未确认影响、记录理由与审计，不能伪装成平台已确认成功。
- 完成条件及最后检查时间。

浏览器自动化失败后回到同一任务，不创建重复收件箱项目。

## 4. 部分失败与重试

批次完成页显示：

- 成功。
- 远端已接受、等待确认。
- 可安全重试。
- 结果未知、只能确认。
- 最终失败。
- 人工处理。

“重试失败项”只选择 `failed_retryable`，不会重提成功项和 `outcome_unknown`。结果未知项提供“检查平台状态”，不提供直接重试。

## 5. 浏览器自动化交接

连接建立与业务执行使用不同提示：首次登录/获取 API Key 显示 BrowserSessionConsent，只说明 ProviderConnection、官方 Host、用途、会话模式和到期时间，不要求选择域名或生成 Operation Plan；此时软件不获得业务填写、上传、提交或读取秘密的权限。软件只检测 Origin 与登录状态，API Key 由用户复制到 Rust Host 原生秘密输入面，BrowserSessionConsent 不允许抓取或回传 Key/Challenge 内容。真正执行平台操作时才展示差异计划并创建 BrowserAutomationGrant。

Remote Browser 窗口持续显示：

- 当前平台、账户和允许 Host。
- 当前处于“用户操作”还是“软件执行”。
- 下一步动作和剩余项目数。
- 暂停并接管、继续、终止按钮。

密码、2FA 和 CAPTCHA 页面自动切换为用户操作状态。最终提交前根据风险策略回到本地计划确认界面。

## 6. 多设备提示

### 账号门禁

- 应用启动先显示登录/授权页，通过后才显示主导航和业务数据。
- 订阅过期且离线宽限结束时显示续费、切换账号和退出，不显示业务主界面。
- 第三台设备登录时显示已绑定设备列表，用户解绑一台后才能继续。若移除的是当前 Active，界面进入与强制切换相同的隔离倒计时：新设备可绑定并查看 Cloud Read-Only View，但在旧 `offline_execute_until` 前不能编辑、批准或访问平台。
- 账号页明确标出一台 `Active` 和一台 `Standby`。
- 新设备绑定后提示用户在首次激活期间配置常用平台凭据；凭据会在设备切回 Standby 后继续安全保存在本机，以减少未来紧急接管时不必要的重录，但接管后仍须通过 Active-only 本机健康检查。
- Standby 可以进入 Cloud Read-Only View，查看云端资产、价格、状态、告警、冲突摘要和任务进度；所有编辑、批准、刷新平台和执行按钮均隐藏或明确禁用。
- 只读视图始终显示“数据来自 GoodDealer Cloud”、云端数据截至时间/Revision 和最后平台读取时间，不能暗示数据刚刚从平台刷新；活动设备存在未同步修改时显示其数量。
- Standby 为每个 ProviderConnection 只显示非秘密的本机配置标记：`曾配置候选`、`从未配置` 或 `未知`，并固定注明“未验证，切换为 Active 后才能检查”。该界面不得读取 Keychain/Credential Manager、Browser Profile 或凭据值，也不得发起凭据健康检查；`曾配置候选` 不能表述为可用凭据。

### 正常切换

- Standby 点击“切换到此设备”后，分别显示旧设备停止任务、等待已提交的原子请求完成或隔离、冲刷 Mutation/ExecutionFact/Workspace DeviceAuditEvent、服务端验证签名 DrainManifest 和释放权限的进度；进入 Draining 后不再发起平台请求。
- 旧设备排空后，新设备先进入“正在安全激活”：使用只读 Bootstrap Capability 拉取最新 Revision、重建工作库并校验摘要；校验通过、服务端签发新 ActiveDeviceLease 后才进入可编辑主界面。
- 尚未执行的 ApprovedOperation 不跨设备迁移；新设备需要重新读取、预览和确认。

### 强制切换

- 旧设备不可达时提供“申请强制切换”，显示旧设备最后在线时间、风险说明和最早接管时间。
- 远程移除当前 Active 和“第三设备满额且 Active 丢失”进入本流程；移除只会立即撤销服务端 Session/Scope，不能消除旧设备剩余离线窗口。账号接管恢复先停留在目的限定的恢复界面，冻结新设备绑定与切换；身份核验、通知与冷静期完成并回到 `normal` 后，才进入本强制切换流程。
- 倒计时最长 24 小时，在旧设备的 `offline_execute_until` 到期前不允许新设备修改业务数据、批准操作或访问平台；Cloud Read-Only View 保持可用。
- 等待界面基于活动设备最后申报的同步进度，预估接管后将进入恢复中心的旧修改规模。
- 若等待期间出现已售域名下架等紧急情况，显示受影响域名、平台和账户，提供“打开平台官网手工处理”和复制域名清单。
- 人工入口使用系统浏览器或无自动化权限的纯人工窗口；不得由 Standby 自动提交，也不得仅凭用户点击“已处理”把任务标记成功。
- 界面说明手工变更会在新活动设备接管后通过平台读取识别为外部修改并完成对账。
- 旧设备以后联网时发现 Epoch 过期，立即停止后台任务；仍绑定且 License 有效时降级到 Cloud Read-Only View，并上传原 Epoch 已持久化签名事实/设备审计与 StaleChangeProposal；Candidate 由 Cloud recovery 生成，已移除或授权失效才锁回账号页。

### 云同步与本地凭据

- 顶部状态常驻显示未同步修改数与最后成功同步时间，并按独立轴同时显示 `设备基础网络`、`GoodDealer Cloud` 和每个 `目标 Provider` 的状态。设备完全断网时只允许 Active 查看本地资产、编辑目标状态和准备计划，禁止平台访问；Cloud 不可达但某 Provider 可达时，当前 Active 可在有效签名离线窗口内继续该 Provider 读写；某 Provider 不可达时只暂停其读取、提交和确认。组合故障的权限取最严格交集并同时显示全部原因，不得用泛化的“服务不可用”或 Cloud-only 状态覆盖设备/Provider 故障。
- Standby 只使用可丢弃的云端只读缓存，不创建 Outbox、Desired State 或 ApprovedOperation。
- 切换为活动设备后以当前 Server Revision 建立完整工作副本，再逐个显示“本设备尚未配置凭据”的 ProviderConnection；只读缓存不作为修改基线。
- 设备重新成为 Active 后，逐个对本机保留的凭据执行 Active-only 健康检查；通过后开放对应连接器。若本设备从未配置凭据，或检查失败、无法验证、凭据已撤销、丢失、过期，用户必须重新输入 API Key、重新登录平台或从明确授权的加密备份恢复。
- 外部写任务显示活动设备、Epoch、离线执行截止时间和等待原因。
- 设置页明确说明哪些业务数据会同步到 GoodDealer 服务端，哪些凭据永不上传。
- 设备绑定流程引导用户在设备处于 Active 期间完成常用平台凭据配置，以缩短日后紧急接管的准备时间；UI 不承诺接管后立即执行，并明确显示健康检查、重录或重新登录状态。

### 恢复中心

- `StaleDeviceCandidate` 展示旧设备、旧 Epoch、原始基线、候选值和当前云端值。
- `RestoreCandidate` 展示备份时间、备份 Revision、候选值和当前云端值。
- `LateExecutionEvent` 在 Operation 历史和审计时间线中展示来源设备、旧 Epoch、发生/接收时间和证据等级，不出现在可丢弃 Candidate 列表。
- 用户选择字段后系统才生成当前 Revision 下的新修改；高风险字段不能批量静默恢复。
- 云端不可用时，备份只能在隔离只读区查看。

### 公开展示

- 云同步不自动公开域名。
- “发布资产”界面按域名和字段预览公开内容，成本、备注、平台账户和审计默认不可选。
- 发布和取消发布都显示最终影响范围并写入审计。

### 本地加密备份

- 所有创建、导出和恢复操作均由用户点击触发。
- 导出前显示备份范围、来源设备、Schema、加密状态和目标文件位置。
- “包含平台 API 凭据”默认关闭；打开时逐项列出将包含的 ProviderConnection。界面按 [D-013](OPEN_DECISIONS.md#d-013-本地备份中的平台凭据) 的完整永不包含清单展示摘要和详情，不得省略 ApprovedOperation、AutomationExecutionTicket 或 Recovery Secret 等不可移植项。
- 恢复前创建本地恢复点，并说明云端当前数据为基线、备份差异会进入恢复中心而不会直接覆盖。

### 账号网页端

- License 过期后客户端仍保持锁定，但网页端保留服务端数据导出、账号/云端数据删除、会话退出和设备移除。
- 导出、删除和移除活动设备要求重新认证，并明确显示邮件通知和处理状态。
- Passkey 是可选的快捷确认方式；界面不要求用户配置 GoodDealer TOTP 或强制 2FA。

### 移动端权限

- 手机处于 Standby 时主场景是查询、告警、计划审阅、任务进度、发起切换和紧急人工处置引导。
- “审阅”不是执行批准；Standby 不能生成 ApprovedOperation 或远程指令活动设备执行。
- 正式批准、少量编辑、平台刷新和经批准的平台紧急下架执行要求手机先切换为 Active；首版不提供无人值守发现或执行。

## 7. 国际化

- UI 文本从第一天使用 i18n Key，不在组件内硬编码。
- 正式版首发 `zh-CN` 与 `en-US`。
- 域名价格使用十进制定点数和 ISO 4217 币种，不使用浮点数。
- 日期、数字和时区按 Locale 展示，数据库保存 UTC。
- 平台原始错误保留原文，同时提供本地化解释。

## 8. 首版 Owner 管理后台

- Owner 使用独立 Admin Web 和 Passkey 登录，不复用普通用户 Session。
- 进入账号详情后顶部固定显示目标账号、Tenant、当前 Scope，以及带类型的 SupportCaseReference、DataRightsRequestId 或 SecurityIncidentId，防止多标签页误操作。
- 跨账号业务明细不要求用户逐次授权，但没有 Scope、理由、有效 `AdminPurposeRef` 或新鲜 Passkey 重新认证时拒绝访问；PurposeRef 关闭、未知或失联时也拒绝新授权。
- Repair Command 先显示 dry-run、目标 Revision 和前后摘要；高风险动作要求再次 Passkey 确认。
- 异步动作显示 Job ID、幂等键、进度、是否可取消、Quarantine 和最终摘要；Owner 不能编辑 Payload 后重放为同一个 Job。
- 首版不展示 Support/Operations/Finance/Security 角色切换或多人审批；未来增加 Staff 后再扩展。
