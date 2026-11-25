# Porkbun 注册商账户归集

状态：Task Frame，源码第 1–6 步已组合；资格与真实账户验收未取得。拥有者：root 主目录（PR #53 分支）。台账阶段 6「Porkbun」。

权威依据：[ADR-0027](../adr/0027-multi-platform-domain-providers-and-marketplaces.md)、[ADR-0024](../adr/0024-capability-qualification.md)、[ADR-0016](../adr/0016-local-business-database-and-cloud-sync-boundary.md)、[API 核查 · Porkbun Registrar](../PROVIDER_API_REVIEW.md#官方合同与当前缺口)。复用对象是已组合的 GoDaddy 账户归集（678c9fd）：同一套 Host 准备/提交/撤销、ProviderLane 串行执行、`registrar_inventory` 业务投影和账户库存面板。

## 交付旅程

连接页选择 Porkbun → Native 对话框以掩码输入 API key 与 Secret API key（凭据只进 Host custody）→ Host 记录连接 → ProviderLane 用 custody 中的凭据分页读取 `/domain/listAll` → 本地库存得到账户域名、注册/到期日、自动续费、转移锁与状态 → 资产页与其他五个来源的资产一起显示，来源标为 Porkbun。

## 2026-11-24 官方合同事实（OpenAPI v3.112）

见 API 核查表。实现只依赖以下几点：

- 固定 `POST https://api.porkbun.com/api/json/v3/domain/listAll`，请求头 `X-API-Key`、`X-Secret-API-Key`；body 只有 `start`、`sortName=domain`、`sortDirection=asc`。
- 每页至多 1000 条。`count` 若出现必须等于本页条目数。条目数少于 1000 才是末页；恰好 1000 时继续读下一偏移，空页结束。
- 官方 schema 对条目字段不设必填。GoodDealer 自行要求 `domain`、`status`、`createDate`、`expireDate`、`securityLock`、`autoRenew`、`apiAccess` 必须出现（缺失即拒绝，属失败关闭的实现选择，不是平台事实）。日期必须是 UTC `YYYY-MM-DD HH:MM:SS`；0/1 之外的标志拒绝。
- 400（`listAll` 文档写作认证错误）与 403（全局状态表：需额外认证，含密钥 IP 白名单 `IP_NOT_ALLOWED`）→ 需用户处理凭据；429 → 限速；5xx → 不可用；其他状态（含未记录的 401 与重定向）、非 JSON、`status` 不为 `SUCCESS` 一律协议拒绝。

## 强制规则

1. 凭据只在 `crate::porkbun` 内部组装请求头，头值设为 sensitive，不进 Debug、错误、日志、Renderer 或本地业务库。
2. 只读：Native 只构造 `listAll` 一个端点。所有 `purchase`/`funding` scope 的资金端点（如 create、renew、transfer、各类 topup、closeout、邮箱与主机购买）都不可达。
3. 整次扫描原子化：重复域名、跨页重复、非规范域名、超出 10 000 条或 11 页（10 000 条整时必须再读到空页才算读完）、未到末页都拒绝整次导入，不写入部分结果。
4. 官方说明 API 访问按域名开启，`apiAccess` 只作为字段保存，不作为过滤条件；界面说明“库存来自 Porkbun 账户列表，转移锁、自动续费以平台为准”。
5. 不传 `includeLabels`、筛选参数，也不读取标签，避免把用户自定义文本带入本地库存。

## 分步交付

1. Native：`porkbun.rs`（客户端、请求、读页）、`porkbun/credentials.rs`（成对凭据 custody、三平台掩码对话框）、`porkbun/registrar_wire.rs`（严格解析、分页与重复检查）及负向测试。
2. 协议：`porkbun:registrar:observe` 授权能力、grant 向量、capability manifest 与 `provider_services/porkbun.rs` 的 `IMPLEMENTED` 同步为 `registrar.domain.observe`（仍 `qualification_pending`）。
3. `local-storage`：Porkbun 库存 SQL、业务模块与 `desktop_local_host` 模块，崩溃/重开测试。
4. Tauri：`porkbun_registrar_submit`、`porkbun_registrar_status` 命令、凭据编排、ProviderLane；权限与命令策略经生成源更新。
5. Renderer：client-core 适配、i18n、账户库存面板（仅依 `brand/ui_kits/desktop`）。
6. 文档：CONNECTORS、CURRENT_IMPLEMENTATION、VERIFICATION、执行台账与审查记录。

## 验收

源码层：负向测试覆盖凭据不出 Native、非 SUCCESS、`count` 不符、跨页重复、恰好 1000 条后的空页、非法日期与标志、状态码映射。真实层：需要开启 API 访问的 Porkbun 账户与受控域名（`local.env` 的 `PORKBUN_*`），核对请求头认证（schema 仍把 body 密钥列为必填）、标志位确为整数、`ACTIVE` 以外的状态词汇（当前一律拒绝整次导入），以及页数与账户域名数一致；在此之前能力保持 `qualification_pending`，不计为 V1 验收。
