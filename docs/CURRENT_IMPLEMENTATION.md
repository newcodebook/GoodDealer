# 当前实现与源码入口

恢复持续实施任务时，先读 [完整任务目标与约束](IMPLEMENTATION_GOAL.md)，再核对本页、Git 与执行台账；本页的局部实现不能缩减总任务。

本文件记录开发状态，不重新定义产品范围。功能目标来自产品需求、用户决策和适用 ADR；
营销和设计材料不构成技术指令。未实现、未组合、未取得真实环境证据是不同的交付工作，
不能互相替代，也不能自动成为永久限制。最新需求对谈见 [产品对谈](PRODUCT_DISCOVERY.md)。

## 平台客户进度

| 平台 | 适配源码 | 当前生产客户流程 | 真实账号验收 |
| --- | --- | --- | --- |
| Cloudflare | 官方 Zone/DNS 读取及 Registrar 账户库存 | 单 Zone 连接与维护；设置页账户扫描在确认受理前入库，原子归集并在重开后从首面续读。资产详情和续费台读取完整扫描中的有效注册资料。可以从有效 Zone 读取其账户，或在设置直接连接 Registrar 账户；两条路径均须独立 Registrar 授权与资格 | 未取得 |
| Afternic | 官方库存/GET/Create/Update/Remove/Relist | 设置连接、完整市场库存归集、持久整批上架/改价/下架及重开只读对账已组合。源码支持批次内或独立的 `OWNERSHIP_REVIEW` 官方复核。Linux debug 受控范围只包括库存与 `wecin.com` 的三项 Listing 变更 | Linux 受控真实库存读取通过，挂牌写入与目标平台资格待验收 |
| Spaceship | 官方 Registrar 账户列表、SellerHub 账户列表、精确 GET/PATCH 和固定价 POST | 设置页提供独立的注册域名和 SellerHub 连接。两者在 Native 预检完整账户后才托管凭据，刷新入库后受理，同一设备和 Lease 可重开续读。SellerHub 归集同时写入资产和销售观察，断开撤销本地执行并清理凭据。「批量操作」已组合 SellerHub 一口价预览、一次确认、本机后台 PATCH、精确读取对账与重开续查。同页提供固定价上架预览、确认和按域名结果。下架和自动 DNS 验证仍在实施 | Registrar 及 SellerHub 读写分别待真实卖家账户与实机资格 |
| Atom | 官方 Seller API 库存、精确详情和 Standard 下架 | 设置可原子归集库存、持久刷新并在重开后续读。批量页已组合 Standard 下架预览、一次签名确认、持久单次发送和重开只读对账。当前精确读取只支持确认挂牌存在，批量页保留未核实结果。上架、DNS 与私有验证继续开发 | 匿名认证错误已取证。需要获准的卖家账号及受控 Standard 挂牌，核对认证下架和账户内缺席。目标系统与发行资格待验收 |
| Namecheap | 未实现实际 Service | 未实现 | 未取得 |
| Dynadot | 未实现实际 Service | 未实现 | 未取得 |
| GoDaddy | 官方 Domains v3 账户列表，Native PAT 与受限游标 | 设置中预检完整库存后托管、原子导入、持久刷新和重开续读；注册资料供资产及续费读取 | OTE 匿名 401 已核实；生产真实账户待验收 |
| Porkbun | 官方 v3 `/domain/listAll` 只读客户端（Native 成对密钥、请求头认证、按域名排序的偏移分页） | 设置页以 Native 掩码对话框录入 API key 与 Secret API key，预检完整库存后托管、原子导入、持久刷新和重开续读；注册资料供资产及续费读取。非 `ACTIVE` 状态的域名会使整次导入被拒绝，待真实账户确认状态词汇 | 未取得 |
| Sedo | 官方 Basic `DomainListExtended` | 设置已组合 Native 录入、账户库存归集、持久刷新与断开。同一设备和 Lease 可重开续读。Listing 写入和自动验证继续开发 | 匿名 XML 认证错误已取证，认证分页和目标系统资格待验收 |
| 易名 | 未实现实际 Service | 账户归集及上下架未实现 | 未取得 |
| 阿里云 | 官方 `QueryDomainList`，ACS3 签名 | 中国站账户通过 Native 预检全量库存后托管凭据并原子导入。刷新受理前提交，重开使用同一连接、设备和 Lease 续读。本地断开可清理凭据。卖家上下架和所有权验证待实现 | 未取得 |
| 22.cn | 未实现实际 Service | 账户归集及上下架未实现 | 未取得 |

