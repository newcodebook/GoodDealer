# 正常交接后的目标设备首次安装与激活

基线 `a95dcdb`；完整任务见 [实施目标](../IMPLEMENTATION_GOAL.md)。来源签名证据/交接及目标取消已提交。本工作包交付无已初始化副本的目标客户旅程，不以 claim、签名或空库开关作为完成；已有副本替换、强制接管和独立恢复继续属于总目标。

## 客户结果与本地准入

在新机以 Standby 登录，确认一次接收本次普通交接；Native 持久化原操作身份，领取独立用途能力，下载并核验 Cloud 最后成功同步的完整资产/代次/墓碑，安装到本机加密库。完整安装及精确读回回执落盘后，提交重建摘要并激活已预留 epoch；未知响应先查询原操作，绝不重分配 epoch。取得匹配的 Active Grant 和新鲜执行上下文后展示资产，提示重新连接 Provider。旧平台凭据、绑定、Outbox 和可执行任务不转移。

首次安装仅准入可信 custody 证明尚未初始化的固定业务库，不替换任何已初始化库。跨平台 initialized/安装 marker 与 journal 区分合法崩溃前缀和缺失/截断，不能仅凭零长度判断 fresh。安装未完成的库不得作为普通 Standby 副本读取，也不得被普通 Active 刷新提前发布。取消/过期保留可核查原记录，不授执行能力、不删除既有业务数据。已有副本仍需 ADR-0023/0029 的生产替换合同和资格，不能隐式转为首次安装。

## 已检查源码与实际依赖

- 现有 bootstrap step/activation 持久表及事务可复用，但生产 crypto 仍拒绝；无 claim/nonce 生产者、无精确激活丢 ACK 回执，不能直接接 HTTP 后声称可用。
- Checkpoint Service 尚未生产组合，必须实际 build→readback verify→publish→pin；最终摘要必须使用 checkpoint state v3，覆盖 generation 和 tombstones，不能使用仅资产的旧摘要。
- Host 生产 rebootstrap 仍拒绝，测试 A/B executor 不作为首次安装实现；Windows CredWrite upsert 不是 create-only 恢复预留。首次安装复用本机已绑定、未初始化的业务文件和 key，不要求旧库替换 anchor，但不削弱既有库规则。
- 现有测试 replay parser 错拒 gen2 普通 edit/delete，且宽松 JSON 有重复键/nullable 缺失风险；具体安装 parser 必须使用严格 JSON 和 ADR-0029 规则，不能仅解除 test cfg。

## 冻结网络合同

新增路由均为 POST、精确当前目标；claim/step/checkpoint/activate 经 Active/Standby 会话准入。目标 status/cancel/receipt 仅经窄 bound_device 准入，核验当前会话/刷新族、安全代次、默认工作区、设备绑定与有效密钥，不要求历史能力仍有效；账户/个人默认工作区/设备/当前密钥/security epoch 仅服务端派生，普通来源设备不得读目标秘密或调用安装。未认证/撤销/跨租户使用既有拒绝语义。外层 schemaVersion 1；所有输入 unknown 严格验证。

