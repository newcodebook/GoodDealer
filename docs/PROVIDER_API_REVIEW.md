# 域名平台 API 与接入路径核查

核查日期：2026-11-18。本轮继续核对七个优先交易平台的官方文档、公开帮助及社区仓库源码。
只读取公开资料，没有使用客户凭据、执行平台业务请求、运行社区代码、申请权限或联系平台。
文档合同已确认不等于账号获准、接口实测成功或 GoodDealer 已交付；未找到公开合同也不等于不存在 API。
搜索摘要和搜索引擎生成的回答不作为接口证据。

产品负责人进一步决定：已确认官方支持的能力走官方 API；目前未找到官方支持的能力缺口，
后续全部走自研私有 API 开发。社区代码仅作参考，不再等待社区成品或追加官方搜索才启动工作包。
接入边界见 [ADR-0027](adr/0027-multi-platform-domain-providers-and-marketplaces.md)。本轮重点为资产归集、卖家上下架和所有权验证，
并非十二平台所有注册商、获取、DNS 能力的完整资格审查。

## 官方合同与当前缺口

| 平台 | 已核实的能力和证据 | 缺口与接入决定 |
| --- | --- | --- |
| Cloudflare Registrar | [List Registrations](https://developers.cloudflare.com/api/resources/registrar/subresources/registrations/methods/list/) 确认 `GET /client/v4/accounts/{account_id}/registrar/registrations`、Bearer Token、`per_page` 上限 50、`sort_by=name`、`direction=asc` 及不透明 cursor。空 cursor 结束。响应提供登记与到期时间、自动续费、注册锁和七种状态；仅注册或转入进行中可无到期日期。 | 归集由同一个 Native Service 从已连接的官方 Zone 详情确定账户，逐页读取后提交。验收需要该账户中可读的 Zone 与有权读取账户注册列表的令牌，在原生界面录入。以完整注册清单、设置页汇总、资产库及重开复读核对结果。当前证据为官方文档和本地测试。 |
| Afternic | [Portfolio API](https://api.afternic.com/docs/portfolio-api/)及[工作流](https://api.afternic.com/docs/portfolio-api/guides/common-workflows/)：`GET/POST /v3/aftermarket/customers/{customerId}/domains`、单域名 `GET/PATCH/DELETE`、`POST .../domains/$each/upsert`，upsert 每批最多 500 个；另有异步 CSV jobs。[认证](https://api.afternic.com/docs/portfolio-api/guides/authentication/)为账户 Security 创建 key/secret、`Authorization: sso-key`。 | Listing 采用官方 API。验证缺口按下文状态区分：账户 challenge 获取和冲突复核目前只确认网页入口；直接纳入该账户正常页面使用的私有 HTTP 接口开发。不能把重新上架当成全部 ownership 问题的解决方式。 |
| Atom | [列表](https://apidocs.atom.com/api-reference/seller_apis/domains)、[详情](https://apidocs.atom.com/api-reference/seller_apis/domain_details)、[新增](https://apidocs.atom.com/api-reference/seller_apis/add_domain)、[移除](https://apidocs.atom.com/api-reference/seller_apis/remove_domain)、[DNS 检查](https://apidocs.atom.com/api-reference/seller_apis/verify_dns)均有官方合同，路径位于 `https://www.atom.com/api/marketplace/`。 | 优先官方 Seller API。[准入说明](https://www.atom.com/help/article/atom-seller-api-access)仍写 Limited Beta，卖家申请审查要求至少 500 个 Listing；Registrar 至少 100 个域名或活跃卖家。约 300 个域名不自动满足卖家条件。若账号未获 API 准入，调查账号正常可用的卖家私有接口；这不等于绕过 API 权限。验证要求与完成状态仍需补齐。 |
| Spaceship Registrar | [官方 Domain Management](https://docs.spaceship.dev/#tag/Domain-Management) 的 OpenAPI 1.0.0 定义 `GET https://spaceship.dev/api/v1/domains`、`X-API-Key`、`X-API-Secret` 和 `domains:read`。分页使用 `take`（1–100）、`skip` 与 `orderBy=name`，响应有 `items`、`total`。限速为每用户 300 次/300 秒。 | 未提供账户身份或快照端点。Native 以固定凭据槽作为读取范围，检查总数、每页数量与规范域名唯一性。联系人引用、原响应和凭据留在 Native。真实验收需受控只读 key/secret 与一个可核对的账户内域名。 |
| Spaceship SellerHub | [官方文档](https://docs.spaceship.dev/#tag/SellerHub)：`GET/POST /v1/sellerhub/domains`、单域名 `GET/PATCH/DELETE /v1/sellerhub/domains/{domain}`；`GET /v1/sellerhub/verification-records` 提供验证要求。 | 本轮七家公开文档中验证闭环最明确，采用官方接口。账户级验证记录可复用，但要发布到各目标域名 DNS；选项之间 OR、选中选项内记录 AND。`sellerhub:read/write` 与 DNS 权限分别申请。验证记录读取 10 次/60 秒，Listing 常见操作 300 次/300 秒；列表分页 `take` 最大 100。 |
| Sedo | [Basic API](https://api.sedo.com/apidocs/v1/Basic/)支持 SOAP 以及部分方法的 XML GET/POST；[DomainInsert](https://api.sedo.com/apidocs/v1/Basic/functions/sedoapi_DomainInsert.html)、DomainEdit、DomainDelete、[DomainListExtended](https://api.sedo.com/apidocs/v1/Basic/functions/sedoapi_DomainListExtended.html)提供卖家写入和账户列表。Insert 最多 50 个，Extended 列表每个 SOAP 请求最多 100 个。 | 卖家操作优先官方 API；认证含 partnerid、signkey、username、password，需核实当前账号准入及密码合同。Insert 会开启 parking，且存在后续检查。尚未取得 TXT challenge 获取/触发验证的公开合同，纳入私有 API 开发工作包。[DomainStatus](https://api.sedo.com/apidocs/v1/Basic/functions/sedoapi_DomainStatus.html)不能证明域名属于当前账户。 |
| 易名 | [官方帮助检索](https://help.ename.cn/faq/faqlist?faqName=API)中的闲置域名协议说明可向合作方 API 分发；本轮仍未取得普通卖家资产列表、上下架和验证的公开端点合同。 | 新发现社区 `greedying/ename` 的资产读取、批量发布源码，见下表。资产读取、上下架及验证缺口全部进入自研私有 API 开发；不能因公开文档缺失取消首发资产归集及上下架。社区旧实现尚不能作为当前接口合同。 |
| 阿里云 | [域名 API 2018-01-29](https://help.aliyun.com/zh/dws/developer-reference/api-domain-2018-01-29-overview)有 QueryDomainList、ScrollDomainList；本轮重读[交易 API 2018-02-08 目录](https://help.aliyun.com/zh/dws/developer-reference/api-domain-2018-02-08-overview)，列出 QueryBrokerDemand、CreateFixedPriceSelectedOrder、CheckSelectedDomainStatus、SelectedDomainList、QueryExchangeRate。 | 归集使用官方 SDK 5.1.1 核对的中国站 `QueryDomainList`，固定域名 endpoint、HTTPS POST、`PageNum/PageSize` 与 ACS3 签名。方法文档列出的 RAM action 是 `domain:QueryCommonInfo`。当前公开交易目录没有卖家发布/下架方法；直接进入卖家控制台私有 API 开发。CreateFixedPriceSelectedOrder 是扣款购买，SelectedDomainList 是市场在售列表，均不能代替账户卖家操作。[严选交易说明](https://help.aliyun.com/zh/dws/user-guide/fixed-price-1)确认可发布外部注册商域名；买家付款后可能禁止下架/改价，必须建模交易锁定状态。 |
| 22.cn | [API 域名代理介绍](https://www.22.cn/help_139.html)明确支持二次开发与 ASP/PHP/ASP.NET 示例；[文档下载](https://www.22.cn/help_141.html)提供 ZIP。[开放平台](https://www.22.cn/open.html)另提供“交易数据开放”的申请表和流程。 | 域名代理 API、交易数据开放均已确认存在，仍不能据此推断卖家发布/下架或账户资产端点。ZIP 前轮读取为 403，本轮公开 HTTP/HTTPS 下载得到 `T_T` HTML，未取得 ZIP 内容；交易数据申请未提交。当前尚未核实官方支持的资产读取、上下架及验证缺口统一进入私有 API 开发，代理文档下载不作为开工前置条件。 |

## 所有权验证与副作用语义

### Afternic

[官方 Listing Statuses](https://api.afternic.com/docs/portfolio-api/guides/listing-statuses/)明确区分：

- `OWNERSHIP_REVIEW`：官方 [Relist multiple domains](https://api.afternic.com/docs/portfolio-api/api/domains/relistMultipleDomains/) 的当前 OpenAPI 3.2.0（API 3.0.0）确认使用 `POST /v3/aftermarket/customers/my/domains/$each/relist`，请求显式 `mode=REACTIVATE`，`names` 为最多 500 个规范 ASCII 域名。顶层 200 按原域名返回各项 `code` 与可选错误，单项 204 表示 Listing 无变化。处理可达 24 小时，该窗口只允许重提一次，需用认证 GET 继续复核。此步骤不适用于 `FAILED_COMPLIANCE` 或 `INVENTORY_COMPLIANCE_ISSUE`。
- `OWNERSHIP_UNVERIFIED`：域名在其他客户名下；从[账户 ownership 页面](https://www.afternic.com/account/ownership)
  取得 TXT 和/或 NS 记录，再由 [Resolution Center](https://www.afternic.com/domains/resolution-center)触发验证。
  2026-11-19 的 Afternic Web 构件 `0Cez0ZEw0NKKYg3PpDnxh` 配置当前 API 前缀 `https://www.afternic.com/fosv2/api`，浏览器请求启用凭据。账户页面读取 `GET /v1/account/verificationTxt`，使用 `verificationTxtRecord` 与 `nameServerRecord` 两个返回字段。该地址匿名读取返回 401。公共构件另声明 `POST /v1/domains/verifications/check`、`POST /v1/domains/verifications` 和 `POST /v1/domains/verificationStatus`；Resolution Center 将前端所选项送入 `verificationStatus`，读取 `verificationStatus` 映射。
  当前证据来自部署页面和公开脚本。登录会话的请求保护、精确请求体、域名匹配与响应状态，以及提交的真实副作用仍须在受控账户中核对。此调查未发送 POST。[API 定义脚本](https://www.afternic.com/fosv2/_next/static/chunks/pages/_app-bd8822f2e43a7a30.js) [账户页面脚本](https://www.afternic.com/fosv2/_next/static/chunks/pages/account/ownership-241381db30b805a0.js) [Resolution Center 脚本](https://www.afternic.com/fosv2/_next/static/chunks/pages/domains/resolution-center-61423e0a569f5993.js)
- `VERIFIED_OWNER_CONFLICT`：平台自动清理冲突；持续超过 24 小时则按官方说明处理。
- `ACTIVE`、`HIDDEN`、`ON_HOLD`、`SOLD` 语义不同。隐藏与删除 Listing 也不是同一操作。

价格是整美元对应的 microunits（美元乘 1,000,000），不能按普通小数金额直接提交。
批量返回 HTTP 200 仍需逐域名检查 code。重提和超时重试必须先对账。

Linux 真实账户库存观察到两个响应行为。未投影的 `maxLeasePeriod` 可以为 `0`，且已返回声明总数的终页仍可能带 `next`。库存读取支持该零值；其他租售期仍限 `2–60`。终页链接仍经过固定 HTTPS 来源、路径及有界查询校验，读取按已确认的总数结束。真实账户首次归集 188 项，重开复读 188 项、无重复新增。

### Atom

`add-domain`、`remove-domain`、`verify-dns` 的官方文档使用 **GET**；它们仍是有副作用的操作，
不能进入通用只读缓存、预取、探活或自动重试路径。Token 在 query 内，完整 URL 不得进入日志、错误和遥测。
`verify-dns` 只返回 `DNS check request accepted`。详情示例的 `status: Seller Approved` 是 Listing 状态示例，
文档未证明它可替代 DNS/owner 验证终态；需核实 challenge 获取和可观测终态，不能据此宣称验证闭环完成。

### SellerHub 与 Sedo

- SellerHub 官方说明创建记录后等待 DNS 传播，系统自动验证；列表状态包含 `verifying`、`onSale`、
  `onSaleStopped`、`saleProcessing`、`failed` 等。以账户内目标 Listing 的新鲜读取确认结果。
- Sedo `DomainStatus.domainstatus` 只区分“不在 Sedo 数据库 / 在 Sedo 数据库”，`forsale` 只表示在售。
  它的参数表不要求用户名；不能单独作为账户归属或 owner 验证成功的证据。账户归属对账至少结合
  `DomainListExtended`，仍需另行取得所有权验证终态证据。

## 社区候选核查

社区代码、公开第三方服务和官方 API 的社区 SDK 是三种不同来源。这里只读取仓库，没有安装或运行。
搜索没有命中不证明不存在实现；未验证的历史端点不进入生产 allowlist。

| 候选 | 实际检查内容 | 结论 |
| --- | --- | --- |
| [greedying/ename](https://github.com/greedying/ename) | README 声称自动登录、自动发布、抓取列表；[User.php](https://github.com/greedying/ename/blob/master/src/User.php)实际有 `domainlist()`、`batchFabuPreTradeList()`、CAS 登录及两步发布表单；路径含 `/manage/advanceSearchAjax`、`/publish/waitsale`、`/publish/first`、`/publish/second`。GitHub 元数据最后推送为 2017-11-18；根目录未见 LICENSE，元数据 license 为空。 | **相关的历史私有接口线索**，未确认今天可用、未确认下架和 owner 验证。旧代码混用 HTTP、落盘 Cookie，并提交操作密码/安全问题答案和锁定/费用选项，不能原样移植；重新核对当前正常账户流程，独立实现 Native 适配。引用代码前须确认许可证。 |
| [s-patompong/sedo-api-client](https://github.com/s-patompong/sedo-api-client) | README 和 [SedoDomain.php](https://github.com/s-patompong/sedo-api-client/blob/master/src/SedoDomain.php)包含 DomainInsert、DomainDelete、DomainList 的 PHP/Laravel 封装；最后推送 2017-05-12，GitHub license 元数据为空。 | 官方协议的社区封装，能参考调用形状，不能补足未公开验证能力或证明当前准入。优先依当前官方文档自行实现 Native Service。 |
| [Afternic-marketplace-search-API](https://github.com/AndreNathanielBarbasa/Afternic-marketplace-search-API) | README 为导入 Afternic/ICANN 数据后的 Flask 搜索服务。 | 市场查询，不是卖家写入或所有权验证接口，不采纳为此工作流的适配器。 |
| [lukecp5/PyDomains](https://github.com/lukecp5/PyDomains) | 仓库描述提到 Afternic，但实际 README 介绍域名内容分类和 LSTM。 | 描述与 README 不一致，无已核实卖家写入能力，不作为接入证据。 |
| [forincode/selldomain](https://github.com/forincode/selldomain) | 阿里云域名出售关键词检索得到，README 为待售域名展示列表。 | 不是阿里云卖家 API，排除。 |
| 22.cn / 阿里云社区卖家接口 | 本轮公开搜索及 GitHub 仓库检索未取得可核对上下架、账户鉴权和验证闭环的实现。 | 社区搜索结果仅保留为参考；当前缺口已进入自研私有 API 开发，不等待社区成品。不能把 DNS SDK、市场数据接口或展示站算作能力完成。 |

## 后续落地顺序与验收

以下是当前已识别的私有 API 开发清单，按既定市场优先级推进。列入开发不表示端点合同已取得或能力已实现。
每项由对应平台 `secure-host-core` 私有 Service 实现，跨平台 DNS 与续作由本地 operations 编排。

| 平台 | 直接进入私有 API 开发的缺口 | 保留的官方路径 |
| --- | --- | --- |
| Afternic | 所有权验证记录获取、冲突验证触发，以及与官方状态读取衔接。 | Listing 读写、批量任务、状态查询及已公开的重提接口。 |
| Atom | 验证要求获取、验证终态读取的未公开部分；账号不具备官方 API 准入时的正常卖家操作适配。 | 已公开且账号获准的 Seller API，包括 DNS 检查触发。 |
| Sedo | 所有权 challenge 获取、验证触发及账户验证结果读取的未公开部分。 | Listing 读写和账户域名列表；DomainStatus 仅按其实际语义使用。 |
| 易名 | 账户资产读取、批量上架/下架、所有权验证及结果对账的当前缺口。 | 当前没有已取得具体合同的上述官方卖家能力。 |
| 阿里云 | 卖家上架/下架、所有权验证及卖家状态读取的当前缺口。 | QueryDomainList、ScrollDomainList 等已确认资产读取接口。 |
| 22.cn | 账户资产读取、批量上架/下架、所有权验证及结果对账的当前缺口。 | 代理 API 的存在只作事实记录，未取得合同的能力不假定已受官方支持。 |

SellerHub 当前已核实的 Listing 与验证记录继续走官方 API。其他能力核查若发现未获官方支持的缺口，
同样纳入对应平台私有 API 工作包，不再另设官方/社区/私有的路线选择待决项。

1. Afternic、Atom、SellerHub、Sedo 的已公开 Listing 读写按官方合同实现；市场优先级保持产品既定顺序。
   SellerHub 验证流程可用来验证跨平台 DNS 编排，但不能把它的 wire 格式作为其他平台事实。
2. 当前缺口按上表直接进入自研私有 API 工作包，包含协议调查、实现及验证；社区线索供参考，
   不再等待社区实现或更多官方资料。已确认的官方能力继续原路径，不整体切换平台。
3. 每项调查需记录具体 endpoint/method、来源、账号权限、认证/CSRF、分页/限流、请求字段、响应与副作用。
   尚无账号会话与受控域名证据的私有接口，先执行开发工作包中的协议验证步骤；本轮决策不代表实现完成。
4. 每个平台一个 `secure-host-core` 私有 Service。已确认官方支持的能力走官方路径，其余当前缺口走私有 HTTP 路径；
   社区代码仅供参考，实际实现由同一 Service 持有。任务记录实现版本、资源和批准范围，超时进入未知结果对账，不自动换另一条写入路径。
5. 对每项能力验证读取 → 批量预览 → 单次确认 → 逐项写入 → 等待验证 → 新鲜对账；覆盖部分失败、
   会话过期、验证码/MFA、价格单位、交易锁定、进程中断与重开续作。新增扣款或扩大 DNS/权限修改时重新确认。
6. 私有 Cookie/CSRF/Token 仍属 Native 本地秘密；不能提交给社区托管代理。Windows/macOS 分别验证
   凭据输入、保管与失效恢复。文档修改不启用任何未经实现及资格化的 Provider 执行能力。
