# Afternic 持久上架与改价父计划

状态：root 已冻结；在隔离 Provider worktree 并行实施。root 拥有本文件及共享面整合。
Provider worktree 基线 `825878d`；强制接管留在主目录独立验证提交，随后合并时仅重放其完整提交。强制接管按既定 Fresh / 可信 not_started 范围收尾，不扩展已有副本与无 held source 恢复。

权威依据：[ADR-0027](../adr/0027-multi-platform-domain-providers-and-marketplaces.md)、[ADR-0016](../adr/0016-local-business-database-and-cloud-sync-boundary.md)、[ADR-0032](../adr/0032-desktop-device-switch-and-drain-handoff.md)。现有连接、完整库存、下架、真实 execution evidence/drain 为源码事实；旧工作框架中的“父计划未实现”或“空证明临时拒绝”不能作为当前实现描述。

## 交付旅程与范围

已有 Afternic 连接及已归集的本地资产 → 批量页选上架或改价 → 填写每项价格/隐藏字段 → Host 从最新完整库存与本地绑定形成 15 分钟持久预览 → 整批批准一次 → 原 ProviderLane 自动执行逐项精确 GET、单次 POST/PATCH、写后 GET → 持久展示字段结果与真实平台状态 → 退出/休眠暂停，重开仅对未决请求 GET 对账 → 实际签名审批、事实、审计同步与 drain 贯通。

- 每批一个连接、一个 action（`create` 或 `update`），1–500 个不重复的规范 ASCII 域名；域名必须为当前工作区未删除、非 provisional re-add 的已有资产。允许不同域名有不同字段值。不隐式创建资产、切换连接或把 create 冲突转换成 update。
- create / update 使用同一个具名 `afternic_listing_write` 父计划能力和一个持久状态机。现有 delist 旅程继续支持，不重写为泛化工作流框架。
- 默认一次非资金整批批准；价格改变、目标增删、字段选择变化、连接变化必须新预览。这里的卖家标价不授权费用、出价、购买、注册、NS 或 DNS 操作。
- 本切片不猜测尚未取得的私有 session/CSRF/step-up 合同。平台返回待验证/冲突/审核状态时准确展示并保留后续自动验证工作；不能把字段相等、201/204 或 Listing 存在说成 ACTIVE 或所有权成功。
- 用户已授权受控域名 `wecin.com`，本轮先在当前 Linux 跑真实业务，再单独取得 Windows/macOS 兼容与实机资格。Native 独立补受限秘密录入/托管，不索要聊天粘贴凭据；root 同步更新与本次用户授权冲突的 ADR-0025/当前平台说明。Windows/macOS 继续完整支持目标；源码测试、当前 Linux 实际接口与双系统实机/发行资格分别记录，不靠空 manifest 或开放开关冒充取证。

## 当前可复用的真实边界

- Core 已有 `AfternicListingIntent::{Create,Update,Remove}`、`AfternicListingFields` 和固定方法/路径。Create：POST `/v3/aftermarket/customers/my/domains`，201；Update：PATCH `/v3/aftermarket/customers/my/domains/{domain}?resource=true`，200/204；精确 GET 负责对账。沿用官方 API Service、同源运输、凭据 custody、150 请求/分钟总限流。`X-Request-Id` 仅关联，不是上游幂等保证。
- `local-storage` 已拥有 `operation_plans/items`、`operations/attempts/results`，唯一业务 writer；原 `domain_asset_provider_bindings` 已支持连接与资源 digest / incarnation、保留 detached 历史。不得增加另一个 Listing repository。
- 完整库存是预览来源及 freshness 提示，不从扫描缺项证明远端缺席。写前必须精确认证 GET。局部扫描、HTTP 错误、登录页、限流、缺字段均不是 absence。
- 现有真实 execution evidence 与 delivery 已在生产路径使用，不能退回空 drain proof 或本地假签名。现有 grant capability `afternic:marketplace:write` 已含 observe 依赖，本切片不扩 entitlement 集合。

