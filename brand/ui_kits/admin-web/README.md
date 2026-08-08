# admin-web — GoodDealer 运营后台 UI Kit

内部 **Owner / Staff** 控制台的界面套件。与用户面的 `account-web` 是**两套完全独立的表面**：
不同身份体系（StaffIdentity，绝不复用用户账户会话）、不同视觉（金色顶栏 accent + `ADMIN · STAFF` 标记）、
不同权限模型（读明细即受控、逐次授权）。

## 运行方式
和其他 kit 一致：React 18 UMD + 浏览器内 Babel（`type="text/babel"`），DS 组件来自预构建的
`../../_ds_bundle.js`（`window.GoodDealerDesignSystem_b5b0b6`），tokens 来自 `../../styles.css`。
无构建工具。打开 `index.html` 即可预览。

每个屏挂到一个 `window.ADMxxx` 全局，由 `index.html` 的 `<script>` 顺序加载，`App` 路由 + `boot()` 守卫。

## 核心红线（编码进界面，不是装饰）
- **Passkey-only 门禁，失败关闭**：`AdminGate` 只签发单一 Owner 身份；丢失 Passkey 不提供邮箱找回 / 隐式 Break Glass。
- **独立 Staff 身份**：绝不复用用户账户会话；Role/Scope 结构预留，未来加 Staff 时再启用职责分离。
- **读明细即受控**：跨账号读取任何业务明细，必须走 **AdminReadAuthorization** 仪式
  （Scope 勾选 + 理由 + **AdminPurposeRef**〔支持工单/数据权利/安全事件 + Ref ID〕+ 新鲜 Passkey 重认证），
  确认按钮在四项齐备前禁用。授权**每次读取复验，不能兑换为修改授权**。
- **管理员永不可读平台凭据**：平台 API 凭据 / 密钥 / 备份秘密**不在后台字段内**——明细页对此显式声明。
- **读 ≠ 改**：修改类动作需 **AdminActionAuthorization + Repair dry-run + 高风险 Passkey**（B 阶段落地）。
- **受控管理 Port**：无任意 SQL / 直接 Repository 编辑（footer 常驻声明）。

### 读授权 vs 写授权（两套独立仪式，互不兑换）
- **AdminReadAuthorization**（读）：Scope + 理由 + AdminPurposeRef + 新鲜 Passkey → 展开只读明细。每次读取复验。
- **AdminActionAuthorization**（写，`ActionAuth.jsx`）：任何修改必须走 ① 参数 → ② **Repair dry-run**（计算 before→after 差异与副作用，**不提交**，先审后行）→ ③ 理由 + AdminPurposeRef + **高风险 Passkey** → 提交（受控 Repair 执行、追加审计）。**读授权不能兑换为写授权**；写授权仅本次动作有效。

### 目的限定（Purpose limitation）
每次读/写授权都要引用一个 **AdminPurposeRef**（支持工单 / 数据权利 / 安全事件 + Ref ID）。目的类型决定可读 Scope
与可执行动作——**目的不可挪用**：支持工单读不到安全内幕、删不了数据；数据权利能导出/删除但碰不了计费与设备；
安全事件能处置设备/会话、但删不了数据。矩阵见「案件」页 `Cases.jsx`。案件即 PurposeRef 的载体。