六个资产来源中，Cloudflare、Spaceship、阿里云和 GoDaddy 已组合账户级归集。四者仍待真实账户验收。Cloudflare 已组合设置中的独立 Registrar 账户连接与原有 Zone 衍生读取。独立入口会在受限 Native 窗口接收 Account ID 与用户 API Token，完整分页预检后发布凭据并在同事务保存资产、注册资料和回执。显式刷新持久绑定当前设备与 Lease，重开从首面续读。旧 Lease 的准备行可断开清理，需要新流程时重新连接。已组合 Linux GTK、Windows Win32 与 macOS 固定录入后端；受控授权、真实账户和目标系统资格仍待取得。Spaceship 的 Registrar 连接先用 Native 候选凭据预检全量库存，精确确认托管后才发布资产。追加迁移 `202611200006`，设置刷新受理前保存工作区、连接 incarnation、设备与 Lease。重开用同一请求从首面续读，完成时原子消费请求并保存观察、资产、Outbox 和回执。旧版待扫描位可通过显式刷新重新准入。仍需具名开发验收范围和真实 `domains:read` 账户。Afternic 的归集对象为市场库存。Linux 受控验收使用 Native 托管的真实 Afternic 凭据，读入 188 个库存域名并新增 188 个本地资产，重开复读仍为 188 个且新增 0。真实 Listing 写入待验收。Afternic 官方复核已进入源码组合，资格清单未开放。`OWNERSHIP_UNVERIFIED` 的私有会话、DNS 与自动验证闭环仍在实施。[所有权复核工作包](phase0/AFTERNIC_OWNERSHIP_REVIEW_TASK_FRAME.md)

GoDaddy 按官方 Domains v3 读取 PAT 所属账户。追加迁移 `202611200008`，在刷新回执前记录当前工作区、连接 incarnation、设备和 Lease，并由同一 SQLCipher 事务发布注册观察、资产、Outbox 和回执。完整扫描缺席时，历史资料在资产与续费台中降为未知。断开先撤销使用权，再按固定系统槽清理。未取得实际账户验收或发行资格。GoDaddy DNS 记录读取已有 Native 只读客户端（`listDNSRecords` 严格分页解析），尚未组合进协议、本地证据和界面，生产入口不可达。Porkbun DNS 记录读取（`GET /dns/retrieve/{domain}`，只需密钥的 `read` 权限）已在源码组合：追加迁移 `202611240002` 把 Porkbun 连接角色扩为 dns+registrar 并保存只追加的读取回执；读取只接受该连接最近一次归集中的域名，记录写入本地 DNS 证据，并为尚无 Zone 绑定的资产建立 `unverified` 的 Porkbun 绑定（已有其他平台绑定或 Cloudflare 观测，或 Porkbun 表示由其他 nameserver 应答而尚无绑定时，失败关闭，改绑待 ADR-0033）；DNS 健康按绑定连接选取观察并标注来源 Porkbun，因没有 Zone 状态与委派核对而始终显示为需关注；证据不上传 Cloud。入口在设置页 Porkbun 面板，资格认证前显示为不可用并说明原因。未取得资格与真实账户验收。注册局委派读取（`GET /domain/getNs/{domain}`，只需 `read`）也已在源码组合：追加迁移 `202611240003` 保存只追加的委派观察（规范主机名、排序去重的集合），准入同 DNS 读取但只要求账户归集的资格与授权，不改变任何 Zone 绑定；DNS 健康按最近一次委派与该行显示的 Zone 观察的 nameserver 集合比对，得出正常、不一致、未解析或未知，页头 NS 异常为全工作区不一致与未解析的资产数。Porkbun Zone 观察不含 nameserver，其委派状态保持未知。入口为设置页 Porkbun 面板的“读取委派”，未取得资格与真实账户验收。Porkbun 连接说明引导用户使用 Read-only 密钥。

Atom 的设置库存同时核对无筛选与 `type=standard` 的两个完整响应。追加迁移 `202611200009` 将正向证据关联到同次库存、Listing 绑定与资产代次。设置可区分零命中及未获核对结果。会话或设备权威不再有效时整次拒绝提交；Standard 分支不可用或观察被隔离时，基础库存保留。此报告只说明保存扫描时的市场类别。

SellerHub 一口价操作只接受当前账户中明确在售并已启用一口价的挂牌。确认冻结连接与挂牌代次、原价与新价，预检后在原 SQLCipher writer 保存一份签名认领。Native 只发送该项的金额，发送成功、断线和未知响应都由精确 GET 对账。退出重开只读取已认领的挂牌，读到目标价后保存结果并请求刷新销售投影。撤销或代次变化会阻止未发送项继续，已认领但无法核对的项目保持未知。本地追加迁移 `202611200011`；Cloud 证据接收追加 `202611200001` 和 `202611200002`，沿用原签名流并在同工作区核对前一设备、原 Lease 与事实摘要。具名开发资格及有 `sellerhub:read` 和 `sellerhub:write` 的认证卖家仍待现场验收。

