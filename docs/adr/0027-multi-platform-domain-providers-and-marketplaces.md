# ADR-0027：多平台域名 Provider 与交易市场纳入首发

状态：Accepted v1 product scope; no new Provider execution path is composed.

## 背景

首发范围此前只有一个连接器：Cloudflare 的域名 Provider（[ADR-0024](0024-domain-provider-capability-coverage-and-financial-confirmation.md)、
[CONNECTORS](../CONNECTORS.md)）。交易市场连接被 [PRODUCT_REQUIREMENTS](../PRODUCT_REQUIREMENTS.md) 列为首发排除项，
其他注册商最多只能作为本地资料记录。Desktop 设计稿（资产库、域名详情、销售管理、续费、人工任务）却以多注册商、
多交易市场的投资人组合为前提。两者不一致：要么界面撒谎，要么产品范围不够。

域名投资人的资产通常分散在多个平台上，并且同一平台往往同时承担几种角色：Spaceship 既是注册商、DNS 提供商，
也通过 SellerHub 销售域名；Atom 既是交易市场，也有 AtomRegistrar；Cloudflare 是注册商和 DNS。如果先接一个平台的
DNS、过后再补它的注册商或市场能力，同一平台账户会出现多套凭据、多次授权和重叠的绑定，后续难以收口。

## 决策

### 1. 首发平台清单

首发接入以下 8 个平台：**Cloudflare、Spaceship、Atom、Afternic、Namecheap、Dynadot、GoDaddy、Porkbun**。
清单以外的平台在首发中保持不可执行；资产仍可手动记录注册商等本地资料。

### 2. 一次接全一个平台

接入一个平台时，一次实现它全部与域名相关的能力，跨越其所有角色：

- **注册商**：注册、续费、恢复、转入、转出与授权码、转移锁、自动续费、联系人、WHOIS 隐私、Nameserver、glue。
- **DNS**：Zone/记录读写、DNSSEC、变更前检查与回滚（仅当 Provider 提供）。
- **交易市场**：Listing 创建/修改/下架、价格（BIN、最低出价、底价）、销售与成交记录、销售授权码交付、
  平台所有权验证。
- **获取（买方）**：在市场和拍卖中搜索与查看在售域名、竞价、补抢（backorder）、一口价或清仓购买，
  以及购得域名在注册商侧的到账对账。
- **监控**：上述资源的周期观察与漂移检测，包括竞价被超出、拍卖结束与补抢结果。

“一次接全”约束的是实现与 capability manifest 的完整性，不放宽资格要求。[ADR-0024](0024-domain-provider-capability-coverage-and-financial-confirmation.md)
继续适用：每项能力独立标注实现状态、最小权限、风险、幂等、异步结果、未知结果对账与真实资格。平台不支持、
准入未获批或尚未资格化的能力在 manifest 中显式标记为不可执行，并写明原因，不得省略。

非域名产品仍不在范围：主机、邮箱、SSL、建站/Link in Bio、应用托管（如 Spaceship Hyperlift）、账户充值，
以及平台之间的托管搬迁服务（如 Porkbun 的 Cloudflare 迁移接口）。

### 3. 平台账户与角色模型

- 一个**平台连接**代表用户在一个平台上的一个账户及其本地凭据，可同时承担 `registrar`、`dns`、`marketplace`
  `acquisition` 中的一种或多种角色；角色由该平台的 manifest 与凭据实际权限共同决定，不由 Renderer 声明。
- 同一公司下认证体系不同的平台按独立平台处理（Afternic 与 GoDaddy 各自一份连接和凭据）。
- 一个域名资产可以同时绑定：一个注册商资源、一个 DNS 资源，以及每个交易市场各一个 Listing。
  当前 `domain_asset_provider_bindings` 以 `(workspace_id, entity_id, resource_kind)` 为主键、只允许
  `zone`/`registration`，无法表达多市场 Listing；需要新增 `listing` 资源类型，并把连接身份纳入 Listing 的唯一键。
  `local_provider_connections` 相应从单一 `provider_kind` 扩展为平台 + 角色集合。具体 schema 由 `local-storage`
  在实现时以迁移给出。
- Provider 账户 ID、账户别名、凭据、平台原始响应继续只存在本地 Host，不进入 Sync Outbox 或 Cloud
  （[ADR-0016](0016-local-business-database-and-cloud-sync-boundary.md)）；Listing 状态与价格等可同步字段沿用允许字段白名单。

