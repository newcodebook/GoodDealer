# GoodDealer License 与商业授权边界

## 适用范围

本文件记录商业授权的产品约束和当前实现边界。仓库已有严格商业快照合同、账号级 PostgreSQL
Entitlement 投影、不可变 Provider 证据、服务器创建的 Provider 绑定和设备期限读取端口，并已实现
Stripe 与可选 PayPal 的可信结账创建和 webhook adapter。共享开发环境已部署 Stripe test-mode 商户
对象、Account Web billing 页面、webhook ingress 与 self-hosted worker；首发不要求 PayPal，live mode
和完整客户管理仍未部署。

## 已接受的目标

未来商业领域应由服务器端事实管理计划、权益、付款状态、退款、访问限制和合规资料。账户
激活时拥有一个个人默认工作区；商业授权与该工作区访问、数据导出/删除和支持流程必须明确
分离。UI 文案、客户端缓存或本地报告不能决定客户权益。

### 目标不变量

- 商业授权的读取和变更从服务器端身份、授权和审计范围推导。
- 平台凭据、恢复材料和其他本地秘密不属于商业领域数据。
- 支付 Provider、优惠和退款规则由 GoodDealer 统一表达，未来启用其他 Provider 不能改变权益。
- 公开价格不含税，只向已经完成支付及税务合规准备的国家或地区开放结账。
- 未确定、过期或被撤销的商业状态必须失败关闭，不能由展示层推断为可用。

商业失败关闭只撤销商业能力，不撤销客户对既有本地数据的查看和受控导出。订阅到期、商业暂停
或退款进入商业只读：禁止本地业务修改、同步和 Provider 外部操作。设备撤销、账号安全恢复和
本地完整性失败属于安全锁定，必须重新认证或恢复后才能打开数据。两者不得使用同一个笼统的
“License 无效”状态。详细裁决见 [ADR-0020](adr/0020-commercial-entitlement-and-local-access.md)。

License Key 仅可作为一次性兑换材料。Desktop 长期运行只接受 Cloud 根据服务器端事实签发的、
绑定账号、个人默认工作区、设备、安全 Epoch、Lease Epoch、能力与期限的签名授权。

首发只有一档功能权益：USD 9.80 月付、USD 98 年付和 USD 498 的 10 年固定期限预付授权。10 年
授权不自动续费且绝不表示永久权益。月付和年付取消后使用到已付周期结束；不提供免费试用。
每账号的首次 settled acquisition 从 Provider 结算时间起有且仅有一个 336 小时全额退款窗口；
该账号终身只产生一次资格，续费不会重置或新增窗口。退款请求一经接受即进入商业只读，而不是等
Provider 最终退款成功后才撤销写入。

首发 catalog 和客户界面只开放 Stripe。PayPal adapter 保留为可选扩展能力，但未配置时不得展示，
也不参与首发或生产资格判定。同一账号最多有一个占用 `CommercialProviderSlot` 的创建、待批准、
不明结果或协议。Provider 切换必须同时满足旧权利不再授予以及准确 Provider 事实证明可替换；优惠码
由 GoodDealer 服务端校验并映射到已启用 Provider 的受控对象，不可叠加，未知映射失败关闭。

## 当前组合

Cloud Licensing 的 M015 是规范化商业领域的 greenfield baseline；仓库不存在 M018 compatibility
migration。`CommercialProviderSlot` 每账号唯一，只拥有 Provider/付款排他性；
`CommercialAuthority` 是唯一可以选择 `CommercialRight` 并推进派生 Entitlement 投影的权威。
槽位占用本身不授予权利，权利撤销也不会自动释放可续费 Provider 槽位。

每个 Provider 外部副作用是独立的 immutable `ProviderOperation`，持有稳定 idempotency identity；每次
网络尝试都必须先提交绑定当前 slot ownership、slot epoch、operation kind、attempt 和 request digest
的一次性 permit，并在事务外调用 Provider。PayPal Order create 与 capture 是 O1/O2 两个操作；规划
O2 会推进 slot epoch，使 O1 permit 失效。创建、capture、取消或回查结果不明时槽位保持占用，迟到或
旧 epoch 结果只能追加证据。

