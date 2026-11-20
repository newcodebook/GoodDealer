# Afternic 官方所有权审核复核

基线 `b746192`。本工作包在 `codex/afternic-ownership-review` 上推进，Linux 受控连接及三项 Listing 动作的验收继续使用已验证构件。生产资格和 `wecin.com` 的原受控范围维持原有合同。

## 客户流程

新建上架、改价预览时可选择在 Afternic 返回 `OWNERSHIP_REVIEW` 的情况下自动提交一次官方复核。预览列出每个域名、价格变更与条件性复核，然后整批确认一次。对于已有审核中的 Listing，可以只创建复核计划，沿用相同的批准、执行和状态页。旧批准恢复原任务；追加复核属于新批准范围。

Core 使用当前官方 Portfolio API 单域名 `POST /v3/aftermarket/customers/my/domains/$each/relist`，明确设置 `mode=REACTIVATE`。顶层 200 返回的逐域名 200/204 只确认受理或无变化。应用从相同凭据及绑定的下一次精确 GET 判断后续状态。`OWNERSHIP_UNVERIFIED` 的私有验证要求、DNS 和 Resolution Center 操作为后续工作包。[API 证据](../PROVIDER_API_REVIEW.md)

## 固定边界

- 一个工作区、一个连接、最多 500 个不同域名。每个选中的域名在原父计划内最多增加一个具名复核子项。子项独立采用用途签名、请求摘要、一次持久 claim、执行事实和配对审计。禁止复用原上架/改价发送凭据。复用 `operation_plans`、`operation_plan_items`、`operations`、`operation_attempts` 与 `operation_results`，沿用唯一业务 writer。
- v2 预览冻结固定子项、触发状态、父项关系、有界未来资源条件、连接和资产代次。针对已有 Listing 冻结实际资源。旧 v1 预览、hash、签名和已应用 006/007/030/031 保持原字节。迁移只追加，新旧合同严格分别验证。
- 允许 claim 前复查当前 Grant、Lease、商业能力、平台资格、已签连续时间、电源、取消、交接屏障、连接、凭据和资源代次。条件性子项要求父项的字段已经由认证 GET 复核并绑定精确 Listing，再从最新认证 GET 证实 `OWNERSHIP_REVIEW`。看到已满足目标的终态只记录观察。等待或权限缺失显示为相应状态。
- 在当前工作区与域名上保留至少 24 小时的不可变 claim。并发、新计划、换连接、换代次或重启不能绕过。原 claim 在首次持久化后只能继续 GET 对账，未知结果超时也不能再次发送。重开必须取得当前已签连续时间。新设备没有完整旧 claim 时，使用既有可验证旧设备关闭边界加 24 小时，无法证明边界则继续阻止这项写入。
- Native 继续使用 Core 凭据托管、固定运输和原 ProviderLane。Cloud 只接纳具有独立签名用途和所属计划/子项的审计与执行事实，不处理域名或凭据。Renderer 只提交有界业务意图，不能声明远端状态、端点、凭据、任意后续动作或真实验收资格。

## 实施与接受

Core 已完成官方固定请求及严格逐项结果解析。本切片其余工作由 local-storage 持久化与 Host、Protocol/Cloud 闭合证据、Native 编排和客户入口分别实现。主代理冻结共享 wire 与迁移顺序后再派发这些实现。

v2 批次的证据使用 `listing_plan_v2`，各项使用 `create`、`update` 或 `reactivate_ownership_review`。沿用 UUID、base64url 摘要和现有时间字段，最多 500 个域名和 1000 项。新目标集 `GOODDEALER-AFTERNIC-LISTING-PLAN-TARGET-SET-V2` 对每项冻结 `operationItemId`、`action`、`requestDigest`、可空 `parentItemId` 与可空 `parentRequestDigest`，按 item ID ASCII 升序。只有复核项可引用同计划内的上架或改价父项。独立复核计划的两项父引用都必须为 null。

上架与改价使用 `gd.afternic-listing-plan-item-approval.v2` 及独立的 `GOODDEALER-AFTERNIC-LISTING-PLAN-ITEM-APPROVAL-V2` 和 `GOODDEALER-AFTERNIC-LISTING-PLAN-ITEM-APPROVAL-ENVELOPE-V2`。复核使用 `gd.afternic-ownership-review-item-approval.v1` 及独立的 `GOODDEALER-AFTERNIC-OWNERSHIP-REVIEW-ITEM-APPROVAL-V1` 和 `GOODDEALER-AFTERNIC-OWNERSHIP-REVIEW-ITEM-APPROVAL-ENVELOPE-V1`。两类 item 从当前 v1 Listing 批次和设备字段开始，增加前述两个可空父引用，`targetCount` 绑定 v2 目标集中的实际项数。历史 v1 继续采用原合同和最多 500 项限制。