SellerHub 固定价上架冻结连接 incarnation、资产代次和 USD 一口价，关闭议价。每项在发送前先用完整认证库存确认目标缺席，再持久认领一次。POST 回执、超时和重开均进入账户精确 GET。平台返回 `verifying` 时显示「等待所有权验证」，仅同域名在售且条款匹配时保存为已核实，并排队刷新销售投影。撤回创建资格后，当前观察授权仍可核对已认领项。追加 SQLCipher `202611200014` 与 Cloud `202611200005/006`，分别保存本机计划和独立签名证据。官方 TXT 选项已在 Native 严格解析，已批准 DNS 发布和真实卖家读写仍待贯通。

Sedo 使用与其他市场分立的 `sedo:marketplace:observe` 签名权限。设置通过固定 Native 窗口录入四项凭据，完整官方 XML 预检后才建槽。刷新先落盘，同一连接 incarnation、设备和 Lease 重开后从首面读取。资产、Outbox、原 Listing 绑定、价格观察和扫描回执同事务提交。源清单缺席只撤去旧观察的新鲜度，账户内记录保留官方 `forsale` 和 `fixedprice`，当前挂牌状态仍为未知。断开先撤销后精确清理槽位。

## 丢机强制接管与首次云恢复

[强制接管工作包](phase0/FORCED_TAKEOVER_TASK_FRAME.md)已组合设置与无副本 Standby 入口：专用浏览器重新认证 → 当前来源 epoch 预览 → 一次确认 → 持久等待及取消 → 合法期限后自动安装和激活最后成功同步的非空资产。新登录本身不创建接管。五分钟窗口来自原密码/Passkey 会话，Cloud 原子单次消费，刷新不延长。当前目标仅接受可信 Fresh 或精确终止且未写库的安装；已有副本和无 held 来源的云恢复仍待实现。

Cloud 追加 025–029，记录原认证期限、Lease 已签发离线历史上限、forced 工作流和未知请求取消墓碑；迟到 POST 不能越过原取消。迁移包含 released 历史，只有完整普通交接证据可免保守 block；部署可能增加最多 24 小时等待，不能撤销已发离线签名。等待内合法续租会延后最早时间，期限到达后冻结领取窗口；领取、释放来源、pending epoch 和原能力回执同事务提交。

Native 在发领取前通过原 publication 锁持久化安装资格与 journal v3 forced origin；重启必须读取当前 Cloud 状态，不能靠缓存 claimable 或本地时钟领取。未知请求/领取/激活先查询原身份；取消与领取竞争转现有 bootstrap 取消 lane。forced-control 先保存精确终态，再复制安装证据，未知或可能写入的库仍保留并阻止新安装。目标 mutex、调度退避、电源和最终授权栅栏继续复用。Renderer 仅传预览/意图引用，资格变化撤去迟到预览，轮询不批准。

源码与真实本机 PostgreSQL/SQLCipher 测试已覆盖这些路径；最终根检查、独立审查和具体证据记录在执行台账。实际双设备、部署的签名服务及 Windows/macOS 实机仍未验收，不能宣称完整设备恢复或发行资格。

## 目标设备首次安装

[当前工作包](phase0/TARGET_INSTALLATION_TASK_FRAME.md)接续 `a95dcdb` 的来源交接与目标终止。Cloud 已接 claim/step/checkpoint/activate/receipt 五条固定路由、独立第五签名用途、原请求及精确回执、真实 checkpoint 构建与完整 generation/墓碑摘要；目标历史 status/cancel/receipt 使用窄 bound_device 准入。追加迁移 022–024，未改旧 SQL。

设置与无副本 Standby 页面已接“在本机接收”的一次确认、同步字段限制说明、Provider 重连说明和 Native 状态轮询。开始回复丢失后仅读原进度；工作流或 port 变化使旧确认失效。local-storage 使用本机固定加密库、持久加密 journal 和不可变安装回执完成首次安装；追加迁移 `202611190005`。每个未知 mutation 先查询精确回执，取消意图先落盘，不能盲目重发激活。已初始化副本一律拒绝该入口。