## 界面（全阶段完成）
| 全局 | 文件 | 说明 |
|---|---|---|
| `ADMGate` | `AdminGate.jsx` | Owner Passkey 登录门禁；失败关闭说明。 |
| `ADMShell` | `AdminShell.jsx` | 后台外壳：金色顶栏 + STAFF chip + Owner 身份/Passkey 新鲜度 + 左导航 + 红线 footer。 |
| `ADMOverview` | `Overview.jsx` | 概览：平台健康 Stat 带（Cloud SLO / 待处理案件 / 隔离区 / Active Lease / 待同步 Mutation）+ 案件列表 + 作业健康 + 账号查找入口。 |
| `ADMAccounts` | `Accounts.jsx` | **关键屏**：账号列表 → 详情。固定金色上下文头（目标账号 / Tenant / 当前 Scope / AdminPurposeRef）；读明细先过 AdminReadAuthorization；授权后展示只读 Entitlement/Revision/watermark、设备 ActiveDeviceLease、安全 epoch、Entitlement 事件。**管理动作**区（读明细≠可改）：手动调整 Entitlement / 强制移除设备，各自开 AdminActionAuthorization。 |
| `ADMActionAuth` | `ActionAuth.jsx` | 可复用**写仪式**。kind=`entitlement`（ManualEntitlementAdjustment：延长商业到期 / 调整设备名额 / 补偿性延期）或 `device`（强制移除设备）。三步：参数 → Repair dry-run 差异预览 → 理由/PurposeRef/高风险 Passkey → 提交成功态（Repair 已排队、Revision+1、已通知用户、绑定 PurposeRef、不兑换读授权）。 |
| `ADMLicensing` | `Licensing.jsx` | **License 与订单**：全局账务与 Entitlement 台账（只读对账）。Stat（本月入账/退款/拒付/手动调整/待对账）+ ProviderPaymentEvent 账务事件（购买/续费/退款/拒付、Paddle ref、Revision、金额、账号钻取）+ **手动调整审计**（ManualEntitlementAdjustment，追加不可改）。Paddle 为 MoR，不接触卡号；批量改动一律禁止，调整走账号详情。 |
| `ADMCases` | `Cases.jsx` | **案件**：DataRightsRequest / SecurityIncident / SupportCase 列表 + 详情（状态机时间线、本案 PurposeRef 授权/拒绝范围、数据删除冷静期、办理与账号钻取）。底部 **AdminPurposeRef 矩阵**（目的×可读 Scope/可执行动作，allow/limited/deny）——目的限定的显式表达。案件推进需理由 + Passkey；触及业务数据/设备的动作路由到账号详情引用本案执行。 |
| `ADMJobs` | `Jobs.jsx` | **Jobs 与隔离区**：受控执行健康（Active Lease / 心跳 / 幂等键 / 重放拦截 / 陈旧 Lease）+ 毒任务隔离区。处置对话框按提交边界分类（safe_retry / outcome_unknown / non_idempotent）：**重新入队仅限 safe_retry**，结果未知/非幂等禁用（防平台侧重复下单）；冻结人工核对 / 终态丢弃为安全路径。每次处置需理由 + Passkey + 审计。镜像桌面崩溃恢复扫描哲学。 |
| `ADMDiagnostics` | `Diagnostics.jsx` | **同步诊断**（只读）：Lease/Mutation/Cursor/Checkpoint/Candidate/LateExecution 观测——ActiveDeviceLease、per-device Cursor lag、Checkpoint、StaleDeviceCandidate/RestoreCandidate（高风险、三路比对、不可批量、经受控 Repair）、LateExecutionEvent（追加只读，幂等去重未重复下单）。协调动作不在此执行。 |
| `ADMRelease` | `Release.jsx` | **发布与政策**：客户端发布通道（稳定/Beta、最低支持门槛、灰度）+ **网络政策（桌面端三轴的 Cloud 轴与 Provider 轴来源）**。云端/平台自动化暂停即三轴收紧——高影响，走发布仪式（影响面预览 + 理由 + PurposeRef + 高风险 Passkey）→ 追加政策发布记录。暂停仅停自动化，不改凭据、不登出用户。 |
| `ADMAudit` | `Audit.jsx` | **审计**（追加不可改）：读授权/写动作/案件/作业处置/政策发布全留痕，按类型过滤；每条绑定 AdminPurposeRef 可回溯。凭据/密钥/备份秘密从不出现在明细里。 |
| — | `data.js` | `window.ADM_DATA`：staff、accounts[5]、detail、`licensing`、`cases[3]`、`purposeMatrix`、`jobs`、`diagnostics`、`release`、`audit`、health。 |

所有导航项均已实装，无占位 Stub。admin-web 全阶段完成——`brand/` 设计系统（desktop + account-web + admin-web）已覆盖 MVP 全部产品旅程。
