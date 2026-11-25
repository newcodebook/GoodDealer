# Porkbun 注册局委派读取

状态：Task Frame。第 1–6 步已在源码完成（2026-11-24）。拥有者：root 主目录（PR #53 分支）。台账阶段 2「注册商委派观察接入后，与 Zone 分配的 nameserver 比对得出委派状态与 NS 异常计数」，以及阶段 6「Porkbun」私有 Service 余项。资格与真实账户验收均未取得。

**权威依据**
- [ADR-0027](../adr/0027-multi-platform-domain-providers-and-marketplaces.md)：注册商角色、最小权限。
- [ADR-0033](../adr/0033-multi-provider-dns-evidence.md)（Proposed）：写明“注册商委派观察可以独立推进”。本任务只观察和展示，不改变任何 Zone 绑定的状态，也不实施 ADR-0033 的决策 1、2。
- [ADR-0024](../adr/0024-capability-qualification.md)
- [API 核查 · Porkbun](../PROVIDER_API_REVIEW.md#官方合同与当前缺口)

**复用对象**
- [Porkbun 账户归集](PORKBUN_REGISTRAR_INVENTORY_TASK_FRAME.md)的连接、custody 槽、`porkbun:registrar:observe` 授权能力与资格登记项。委派是注册局上的注册事实，属于能力 `registrar.domain.observe`，不新增能力标识；该能力的资格证据须同时覆盖 `listAll` 与 `getNs`。
- [Porkbun DNS 记录读取](PORKBUN_DNS_RECORDS_OBSERVE_TASK_FRAME.md)的设置页入口、准入检查（最近归集、凭据身份、交接）与 ProviderLane 意图。

## 交付旅程

1. 用户已在设置中用 Read-only 密钥连接 Porkbun，并完成一次归集。
2. 用户在设置页 Porkbun 面板中，对最近一次归集到的某个域名发起“读取委派”（与“读取 DNS 记录”共用域名输入）。
3. ProviderLane 用 custody 中的密钥读取该域名在注册局登记的 nameserver。
4. 结果写入本地委派观察。DNS 页的“委派”列显示这些 nameserver：
   - 与该资产当前显示的 Zone 观察所分配的 nameserver 集合相同时为“正常”；
   - 集合不同为“不一致”；
   - 注册局没有登记任何 nameserver 为“未解析”；
   - 没有委派观察，或没有带 nameserver 的可用 Zone 观察（例如 Porkbun Zone 观察不含 nameserver）时为“未知”。
5. 页头“NS 异常”计数为全工作区“不一致”与“未解析”的资产数。

全程只读。委派结果不改变 Zone 绑定状态，不提供改 nameserver 的入口。

## 2026-11-24 官方合同事实（[OpenAPI v3.112](https://porkbun.com/api/json/v3/spec)，SHA-256 `394e0310…2275`，当日重新下载核对一致）

- `GET https://api.porkbun.com/api/json/v3/domain/getNs/{domain}`（另有 POST），请求头 `X-API-Key` / `X-Secret-API-Key`，`x-porkbun-scope: read`，`x-porkbun-agent.safe: true`。
- 说明：读取注册局登记的权威 nameserver，实时读自注册局；nameserver 是无序集合，顺序常与 `updateNs` 提交时不同，应按集合比较。
- 200 响应 schema：`{status, ns: string[]}`，示例 `{"status":"SUCCESS","ns":["ns1.porkbun.com","ns2.porkbun.com"]}`。schema 不声明必填字段与条数上限。
- 操作声明 200、400（`ErrorResponse`：`status` 为 `ERROR`、`message` 必填，另有 `code`）、429（限速，带 `Retry-After`）。全局错误码表同 DNS 读取：`API_ACCESS_DISABLED`、`INVALID_DOMAIN`/`DOMAIN_NOT_FOUND`、`DOMAIN_NOT_ACTIVE`、请求形态错误码；403 为 IP 白名单、域名白名单、权限不足等。

## 强制规则

1. 密钥只放在 sensitive 请求头里，GET 请求不带 body。Native 只构造 `GET /domain/getNs/{domain}`；同族的 `updateNs` 与 glue 写端点不可达。
2. 域名先转小写，非规范 A-label 在请求前拒绝，路径只拼接规范化后的域名。
3. 以下是 GoodDealer 的失败关闭选择，不是平台事实：
   - `status` 必须为 `SUCCESS`，`ns` 必须出现；出现未知字段时拒绝；
   - nameserver 至多 16 个，每个为规范 LDH 主机名（转小写、至少两个标签、不带末尾点、总长不超过 253）；
   - 转小写后重复时拒绝；
   - 结果按字典序排序后作为集合保存；空集合照实保存，显示为“未解析”。
4. 400 错误码映射与 DNS 读取相同；不保留 `message` 或 `account` 文本。
5. 比对只用本地已有证据：委派集合与该资产当前显示的 Zone 观察的 `authoritative_nameservers` 集合。官方未提供 Porkbun 自身权威 nameserver 的完整集合，Porkbun Zone 的委派状态保持“未知”，按 ADR-0033 决策 1 另行处理。

## 分步交付

1. Native：`PorkbunRegistrarClient::observe_nameservers` 与 `porkbun/delegation_wire.rs`，附负向测试。
2. `local-storage`：
   - 追加迁移：只追加的 `registrar_delegation_observations`（资产、连接、排序后的 nameserver 集合、观察时间），插入要求 Porkbun 连接处于有效状态，禁止更新。
   - Host 准入复用 DNS 读取的检查（有效连接、凭据身份、交接栅栏、最近一次归集包含该资产），只要求注册商能力资格与授权。
   - DNS 健康每行带最近一次委派观察与 Host 判定的委派状态，读取带全工作区 NS 异常计数。
3. Tauri：`porkbun_registrar_submit` 的 `observe-delegation` 意图与 ProviderLane `PorkbunDelegationObserve` 操作；结果为封闭值。
4. client-core：DNS 健康合同新增委派字段并按同一规则校验状态；DNS 页模型使用 Host 的委派与计数。
5. Renderer：设置页 Porkbun 面板的“读取委派”按钮与结果提示；DNS 页沿用已有的委派列。
6. 文档同步。

## 验收

**源码层**
- 请求形态正确，凭据不外泄；非规范域名在请求前拒绝。
- 非法主机名、重复、超过上限、未知字段、`status` 非 `SUCCESS` 一律拒绝；文档列出的 400 错误码映射到对应结果。
- 不在最近归集中的域名、被撤销或替换的连接、交接期间与最后栅栏失效时不写入。
- 委派状态四种取值与计数在 Host 与 client-core 一致；不一致的 Host 行被拒绝。

**真实层**：需要已开启 API 访问的 Porkbun 账户与 Read-only 密钥。需要核对：`ns` 的大小写与是否带末尾点；没有 nameserver 时是空数组还是错误；未开启 API 访问时 `getNs` 是否返回 `API_ACCESS_DISABLED`；限速窗口。

在完成真实层核对之前，`registrar.domain.observe` 保持 `qualification_pending`，不计为 V1 验收。