## 价格与字段合同

所有 UI/IPC/Host 输入使用明确 `*MicroUsd` 名称。数字必须是 JS 安全整数和 `u64` 可表示整数，整美元步长 `1_000_000`；不得从 binary float 直接乘换成货币值。最大 `49_999_999_000_000` microUSD；BIN/floor 最小 0；minbid 最小 `20_000_000`，与当前 Core/Storage 校验一致。

Create 合同显式提供四个字段，Native POST 也显式发送四个字段；不让遗漏字段触发可漂移的上游默认。当前官方内嵌 OpenAPI 3.2.0/API 3.0.0 已重取：BIN default=0、floor default=0、minbid default=20_000_000 microUSD、hidden default=false。UI 可按 **0 / 0 / 20 USD / false** 初始化，预览必须显示实际完整四值，用户整批批准后以这些值显式发送。任何编辑都改变冻结hash。

Update 的 `patch` 必须至少一个键，只接受四个允许键；省略表示不变，不接受 `null`。0 是显式值，不等于省略；false 不能丢失。预览显示旧值、所选字段的新值和未选字段保持不变。Patch wire 仅包含批准键。当前规范未声明 BIN/floor/minbid 的相对大小约束，不自行加规则或自动改其他字段。`resource=true` 时无变化也可返回 200 资源，否则 204 可无 body；二者仍不替代写后 GET。