初步迁移顺序为本地 `202611190008`，Cloud `202611190032` 由审计模块拥有，`202611190033` 由执行证据模块拥有。整合负责人复核冲突及任何已应用迁移，只有确认未占用后才能登记。Core 和 Protocol 的签名测试向量可先确立，既有证据 ingest 与直接 SQL 同步收紧后才允许 Native 排队新的复核项。

## 冻结的审计与执行证据字段

沿用现有 workspace 设备审计和执行事实外层与签名域。v2 批次批准的审计 `targetType` 是 `afternic_listing_plan_v2_approval`，`targetRef` 是 `approvedOperationId`。payload 为 `schemaVersion:2`、`provider:"afternic"`、`action:"listing_plan_v2"`、`stage:"approved"` 与上述批字段 `approvedOperationId`、`operationId`、`planId`、`planHash`、`targetCount`、`targetSetDigest`。

v2 普通 Listing 项与复核项使用各自的 `targetType`：`afternic_listing_plan_v2_attempt`、`afternic_ownership_review_attempt`，`targetRef` 均为 `attemptId`。执行事实 `eventType` 分别为 `afternic_listing_plan_v2_dispatch_claimed`、`afternic_ownership_review_dispatch_claimed`。普通项 payload 使用 `schemaVersion:2`，复核项使用 `schemaVersion:1`。相应 `provider` 和 item `action` 必须匹配准确批准。批准、claim、拒绝及核对都沿用原审计外层 actor、eventType 和 authorizationSource 的严格分类。

claim 审计沿用当前 Listing claim payload 的其余字段。执行事实 payload 沿用当前 Listing claim 中的 `dispatchSemantics:"local_claim_only"`、`deduplicationScope:"local_only"`、`requestDigest` 和 `approvalEnvelopeDigest`。只有复核项增加两项 base64url SHA-256 摘要 `resourceBindingDigest` 和 `preflightObservationDigest`，在事实与配对审计上共同签名并验证一致。准确观察年龄由 Host 当前验签时间与原观察存储检查。Cloud 不接观察时间以外的 Provider 源数据、原始调用结果或账户标识。`parentItemId` 与 `parentRequestDigest` 只由 item approval 和目标集绑定，避免不同 payload 中重复持有同一权威。

普通项的拒绝与核对使用原 Listing payload 字段和闭合值。复核项 `preflight_refused` 的字段沿用当前 Listing 拒绝审计，闭合 reason 为 `precondition_changed`、`connection_changed`、`listing_absent`、`provider_state_blocked`、`cooldown`、`prior_outcome_unknown`。复核项 `reconciled` 使用当前核对审计字段，按照 `confirmed`↔null、`still_review`↔`postcondition_pending`、`read_failed`↔`read_failed`、`conflict`↔`precondition_changed|connection_changed|provider_state_blocked` 约束 outcome 与 reason。以同一子项的原执行事实 ID 和 digest 核对结果，迟到、跨项或跨范围证据拒绝。

未发送且认证 GET 已确认目标满足时，复核项记录 `preflight_satisfied`，字段同 `preflight_refused`，省略 `reason`。这条 Native 签名审计无执行事实，不能与同项同尝试 claim 并存。Cloud 核对签发设备和批次，目标成员关系由 Host 在事务中保证。

## Desktop 客户合同

`afternic_listing_plan_preview`、`afternic_listing_plan_approve`、`afternic_listing_plan_status` 使用 `schemaVersion:2`。上架或改价项必须逐域名显式声明 `ownershipReview` 为 `null` 或 `{mode:"reactivate_once_if_review"}`，整批至少一项复核。独立复核使用 `action:"reactivate_ownership_review"` 和仅包含 `domain` 的项。批准只提交预览引用与 hash。无复核的上架或改价继续走 v1。

v2 详情为每域名一行，含可空 `listingWrite` 和 `ownershipReview`。独立复核没有价格修改项。复核状态区分预览、等待父步骤、待读取、对账、仍在审核、已确认、无需提交和冲突。详情中的 `latest` 仅来自该复核项的认证读取，显示 Provider 状态和观察时间。`not_required` 无 claim，`confirmed` 必须有 claim 和其后的确认观察。v2 状态可读 v1 及 v2 保存的历史，资格和当前能否执行由 Host 与 Native 通道共同决定，现有 Linux 受控范围不准入复核。

当前缺少把前任关闭证据完整绑定到新机工作区和当前 Lease 的持久路径。新 claim 仅从可以证明没有前任的初始来源准入；其余来源遇到缺失证据时保留 `prior_outcome_unknown`。收到精确的已验证关闭边界且已签时间达到该边界后 24 小时才能移除这一限制。安装时间、当前系统时间及等待时长不能替代关闭证据。已存在的 claim 仍沿用只读对账。

独立接受覆盖实际旧库升级、500域名限制、竞态与一次 claim、跨连接/代次、截止与有限连续时间、交接冻结、真实 PostgreSQL 与签名重放错用途。真实接口验收还需要有权凭据和一条实际 `OWNERSHIP_REVIEW` Listing，以及对应资格或单独授权的开发范围。需要从真实 GET 检查终态，Windows/macOS 实机另行验收。
