# 丢机强制接管至首次云恢复

基线 `825878d`（终止安装后重新接收）。总范围见 [实施目标](../IMPLEMENTATION_GOAL.md)，规则见 ADR-0032、ADR-0011、ADR-0023；本工作包实施真实生产组合，不以合同或空入口结束。

## 目标与范围

已绑定目标 Standby 在设置或无副本页面要求浏览器重新认证，返回后读取当前来源和 Lease epoch，预览最后成功同步字段及旧机未同步修改不会恢复的限制。最终确认一次，Native 持久保存原请求，Cloud 单次消费五分钟认证窗口并进入 waiting_expiry。等待中重开自动对账，显示随合法续租变化的最早接管时间，允许取消。到达合法窗口后，Native 先持久占住合格本机安装状态，再领取能力、下载真实 checkpoint/mutation、安装和激活，显示资产并提示重新连接 Provider。

本切片目标库支持可信 Fresh 或已精确终止且 not_started 的原安装；其他已有库明确拒绝释放来源并保留原库。已有副本独立保留/新副本发布、离线备份恢复与所有平台仍属于总目标，后续继续实现。旧机回联必须降级、停止 Outbox/Provider/Inbox 并保留未同步原库；不能以先前普通交接回执解除强制接管冻结。

## 所有权与依赖

- standby_cloud 拥有 protocol、Cloud Identity/Devices、追加迁移与真实 PostgreSQL 验证。只通过已有声明端口跨模块，Identity 拥有认证窗口，Devices 拥有工作流/Lease/能力，Workspace 拥有允许字段副本。不新增通用代理或第二 writer。
- device_architecture_review 拥有 local-storage 具名 forced-control custody、Host 准入/原意图与恢复、安装 origin/终态证据、实际 SQLCipher 与跨崩溃测试，及最小 public exports。
- standby_native 拥有 secure-host-core OAuth 固定重新认证意图、Native OAuth/固定 HTTP/目标协调器与后台调度；共享安装/取消锁，Windows/macOS 同义实现。
- root 拥有 Task Frame/ADR澄清、Account Web 重新认证入口、Desktop IPC/adapter/界面/i18n、共享组合注册、策略清单与当前文档、根检查和提交。
- 独立接受：root 及 Storage 复核 Cloud 事务/权限/并发；Cloud 复核 Host/Native 与 root UI 并复现相关测试；Native 复核 Storage claim 前安装资格。构建者不得接受自己的实现。

基线完整根检查和独立审查已通过，工作区清洁。本框架已冻结，可按不重叠文件派发实施；迁移编号、protocol shape、Host API、Native method 与 root 组合由指定所有者先发精确合同，不在拥有者之外抢改。

## 重新认证与原请求

1. OAuth authorize 增可选字面量 require_reauth=true，普通登录不带。Core 在challenge二次authorize保留；HTTP严格拒绝重复/未知/其他值。Cloud只认五分钟内password/passkey Account Web session的原created_at+300s，不从refresh、oauth_pkce或客户端时钟推导；challenge、proof、code兑换及新Desktop session落盘均检查原截止。超时浏览器返回同源明确reauth continuation，Account Web呈现登录而非沿用旧session循环跳转。
2. Authorization code短期保存绝对deadline，新的Desktop session只保存deadline/consumedAt；refresh不延长、不重置。窗口不进Renderer、Grant或单独proof token。普通OAuth不产生接管意图。
3. UI先专用reauth，再取得当前来源epoch和目标scope的新预览；最终一次确认才落盘forced request。严格forced请求删除reauthProofId，增加expectedSourceLeaseEpoch正整数CAS；服务器从当前epoch/Lease派生source device，target必须是当前Standby会话设备。
4. Cloud先校验当前session/family/security epoch/绑定密钥、精确原幂等结果及来源CAS，再在同一事务消费窗口并创建waiting。失败回滚消费；相同body/idem只读原结果，不再次消费，不同body冲突。SOURCE_LEASE_CHANGED要求新预览，不能静默切换来源。
5. Native具名forced-control保存原批准、request字节、idempotency及结果；发送前已落盘。请求丢ACK/重开先经target绑定resolve查询；找到只接受匹配原body/epoch/目标的workflow，未找到且授权/预览变更则作废，不能新建意图。账户/工作区来自会话，不由Renderer选择。

## Lease 历史与等待期限