激活成功但回复丢失后，重开先收到 Active Grant 也只能进入 `target_installation_pending`：专用准入仅允许 receipt/status/cancel；原激活回执、匹配 Active Grant 与新鲜 execution context 全部通过后才开放资产库和正常后台。Host/SQLCipher 覆盖非空资产、代次及墓碑、网络回复丢失和关闭重开；最终整合检查与独立复审记录在 [执行台账](phase0/PHASE0_EXECUTION_PLAN.md) 和 [审查记录](reviews/2026-11-19-target-installation-review.md)。已有副本替换、无来源 Lease 云恢复和独立跨机备份仍须继续交付；强制接管已接上述受限目标路径；本节不宣称真实双设备或发行资格。

取消或过期后，Cloud 精确确认原工作流 cancelled/failed、Native 证明从未打开安装数据库且授权仍匹配时，现可对新工作流重新预览确认。首次 SQL open 前先持久化 started；可能写入、旧版未知证据、文件截断或授权变化都不能重标 Fresh。custody Head v2 原子保存新 journal 与最多 8 个原始加密终态文件引用，保留原请求字节；历史满明确拒绝，不删除证据。后台先按原 requestId 对账，轮询不会自动批准新交接。界面保留旧工作流的恢复/等待终态/授权变化/历史满原因，开始丢回复只读原状态。范围及验收见 [重新接收工作包](phase0/TARGET_INSTALLATION_RETRY_TASK_FRAME.md)；最终根检查和独立复审已通过，证据见 [重新接收审查](reviews/2026-11-19-target-installation-retry-review.md)。

## Desktop 与 Native Host

- [生产根组件](../apps/desktop/src/app.tsx)组合启动、登录、锁定、首次接入引导和工作区。
  [工作区入口](../apps/desktop/src/app/workspace-view.tsx)组合资产库、详情、续费、销售、DNS、
  批量任务、人工任务、历史、冲突和设置；存在页面不意味着它展示的每项 Provider 操作已经可执行。
- 资产手动创建、编辑、删除和按同步代次约束的重新添加走本地 SQLCipher；业务状态与 Outbox
  在同一事务提交。设置已组合存储行修复及 Cloudflare 被拒凭据的撤销/清除维护入口，均由 Host
  重新验证授权、代次和请求，不由 UI 自行裁决。
- [Native 注册表](../apps/desktop/src-tauri/src/main.rs)、[command manifest](../apps/desktop/src-tauri/build.rs)
  与 [WebView capability](../apps/desktop/src-tauri/capabilities/local-app.json)定义命令面。
  设备切换 request/advance/status/cancel 已组合 Native 协调器。设置“设备”已组合真实目录读取与本机命名：
  Native 固定 list/self 路由、按本机构建目标报告平台、校验当前设备并移除签名元数据；名称持久化于 Cloud。
  保存结果未知时先刷新对账，普通业务同步不清空未保存输入。Standby 现在可读目录；本机命名仍只允许 Active，
  角色降级立即移除改名入口，不依赖旧设置投影。设置已组合来源交接：列出其他绑定 Standby，名称与编号尾号一起预览，确认一次后由 Native 后台推进；Renderer 只轮询状态，不驱动 drain。无已初始化副本的目标已接一次确认后的安装、重开对账和激活入口；已有副本替换与无来源 Lease 恢复仍未完成。
- Desktop 登录/刷新现已在同一事务终结默认工作区的过期引导：烧毁 pending epoch、消费能力与 nonce、释放 checkpoint pin，
  再按原授权规则分配更高 epoch。未到期、孤立或不一致记录继续阻断；同事务内 Lease 签发失败时整体回滚。
  引导步骤与激活在外部 I/O 后以数据库当前时钟复核期限。目标专用 status/cancel 已组合严格协议和生产终结事务；同一事务烧毁待用 epoch、消费能力/nonce 并释放 pin，保留来源交接回执。首次目标安装/激活已组合，严格限定可信 custody 证明尚未初始化的本机库。
- 设置与无副本 Standby 页面已组合目标引导终止入口：预览本机当前工作流后确认停止；local-storage 固定用途 custody 先保存精确意图，后台和重开先按原 id 对账，未知响应不取消新工作流。无业务库也能工作，不创建空库；终止不触发授权刷新或授予 Active。新的 security epoch 只退回原工作流的重新确认，不复用旧批准。来源释放 Lease 后撤去来源取消按钮。
- Desktop OAuth/刷新支持第二台已绑定设备以 Standby 登录；Cloud/Host 使用严格 v5 角色交换，Active 内层为 v4 Grant 与 v1 Lease 双签名，
  Standby 使用独立用途签名 v1。Cloud 在锁定服务器状态派生角色，签名后重查会话/撤销/期限；精确当前引导目标的 floor 为 pending−1，其余设备为 highest allocated。