1. `/v1/device-switch/bootstrap/claim`：请求 `{schemaVersion,requestId}`（2 KiB）；成功 `{schemaVersion,accepted:true,claim:{requestId,stepSchemaVersion:2,capability,pendingLeaseEpoch,workflowRevision,nextStep:{stepNumber:1,stepKind:'pin_checkpoint',stepNonce}}}`（16 KiB）。能力保持 `gd.bootstrap-capability.v1`，签名用途独立 `gooddealer.devices.bootstrap-capability.v1`。nonce 为 32 随机 bytes 的 canonical base64url。完整 envelope、原 claim response/digest、nonce digest 同事务保存；重放原响应，不重签、不重置时间或 nonce，不延长既有一小时期限。
2. `/v1/device-switch/bootstrap/step`：请求 `{schemaVersion,capability,step}`，成功 `{schemaVersion,accepted:true,result}`，各 1 MiB。现有 `bootstrapStep*` 合同直接升级 v2，不保留 v1 parser/兼容入口。公共 step 字段保持精确 request identity、nonce、expectedWorkflowRevision 和 digest。`pin_checkpoint` payload 严格 `{}`，checkpoint owner 在同一授权事务按冻结 head 选/建、读回验、发布及 pin；返回 `{checkpoint,pinExpiresAt,targetServerRevision,workspaceSchemaVersion,checkpointEntityDigests}`。`fetch_mutations` 保留精确 pinned checkpoint、revision 范围、cursor、pageLimit 1..256；返回现有严格 v3 mutation page。`submit_rebuild_digest` 为 `{targetServerRevision,workspaceSchemaVersion,entityDigests:checkpointEntityDigestsSchema}`；返回 `{verifiedRevision,workspaceSchemaVersion,verifiedDigest,accepted:true}`。
3. v2 semantic request/result digest 与完整 replay transcript 分别使用既有域名的 V2 后缀；request semantic digest 排除 nonce/requestDigest，完整 replay 必须覆盖全部字段。最终 verifiedDigest 为 SHA256(encodeCheckpointEntityDigestsInput(entityDigests))；Cloud 从冻结 head 的完整 checkpoint state 重算匹配。pin 返回的 target revision/schema 不可由客户端改写。原 64 KiB 持久限制通过追加迁移扩到 1 MiB，不改已应用 SQL。
4. `/v1/device-switch/bootstrap/checkpoint`：请求 `{schemaVersion,requestId,capability,checkpointId,checkpointDigest,entityType,partitionId,offset,pageLimit}`（16 KiB）；entityType 仅 domain_asset/domain_asset_tombstone，partition 必须属于已 pin manifest，offset 0..512、pageLimit 1..256。成功 `{schemaVersion,accepted:true,page:{requestId,checkpointId,checkpointDigest,entityType,partitionId,offset,totalRows,nextOffset,rows,pageDigest}}`（1 MiB）。rows 按 entityType 严格解析。pageDigest 为去掉自身后的 page 在 `GOODDEALER-BOOTSTRAP-CHECKPOINT-PAGE-V1` 域的 SHA256。Native 核验每页、全局 UTF8 排序、完整分区与最终 manifest/checkpoint 摘要；空 empty 分区仅 offset0/totalRows0/rows[]/nextOffset null。只读同 pin，不推进 nonce/revision。
5. `/v1/device-switch/bootstrap/activate`：请求 `{schemaVersion,requestId,capability,activationId,expectedWorkflowRevision,pendingLeaseEpoch,targetServerRevision,workspaceSchemaVersion,verifiedRebuildDigest,requestDigest}`（16 KiB）。activationId 由 Native 在首次准备时持久生成 UUID。requestDigest 在 `GOODDEALER-BOOTSTRAP-ACTIVATION-REQUEST-V1` 域覆盖去掉自身、将 capability 替换为 canonical envelope SHA256 的字段。成功 `{schemaVersion,accepted:true,receipt:{requestId,activationId,requestDigest,workflowRevision,status:'completed',pendingLeaseEpoch,targetServerRevision,workspaceSchemaVersion,verifiedRebuildDigest,cursorGeneration,lease}}`（16 KiB）。既有 activation_attempts 保存完整原请求/响应，精确重放返回原 receipt；不同内容冲突，不能重签或再分配。Lease 仍独立验签；身份、授权和期限在同事务最终栅栏复核。
6. `/v1/device-switch/bootstrap/receipt`：请求 `{schemaVersion,requestId,operation}`（16 KiB），operation 为 `{kind:'claim'}`、`{kind:'step',stepNumber,requestDigest,replayDigest}` 或 `{kind:'activate',activationId,requestDigest}`。step replayDigest 是完整 v2 replay transcript SHA256。精确目标会话可读原操作，不要求仍有效 capability；响应（1 MiB）区分 not_found/conflict，或带 `{requestId,status,workflowRevision}` 的 workflow 与 outcome committed/uncommitted/terminal。committed 附原 kind 的 claim/result/activation receipt；仅原操作未提交且 workflow bootstrapping 时 uncommitted，并返回 nextStepNumber/nextStepKind 而不另发 nonce；无回执且已终结返回 terminal。终态即使有历史回执也不得继续旧 nonce。未知结果一律查精确身份，只有 uncommitted 才重发原字节。

