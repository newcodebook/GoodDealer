# GoodDealer 用户旅程

## 适用范围

本文件是产品验收的旅程目录。它保留用户价值、跨域约束和验收门槛；当前组合状态在文末
明确区分已进入客户路径的本地旅程与仍需外部资格的部分。

## 目标旅程目录

| 旅程 | 用户目标 | 未来拥有模块 | 关键验收条件 |
| --- | --- | --- | --- |
| 账户接入 | 激活账户并建立其个人默认工作区访问。 | identity / account web. | 账户与默认工作区原子创建、服务器端范围和可观察会话生命周期。 |
| 资产查看 | 查看有来源、版本和时间的域名资料。 | workspace read / desktop. | 真实共享投影、严格读取协议和脱敏展示。 |
| 资产编辑 | 提交有明确差异的资料变更。 | workspace mutation / operations. | 计划、授权、幂等、冲突和审计。 |
| Cloudflare 域名连接 | 配置明确 Zone/注册商资源并按能力读取或管理域名资产。 | connector / Secure Host. | capability manifest、最小权限、绑定代次、严格网络边界和逐项资格。 |
| DNS/DNSSEC 管理 | 读取、变更 DNS 与 DNSSEC，并在提交后重新观察确认。 | operations / connector. | 单项计划、前置条件、Lease fence、未知结果对账和脱敏历史。 |
| Registrar 生命周期 | 注册、续费、联系人/隐私、转入/转出和转移状态。 | operations / connector. | 资金单项确认；Provider 页面回跳只触发对账，不代表成功。 |
| 批量变更 | 在逐项结果和风险预览下执行域名能力批量操作。 | operations / connector. | 逐项幂等、部分成功、未知结果和可验证补偿；不能假设 Provider 原子成功。 |
| 多设备共享 | 在同一账户的授权客户端间读取个人工作区资料。 | identity / workspace sync. | 服务器端范围、版本、冲突和并发副作用控制；不形成跨账户共享。 |
| 本地数据保护 | 在安全前提下导出或恢复受限资料。 | local backup / recovery. | 安全 SQLite、Host 组合、原生故障验证和恢复规则。 |
| 商业授权 | 管理未来计划、付款和权益。 | account / commercial domain. | 服务端权威、合规资料和外部运营证据。 |
| 内部运营 | 在严格边界内支持客户和系统。 | admin / audit / jobs. | 独立身份、最小范围、脱敏审计和无越权数据库访问。 |

## 共同旅程规则

- 每个旅程在可声明可用前必须有明确用户意图、严格输入、可验证授权、秘密与数据所有权、
  失败关闭的副作用、脱敏审计和可观察结果。
- UI、文案、夹具和静态页面不能充当业务事实或成功证据。
- 外部副作用还需要适用的提供商条件、部署/原生资格和独立审查。
- 数据保护和恢复不能制造新的身份、授权或外部执行能力。

## 当前组合

账户接入当前源码已覆盖同源注册、验证重发、15 分钟/六次/单次使用 challenge、验证事务内账户激活与
个人默认工作区创建、显式密码登录、旧 Web Session 轮换、刷新后的 session discovery、服务端退出，
以及独立密码恢复 challenge、Security Epoch 推进和全部旧 Session 撤销。加密邮件 outbox 只领取绑定
当前、未过期且仍有尝试预算的 challenge digest 消息，每次投递携带稳定幂等键，临时失败按有界退避重试，第二十次失败进入 durable terminal state；
HTTP 只观察脱敏 operation/outcome 标签。以上是当前源码和本地 PostgreSQL 证据。公网
Resend 控制台已确认 `gooddealer.com` 为 Verified 域名；源码将 staging 发件地址固定约束在该域名下。
`account.gooddealer.com` 当前以 fail-closed staging 组合运行：Resend 使用已验证的 `gooddealer.com`
发件域名和 secret custody，账户 API 仍是同源 `/v1/*`；无数据库或开发工具权限的测试用户已完成注册、真实邮件验证、登录、刷新恢复和退出。该证据授权 staging 旅程可用，但不等于公开注册或生产资格。

Cloud 已组合账号激活、Desktop Grant、账号 billing、Desktop OAuth 与支付 webhook 边界；周期
作业精确包含 Licensing provider operation/inbox/reconciliation/due-authority/release，共享开发环境由
systemd self-hosted worker 执行。Desktop 主应用已组合授权门禁、本地资产 list/detail/edit/delete、
Native PKCE/token custody，以及本地提交后的重新读取。Sync 的协议、Cloud ledger、local materializer、
fixed-origin Native transport 与隔离 Sync/Projection lanes 已存在；conflict/tombstone 底层链路也已实现。
Desktop 主应用现已注册独立的 `sync.conflicts` 主导航和冲突页面。页面读取 Native 提供的严格
Conflict Center 投影；Active 本地权威可以对单个候选提交一个明确选择，商业只读/Standby 只可查看且
不携带 resolution admission。locked、retryable、security 和 recovery surface 是 route-free，不能
通过导航或回退路由进入冲突页面。`keep_local` 的 receipt 只证明本地事务已提交并已排队同步，
`accept_remote` 不产生 Outbox；receipt 不是 Cloud ACK。首次成功 receipt 必须严格等于请求的
`expectedReadGeneration + 1`，只有完全一致且期间没有其他 generation 变化的重放可返回同一结果。
页面成功后在一致的 Host generation 上完整重读业务状态、资产列表、Conflict Center 和
`SyncSnapshot`，再一次性发布，generation 撕裂时不会暴露部分刷新结果。

客户同步状态来自持久化 `SyncSnapshot`：它展示 `pendingMutationCount`、`openConflictCount`、
`rejectedMutationCount`、`recoveryRequired`、`appliedThroughServerRevision`、最近复制活动和
Native transport。transport 只有 `checking`、`reachable`、`offline`、`blocked`；Native 首次启动
和每次重启都从 `checking` 开始，不把上次成功观察当作当前可达性。同步是强制异步复制，没有手动同步
按钮，也不使用 `navigator.onLine` 决定状态。

Cloudflare activation/status/observation/local-read 已通过独立、仅用户触发且无 timer retry 的 ProviderLane 和 Renderer adapter 组合到 Tauri。
原始 IPC 只提交 connection/entity lookup hints，凭据和 Provider HTTPS 留在 Native；activation 在 Keychain
前先提交 durable prewrite deny fence，提交后取消不再中断，只有 exact B 能进入 marker/write，矛盾或
orphan 固定进入 remediation 且不推进 generation ledger/head。Renderer 对 status/observation 使用严格
非秘密 DTO、本地提交后读取和 generation/auth fence。Revoke/deactivate
没有 Host 原子 custody/fencing capability，因此当前明确显示 unavailable，未伪造 UI/API。
真实受控 Zone、目标平台 Keychain 和发行资格同样尚未完成，不能声明客户可用。

`local-storage` 的私有备份边界、GDBK/current-DB restore 和 test-only continuity/rebootstrap 聚合协议
已有实现。生产 native picker/handle/KEK custody、独立 non-rollbackable anchor、true create-only
slot-key adapter、safe active-database move detection 与目标平台故障资格尚未完成；生产 rebootstrap plan
在读取 wire/locks 前拒绝，startup 的固定只读检查发现任何残留即终止 Host 构造，不进入私有测试
recovery/quarantine 状态机。因此本地数据保护仍不可作为客户可执行旅程；嵌入式浏览器自动化也不可用。