### 4. 所有权与代码边界

- 每个平台在 `secure-host-core` 内有一个私有 Service，独占该平台的 endpoint、wire 解析、认证构造与网络 authority，
  延续 CONNECTORS 中对 Cloudflare 的同一规则：Provider wire 在 Service 内有界解析并重建为 GoodDealer 领域合同，
  不得跨 IPC、Cloud 或 TypeScript 边界；每个平台只有一条运行时路径。
- 各平台 Service 共用一个框架：凭据 custody 与代次、固定 origin 的加固 HTTPS Transport、能力准入、
  按平台的速率限制与串行化、闭合错误分类、`outcome_unknown` 对账。框架只服务这 8 个平台的具名 Service，
  不对 Renderer 或其他模块暴露通用 Provider 代理。
- `packages/connectors/<platform>` 只公开该平台的 Host-local 非秘密领域合同，与 `packages/connectors/cloudflare` 同构。
- 计划、确认、执行与结果继续复用 `local-storage` 的 `operation_plans`、`operation_attempts`、`operation_results`。

### 5. 跨平台所有权验证

交易市场的所有权验证常需要在域名的 DNS 上发布记录，而 DNS 可能托管在另一个平台。验证流程由本地 operations
编排为两个独立计划：先从市场 Service 读取验证要求，再由托管该 Zone 的 DNS Service 执行一次普通的 DNS 变更
（需留意档确认、前后观察），最后请求市场复核。两个 Service 之间不直接调用、不共享凭据；DNS 不在 8 个平台内时，
该步骤降级为人工对账任务。

### 6. 没有 API 的操作

[ADR-0017](0017-v1-excludes-browser-automation.md) 不变：不使用嵌入式浏览器或网页自动化。平台没有 API 的操作
（例如 Atom 的转出、部分平台的后台确认）呈现为人工任务：用户在自己的浏览器里完成，回到 Desktop 后 Host 重新
查询平台对账；回跳不构成成功证据。产品不提供 CSV 导入；平台自身的批量 job 若以 CSV 作为 wire 格式，CSV 只在
对应 Service 内生成和解析，不成为用户导入入口。

### 7. 资金操作

注册、续费、恢复、转入、竞价、补抢、购买及任何扣款操作，统一适用 ADR-0024 的单项确认与报价核对；平台的账户余额、
自动充值等支付设置不纳入首发。获取类操作另有以下约束：

- **竞价逐次确认**：每一次出价都是一笔独立的资金承诺，确认绑定具体拍卖、出价金额、币种与拍卖结束时间。
  不提供代理出价、自动加价或“最高到 X”的长期授权；被超出后由监控提示用户，再次出价需要新的确认。
- **条件扣款明示**：补抢等只在成功时扣款的操作，确认文本必须说明扣款条件、最高金额和失败时是否退款。
- **购得不等于入库**：购买或拍卖成功只是 Provider 侧状态。只有在注册商侧观察到域名进入用户账户后，
  Host 才创建或更新本地资产；在此之前资产处于待对账状态。
- **只读搜索不付费**：搜索、浏览与报价查询是只读能力，不需要资金确认，但仍受速率限制与能力准入约束。

### 8. 接入顺序与首发门槛

接入顺序：

1. **Cloudflare**：补齐其全部域名能力，同时把实现抽象为第 4 节的共用框架。
2. **Porkbun**：官方 OpenAPI、沙箱、`dryRun`、webhook，最适合验证框架。
3. **Spaceship**（含 SellerHub）：官方 OpenAPI、细粒度 scope。
4. **Dynadot**、**Namecheap**：均有沙箱。
5. **GoDaddy**、**Afternic**。
6. **Atom**（含 AtomRegistrar）：受 Beta 准入限制，放在最后。

交易市场能力在 Cloudflare 路径稳定后开始。`1.0.0` / `stable`（[ADR-0018](0018-production-operations-and-stable-release.md)）
要求 8 个平台全部完成接入：每项能力在 manifest 中要么已取得资格，要么带原因地标记为不可执行。

## 平台事实快照（2026-11-03 核对）

以下事实来自各平台当前官方文档，仅用于本决策的可行性判断。官方 API 变化频繁，实现每个平台前必须重新核对；
仓库内旧文档和设计夹具不能作为依据。“未见”表示官方文档中没有找到，不等于平台确认不支持。