每个 mutation/checkpoint 页按照实际 UTF8 字节动态取连续前缀，数据预算 896 KiB、完整 response/receipt <=1 MiB，不假定 256 行总能装下。checkpoint digest 清单保持原 4096 上限。业务拒绝封闭为 CAPABILITY_INVALID、BOOTSTRAP_CONFLICT、BOOTSTRAP_EXPIRED、CHECKPOINT_UNAVAILABLE、ENTITLEMENT_INACTIVE、SIGNING_UNAVAILABLE；不得泄露原异常/签名材料。receipt conflict 使用其明确 outcome。

## 所有权、实现次序和共享面

- standby_cloud：protocol 的目标安装 wire/v2/generator/tests；Cloud devices/checkpoints/portfolio/identity/licensing 的具名同事务端口、claim/step/receipt/activation、生产 checkpoint、追加迁移及模块测试。只能经声明 exports/ports 跨模块。首次先交付 strict schema/type 和 signer/public service 接口供相邻 owner 使用，随后实现完整事务，不把接口当结果。
- device_architecture_review：local-storage 首次安装持久 journal、严格 wire、完整投影验证/单 writer 业务安装、持久回执、原 publication 栅栏；Unix/Windows 固定本机 custody 首次安装准入与恢复。公开 Host API 先通知 root/Native，lib 导出由该 owner 收敛；不创建通用下载或数据库代理。
- standby_native：固定 Native transport/首次安装协调器、独立后台阶段、secure-host-core 第五用途公钥校验；Windows 所需同范围实际源码与目标编译。共享 main/commands/sync lane 先把最小接口交 root，避免同时修改。
- root：Cloud HTTP/ports/composition、OpenBao 第五独立用途及 registry、Tauri command/main/capability/adapter、客户入口/i18n、策略、ADR 与当前文档、迁移 catalog 及最终收敛。迁移编号由 Cloud owner 与 root 确认。
- 无源码或 Cargo target 共享写冲突；main target 由 Storage 起先独占至编译和测试全部结束，再显式交接。生成物改源后生成；不提交未属于此切片的其他工作。

Native 只拿 Host 返回的不透明、固定用途 exchange 与脱敏 view，所有 capsule/nonce/原请求/恢复材料在 Native custody；Renderer 仅 start/status/cancel，不传路径/key/capability/任意 URL。Host 先 stage 慢验签/custody/SQL，再在短 power/session/publication 栅栏发布；不能让普通刷新抢先暴露未完成安装。目标开始确认绑定精确 workflow；重复确认不创建另一计划。

激活已提交但 ACK 丢失的重开必须覆盖“先收到 Active Grant，再查询原 activation receipt”：精确匹配持久 pending activation 的身份可以进入专用目标控制准入，仅放行 receipt/status/cancel；普通业务库、同步与 Provider 仍拒绝。客户状态为 target_installation_pending。回执与当前 Active Grant、fresh context 全部匹配后才开放业务并持久完成；不得依赖旧 Standby 授权仍有效。

## 本地验收、独立审查与资格

完整非空资产和墓碑/删除重加旅程；关闭重开每个持久化/网络窗口；claim/各 step/activation 丢 ACK 后精确回执对账；未知结果不改身份/重分配 epoch；错用途/租户/目标/key/security epoch、撤销、过期、并发 cancel/step/activate、大小/重复键/排序/缺页/错 digest 全部拒绝。gen2 后续普通 edit/delete 合法，错误 resurrection 拒绝。安装没有旧 Provider 凭据、绑定、可执行队列或 echo Outbox。

Cloud 与 root 分别在真实 PostgreSQL 验证，Storage 用真实 SQLCipher 验证持久状态和重开。构建者不可接受自己：root 复审 Cloud/Storage，Cloud 复审 Native/UI，Native/Storage 交叉检查初装边界。最终全仓检查 `pnpm check`、严格 Clippy/格式、术语/链接/公开面检查、文档与完整切片提交。

Windows/macOS 实机、已部署 OpenBao 第五用途、真实双设备及 Provider、签名/公证/发行证据分别取证；目标编译和 fixture 签名不等于实机/部署资格。外部缺失不阻止不依赖它的实现，但绝不通过空 manifest、测试 executor 或开放资格开关宣称交付。