Provider event receipt 是全局、account-blind 的 durable inbox。验签后的首次 digest 不可变，冲突重放
被隔离；账号范围只能从服务器创建、全局唯一的 `ProviderBinding` 推导，不能信任 payload metadata
选择租户。可信 current-generation exact-resource reconciliation 在固定锁顺序下应用 Provider 事实，
并原子推进 authority/right/projection/outbox。当前周期定义精确包含 provider operation、inbox、
reconciliation、due-authority 与 release；共享开发环境的 self-hosted worker 和 Stripe test mode 只构成
开发集成观察，不表示生产 worker 或 live provider 已运行。
Desktop 已区分 active、商业只读、standby 只读、安全锁定和首次激活，并由 OS-protected binding
支持过期后重启读取。Cloud 已提供仅允许 Desktop session 调用的 Grant 公共 route；Desktop OAuth
在签发 code 前要求活动设备密钥持有证明；首次安装还要求五分钟内的密码/Passkey Web 重新认证、
两段浏览器流程使用同一 Web 会话，并在有空闲槽位时原子建立设备 binding。Cloud 已有独立的 Stripe/PayPal raw-body
webhook 入口：先完成 provider 验签，再通过两家官方服务端 SDK 回查当前 Subscription、Checkout
或 Order，最后依据显式 plan allowlist 和服务器创建的 ProviderBinding 写入 Licensing；未知计划、
缺失绑定和不支持状态均失败关闭。Provider metadata/custom id 只可与既有绑定交叉核验，不能创建
账号权威。Provider 创建结果不明时保留原 operation/idempotency identity 等待 reconciliation；只有
确定性 Provider 拒绝或 exact-resource reconciliation 证明资源不存在且不可能后续 capture/activate
才可进入槽位释放判定。返回浏览器的批准地址必须是 HTTPS 且属于当前环境的
Stripe/PayPal 官方 origin。10 年 Stripe Checkout 与 PayPal Order 必须匹配该记录后才能生成
`fixed_term` 权益。可续费订阅的退款必须先由 Provider 确认 termination，再规划精确首付款退款；
`termination_unknown`、`refund_unknown`、`retry_wait` 与 `manual_resolution` 均保持商业只读且绝不表示
退款完成。订阅槽位释放同时要求 exact current-resource reconciliation 已确认 termination/nonrenewal、
没有未来付费周期，并且 protected paid-through 已到期；退款或权利撤销本身不足以释放可续费槽位。
固定期限没有续费协议，只有与首付款 exact binding、同币种且金额等于接受时完整剩余金额的成功退款
事实才能完成退款并释放槽位；partial 或多退少退均不能冒充完成。
首次付费资格由账号终身唯一账本记录；336 小时窗口从首次 settled acquisition 的 Provider 时间开始，
并以数据库当前时间判定接受资格，续费不会重置。billing status 仅为仍对应当前首次购买的
`available` / `expired_unclaimed` 资格返回原始截止时间，使过期与非首次购买保持可区分；claimed 或替换购买不暴露该窗口。退款请求以
`refund_request` 事务能力一次性认领资格，并在同一事务立即把 `CommercialAuthority` 切换为不授予，
随后才通过稳定的 `subscription_refund_terminate` / `first_purchase_refund` operation 和一次性 permit
执行 Provider 副作用。接受或 `not_first_paid_purchase`、`window_elapsed`、`not_paid`、`already_claimed`、
`already_fully_reversed`、`purchase_mismatch` 的业务拒绝，均由同一个持锁事务和数据库时钟裁决，不使用
应用层旧 billing snapshot 猜测。refund command 与 Provider result 在取得任何可变行锁前，先取得同一
账号级 transaction advisory lock；两条路径随后都先锁 account slot，Provider result 再按
work→permit→operation→refund request 的顺序推进。reconciliation 同样从 slot 开始，再读取 agreement、
Authority、refund request 与 refund evidence head，因此所有会同时接触这些聚合行的路径保持一致顺序。
相同请求重放等待结果事务提交后仍返回原
`refundRequestId`，不会形成交叉行锁死锁。该 accepted fence 对所属 Provider agreement 不可逆：后续 active、无
reversal、Provider 拒绝或 reconciliation 都不能重新授予该协议；旧协议完成释放后，新购买协议仍可正常
授予，但账号终身资格保持 claimed 且不再展示退款窗口。operation work 在 lease、permit issue、permit consume 和 result recording 四处都必须仍是 slot 的 exact
current operation，并匹配 ownership 与 holder；result 还必须证明 consumed permit 属于该 operation 的最新 dispatch
revision。最新 permit 的相同结果重放只读返回，冲突结果 quarantine；已有更新 dispatch revision 时，旧 permit
即使搭配当前 lease token 也只能以 `40001` 失败且不得写入。任何 superseded work 或已签发旧 permit 都不能产生 Provider
权限或写入迟到结果。exact-current leased worker 在 Provider mutation 后失败时，数据库会在同一 account advisory
与 slot 锁内把 `permit_issued` 或 `dispatch_consumed` operation 原子推进到 durable `outcome_unknown` 并增加 revision，
随后才将 work 置为 retry 或 dead-letter；旧 lease/token 不得推进 operation，due retry 或 redrive child 必须签发新 permit。
退款 termination 或 refund work 被 quarantine、或耗尽重试进入 dead-letter 时，关联的 accepted refund request
会在同一事务进入无 `retry_at` 的 `manual_resolution`，避免客户状态永久停留在 pending；accepted 只读 fence、
slot release blocker 与 immutable work 审计证据继续保留，受控 dead-letter redrive 仍可推进同一 operation 收敛。
`refunded` request 与 scheduled/completed cancellation 等终态单调不降级；settlement
先于 worker result 到达时，未终结的 consumed permit/work 继续阻止 release，迟到结果只能终结原 exact-current
operation，不能创建新的 subscription refund child，更不能改写已经释放后重购的 slot。确定性 Provider 拒绝进入不可重试的 `manual_resolution`；只有网络、限流或 5xx 等暂时不确定结果
进入带明确 `retry_at` 和有界次数的 `retry_wait`。authenticated pending、partial、dispute、fraud 或其他
不明确退款/冲正事实均立即不授予但不会释放槽位；数据库按 agreement、payment、Provider 与 receipt
trigger resource identity 保存 durable refund evidence head。任一 `blocking` head 都保持不授予，`none`、
缺失 payment context、其他 payment 或同 payment 上不同 refund/dispute/reversal trigger lineage 的较新
receipt 均不能清除；只有携带 authenticated actionable receipt、同时匹配原 payment 与 Provider trigger
identity 的 `refund_failed` 可以把临时 head 解析为 `resolved_failed` 并在没有 accepted fence 时恢复授予；
同 lineage 的 exact full settlement 则进入永久不授予的 `resolved_settled`。只要仍有 blocking head，系统就原子推进 cursor
并创建带最新 binding、slot、agreement 和 Authority CAS 的延迟新 generation reread；child 始终继承该
blocking head 的原始 authenticated receipt/event/trigger context，即使无关的新 receipt 已 supersede cursor。
已应用 generation 不会重试。child 继承 parent lineage、首次尝试时间、最大次数和最大年龄，持续不收敛时
最终节点进入 `dead_letter`，同时保留 evidence head、slot 占用和不授予；所有 blocking head 解析后不再创建轮询。
slot release 在 slot 行锁内聚合这些 durable heads：任何 blocking lineage 都会跨 paid-through、固定期限 expiry
或另一 lineage 的 settled 事实继续保留槽位，并让已有 release job 等待而非静默成功。固定期限提前 release
只读取 immutable purpose 为 `acquisition_initial` 的 `refund_succeeded` `resolved_settled` head 与单调 payment
refund head 的完整金额；renewal 或 adjustment 的 matching terminal 只解析其自身 lineage，不能形成整份 agreement
的 replacement eligibility 或提前 release。
authenticated `full_reversal_settled` 是独立的 exact reversal settlement，真实 dispute/reversal 可以在
`cumulative_refunded_minor=0` 时形成 durable `resolved_settled`，无需伪造 refund progress；但也只有绑定
`acquisition_initial` payment 的 reversal 才能提前释放固定期限。两者都不依赖可被
无关 receipt 替换的 agreement current observation。release 还在同一 slot 锁内聚合未完成的 accepted refund
request、当前 refund operation/work，以及 `requested`、`dispatching`、`outcome_unknown`、`failed_retryable`、
`manual_resolution` cancellation intent 和对应当前 operation/work；这些流程即使尚未产生 sticky head，也会
保持 slot 占用、permit exact-current fence 与不授予状态。只有 request 已由 exact settlement 完成、或 cancellation
已合法 scheduled/completed/superseded 且当前工作终结后才解除该流程阻断。可续费 agreement 仍额外要求
termination/nonrenewal 与 protected paid-through 到期；固定期限仍要求 expiry 或 durable exact settlement。
business blocker 不消耗 execution-failure attempt budget，并使用长退避避免热轮询；exact settlement、matching
terminal evidence 或 confirmed cancellation 会唤醒等待中的 release，若只剩旧 dead-letter 则创建新的 release job。
匹配终态解析 ambiguity 后，系统按相同 durable predicate 续跑或重新规划 release。
首付款事实不可变，累计退款只推进单调 refund head；只有 exact binding、同币种
全额成功事实可以完成退款。partial、pending dispute、fraud ambiguity 均保持失败关闭；任何 accepted
unknown/manual 状态都只能以原 `refundRequestId` 恢复，不能新建请求或展示为已退款。dead-letter
重驱只创建带 parent lineage 与审计原因的新 child work，终态 parent 不可修改。release 只把 lineage 中没有
child 的未解决 leaf 视为 blocker：未重驱的 dead leaf、ready/leased/retry/quarantined child 或再次 dead-letter
的 child 都保持占槽；成功 child 或 grandchild 则仅在 release predicate 中 supersede 其 immutable ancestors，
不会删除或改写审计链。
`credentialRefreshDueAt` 是下一次 Provider 事实 reconciliation 的调度元数据，不是商业授权硬截止；
active 的设备资格截止于 `commercialExpiresAt`，grace 截止于 `offlineGraceUntil`，`pending`、
`suspended`、`revoked` 继续失败关闭。每次实际签发的 Lease 仍独立限制最长 24 小时外部执行窗口。

