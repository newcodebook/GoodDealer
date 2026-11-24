# Atom Standard 整批上架父计划

状态：Task Frame，待实施。拥有者：root 主目录（PR #53 分支）。不触碰 SellerHub 工作线（Codex `codex/afternic-ownership-review`）。

权威依据：[ADR-0027](../adr/0027-multi-platform-domain-providers-and-marketplaces.md)、[ADR-0024](../adr/0024-capability-qualification.md)、[ADR-0016](../adr/0016-local-business-database-and-cloud-sync-boundary.md)、[API 核查 · Atom](../PROVIDER_API_REVIEW.md#atom)。复用对象为已组合的 [Atom Standard 下架](../reviews/2026-11-20-atom-standard-delist-review.md) 与 Afternic 上架/改价父计划（[Task Frame](AFTERNIC_LISTING_WRITE_TASK_FRAME.md)）。

## 交付旅程与范围

已有 Atom 连接及已归集资产 → 批量页选“Atom 上架（Standard）” → 为每个域名填写售价 → Host 形成 15 分钟持久预览（逐项写前精确 `domain-details` 确认账户内尚无该挂牌）→ 整批批准一次 → ProviderLane 逐项持久认领、至多一次 `add-domain`、写后精确 `domain-details` 复核 → 批量页持久展示逐项结果 → 退出/休眠暂停，重开只对未决项读 `domain-details` 对账，不重发。

- 每批一个 Atom 连接、1–500 个不重复的规范 ASCII 域名，均为当前工作区未删除、非 provisional 的已有资产。不隐式创建资产，不切换连接。
- **只做 Standard**（`domain_type=standard`）。Premium 每次扣一枚 coin 并进入平台审核，属于资金操作，须逐项资金确认（ADR-0027 资金条款），不在本切片；Geo 的含义与准入未取证，也不在本切片。请求必须显式发送 `domain_type=standard`，不依赖未写明的默认值。
- 非资金整批确认一次。价格、目标、连接任一变化都需要新预览。
- 本切片不包含所有权验证（`verify-dns` 与 TXT 发布）；它是独立的下一切片，结果中“待验证”状态如实显示，不说成已上架成功。

## 2026-11-24 官方合同事实（apidocs.atom.com，OpenAPI 1.0.0）

- `GET https://www.atom.com/api/marketplace/add-domain`，查询参数 `api_token`、整数 `user_id`、`domain_type`（standard | premium | geo，可选，未写默认）、`domain_name`、`price`（字符串，未写币种）。
- 200 响应文档示例 `{"message":"Successfully uploaded"}`；schema 示例写作 “Successfully updated”。未记录错误响应，也未记录幂等性。
- `domain-details` 返回 `id`、`domain_name`、`status`（示例 “Seller Approved”）、`full_price`、`selling_price`、`listing_type`（示例 “Plus”）等。
- `verify-dns`：`GET …/verify-dns`，返回 `{"success":true,"message":"DNS check request accepted"}`，无结果查询端点（属于下一切片）。

由此得到的强制规则：

1. Token 在查询串中：URL 只在 `crate::atom` 内部构造，不记录、不进入错误、Debug 或证据。
2. 这是带副作用的 GET：不缓存、不预取、不自动重试；HTTP 客户端不跟随重定向。
3. 无幂等保证：每项持久认领后至多发送一次；超时、断网、非 JSON、未知文案、登录页都是**结果未知**，只能靠 `domain-details` 对账，不能重发。
4. 回执只接受两个文档文案（`Successfully uploaded`、`Successfully updated`）的严格 JSON 对象；其他任何响应都不是成功。回执本身也不是挂牌成功，必须写后 `domain-details` 精确命中同一域名、`listing_type` 为 Standard。

## 价格合同

UI/IPC/Host 使用 `priceMicroUsd`：JS 安全整数、`u64` 可表示，整美元步长 `1_000_000`，范围 `1_000_000`–`49_999_999_000_000`。Native 只发送整数美元的十进制字符串。

**币种待取证**：官方文档未写 `price` 的币种。现有库存样本与卖家页面显示为美元，本切片按 USD 实施，并把“价格币种为 USD”列为真实账号验收的第一项核对：受控上架后，`domain-details` 的 `selling_price`/`full_price` 必须等于提交的整数美元。不相等时，该项结果为 `conflict`，能力不得取得资格。

## 精确 Renderer / TS / IPC 合同

所有对象 strict，从 `unknown` 校验，拒绝额外字段、重复域名、非整数、越界与非规范域名；nullable 字段必须出现。

```ts
type AtomListingCreatePreviewRequest = {
  schemaVersion: 1; connectionId: string;
  items: { domain: string; priceMicroUsd: number }[];
};
type AtomListingCreateApproveRequest = { schemaVersion: 1; planRef: string; planHash: string };
type AtomListingCreateStatusRequest = { schemaVersion: 1; planRef: string | null };

type AtomListingCreatePlanState = "awaiting_approval" | "executing" | "completed" | "partially_failed" | "expired";
type AtomListingCreateItemState = "preview" | "queued" | "reconciling" | "listed" | "pending_verification" | "conflict" | "already_listed";
```

三个 raw IPC：`atom_listing_create_preview`、`atom_listing_create_approve`、`atom_listing_create_status`，与 Atom 下架相同的 UTF-8 JSON body 形式；capability、命令策略与生成物经生成源更新。Renderer 不接收或发送 token、user_id、资源摘要、凭据代次或端点。

## 状态与对账

- `already_listed`：预览或写前 `domain-details` 已在同一账户精确命中该域名（任何类型），不发送。
- `listed`：写后精确命中、Standard、状态为已观察到的上架态。
- `pending_verification`：写后精确命中、Standard，但状态表明等待所有权验证或审核；原文状态只映射到闭合枚举。
- `reconciling`：已认领且结果未知；重开只读 `domain-details`。
- `conflict`：命中但类型不是 Standard、价格不等于提交值，或域名属于其他挂牌形态。
- 404、空数组、null、匿名认证错误、登录页都不能证明缺席；预览阶段这类结果使该项不可批准，而不是当作“未挂牌”。

## 分步交付

1. 协议 execution-evidence schema、向量与生成脚本（仿 `atom-standard-delist-evidence.ts`）。
2. Cloud 审计与执行台账证据迁移。
3. `local-storage`：批准 SQL、计划/认领/结果业务模块、`desktop_local_host` 模块及崩溃/重开测试。
4. `secure-host-core`：`add-domain` wire、严格回执解析、`domain-details` 复用；`provider_services/atom.rs` 的 `IMPLEMENTED` 与协议 manifest 同步加入 `marketplace.listing.manage`（仍为 `qualification_pending`）。
5. Tauri 命令、权限、ProviderLane 与批量页面板（仅依 `brand/ui_kits/desktop`），i18n 与清单计数。
6. 文档：CURRENT_IMPLEMENTATION、VERIFICATION、PROVIDER_API_REVIEW、执行台账与审查记录。

## 验收

源码层：负向测试覆盖 Premium/Geo 请求被拒、重复与越界价格、未知回执文案、超时后不重发、重开只读对账、跨连接与过期计划。真实层：需要获准 Seller API 的 Atom 账号与受控域名（见仓库根 `local.env` 清单），核对价格币种、Standard 状态文案与下架往返；在此之前能力保持不可用，生产入口无可执行路径。