- 既有device_active_leases追加max_issued_offline_execute_until。新签发/激活初始化，所有同epoch续租greatest更新；较短商业截止不得缩小历史已签发窗口。撤销/移除产生execution block时同样用历史上限。既有未知历史记录（含released）保守回填max(当前截止,锁后迁移切换时刻+24h)，不能声称当前行代表历史。账户对无法由精确普通handoff证明解释的released历史补相应execution block；只有完整匹配proof/workflow/source epoch/release时间/target能力才可例外，不能只看reason。未来insert/update触发器保底单调上界；有关账户的Grant/ExecutionContext签发也须遵守block。此保守迁移可能增加最多24小时等待，不声称撤回已发离线授权或修复迁移前重叠；部署文档须说明切换窗口。
- waiting工作流持久earliest_takeover_at=max(请求时刻,exclusive block,来源历史截止)，deadline=earliest+24h。等待期间now<已有earliest时合法续租可单调推进earliest/deadline/revision；到达earliest后冻结领取窗口，迟到续租不能复活或推走它。持续在线续租可能持续延后，UI明确说明。
- claim/renew/cancel/expiry沿用统一锁序；锁后clock_timestamp和慢签名后最终期限/身份/epoch/状态重验。领取在earliest<=now<deadline时原子释放来源、预分配pending、签发并验证独立能力；失败回滚。取消/过期不回退最高epoch，不恢复来源，不删除云副本。
- 本切片只准入唯一未释放 current held source（可过 online/offline 期限，epoch身份必须精确）。无held不生成可提交preview，不消费窗口、不猜来源，也不绕过exclusive block；无held的云恢复仍为后续必须交付路径。等待取消只结束工作流，来源尚未释放，无需恢复；进入bootstrap后终结才适用不恢复已释放来源。

## 目标安装与未知结果

- waiting阶段不伪造Cloud workflow id，不将Fresh改为虚构状态。得到真实workflow后，在任何claim HTTP之前，以原批准和精确最新forced状态在同一publication锁下持久Installing journal。准入复用Fresh或本轮Stopped.allowed，不只瞬时检查isFresh。失败保留可取消入口，绝不先释放来源再发现无法安装。
- journal持久显式forced origin（原intent/idem/digest、来源epoch、真实workflow），normal明确为空。缺失/错scope/control/旧代次失败关闭。计时器仅唤醒，Host不得使用本地trusted_time_floor当服务器时间；具体claimable事实合同由Cloud/Host冻结，领取仍以Cloud最终事务为权威。
- Cloud仅claim和claim receipt准入waiting或未创建capability的原终态；step/checkpoint/activate仍要求真实capability。原claim在waiting为严格uncommitted、operation=claim、nextStep=null；已取消/失败为terminal，不能用not_found猜未提交；已领取为原committed回执。
- waiting/uncommitted或刚被续租推迟的NotReady只恢复持久等待、读取精确最新状态，再调度同一claim；不生成新批准、不热循环、不永久Blocked。未知结果先receipt，原body/nonce不替换。
- waiting取消先保存具名原取消意图；如与claim竞争后已bootstrapping，沿用同一意图转现有bootstrap取消，不重复询问。原waiting终态保存forced_control完整认证记录，再在同publication锁下复制为installation terminal_evidence.kind=forced_control，精确匹配journal origin。中间崩溃幂等收敛，不能伪装target_control.last_finished。

## 验收与证据

- 源码与真实SQLCipher/PG贯通：浏览器reauth→新session单次窗口→新预览确认→waiting→重启resolve→历史截止到达→安装资格持久化→claim/pin/download/install/activate→当前Active+fresh context→非空资产与代次/墓碑。
- 负测：错用途/租户/设备/epoch/key/role、proof字段拒绝、旧/非password-passkey会话、refresh延长和多次消费、并发重复请求、CAS变化不消费、waiting正常续租较短/更长截止、历史旧签名仍有效、慢signer跨earliest/deadline、并发claim/cancel/renew/expiry、领取ACK丢失、每个文件/网络崩溃前缀、旧普通交接回执不得解冻强制接管原机。
- UI验收一次确认、登录本身不执行、scope变化撤回预览、动态最早时间、关闭重开续作、等待取消及claim竞争后继续取消、已有库阻止释放来源、Provider重连与最后成功同步限制。所有输入从unknown严格校验，Renderer不接秘密。
- 追加迁移及实际生产角色权限、完整关键PG套件、模块测试、根pnpm check、Linux/Windows strict、生成物/拓扑/导出/链接/diff，独立复审。Windows/macOS实机、真实双设备、部署OpenBao第五用途与发行资格分别记录；缺外部条件继续本地工作，不假装fake为实机。

## 冻结公开合同

