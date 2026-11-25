# Afternic 连接、库存与持久 Listing 客户闭环

当前归集切片基线 `61979a5`；完整任务与边界见 [持续实施目标](../IMPLEMENTATION_GOAL.md)。不等待所有设备引导或 Cloudflare 写能力完成。

- 目标：受限 Native key/secret 连接 → 完整分页读取市场库存 → 复用资产和 Listing 绑定 → 整批新增/改价/下架预览一次批准 → 持久单项执行与 GET 对账 → 退出暂停、重开先对账续作。Afternic 库存不能冒充注册商所有权证明。
- 当前事实：Listing 绑定迁移已支持 connection/resource digest/incarnation；plan/item/operation/attempt/result 表已有严格约束，但生产写入/执行路径未实现。本切片已追加连接/代次关联的观察和销售读取。Renderer 批量页只有读取端口。
- 外部合同：已读取当前官方内嵌 OpenAPI 3.2.0（API 3.0.0），固定 `https://api.afternic.com/v3/aftermarket/customers/my`；逐域名 POST/PATCH/DELETE 和 GET 对账。`X-Request-Id` 没有幂等保证；完整扫描后才开始改动；150 请求/分钟含读取。价格是整美元的微美元整数，不从浮点换算。省略字段的默认行为须在预览中明确，PATCH 仅包含批准字段。
- 私有证据：当前公开脚本固定 `https://www.afternic.com/fosv2/api`，读取 `/v1/account/verificationTxt`，域名数组 POST `/v1/domains/verifications` 与 `/v1/domains/verificationStatus`。不猜 `/verifications/check` 请求体，不绕过 HBI/重新认证。真实 Cookie/CSRF/step-up 采样需要受限 Native 会话；此条件不阻断官方闭环开发。
- 所有权：secure-host-core 的 Afternic 私有 Service 拥有固定 HTTP/凭据/响应解析；local-storage 唯一 writer 拥有连接、绑定、扫描、观察、预览、计划、尝试、结果与对账；Cloud 不执行 Provider 请求；Renderer 只持有有界业务意图与脱敏投影。
- 冻结端口：Native 候选验证、完整有界 portfolio 扫描、精确域名集合观察、闭合 create/update/remove 意图执行；跨 crate 仅公开必要 Native facade、脱敏观察与封闭错误。Provider 账户身份/key/secret/Cookie/CSRF 不离开 Native。每次 await 前后及提交时核对连接 incarnation、凭据 generation、授权 epoch；不得泛化为任意 HTTP 代理。
- 持久化：追加迁移关联观察与既有 Listing 绑定，保留旧 incarnation；修正同平台多连接销售投影；批准计划至多一个 execution。Afternic custody metadata 独立于 Cloudflare zone 字段。未知 attempt 追加不可变对账事实并严格绑定请求/观察摘要；重启遗留 running 必须先对账，不改成 queued 盲发。不修改已应用 SQL。
- 批量确认：新增目标、改价或扩大 DNS 范围须重新预览；非资金整批一次批准。无费用/出价或购买交易。写后 2xx 不是验证成功，OWNERSHIP_REVIEW/UNVERIFIED/ON_HOLD/SOLD 各自保持真实状态。
- 文件所有权：`standby_native` 独占 secure-host-core 的新增 afternic_* 与该 crate lib exports；root 独占 local-storage 迁移目录、业务/Host、协议 Provider 意图、Tauri/Renderer/i18n 组合。设备回执工作线不得改这些文件。共享面变化先通知 root；不创建第二 repository/writer。
- 验收：严格 unknown wire、秘密脱敏、恶意分页 URL/重复/缺项、绑定代次与跨租户、批准冻结、并发、请求超时/5xx/429、提交失败、崩溃/重启、未知结果重放；模块/数据库测试、独立评估、新鲜根 pnpm check，按完整切片提交。
- 资格：公开文档/脚本只是协议证据。真实账户、所有权与 DNS 验收需 Native 受限流程；Windows/macOS 分别取证。不以 fake、空资格 manifest 或开放开关声明可用，不要求用户把秘密粘贴到聊天。

## 实际组合前置与冻结决定

现有 Active Grant 的商业字段仅接受 `cloudflare:dns:observe`，Cloud issuer 与 Host verifier 同样硬编码；不能把它当作 Afternic 授权。此修正与实际连接/观察/Listing 旅程一并交付，不单独声称权限目录已实现产品。