Desktop 已落地系统浏览器 PKCE、custom-scheme challenge/code 回调、Native access token 内存
custody、独立 Keychain device identity、近期 Web 重新认证首次设备注册和 Keychain refresh token 轮换；每次登录或
refresh 后使用 Bearer 拉取 Grant，以 build-pinned、分目的公钥 registry 双重验签并激活本地 runtime。
开发 OpenBao 已提供真实 Transit/TLS/AppRole/审计集成目标，但生产 OpenBao custody 仍需独立环境
资格；`local:export` 已进入能力合同，GDBK 的四个 Tauri command 及注入式开发导出/恢复工作流也已
完成组合，但尚无生产 native picker/stable-handle/KEK custody 或客户流程。因此源码授权主链已经闭合，
但尚不能把未部署、未签名公证、未完成真实 OpenBao/商户/数据库及备份原生资格的构件声明为客户生产
可用；受控导出产品能力仍为 `unavailable`。

## 自托管 OpenBao Transit custody

GoodDealer 已选择自托管 OpenBao Transit 作为生产签名 KMS。Cloud 不读取私钥，只向固定私有
HTTPS origin 提交 canonical transcript；`GrantV3` 与 `ActiveDeviceLeaseV1` 使用独立 Ed25519
Transit key、固定 key version、独立 `kid` 和仅允许对应 sign path 的策略。OpenBao 返回签名后，
Cloud 使用独立发布的受信公钥立即复验，receipt 只保留 request id、purpose、key/version/kid 和
摘要。工作负载通过 OpenBao Agent 或平台 workload identity 获取短期 token；仓库配置、数据库、
日志和错误不得包含 token、SecretID 或 root credential。
Transit 请求收到 401/403 时只清除被拒绝的缓存 AppRole token，重新认证并重试一次；第二次拒绝
仍失败关闭，不能以长 lease 缓存继续反复提交已吊销 token。