- 新增固定 `POST /v1/device-switch/forced/preview`，strict 请求 `{schemaVersion:1}`。成功 `{schemaVersion:1,available:true,sourceDeviceId,sourceLeaseEpoch,toDeviceId,earliestTakeoverAt,evaluatedAt}`；不可确认 `{schemaVersion:1,available:false,reason}`，reason闭集 `SOURCE_UNAVAILABLE | SWITCH_IN_PROGRESS | TARGET_NOT_STANDBY | REAUTH_REQUIRED`。当前会话及Standby派生范围，窗口不输出、不消费；无租户/来源选择器。
- 新增固定 `POST /v1/device-switch/forced/status`，请求 `{schemaVersion:1,requestId}`，响应 `{schemaVersion:1,found:false}` 或 `{schemaVersion:1,found:true,workflow}`。`workflow={request:DeviceSwitchRequestViewV2(mode=forced),workflowRevision:positive,sourceLeaseEpoch:positive,evaluatedAt:UTC,claimable:boolean}`。claimable只在锁后当前waiting、来源/历史截止/block/target/deadline均匹配时true；其他状态false。认证HTTP的本次状态不是未来承诺；新进程不能只读缓存true首次发送claim。
- 新增固定 `POST /v1/device-switch/forced/resolve`，请求 `{schemaVersion:1,idempotencyKey}`，未找到与status同found=false；找到含 `{schemaVersion:1,found:true,idempotencyKey,originalRequest,workflow}`，原请求包含strict forced request全体字段，仅当前会话target可读。原source resolve不扩张为任意参与者读。
- forced request保留schemaVersion2，字段为mode/toDeviceId/expectedSourceLeaseEpoch/idempotencyKey，无reauthProofId。request/cancel沿用既有固定路由，应用与事务精确分支验证角色；普通来源操作不泛化给Standby。新增统一闭集REAUTH_REQUIRED，不暴露具体凭据/消费状态。
- claim响应新增闭集TAKEOVER_NOT_READY，只有waiting当前不可领取时使用；Host保存等待、读取最新精确状态。receipt仅claim+waiting_expiry允许uncommitted且nextStep=null；step/activate不得用该分支。过期先终结再返回terminal，不得复活。来源释放、pending、能力与原claim_response必须同一事务提交。
- Host公开最小面：prepare/complete_forced_takeover_preview；confirm_forced_takeover(admission,previewId)；forced_takeover_status；prepare/complete_forced_takeover_work（固定Exchange或ResumeInstallation/Settled）；cancel_forced_takeover(admission,intentId)。交换对象不暴露secret字段，实际签名/token仍Native。Cloud原source epoch只经preview固定，Renderer不裸传epoch。
- Native/Renderer仅五个IPC：forced_takeover_reauthenticate()、forced_takeover_preview()、forced_takeover_confirm({schemaVersion:1,previewId})、forced_takeover_status()、forced_takeover_cancel({schemaVersion:1,intentId})。专用reauth成功关联本次login purpose/generation/最终credential fence；仅为本机流程关联，Cloud窗口才是权威。取消/失败回旧authenticated不能解锁preview。未确认重开重新reauth；已有持久意图只恢复原计划。
- journal私有v3必填origin，v1/v2明确升级normal，forced仅存不可变intent/idem/digest/sourceEpoch/workflow；动态earliest/revision/claimable存forced-control。每次首次/重放Claim均过forced gate；waiting无work/more=false，重开先status/receipt。ResumeInstallation返回后释放目标mutex再唤醒安装，禁止持锁递归。
- waiting取消转bootstrap取消沿同一原intent；若已经completed，只收敛真实activation和当前授权，不能宣称取消。forced_control完整原记录先落盘再复制journal，exact origin/scope/security匹配，not_started才允许本轮重接历史路径。

## 组合与迁移归属细化

Cloud builder拥有protocol及其corpus、Identity/Devices源码、025–027三个追加迁移及模块/PG测试；root拥有迁移catalog注册、HTTP route/desktop-oauth-http/development-server薄组合及其测试。025为Identity code/session重新认证窗口与窄消费权限，026为Devices历史截止和DB单调保底，027为forced工作流/源epoch/等待/期限约束；应用后只能再追加修正迁移。

OAuth service stale结果固定 `{authorized:false,reauthRequired:true}`，root HTTP用 `/?continue=<已验证原authorize URL>&reauth=required` 回同源Account Web。合法continuation且外层单一精确required才要求当前页面重新登录，不自动沿用旧session返回；登录成功后回原continuation。Origin/同源校验、重复字段、未知selector及loopback/PKCE检查保留。

Modern Web Guidance已针对返回地址检索并完整读取validate-origins/security：新逻辑不把URL/marker当认证权威，拒绝不透明origin与不合法同源continuation，保持浏览器Cookie及Native令牌边界。界面仍用既有表单/品牌组件，状态播报沿用已应用的accessibility要求。


## 未知初始请求的精确取消

已输出原POST字节后，resolve未找到不证明迟到请求不会创建工作流。`POST /v1/device-switch/forced/cancel-intent` 接受 `{schemaVersion:1,originalRequest:<完整strict forced请求>}`，返回原请求及 `outcome=cancelled_before_request`，或 `outcome=workflow` 与精确workflow。同账户锁内无workflow时持久幂等墓碑，后到原请求必须拒绝且不消费认证窗口；已有waiting同事务取消，已bootstrapping沿原取消意图终止引导，已完成只收敛真实结果。028前向迁移拥有墓碑；未得到精确响应前持续原取消对账。Host脱敏状态新增CancelledBeforeRequest{intentId}，不伪造requestId，保留原请求与终结证据后可重新预览。