| 平台 | 认证 | 准入 | 沙箱/测试环境 | 速率 | 已知缺口 |
| --- | --- | --- | --- | --- | --- |
| [Cloudflare Registrar](https://developers.cloudflare.com/api/resources/registrar/) | API Token | 无额外门槛 | 未见 | 未见 | 新 Registrar API 有注册、转入、注册状态；续费、转出、Nameserver 端点未见 |
| [Spaceship](https://docs.spaceship.dev/) | `X-API-Key` + `X-API-Secret`，按 scope 授权（`domains:*`、`dnsrecords:*`、`contacts:*`、`sellerhub:*`） | 无额外门槛 | 未见 | SellerHub 300 次 / 300 秒 / 用户 | DNSSEC 端点未见 |
| [Atom](https://apidocs.atom.com/introduction) / [AtomRegistrar](https://apidocs.atom.com/guides/registrar_apis) | 市场：`api_token` 查询参数 + `user_id`；注册商：Bearer | [有限 Beta 需审批](https://www.atom.com/help/en/articles/5698350-atom-seller-api-access)：卖家 ≥500 个 Listing；AtomRegistrar ≥100 个域名或活跃卖家 | `dev.atom.com` | 未见 | 转出不可经 API；`/verify-dns` 只返回已受理，期望记录未写明；无 webhook |
| [Afternic](https://api.afternic.com/docs/portfolio-api/) | `Authorization: sso-key KEY:SECRET`，每账户最多 2 把 key | 对所有卖家开放（2026-10 发布） | 未见 | 150 次/分钟 | 所有权验证未写明；批量操作为异步 job |
| [Namecheap](https://www.namecheap.com/support/api/intro/) | ApiUser + ApiKey + 客户端 IP 白名单 | 生产需满足账户门槛（如 ≥20 个域名或 $50 消费） | 独立沙箱账户 | 未核实 | `setHosts` 全量覆盖；只能管理在该账户注册的域名；方法清单需复核 |
| [Dynadot](https://www.dynadot.com/domain/api) | Bearer + `X-Signature`（HMAC-SHA256，secret 为密钥） | 账户内开启 | `api-sandbox.dynadot.com`（部分命令不支持，含 set for sale） | 普通档 1 线程、60 次/分钟 | RESTful v2 标注 Beta；完整命令清单需复核 |
| [GoDaddy](https://developer.godaddy.com/en/docs/api-users) | Personal Access Token（Classic key 不能用于 v3 Domains） | 读取任意账户；付费写操作需账户有支付方式或余额 | 未核实 | 未核实 | DNSSEC 与授权码未写明 |
| [Porkbun](https://porkbun.com/api/json/v3/documentation) | `X-API-Key` + `X-Secret-API-Key`；需开启账户内 API 访问 | 无额外门槛 | 沙箱端点 + mock；计费类调用支持 `dryRun` | 未见 | 市场只能浏览，不能经 API 上架自己的域名 |

Cloudflare API 失败语义（2026-11-08 核对）：
[API 限制](https://developers.cloudflare.com/fundamentals/api/reference/limits/)只写明超限返回 `HTTP 429 - Too Many Requests`、
之后 5 分钟内的调用都被拒绝，并带 `retry-after`；[故障排查](https://developers.cloudflare.com/fundamentals/api/troubleshooting/)
对 Token 无效与权限不足只建议确认 Token 校验结果为 `"status": "active"` 并检查权限组，未写明对应的 HTTP 状态或错误码；
[Token 校验](https://developers.cloudflare.com/api/resources/user/subresources/tokens/methods/verify/)的 `status` 为
`active`、`disabled` 或 `expired`，只记录了 200 响应。因此 Desktop 不区分“Token 失效”与“权限不足”：
只有 RFC 9110 定义为认证与授权拒绝的 401 与 403 作为同一个“凭据被拒绝”结果，提示用户在 Cloudflare 确认
Token 有效并具备所需权限；其他非重试状态（重定向、400、404 等）与格式不符的 200 说明不了凭据，仍为通用失败；
429、408、425 与服务端错误为“稍后重试”，传输失败为“无法连接”。

## 安全约束

- **URL 中的凭据（Atom）**：Atom 市场 API 把 token 放在查询参数中。Atom Service 必须在内部构造请求 URL，
  任何日志、错误、诊断与持久化都不得包含完整 URL；Transport 的通用错误映射不得回显请求 URL。
- **请求签名（Dynadot）**：HMAC 计算只在 Service 内进行，secret 不离开 custody 边界。
- **IP 白名单（Namecheap）**：桌面用户的公网 IP 会变化。白名单失败映射为可解释的连接状态（例如
  `insufficient_access`），不得自动重试刷屏。若需取得本机出口 IP，只能使用该平台自身返回的信息或用户输入，
  不引入第三方 IP 查询服务。
- **最小权限**：支持 scope 的平台（Spaceship、Cloudflare）只请求 manifest 中已实现能力所需的 scope；
  连接校验发现 scope 不足时按能力降级，而不是整条连接失败。
- **Linux**：[ADR-0025](0025-linux-secret-service-custody.md) 规定 Provider 凭据在 Linux 上不可用，该限制
  覆盖全部 8 个平台；放开需要另行修订 ADR-0025。

## 残余风险与开放问题

- **准入门槛**：Atom、AtomRegistrar、Namecheap 的门槛意味着部分用户永远无法启用对应能力。界面必须按平台、
  按能力显示“平台未授予 API 访问”，并说明门槛来源；GoodDealer 自身也需要满足门槛的资格测试账户。
- **无沙箱平台**：Cloudflare、Spaceship、Afternic（以及待核实的 GoDaddy）只能用真实受控资产完成资格，
  付费能力的资格成本需单独预算。
- **范围膨胀**：8 个平台 × 多角色的资格工作量远大于原首发计划，首发时间相应推后。
- **竞价时效**：逐次确认意味着用户可能在拍卖末段来不及确认而落败；这是为了不让客户端持有长期出价授权而接受的代价。
  监控只能提示，不能代为出价。
- **获取能力覆盖不均**：已核对到的买方 API 主要是 Dynadot（拍卖、backorder）与 Porkbun（closeout 购买、
  aftermarket 搜索）；其他平台的买方能力需在接入时逐一核对，没有 API 的保持不可执行。
- **平台 API 稳定性**：Dynadot RESTful v2 与 Atom 均标注 Beta，Afternic Portfolio API 刚发布；字段与行为可能变化，
  Service 必须对未知字段与未知状态失败关闭。

## 取代与修订

- 取代 PRODUCT_REQUIREMENTS 首发排除项中的“市场连接”。
- 修订 CONNECTORS“首发唯一连接器是 Cloudflare”及“所有能力归一个私有 Cloudflare Service”，改为第 4 节的
  “每平台一个私有 Service + 共用框架”。
- 扩展 ADR-0024 的范围边界：交易市场的 Listing、价格、成交与所有权验证，以及竞价、补抢、购买等获取能力，
  都属于域名相关能力；ADR-0024 的
  逐项资格与资金确认规则全部继续适用。
- 不改变 ADR-0017、ADR-0016 与 ADR-0025。

## 文档同步

接受本 ADR 时已同步更新 `PRODUCT_REQUIREMENTS.md`、`CONNECTORS.md`、`USER_JOURNEYS.md`、`UX_FLOWS.md`、
`ROADMAP.md`、`VERIFICATION.md`、`ORCHESTRATION.md`、`ENGINEERING_STRUCTURE.md`、`OPEN_DECISIONS.md`、`GLOSSARY.md`、
Phase 0 执行计划与外部资格台账、`brand/README.md` 与 Desktop README。Cloudflare 以外平台的外部资格记为 `Q-PROV`。

同时清理了早于本 ADR 即与 ADR-0017 和 CSV 排除项冲突的残留：`client-core` 的 CSV 导入计划端口、人工任务合同中的
`browserGrant`/`browserTask` 与 `request_automation_grant` 动作、连接方式枚举中的 `browser`/`csv`，以及消费它们的 Desktop
组件、i18n 文案与视觉夹具。人工任务现在只表达“在平台页面完成、回到 Desktop 后重新观察对账”，合同测试拒绝重新带入浏览器字段。
`client-core/src/browser-automation` 保留为 ADR-0002 下失败关闭的未来能力合同，不被任何首发路径引用。

## 当前实现

本 ADR 不开放任何执行路径。当前生产源码仍只组合 Cloudflare Zone/DNS 只读观察；其他平台没有 Service、
合同或 Desktop 组合。