- Native custody 独立保存安装与身份绑定的 security/issuedAt/Lease/商业地板，建立标记和记录缺项均拒绝；持久读回后再发布角色，
  Active→Standby 保留本地库并原子停写。新机无副本显示 `standby_awaiting_replica`、设备目录及刷新授权，不伪造空资产库。
  有副本只读，Provider、Outbox 和业务写入均拒绝；普通交接的 Cloud 回执、持久 attempt、原 barrier 与 Native 最后本机 Active epoch 全部匹配后，专用 Inbox gate 允许只读同步。
  Cloud 响应丢失后重开先查状态；未消费且当前仍为 Active 时只恢复 Native 保存的同一签名请求。强制接管、证据缺失、旧 epoch 与 retired cursor 均保持冻结。
  Windows 已组合加密工作区启动/重开、身份/授权地板与 Provider custody：使用本机 Credential Manager 和原子私有 ACL 文件；Core、真实 SQLCipher Storage、Tauri 均通过 Windows GNU 全目标严格 Clippy。尚缺恢复 reservation 和实际 OS 验收，不宣称双系统完整可用。
- 已组合 [Host 执行上下文](../crates/local-storage/src/desktop_local_host/execution_context.rs)：
  Native 随机 nonce、包含休眠的连续时钟和 boot 身份绑定独立签名的 Cloud 时间；授权地板与原始 t0/t1 锚合并为
  一条 v4 custody 记录，发布仍经过原提交栅栏。同 boot 重开保留原 t0，boot 变化、晚到降级响应和超过 RTT 均拒绝。
  新批准、claim 和最终发送要求当前上下文；角色交换失败不伪造可执行权威。context 的验签、custody 与数据库准备在电源锁外完成，返回仅能消费一次的阶段结果；最终电源/会话/Host 栅栏只发布内存权威，期间旧执行权威关闭。Windows/macOS 时钟模块已分别取得
  原样源码目标编译证据；Windows 完整应用也已完成目标编译，macOS 完整应用与两个系统实机仍待验收。Cloud 保存签发时不可变的 Lease/Grant/context 公钥快照，历史核验不借用当前 keyring。
- 普通交接 switch view 使用严格 v2 回执；Cloud 从唯一已消费 proof、释放原因为 normal_handoff 的来源 Lease 及匹配目标能力派生，不从工作流 status 推断成功。
  本地追加迁移 `202611180002` 保存不可变 attempt/receipt/refusal；已签完整请求只进 Native custody。Native 授权地板 v3 保存具名 capabilities，并单独记最后本机 Active epoch，旧地板升级保留所有拒绝重放信息：v1 缺失的历史 Active epoch 保持未知，v2 已记录的值保持不变；旧商业记录仅映射历史 Cloudflare observe 权限。
  初始普通请求也已由 `202611190004` 保存精确字节与幂等键，Cloud request v2 比较 Native 派生的来源 Lease epoch；未知响应先走固定 resolve，再决定只重发原请求或消解更早代次。回答和本地屏障/冻结同事务提交。
  来源后台在原同步 lane 推进，交接与证据上传各有独立退避；已签 proof 使用当前已验签上下文中的真实密钥版本。首次目标引导及上述强制接管已组合；已有副本替换、无来源 Lease 云恢复与独立跨机恢复仍未完成。
- `local-storage` 的 [desktop_local_host](../crates/local-storage/src/desktop_local_host/mod.rs)
  是唯一数据库与事务聚合所有者，内部按授权、业务、同步、Provider 协调和恢复拆分。
  私有实现与数据库、密钥、文件 handle 不成为跨 crate API。
- `active_workspace/business/` 已按资产、Provider 观察、读投影、同步收发、冲突、checkpoint、wire 和修复
  拆分私有实现及测试；仍共享一个数据库 owner。Host 工作区授权与备份工件状态已明确分离，保持同一锁和 epoch。
- Native Provider facade 已分离 Cloudflare 私有适配；Unix custody 的 OS 密钥库细节已提取私有后端。
  Windows custody 与受限 Native 掩码录入已组合；输入在独立 Native 窗口线程中完成并清理，不经 Renderer 或子进程输出。私有目录/文件在创建时即设置 ACL，SQLCipher 临时 sidecar 只接受精确继承权限；真实 Windows 启动、关闭重开、撤销、恢复与凭据输入仍待分别验收。

## Provider