OpenBao 是软件 KMS，不自动等价于 HSM。若部署要求硬件不可导出根保护，OpenBao seal/root
custody 再接获批 HSM；没有该后端时不得宣称 HSM 保证。完整策略、轮换次序和当前实现边界见
[ADR-0021](adr/0021-self-hosted-openbao-transit-signing.md)。当前单节点开发实例、共享 HTTPS Cloud
入口、人工管理隧道、恢复材料和最小权限操作见[开发 OpenBao 运行手册](DEVELOPMENT_OPENBAO.md)；
它不是生产/HSM 资格。

## 交付条件

Stripe test-mode Checkout、webhook、取消和 Stripe-side 首购退款事件收敛已经构成支付集成本地/开发环境证据：一次性
十年期 Test Mode Checkout 已完成并由 Stripe 返回 `paid`，随后创建全额 Refund 并观察到
`refund.created`、`charge.refunded` 与 `refund.updated` 事件；Account Web 重新登录后显示商业只读，
不再显示商业付款计划；同一 Account Web 退款请求已由 Cloud worker 使用 Stripe 官方 SDK 执行并完成。
真实收费时使用的 Stripe live 对象和 secrets 是环境激活输入，
不要求 PayPal，也不能由 test-mode 值替代。商业服务仍需要销售国家与税务资格、数据保护和保留规则、
OpenBao 集群/key/身份/seal 资格、部署、独立审查及适用的发行证据。
仓库中的 SDK adapter、类型、夹具和检查都不能替代这些条件。