官方证据：[createDomain](https://api.afternic.com/docs/portfolio-api/api/domains/createDomain/)、[updateDomain](https://api.afternic.com/docs/portfolio-api/api/domains/updateDomain/)。当前取证原HTML在 `target/afternic-official-{createDomain,updateDomain}.html`；提取spec为 `target/afternic-official-openapi.json`，compact UTF-8 SHA-256 `566633b7046e5e19ade660ae2fe847df05f17d732bacad04b3aa17b6928de769`。实施者将需要的脱敏contract fixture/来源说明纳入拥有模块测试，临时target工件本身不作为可发布资格。


## 精确 Renderer / TS / IPC 合同

所有对象 strict；从 unknown 验证；禁止额外字段、重复键、空 patch、重复域名、未知 action、非整数、越界和非规范域名。下面字段名为序列化 camelCase；Rust 类型用 PascalCase、字段用 snake_case。所有 nullable 字段必须出现。

```ts
type AfternicListingWriteAction = "create" | "update";
type AfternicListingWriteValues = {
  buynowPriceMicroUsd: number;
  floorPriceMicroUsd: number;
  minbidPriceMicroUsd: number;
  hidden: boolean;
};
// 至少一个自有键；未知键和 null 拒绝。
type AfternicListingWritePatch = Partial<AfternicListingWriteValues>;
type AfternicListingWritePreviewRequest =
  | { schemaVersion: 1; connectionId: string; action: "create";
      items: { domain: string; values: AfternicListingWriteValues }[] }
  | { schemaVersion: 1; connectionId: string; action: "update";
      items: { domain: string; patch: AfternicListingWritePatch }[] };
type AfternicListingWriteApproveRequest = {
  schemaVersion: 1; planRef: string; planHash: string;
};
type AfternicListingWriteStatusRequest = { schemaVersion: 1; planRef: string | null };
```

三个新 raw IPC：`afternic_listing_write_preview`、`afternic_listing_write_approve`、`afternic_listing_write_status`，沿当前 delist adapter 的 raw `Uint8Array` UTF-8 JSON body（`TextEncoder().encode(JSON.stringify(intent))`）和 Native strict parse，无额外 request_json/任意JSON字符串桥；通过命令生成源更新 Tauri capability、exact command policy 与生成物。Renderer 不传批准域名以外的 resource digest、credential generation、账户身份、授权 envelope 或端点。

`packages/client-core` 的具名端口与应用 adapter 使用相同请求结构；不要放到一般 utils/shared。计划输出建议固定如下，所有 string 状态均封闭 enum，不接受任意文本。

```ts
type AfternicListingWritePlanState =
  "awaiting_approval" | "executing" | "completed" | "partially_failed" | "expired";
type AfternicListingWriteItemState =
  "preview" | "queued" | "reconciling" | "pending_provider" | "pending_verification" | "applied" | "conflict";
type AfternicListingWriteReason =
  "precondition_changed" | "connection_changed" | "read_failed" | "postcondition_pending"
  | "already_present" | "listing_absent" | "provider_state_blocked";
type AfternicListingWriteObserved = {
  providerStatus: AfternicProviderStatus; // 复用当前14项原始状态闭集
  buynowPriceMicroUsd: number | null;
  floorPriceMicroUsd: number | null;
  minbidPriceMicroUsd: number | null;
  hidden: boolean | null;
  observedAt: string;
};
type AfternicListingWriteItem = {
  domain: string;
  before: AfternicListingWriteObserved | null;
  changes: AfternicListingWritePatch; // create 恰好四键；update 恰好原批准键
  latest: AfternicListingWriteObserved | null;
  fieldsMatched: boolean; // 只表示本次批准字段已被精确GET确认
  state: AfternicListingWriteItemState;
  reason: AfternicListingWriteReason | null;
  retryAt: string | null;
};
type AfternicListingWritePlan = {
  schemaVersion: 1; planRef: string; planHash: string;
  action: AfternicListingWriteAction; connectionLabel: string;
  createdAt: string; expiresAt: string; approvedAt: string | null;
  state: AfternicListingWritePlanState; items: AfternicListingWriteItem[];
};
type AfternicListingWriteSummary = {
  planRef: string; action: AfternicListingWriteAction; connectionLabel: string;
  createdAt: string; state: AfternicListingWritePlanState;
  total: number; applied: number; conflicts: number; pending: number;
  pendingProvider: number; pendingVerification: number;
};
type AfternicListingWriteStatus = {
  schemaVersion: 1; writeQualified: boolean; writeEntitled: boolean; executionAvailable: boolean;
  plans: AfternicListingWriteSummary[]; detail: AfternicListingWritePlan | null;
};
```

`executionAvailable` 沿现有 delist 组合由当前 Native authority/power/runtime gate 投影，不能由 qualified/entitled 推导或由Renderer传入。Status 最近 50 项，与 delist 一致；一个详情最多 500 项。`before:null` 只表示预览没有这项库存事实，文案不能说“已确认远端不存在”。`fieldsMatched:true` 不能直接将项目变成 applied，亦不证明由本次请求唯一造成。PENDING/INACTIVE/UNKNOWN 等仍为 pending_provider，OWNERSHIP_REVIEW/OWNERSHIP_UNVERIFIED 为 pending_verification，持续持久只读退避查询并使父计划保持 executing；不重发写请求、不遗失后续自动验证目标。

create且hidden=false只有认证观察为ACTIVE、已批准字段匹配且明确未隐藏才显示“已上架”；hidden=true的目标是“已创建并隐藏”，不叫已上市。update只说“改价/所选设置已确认”，只有合法 ACTIVE/HIDDEN状态与批准字段目标符合时 applied；未知、审核及所有权待验证状态继续等待。SOLD、VERIFIED_OWNER_CONFLICT、合规/TLD/注册失败等保留真实平台状态并转 conflict/provider_state_blocked，不能上架成功。新观察的既有销售投影映射不由fieldsMatched覆盖；平台ACTIVE也不升级为注册商所有权证明。


## 精确 Host / Native 非序列化 API

公开类型前缀 `DesktopAfternicListingWrite`，请求/Plan/Summary/Status 与以上 wire 对应。Host 方法复用 delist 的 Native admission 与不透明 work/claim，不公开数据库、request digest 或凭据：

```rust
preview_afternic_listing_write(admission: DesktopNativeCloudAdmission,
    request: DesktopAfternicListingWritePreviewRequest) -> Result<DesktopAfternicListingWritePlan, DesktopLocalHostError>;
approve_afternic_listing_write(admission: DesktopNativeCloudAdmission,
    request: DesktopAfternicListingWriteApproveRequest) -> Result<DesktopAfternicListingWritePlan, DesktopLocalHostError>;
read_afternic_listing_write_status(request: DesktopAfternicListingWriteStatusRequest) -> Result<DesktopAfternicListingWriteStatus, DesktopLocalHostError>;
next_afternic_listing_write_work(admission: DesktopNativeCloudAdmission)
    -> Result<Option<DesktopAfternicListingWriteWork>, DesktopLocalHostError>;
recheck_afternic_listing_write_work(work: &DesktopAfternicListingWriteWork) -> Result<(), DesktopLocalHostError>;
claim_afternic_listing_write(work: DesktopAfternicListingWriteWork,
    observation: Option<DesktopAfternicListingObservation>)
    -> Result<Option<DesktopAfternicListingWriteClaim>, DesktopLocalHostError>;
recheck_afternic_listing_write_claim(claim: &DesktopAfternicListingWriteClaim) -> Result<(), DesktopLocalHostError>;
reconcile_afternic_listing_write(work: &DesktopAfternicListingWriteWork,
    observation: Option<DesktopAfternicListingObservation>) -> Result<(), DesktopLocalHostError>;
defer_afternic_listing_write_read(work: &DesktopAfternicListingWriteWork,
    retry_after_seconds: Option<u32>) -> Result<(), DesktopLocalHostError>;
```

`Work.kind() -> Preflight | Reconcile`、`connection() -> &DesktopAfternicConnection`、`domain() -> &str`。Claim 独有 `action() -> Create | Update`、`fields() -> &DesktopAfternicListingWritePatch`（Host 已冻结且严格校验）、`connection()/domain()`、消费式 `into_reconciliation() -> Work`。Claim 不实现 Clone/Serialize；只有 queued→running 事务胜者能获得。Native 将四个明确字段映射到既有 `AfternicListingFields`，再调用同一 Core Service 的 `Create` 或 `Update`，不引入 Core→Storage 依赖或秘密 TS 桥。

Native 原 ProviderLane 增具名工作分支；连接扫描、delist 和 listing-write 共享该 lane/限流/实际电源门禁。数据库 read-only work selection 返回 None 时不写 readGeneration、不忙循环。所有 await 前后核对当前 authority、商业 capability、连接 incarnation/credential generation、资产 generation、binding 和 power epoch；发送前及最终数据库提交各自再过栅栏。

## 持久事实、前置和未知结果

1. Preview 保存完整有序原意图、action、每项所选键和值、连接 incarnation/credential generation、资产 generation、最新完整 scan/观察及时间、原 binding/其状态或明确无当前 binding、adapter revision。预览 hash 覆盖所有字段与截止，不包含秘密。create 只准入无当前该连接 Listing 的资产；旧 detached incarnation 保留。update 要求该连接当前绑定及明确观察。缺少必要观察的单项不得偷偷变成另一个动作。
2. Approve 在 15 分钟窗口内对原 preview 精确 CAS，单父计划只创建一次 operation、每项 attemptNo=1。全批原签名 approval + 每项 authorization 与批准事实同事务落盘。跨 create/update/remove 的同连接 incarnation、同域名未决执行互斥，防改价/上架绕过未知下架或反之。
3. Preflight 精确 GET：create 只有认证 absence 可领取 POST；已存在即 conflict / already_present，不改成 PATCH。update 只有当前绑定/代次及冻结原观察匹配可领取 PATCH；缺席或变化拒绝，不能重新 create。预检 GET 失败只持久只读退避；其他独立项继续。
4. Claim 原子持久 running、exact request digest、真实签名 fact 与 paired audit 后发出非序列化一次性 Claim。到达发送边界前再次核对门禁。HTTP 成功/拒绝/超时/断线均进入 GET；无远端幂等保证。进程在 running 提交后、发出前崩溃仍视为可能发送，不再 POST/PATCH。
5. Reconcile 只读比较批准的 postcondition：create 四字段；update 原选择键（未选键不被补写）。GET absence、字段尚未相等或失败持久退避 30→900 秒，合法 Retry-After 可延长。不可证明原请求没发送时，即使远端仍是旧值也不能重发；保留“待对账”，用户改目标必须先解决原未决事实，不能新计划绕过。
6. 当确切字段目标被观察到，先记录 fieldsMatched；仅平台状态也符合前述业务目标时才能终结 applied。原 reconciliation/result、Listing 绑定/观察/原始详情、readGeneration、真实结果审计在同一业务事务和最终栅栏提交。create 通过现有 binding 准入创建新 incarnation；不得复活旧 detached digest。若另一完整 scan 已建立同连接同资源的当前 binding，必须通过原资源身份/代次与无冲突检查复用，不能插第二绑定；不能证明相同资源则保留冲突与现有事实。
7. 字段匹配与 Provider status 分离。业务不可操作状态（SOLD、合规失败、账户所有权冲突等）保留原状态、reason 与后续处理；不通过写请求循环“修复”。若 Provider 状态含义尚无当前合同证据，UNKNOWN 不提升为完成所有权。DNS/私有验证将来是同批准范围下的独立步骤；此切片不写未知 DNS。
8. 真实 signed reconciliation audit 绑定原 fact ID/digest；没有 dispatch 的 preflight 拒绝使用批准绑定的 preflight_refused audit，不能伪造执行 fact。旧运行 epoch 的证据仍按原身份上传/对账，不用新 Lease 重签历史。

## execution evidence 的最小 closed action 扩展

现有证据不是通用能力：Rust `execution_evidence.rs` 的 action/remove、typ、audit target/event、查询表名；`execution_evidence.sql` 的 FK/trigger；`execution_evidence_delivery.rs` 的 missing-fact 检查；Cloud Audit/Execution Ledger 验签与 SECURITY DEFINER append function 都明确只支持 delist。它们必须在同一完整切片扩展，不能只改 UI/Service 或放宽一个 enum。

- **保留 legacy remove v1**：已签名 typ `gd.afternic-delist-item-approval.v1`、现有 transcript/envelope/target-set 域、历史 planHash/digest、audit/fact envelope 原样继续验证/上传/drain。禁止重签迁移历史或改变其 digest。
- **新增具名 listing-write v1**：`typ = gd.afternic-listing-write-item-approval.v1`；action strict `create | update`；capability 仍 `afternic:marketplace:write`；其余有界字段沿现有 item approval。签名、envelope、target-set 域分别为 `GOODDEALER-AFTERNIC-LISTING-WRITE-ITEM-APPROVAL-V1`、`GOODDEALER-AFTERNIC-LISTING-WRITE-ITEM-APPROVAL-ENVELOPE-V1`、`GOODDEALER-AFTERNIC-LISTING-WRITE-TARGET-SET-V1`。target-set 顶层包含 action，item 有序唯一且每项精确 requestDigest。local dispatch key 的已有领域可继续复用其原严格形状，不宣称远端去重。
- 新审计 target 为 `afternic_listing_write_approval` / `afternic_listing_write_attempt`；新 fact event 为 `afternic_listing_write_dispatch_claimed`。stage 仍 approved / dispatch_claimed / preflight_refused / reconciled。payload 只包含原计划/批准/尝试引用与摘要、action、闭合结果/原因；不得把域名、价格、Provider 账户或凭据塞入 Cloud 证据流。
- 新 reconciled outcome strict `matched | absent | different | read_failed | conflict`。matched仅表示字段匹配，不能由该fact单独推导本地parent完成；本地同时保留latest原始Provider状态与pending类别，后续GET继续追加观察/审计。matched reason=null；absent/different 对应 postcondition_pending；read_failed 对应 read_failed；conflict 仅 precondition_changed / connection_changed / provider_state_blocked。preflight_refused reason 闭集 precondition_changed / connection_changed / already_present / listing_absent / provider_state_blocked。Cloud 在 action+typ+target/event+stage 的闭集分支中校验，不只放宽 action 后共用 permissive parse。
- action 必须在 item approval → batch approval audit → paired claim audit → execution fact → reconciliation original fact 的全链一致。错用途签名、把 remove 改成 create、create/update 交叉、同摘要但不同 action、错 key/epoch/tenant、漏 paired audit 均拒绝/保留 pending。Historical Execution Context 当前 capability 校验继续复用，不授予其他平台/资金能力。
- 单一原两流及其 head/sequence/rolling digest 保留；不建新的 Provider 证据流、Cloud approval 表或泛化事件代理。

## 追加迁移建议

**Local Storage `202611190006`（root 已保留）**，owner `active-workspace/afternic-listing-write`：

- 新增窄 `afternic_listing_write_reconciliations`，关联原 operation/plan/item/attemptNo=1，连续序号、exact request digest、stage/outcome/reason/observedAt/nextReadAt、可选原 observation digest/id，append-only。它不拥有 Listing 身份。
- 将原 `afternic_delist_approvals` / `afternic_delist_item_authorizations` 窄改名为 `afternic_listing_approvals` / `afternic_listing_item_authorizations`；现有 fact outbox FK 随同指向原表。批准表追加 closed action（create/update/remove，旧行确定回填 remove），保持历史原字节及所有 FK。若 SQLite rename 对触发器/索引或 schema guard 有影响，同一追加迁移显式维护并验证；不能修改旧 SQL。
- 延伸当前 signed-claim / immutable / evidence/result / handoff triggers 至两个 operation_kind 的闭集；新 create/update attempt 的新值 action须与父计划及批准 action一致。所有 new preview/approve/queued→running/dispatch 仍受 handoff 屏障。进入屏障时按 ADR-0032 冻结两条来源流，迟到 GET 不追加旧 epoch 观察或审计；只有权威取消交接并重开来源，或以后取得新 Active epoch 后重新 GET 才可继续对账，不补造旧响应证据。
- `execution_evidence_delivery.rs` 的原 missing-fact audit 必须同时纳入 `afternic_listing_write`，包括 queued、终态及重开历史；新写未进真实两流时禁止生成“空证明”。
- 注册 manifest、schema guard/fingerprint（由源重生成）、迁移验收、旧 delist 字节与关系保持测试一起更新。

**Cloud `202611190030` / `202611190031`（root 已保留）**：目前 forced 线最新为 029。Audit 030 替换当前 015 版本 append function 的 closed payload/action/target 限制；Execution Ledger 031 替换当前 017 版本 fact append function 的 closed event/payload 限制。保留现有 SECURITY DEFINER search_path、角色 ACL、账户/工作区隔离与所有原 canonical bytes/签名/sequence 检查。没有新增通用 authority 或额外 Cloud Provider 数据表。应用后只追加修正迁移。

## 已冻结所有权与整合次序

- device_architecture_review 拥有 Storage：新业务/Host 与追加本地迁移、原 evidence 表/签名生产/队列/drain准入最小闭集扩展、SQLCipher/迁移测试、必要 public exports。
- standby_cloud 拥有 Cloud/protocol/client-core：新 evidence contracts、生成源/corpus/负测，以及 `packages/client-core/src/operations/afternic-listing-write.ts` 的unknown请求/结果/端口合同与导出/测试；Audit/Execution Ledger/历史授权相关校验及 030/031 实际 PG 权限/两流验证；不改 Storage/Native。
- standby_native 拥有 Native/Core：官方当前字段证据、同一 Afternic Service 意图映射、原 ProviderLane worker/电源守卫/三个 raw IPC与生成物；不持有数据库状态机。
- root 拥有 Desktop/client 组合：Desktop adapter、现有批量页选择create/update/字段预览批准历史、i18n、主组合/目录注册、当前文档、独立审查与完整提交。共享 app/main/build/capability/command 策略、迁移 catalog 与公开 surface 清单由 root 整合；Native 只拥有 command handler 源与 worker，生成物由 root 改源后重生成。Storage 拥有 local-storage 的必要 public exports；Cloud 拥有 protocol/client-core 的必要 public exports；Core exports、Native execution_context_native 签名实现归 Native。不得并发抢改。

先落 strict合同/迁移及原审批证据贯通，再接真实worker和客户入口；同切片收尾。证据未接通前不能开放可执行 create/update。新字段或语义由当前官方合同决定，缺真实资格只阻塞对应实机/账号验收，继续其余源码、数据库及目标编译工作。

## 验收与完成条件

- 合同：create遗漏/unknown/duplicate/null、update空patch/未选字段、0/false、浮点/越界/非整美元、重复目标、错 action/connection 拒绝；预览明确全部POST值与PATCH键。
- 状态机：重复整批批准、并发claim只有一次、create已有/patch缺席、外部漂移、同域名跨create/update/remove未决互斥、撤权/凭据代次/资产generation/绑定incarnation、sleep/wake/退出守卫、每个SQL/network崩溃前缀、unknown ACK与重启不重发、独立项继续及持久退避。
- 结果：精确GET字段匹配、非匹配/缺席/失败、PENDING/OWNERSHIP_*不冒充ACTIVE、SOLD/合规/UNKNOWN保持实际状态；create正确新绑定或严格复用并保留旧detached；update不得暗改未选字段；所有观察/结果/审计同事务最终栅栏。
- 证据：legacy remove迁移后继续验证、create/update新transcript共享向量、错用途/跨动作/租户/key/epoch拒绝、approval audit欠缺pending、完整事实/结果审计持久重开→Cloud ingest/receipt→drain seal，任何新write漏证据时不能生成空drain。实际PG生产角色直调append的恶意payload仍拒绝。
- 客户：以用户授权的 `wecin.com` 经受限Native连接，在当前Linux跑真实已有连接→库存→上架/改价选择→15分钟预览一次批准→状态/价格历史→重启对账；禁用/失效状态明确且不重复批准，不让标价成功代替平台审核/验证。
- 最终执行模块/迁移/SQLCipher/PG、严格Clippy、生成物/策略/拓扑/文档引用、独立评审和根 `pnpm check`；Windows/macOS目标编译、真实账号受控资产、两个系统休眠/重开资格分别记录。未取得材料不索要聊天粘贴秘密，不擅自真实资金交易。

## 独立接受与并行工作区

Provider 工作目录为 `/home/sean/.codex/worktrees/afternic-listing/GoodDealer`，所有构建和命令显式使用该路径；主目录的强制接管改动不能拷入。local migration 006 与 Cloud 030/031 已预留。root 最终将独立完整切片合并到主目录，不混入其他工作；生成物只从拥有源重生成。Native 的 Linux capture 与 power 各自独立审查，并与 listing-write 保持分开提交。

Storage 业务/迁移/SQLCipher 由 root 与 standby_cloud 独立复审；Cloud/protocol 由 root 与 Storage 独立复审；Native/Core 由 Cloud 与 root 独立复审；root adapter/UI/共享面由 Cloud 独立复审。不得接受自身实现。Linux 真实操作必须当前授权与Native凭据，缺失条件尽早明确；账户级库存与官方读写、私有验证/DNS、Linux运行及Windows/macOS实机证据分别记录。