- 十二个首发平台在 `secure-host-core` 的 `provider_services` 各有一个私有 Service 骨架（ADR-0027“平台 Service 骨架”），镜像协议能力 manifest；唯一准入入口目前拒绝一切能力。Dynadot、易名、Namecheap、22.cn 只有骨架，没有 Native transport；Porkbun 的 Service 指向 Native 只读库存与 DNS 记录读取 transport。骨架不是平台交付。
- Cloudflare Zone/DNS 只读 Service 位于 Secure Host 私有实现，包括固定来源 HTTPS、
  Native 凭据录入和 custody、观察、撤销和被拒凭据清除。Renderer 不接收 Token。
- 接入向导已组合连接创建/激活，设置已组合连接维护；单独主动观察的完整客户入口仍需交付。
- [Host 生产资格登记](../crates/local-storage/src/active_workspace/capability_qualification.rs)当前为空。默认构建拒绝未取得资格的创建、激活和观察，撤销、清除及恢复流程继续可用。
  完成对应真实资格后要同步更新合同、准入与客户旅程，不能仅修改清单宣称完成。
- Afternic 官方 API Service 已组合进 Native 和设置：受限凭据录入 → Native 完整分页只读预检 → 托管并复核原槽 → 同事务导入资产、Outbox、Listing 绑定与观察 → 设置展示扫描计数。取消、凭据被拒或扫描未完成时保留首次接入资格。历史删除或待重新添加的资产跳过，既有用户字段保留。
  追加迁移 `202611200001` 令最新完整扫描缺席的旧 Listing 降为未知，随后同秒完成的精确读取仍可更新状态。批准时重新比对最新库存；已认领请求按原证据精确对账，首次写入返回 429 时保存首次 GET 的等待时间。
  原始所有权状态保持，不把市场库存解释成注册商所有权。重开 prepared 使用当前授权加载原 incarnation/generation/proof 的凭据；缺槽进入修复，不能重新录入覆盖。
  撤销先持久阻止使用，再清除 Native slot，确认清除后隐藏连接，保留资产和审计历史。未获得平台权限仍允许本地清理。
  Linux/macOS/Windows 均有受限原生掩码录入与 custody 源码。Linux 已用真实账号导入 188 项，并在重开后复核相同数量。Windows/macOS 实机验收待完成。
- Linux debug 的显式 `afternic-controlled-acceptance` 构建接入了设置、批准和重开恢复。追加迁移 `202611190007` 原子绑定真实账户、工作区、设备、Lease epoch 与唯一凭据槽，读同一连接完整市场库存，写入限 `wecin.com` 的三个 Listing 动作。截止取已验签执行上下文的连续时间投影。Host 向设置和批量页投影受控范围，使用当前 Grant、Lease 和商业权益。见[受控验收工作包](phase0/AFTERNIC_CONTROLLED_ACCEPTANCE_TASK_FRAME.md)。
- Active Grant 的 commercialAuthority v2 是封闭 capability 集合，包含 Afternic、Atom 和 Spaceship 市场 observe/write、Sedo 市场 observe，以及 Cloudflare DNS 与 Cloudflare、GoDaddy、Spaceship、阿里云 Registrar observe。市场 write 必须含同市场的 observe。空集合仍允许有授权的本地业务。
  Cloud 只取锁定 Licensing 快照的精确交集；Host floor/runtime/最终提交栅栏包括集合，权限变化不能复用旧 admission。逻辑 Grant 签名用途仍为 `.v3`，不随 wire 升版创建新用途。
- 十二平台角色、能力目录和不可执行 manifest 已存在。Cloudflare、Afternic、Spaceship、GoDaddy、阿里云、Atom 和 Sedo 已有 Native Service，其余五个平台仍需实现。各平台的完整能力与发行资格继续逐项推进。
  Rust 与 TypeScript 读取合同按 [ADR-0027](adr/0027-multi-platform-domain-providers-and-marketplaces.md)一致扩展；
  名录和展示名称不授予 Provider 执行能力，销售聚合的临时位图也已扩容以保留全部平台。
- [ADR-0027](adr/0027-multi-platform-domain-providers-and-marketplaces.md)已明确已确认官方能力使用官方 API，当前其余缺口全部自研私有 HTTP 接口；
  [公开核查](PROVIDER_API_REVIEW.md)已补充接口语义与社区线索，尚未新增私有会话 custody、Service 或执行资格。

- 本地新增迁移 `202611180001`：原资源绑定表支持连接范围的 Listing、多市场/多账户和 detached 历史；
  Registrar/DNS 单资源约束及已有数据保持。追加 `202611180003` 为 Afternic 连接 publication、完整扫描回执和原始 Listing 详情提供持久事实；观察关联原绑定与代次，销售/资产投影支持同市场多连接，断连后的历史不存在结果降为 unknown。
  追加 `202611180004` 复用原 operation plans/items/attempts/results，保存 Afternic 下架的不可变对账事实；不新增 Listing repository。
