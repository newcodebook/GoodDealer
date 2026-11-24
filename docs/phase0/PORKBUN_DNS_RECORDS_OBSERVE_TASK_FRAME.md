# Porkbun DNS 记录读取

状态：Task Frame。第 1 步（Native 只读客户端）已完成，第 2–6 步待组合。资格与真实账户验收均未取得。拥有者：root 主目录（PR #53 分支）。台账阶段 6「Porkbun」。

**权威依据**
- [ADR-0027](../adr/0027-multi-platform-domain-providers-and-marketplaces.md)：DNS 角色、最小权限、单资源唯一性。
- [ADR-0024](../adr/0024-capability-qualification.md)
- [ADR-0016](../adr/0016-local-business-database-and-cloud-sync-boundary.md)
- [API 核查 · Porkbun](../PROVIDER_API_REVIEW.md#官方合同与当前缺口)

**复用对象**
- 已组合的 [Porkbun 账户归集](PORKBUN_REGISTRAR_INVENTORY_TASK_FRAME.md)：同一对密钥 custody 槽，同一个连接。
- 本地 `dns_zone_observations` / `dns_record_observations` 证据表。

## 交付旅程

1. 用户已在设置中用 Read-only 密钥连接 Porkbun。
2. 用户在资产页对一个 Porkbun 域名发起"读取 DNS 记录"。
3. ProviderLane 用 custody 中的密钥读取该 Zone。
4. 记录写入本地 DNS 证据，DNS 健康与市场验证前检查看到这些记录，来源标为 Porkbun。
5. 如果其他 nameserver 在应答该域名，界面提示当前读到的记录并不是实际解析的结果。

全程只读，不提供写入入口。

## 2026-11-24 官方合同事实（[OpenAPI v3.112](https://porkbun.com/api/json/v3/spec)，SHA-256 `394e0310…2275`）

**请求**
- `GET https://api.porkbun.com/api/json/v3/dns/retrieve/{domain}`。
- 请求头 `X-API-Key` / `X-Secret-API-Key`。
- 另有 POST 形式，可以把凭据放在 body 里。
- 不分页，没有筛选参数。
- 返回"全部可编辑记录"，不含 SOA 和 Porkbun 默认 NS。

**权限**
- `x-porkbun-scope: read`。`read` 权限总是包含在密钥里。
- 设置页提供"Read-only"预设，所以账户归集和 DNS 读取可以共用一把只读密钥。
- 密钥可以限定允许的域名，范围外返回 403 `DOMAIN_NOT_ALLOWED`。
- 权限不足返回 403 `INSUFFICIENT_SCOPE`。

**200 响应**
- 整体为 `{status, cloudflare?: "enabled"|"disabled", records[]}`，必填字段只有 `status` 与 `records`。
- 每条记录含 `id`、`name`（完全限定名）、`type`、`content`、`ttl`、`prio`、`notes`。
  - 都是字符串，其中 `prio`、`notes` 可为 null。
  - schema 对记录不设必填字段。
- 读取响应没有类型枚举；创建请求枚举了 16 种类型：A、AAAA、MX、CNAME、ALIAS、TXT、NS、SRV、TLSA、CAA、SSHFP、HTTPS、SVCB、DS、SMIMEA、OPENPGPKEY。
- 创建时如果省略 `prio`，默认值为 0。
- 单个 Zone 上限 2 500 条记录。
- `warnings` 不在读取 schema 中。官方说明只承诺：域名迁到 Cloudflare 后，每个 `/dns/*` 响应带 `warnings`；委派在别处的域名，写操作响应带 `warnings`。读取时是否带出并未写明。

**错误**
- 400 返回 `{status:"ERROR", message, code, account?, next_action?}`。相关 `code`：
  - `API_ACCESS_DISABLED`：该域名没有开启 API 访问，只有账户持有人能开启；
  - `INVALID_DOMAIN`（“参数无效或不在你的账户中”，沙箱密钥读真实域名也返回它）、`DOMAIN_NOT_FOUND`：域名不在该账户中；
  - `DOMAIN_NOT_ACTIVE`：域名处于待定或过期等暂不可管理的状态；
  - `INVALID_INPUT`、`MISSING_PARAMETER` 等：请求形态错误。
- 403：需要额外认证，包括 IP 白名单、域名白名单、权限不足、需要身份验证等情况。
- 429：限速，带 `Retry-After`。
- 全局错误码表另列 500 `DNS_READ_FAILED`（当前 Zone 无法读取，可重试），它随 Zone 还原点引入；读取操作本身只声明了 200、400、429。

## 强制规则

1. 密钥只放在 sensitive 请求头里，GET 请求不带 body。记录的 Debug 输出脱敏。`notes` 是用户自写的文本，只校验形态，不越过 Native 边界。
2. 只读。Native 只构造 `GET /dns/retrieve/{domain}`。同族的 create、edit、delete 端点和资金端点都不可达。
3. Zone 先转小写，非 A-label 主机名在请求前就拒绝。路径只拼接已规范化的 Zone。
4. 以下选择是 GoodDealer 的失败关闭策略，不是平台事实：
   - 每条记录必须带 `id`、`name`、`type`、`content`、`ttl`；
   - `ttl`、`prio`、`id` 只接受无前导零的十进制数字串；
   - 类型限定为创建请求枚举的 16 种；
   - `name` 必须落在该 Zone 内；
   - 出现未知字段、重复 `id` 或完全相同的记录时拒绝；
   - 超过 1024 条时拒绝（本地单次 Zone 证据上限，低于平台的 2 500 条；组合时应给出区别于协议拒绝的提示）；
   - `content` 非空、不超过 4 096 字节、不含控制字符；`notes` 不超过 4 096 字节；`warnings` 为 1–16 条、每条不超过 2 048 字节；TTL 至少为 1；完整主机名不超过 253。
5. 400 错误码映射如下：

   | 错误码 | 结果 |
   |---|---|
   | `API_ACCESS_DISABLED` | `ApiAccessDisabled` |
   | `INVALID_DOMAIN`、`DOMAIN_NOT_FOUND` | `NotInAccount`（可能只是密钥属于别的账户，组合时不得据此降级资产证据） |
   | `DOMAIN_NOT_ACTIVE` | `DomainNotActive` |
   | 请求形态类错误码 | 协议拒绝 |
   | 其他错误码或缺少 `code` | 需要账户持有人处理（GoodDealer 的失败关闭选择） |

   不保留任何 `message` 或 `account` 文本。其他状态码沿用账户归集的映射。
6. 带 `warnings` 时，结果仍返回记录，同时标记 `answered_elsewhere`。这是 GoodDealer 的推断，不是平台承诺；为 `false` 也不能证明 Porkbun 在应答。组合时，记录用作 DNS 健康依据之前，必须另行核对委派（注册商观察到的 nameserver）。

## 分步交付

1. Native：`PorkbunDnsClient::observe` 和 `porkbun/dns_wire.rs`，附负向测试。（已完成）
2. 协议：
   - 新增 `porkbun:dns:observe` 授权能力，同步 grant 向量；
   - manifest 中 `dns.records.observe` 与 `zone.observe` 由 `implementation_pending` 改为 `qualification_pending`；
   - `provider_services/porkbun.rs` 的 `IMPLEMENTED` 同步上述能力。
3. `local-storage`：
   - 追加迁移，把 Porkbun 连接的角色扩为 dns+registrar。依据是官方 `read` 权限同时覆盖两项读取。
   - 写入 Porkbun DNS 观察和 Zone 绑定；单资源唯一，已有其他平台 Zone 绑定的资产失败关闭。
4. Tauri：命令、ProviderLane，以及从生成源更新的权限与命令策略。
5. Renderer：入口、来源标注与"可能非实际解析"提示。资格认证之前，入口显示为不可用并说明原因。
6. 文档同步。

## 验收

**源码层**（第 1 步已覆盖）
- 请求形态正确，且凭据不外泄。
- 非规范 Zone 在请求前拒绝。
- 越界类型、名称越出 Zone、非数字 TTL/优先级、控制字符、未知字段、重复记录、超出上限，都会被拒绝。
- 文档列出的 400 错误码映射到对应结果，错误文本不保留。
- `warnings` 只留下一个布尔标记。

**真实层**：需要已开启 API 访问的 Porkbun 账户、一个受控 Zone 和一把 Read-only 密钥（见 `local.env` 的 `PORKBUN_*`）。需要核对：
- 记录字段是否总是出现；
- `prio` 在非 MX/SRV 记录上的实际取值；
- 实际出现的类型词汇；
- 由其他 nameserver 应答的域名是否带 `warnings`；
- 未开启 API 访问时，读取是否返回 `API_ACCESS_DISABLED`。

在完成真实层核对之前，能力保持 `implementation_pending` 或 `qualification_pending`，不计为 V1 验收。
