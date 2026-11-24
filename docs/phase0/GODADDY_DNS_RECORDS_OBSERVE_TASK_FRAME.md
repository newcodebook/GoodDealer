# GoDaddy DNS 记录读取

状态：Task Frame。第 1 步（Native 只读客户端）已完成；第 2–6 步待组合。资格认证与真实账户验收均未取得。拥有者：root 主目录（PR #53 分支）。台账阶段 9「GoDaddy」。

权威依据：

- [ADR-0027](../adr/0027-multi-platform-domain-providers-and-marketplaces.md)：DNS 角色、单资源唯一性。
- [ADR-0024](../adr/0024-capability-qualification.md)
- [ADR-0016](../adr/0016-local-business-database-and-cloud-sync-boundary.md)
- [API 核查 · GoDaddy Registrar](../PROVIDER_API_REVIEW.md#官方合同与当前缺口)

复用对象：

- 已组合的 GoDaddy 账户归集：同一个 PAT custody 槽和同一个连接。
- 本地 `dns_zone_observations` / `dns_record_observations` 证据表。DNS 健康页和市场验证已经从这两张表读取。

## 交付旅程

1. 用户已经在设置中连接了 GoDaddy。
2. 用户在资产页对一个由 GoDaddy 注册的域名，发起"读取 DNS 记录"。
3. ProviderLane 用 custody 中的 PAT 分页读取该 Zone 的全部记录。
4. 记录写入本地 DNS 证据。
5. DNS 健康与市场验证前检查看到当前记录，来源标为 GoDaddy。

页面只读，不提供任何写入入口。

## 2026-11-24 官方合同事实（Domains v3.1.0，SHA-256 `8363ab65…a809`）

- **端点与认证**：`GET https://api.godaddy.com/v3/domains/zones/{zone}/dns-records`，Bearer PAT。`zone` 为 punycode A-label。
- **分页参数**：
  - `page` 从 1 开始；
  - `pageSize` 取值 1–100，默认 25；
  - `totalRequired=true` 时，仅当至少有一条记录才返回 `totalItems`、`totalPages`（最小为 1），空结果省略两者；
  - 另有可选的 `type`、`name`、`fields` 筛选。
- **响应体**：`items` 与 `links` 必填。`links` 是 HATEOAS 链接：`next` 在末页缺省，`prev` 在首页缺省；官方示例还给出 `first`、`last`。
- **记录字段**：
  - 必填：`name`（1–255，相对 Zone 顶点，`@` 为顶点）、`type`、`data`（1–512）、`ttl`（600–86400）；
  - 可选：`recordId`、`priority`（0–65535，MX/SRV）、`service`/`protocol`/`port`/`weight`（SRV）、`flag`（0–255）/`tag`（CAA）。
  - `type` 枚举为 A、AAAA、CNAME、MX、TXT、NS、SRV、SOA、CAA。
- **状态码**：200、400、401、403、404、429。404 只写作"请求的资源不存在"，没有说明是否意味着 DNS 托管在别处。

## 强制规则

1. **凭据**：PAT 只在 `crate::godaddy` 内部组装为 sensitive Bearer 头。记录的 Debug 输出脱敏，因为 TXT 值可能是验证令牌。
2. **只读**：Native 只构造 `listDNSRecords`。同一规范中的 POST/PUT/DELETE 记录、nameserver 替换以及资金端点都不可达。
3. **不跟随链接**：`next` 链接只做校验。必须同源、同 Zone 路径，查询参数只能是 `page`（当前页 +1）、`pageSize=100`、`totalRequired=true`。下一次请求由固定 origin、Zone 和页号重建。
4. **整次读取原子化**（除总数与页数核对外，均为 GoodDealer 失败关闭的选择，不是平台事实；官方 `pageSize` 只写作每页上限，schema 也未声明禁止未知字段）：以下任一情况都拒绝整次读取：
   - `totalItems` 或 `totalPages` 与已读条目、页数不一致；
   - 非末页不足 100 条；
   - 出现未知 `rel`、重复 `rel`、重复 `recordId`、完全相同的记录；
   - 超过 1024 条（与本地单次 Zone 证据上限一致）。
5. **失败关闭的实现选择**（不是平台事实）：
   - MX 必须带 `priority`；
   - SRV 必须带 `priority`、`weight`、`port`，且 `service`/`protocol` 若出现，必须是 `_label`；
   - CAA 必须带 `flag` 和字母数字 `tag`；
   - 字段出现在不属于它的类型上即拒绝；
   - `name` 只接受 `@`、LDH 加 `_` 的标签和前导 `*`，解析后的完整主机名不超过 253（官方 `name` 上限为 255）；
   - `data` 按字符计不超过 512，含控制字符即拒绝；`recordId` 只接受不超过 256 的可见 ASCII；
   - 未知字段一律拒绝。
6. **状态码映射**：
   - 首页 404 → `NotFound`，组合时记作 `unavailable`，不当作空 Zone；后续页 404 → 协议拒绝；
   - 401 → 需重新认证；403 → 权限不足；429 → 限速；5xx → 不可用；
   - 400、重定向和其他状态一律协议拒绝。

## 分步交付

1. **Native**（已完成）：`GoDaddyDnsClient::observe`，`godaddy/dns_wire.rs` 严格解析分页与记录，并附负向测试。
2. **协议**：`godaddy:dns:observe` 授权能力、grant 向量、capability manifest，以及 `provider_services/godaddy.rs` 的 `IMPLEMENTED` 追加 `dns.records.observe`（仍为 `qualification_pending`）。
3. **`local-storage`**：GoDaddy DNS 观察写入；SRV 的所有者名称未经真实账户确认前不写入证据。它与 Cloudflare 共用证据表，但没有 Cloud 计数投影；ADR-0016 只为 Cloudflare 建了投影，若要扩展须另起任务。连接与资产绑定沿用 Registrar 库存。
4. **Tauri**：`godaddy_dns_observe` 命令、ProviderLane 串行执行、权限与命令策略经生成源更新。
5. **Renderer**：资产详情的读取入口和来源标注。认证前显示为不可用并说明原因。
6. **文档**：CONNECTORS、CURRENT_IMPLEMENTATION、VERIFICATION 和执行台账。

## 验收

**源码层**（第 1 步已覆盖）：

- 请求形状与 PAT 不外泄；
- Zone 先转小写，非 A-label 主机名在请求前拒绝；
- 跨源、跨 Zone、跳页、改页大小或带筛选的 `next` 一律拒绝；
- 总数与页数不一致、空页带总数、超过上限都拒绝；
- 越界 TTL、未知类型、非法名称、控制字符、类型字段错配、重复记录都拒绝。

**真实层**：需要一个 GoDaddy 账户、受控 Zone 和 PAT（`local.env` 的 `GODADDY_*`），核对以下几点：

- 404 的实际含义；
- 无记录 Zone 的响应形态；
- SOA/NS 是否出现在列表中；
- SRV 的 `name` 与 `service`/`protocol` 如何组合；
- 600 秒以下的 TTL 是否真实存在。

真实层验收完成前，能力保持 `qualification_pending`，不计为 V1 验收。