- 批量页已组合 Afternic 下架：选择连接与最多 500 个已有域名，从最新完整库存生成 15 分钟持久预览，整批批准一次；历史和详情读取实际持久结果。
  每项精确 GET 与冻结前像匹配后，数据库只发出一个 DELETE claim；任何写响应之后以及重开遗留 running/unknown 都先 GET，绝不自动重发 DELETE。
  精确缺席、unlisted 观察、原绑定 detach 与聚合结果同事务提交；未知/仍存在持久只读退避，完整保留合法 Retry-After。旧绑定和普通 detach 不能伪造成功。
  UI 换选计划、工作区替换和角色降级撤去旧批准入口；丢失预览/批准响应只查状态。
- 下架和上架/改价 worker 与批准入口接入 Linux/Windows/macOS 系统电源通知及 epoch 栅栏：休眠/退出阻断，唤醒不得复用旧许可；注册失败禁止新写，当前授权下仍可只读对账。
  共享原 ProviderLane，每轮处理一项再接收维护/退出请求。连接、库存刷新和重开恢复也检查电源代次，库存最后提交仍按电源、取消、Host 顺序持锁。
  两个 OS 电源模块已取得原样源码目标编译证据，Windows 完整应用已通过目标编译。macOS 完整应用与两个系统实机休眠，以及 Afternic 生产资格，均待取证。
- [执行证据本地来源](../crates/local-storage/src/active_workspace/business/execution_evidence.rs)已组合批准、claim、前置拒绝与结果事务：
  一次批量批准生成真实 item 签名批准与审计；queued→running 原事务追加唯一 claim fact、配对审计及序号，签名失败整批回滚。claim 只表示本地持久认领，不声称 HTTP 已送达或平台成功。
  `202611190001`～`202611190003` 持久化来源、结果/冻结与精确回执。原同步 lane 逐个上传不可变事件，未知响应重发同一字节；缺因果前项先补原 fact/audit；quarantine 保留并阻止封链。
  drain 在原业务事务关闭旧 producer 并记录真实未决数量，取消递增准入代次，旧 GET 不能写入冻结代次；界面明确未决项留在本机，不转为目标可执行队列。
  只有实际 mutation/fact/audit 三流精确回执与连续链全部匹配才构造 proof。旧版本未签名尝试仍拒绝空证明，不补造过去的批准或事实；其升级客户路径尚须接续。
- Afternic 上架/改价已组合严格四字段 POST/所选键 PATCH、15 分钟持久预览、一次批准、单次 claim、写前/写后精确 GET 与关闭重开只读对账。批量页按连接读取历史和详情，字段匹配与平台状态分开；PENDING/ON_HOLD/UNKNOWN 保持平台等待，OWNERSHIP_* 保持待验证，SOLD/合规冲突保留失败原因。新增目标/价格/字段须新预览。
  本地追加 `202611190006` 保留原下架签名字节及 FK，复用原批准表与唯一 Listing 绑定，新增窄 append-only 对账事实；Cloud 030/031 和 purpose 独立的 create/update 批准/事实/审计支持真实两流与 drain。屏障冻结后迟到 GET 不追加旧 epoch 证据。
  源码及独立测试范围见 [上架/改价审查](reviews/2026-11-19-afternic-listing-write-review.md)。真实 Listing 写入、私有所有权验证和必要 DNS 尚未完成，不能以此声明完整 Afternic 或跨市场闭环。

## Cloud 与 Account Web

- [公共 HTTP 组合](../apps/cloud/src/entrypoints/http.ts)与
  [公共业务路由](../apps/cloud/src/entrypoints/routes/public/boundary.ts)包含账号激活、Desktop Grant、
  billing checkout/status/cancel/fixed-term confirm/首购退款，以及按应用端口条件组合的
  workspace sync、Cloudflare 观察副本、设备切换及原请求 resolve、设备列表/self-report、固定 Active-only execution-context，以及各自固定的 device-audit/execution-fact ingest/receipt。
  声明了 route 不代表任意环境都已配置其依赖；具体可达面由对应 composition 和运行配置决定。
- Identity、Desktop OAuth、支付 webhook 与 worker 由各自入口组合；身份、租户范围和商业权威
  由服务器派生。设备目录读/报告锁定当前会话、刷新族、绑定与有效签名密钥，撤销或 rotated 密钥拒绝。
  Cloudflare ingress 接收允许字段的业务观察副本，不接受 Provider 凭据或代为请求 Provider。