- Active Grant 升 v4（typ/domain 同步），commercialAuthority 升 v2，外层 role exchange 升 v5；Standby Grant v1、Lease v1 不变，不保留旧运行时 wire。
- `capabilities` 是 0–3 项严格升序、无重复的封闭集合；空集合保留有效商业授权的本地业务 scopes，但不授予任何 Provider 操作。允许项：`afternic:marketplace:observe`、`afternic:marketplace:write`、`cloudflare:dns:observe`。write 必须同时拥有 observe，以保证对账能力；不隐含 DNS 写入、私有验证或其余平台。
- 来源仅为当前锁定的 Licensing authoritative snapshot.featureEntitlements 的精确交集。旧 Cloudflare feature 不映射成 Afternic；新增 feature 经受控 catalog 与可信对账产生新 revision/digest，不改历史购买事实。
- 仍使用现有独立 Desktop Grant 签名用途；schema/domain 改版不创建新的授权角色或泛化签名系统。Cloud/Native 注册表、签名验证和生成向量同步改源重生成。Lease 与 Standby 的用途隔离继续保持。
- Native floor 升 v3 并保存 capabilities。旧 floor v1/v2 的商业记录只映射历史 Cloudflare singleton，epoch/issuedAt/最后本机 Active 的未知语义保持。相同 revision 或 digest 不得改变权限/期限；新 revision 与新 digest 可增权或撤权，不要求永久超集。
- runtime snapshot 与最后提交检查包含 capability 集合。Cloudflare 原有准入也必须逐项检查其具名权限；Afternic 每次 await 前后、连接代次与事务提交均重查。continuity 与备份读取不能推导 Provider 权限；不复活未被生产使用的 local_workspace_binding 为第二权威。
- 先完整交付连接与库存归集（明确是市场库存，不是注册商所有权），随后在同一拥有模块完成批量预览/批准/执行与重开对账。追加迁移统一由 root 编号；不改本轮设备线的 `202611180002`。

## 本轮所有权（基线 `61979a5`）

- standby_cloud：上述 Grant v4/role v5 的 protocol 授权源码、对应 vectors/生成源/测试；Cloud issuer、严格请求与受控商业配置校验、相关测试。不得修改 local-storage、Native 或协议 index 公共导出。保留现有 Desktop Grant 签名用途与 key 隔离，不新增第四用途。
- standby_native：Native verifier 与 local-storage 实际 authority、授权 floor、runtime snapshot、Cloudflare 具名权限准入及相关测试。公开 `DesktopSyncRuntime::require_provider_capability(admission, capability)` 供 root 的 Afternic 拥有模块调用；权限集合必须已被当前精确授权与最终栅栏覆盖。后续扩展所有权到 Tauri Afternic 协调器、commands/capabilities/生成源和精确命令策略；不得修改 Afternic 业务/迁移、Renderer、Cloud/protocol。
- root：新 Afternic 业务、连接状态/绑定/观察/计划/结果/对账，唯一迁移 catalog，Host Afternic 组合，Tauri/Renderer/i18n 与公开导出；普通当前文档、最终检查与完整切片提交。
- device_architecture_review：构建 Afternic 迁移与按绑定读取投影（由 standby_cloud 独立评估）；独立评估 root 的业务/Host。standby_cloud 另独立评估 Native authority/组合与 Renderer；root 收敛公开面/最终检查。不得接受自身实现。

## 连接与库存的持久语义

- prepared 保留原授权摘要作为审计，重开由当前具名 Active 授权重新准入同一 incarnation/generation/proof 的 Native slot；只允许 load/readback 和完整只读 scan，不重新 capture 或覆盖缺失 slot。缺失/损坏进入 remediation，撤销后仅可 purge。
- 观察、资产创建及其 Outbox、Listing 绑定、原始所有权状态与完整扫描回执在单事务和最终授权栅栏下提交。空库存/全部跳过已删除资产只记录真实扫描回执，不伪造 target 或下架结果。
- 多连接观察按当前本地绑定 incarnation 分组；随机绑定 digest 不是远端稳定资源 ID。断连或代次变化后历史事实降为 unknown，包括上次观察到不存在的状态。
- 新连接准入使用设置页相同的可见容量；Native 确认 purge 后隐藏已清理连接，保留不可变 custody 历史、Listing 及资产事实。
- 连接、库存归集是当前可整合切片；父计划/批准/执行/未知结果对账及私有所有权验证尚须后续继续实现，不因本切片而视为完成。