- [唯一迁移目录](../apps/cloud/src/db/migrations.ts)维护迁移顺序和校验和；本文件不复制数量。
  包括后续设备交接、mutation receipt、删除/重新添加代次和设备 self-report 的追加迁移。
  数据库是否实际应用这些迁移，必须依据相应环境的运行记录。
- execution-context 已组合独立第四签名用途、锁定事务、签后期限复核及不可变历史；普通应用角色不能通过伪造
  租户变量读取该历史。设备审计/执行事实 ingest 复用原 ledger/封链表，以当前 Active 会话派生来源；严格核验历史时间、用途、批准与配对审计，精确重复返回原回执，已封链不接受新事件。真实签名语义拒绝可阻断首次封链，伪造签名不能污染猜测的流。
  共享开发 OpenBao v2 已部署五个独立用途，经生产 signer/AppRole 完成 5 次签名和 20 次错用途拒绝；本机公开 registry 与部署生成物一致。2026-11-20 只读核对 VPS 仍为 `f872727`，71 条迁移与当前候选前缀完全匹配，030–033 尚未应用。Afternic 的两项测试权益仍在。具体环境见 [开发 Cloud](DEVELOPMENT_CLOUD.md)。生产 custody 资格与真实双设备验收仍独立。
- Account Web 已组合账户访问和商业旅程；已有 staging 观察与其具体限制见
  [开发 Cloud](DEVELOPMENT_CLOUD.md)。这些记录不能替代生产支付、邮件或发行证据。

## 恢复与发行工作

换机云恢复与独立业务备份均为明确需要交付的能力。现有 GDBK v1 是安装绑定格式；其私有
开发组合和 rebootstrap 故障协议已有测试，但生产 native 文件、密钥 custody 和恢复链路
尚未完成，已有副本替换入口仍拒绝执行。普通交接后的首次新机安装已实现上文的受限路径；上述强制接管接续其安装能力，但不能替代无来源 Lease、已有副本或独立灾难恢复。
GDBK v2 独立备份已从桌面设置接入加密创建，登录页、锁定页及本地工作区不可用时可打开备份。用户分别选择加密工件和恢复密钥。两份文件可在隔离的 SQLCipher 数据集中恢复域名、备注、标签与目标价，再另存可读 JSON。创建沿当前工作区授权复核，打开和导出使用独立入口。Linux 已验证源库与源密钥移除后的离线恢复与 JSON 导出，并在隔离桌面会话中从未登录应用经真实 GTK 窗口完成文件选择、资产查看与 JSON 导出。[备份与离线验证记录](reviews/2026-11-20-portable-backup-review.md)

当前 Active 工作区可从同一备份查看页预览逐域名差异，一次确认后导入符合条件的缺失域名。用户可在预览前选择补齐同代次已有域名的空字段，预览列出即将写入的备注、标签、目标价格和有效的域名组合。已有非空字段保留，墓碑、待确认重新添加及其他代次受现有约束保护。新增和补齐分别使用常规创建与编辑，写入同一事务、Outbox 和回执。预览绑定当前工作区、授权代次和本地 revision。Windows/macOS 实机互恢复和其余换机云恢复场景继续验收和实施。

恢复场景和设计修订见 [ADR-0023](adr/0023-business-backup-and-recovery.md)，现有格式边界见
[数据生命周期](DATA_LIFECYCLE.md) 与 [ADR-0023](adr/0023-business-backup-and-recovery.md)。

生产 OpenBao、托管数据库、支付/销售地区、Provider 实际行为、最终原生构件和稳定发行仍需
各自的实现与验证。证据分类与验收见 [验证边界](VERIFICATION.md)；本文件不宣称关闭任何 Gate。


## Linux Afternic 原生录入增量（2026-11-19）

Afternic 的固定 Native GTK 掩码窗口已接入原 Service/custody；取消、超时、授权撤回和晚回调失败关闭，秘密不进入 Renderer/普通 TypeScript。真实 GTK canary 生命周期验收及独立审查通过，见[审查记录](reviews/2026-11-19-linux-afternic-capture-review.md)。这只解除 Linux 凭据录入的源码和组件阻塞，不代表 Afternic 真实账号/写能力已资格化；Windows/macOS 仍分别验收。


## Linux 原生电源监控增量（2026-11-19）

已接入固定 logind PrepareForSleep、真实 delay inhibitor 与原 power epoch/提交栅栏；注册、owner/总线失效及恢复重新取得 inhibitor 均失败关闭。Root/Cloud 独立评审与实际 logind 注册释放测试通过，见[审查记录](reviews/2026-11-19-linux-native-power-review.md)。未触发当前主机实际挂起，sleep/wake 实机及 Windows/macOS 原生资格仍单独验收；不以注册成功代替 Provider 真实业务结果。
