# GoodDealer Desktop UI Kit

桌面客户端（Tauri）核心界面。代码库 UI 为 Phase 0 占位，本 kit 按 `docs/UX_FLOWS.md` + `docs/PRODUCT_REQUIREMENTS.md` + `brand/` 规范首次实例化，非复刻。

Screens（index.html 内点击侧栏切换 / 点击资产行进入详情）:
- **接入 · Onboarding** Onboarding（`onboarding.html` 独立卡片；应用内可从 设置·连接「重新运行接入向导」启动）— 首次接入五步向导：欢迎 → 设备门禁（本地密钥签发 ActiveDeviceLease·Epoch 1，此设备设为 Active）→ 连接账户（注册商/DNS/交易平台，≥1）→ 首次导入（拉取 823 域名建立基线 rev 1）→ 完成。左竖向 Stepper（done 金勾 / current 金环 / upcoming）
- **资产库** AssetLibrary — KPI 总览 + 筛选（注册商 / 状态）+ 分页资产表；行内双击 BIN 编辑，离开提示「保存并同步」并写入未同步计数；选择→BatchBar（批量改价 / 修改 DNS / 上架 / 下架）或生成批量计划；点击行进入域名详情
- **设置** Settings — 连接（注册商/DNS/交易平台，已连接/需重新授权/未连接）；**一平台多账号一等**（PRD §2 · CONNECTORS.md：`ProviderConnection` = 每个「平台账号/连接」，同一 Provider 可多账户）——交易平台按账号列行，每行=一个 ProviderConnection，显示 账户别名 + 远端账户 ID + **独立凭据健康** + 方法 + **独立限流** + 独立浏览器 Profile，支持「新增账户连接」；Atom 演示挂 主账户 + 子账户 B（凭据健康各自独立）；**连接建立走浏览器交接**（`BrowserHandoff.jsx` · J-02/03/04 · UX_FLOWS §5）——点「连接」先出 **BrowserSessionConsent**（只说明 ProviderConnection/官方 Host/用途/会话模式/到期，软件只检测 Origin+登录态、绝不读取回传 Key·密码·2FA·CAPTCHA，不选域名不生成计划）→ Remote 登录（用户操作）→ **Rust Host 原生秘密输入面**（API Key 由用户粘贴，标注「浏览器与自动化软件无法读取、仅本地密钥加密保存永不上云」，视觉刻意区别于 web 面板）；**设备与运行态**：ActiveDeviceLease 门禁——Active(金实心)/Standby(蓝空心)/激活中/排空中/Sunset·LocalContinuation(保留态·本地只读) 差异化视觉，移交执行权走确认仪式（排空→安全激活→Epoch 递增），联动状态栏 Active 设备与 Epoch；**强制切换**（`ForcedSwitch.jsx` · J-05）——旧设备不可达时申请，danger 承认门后进入**隔离倒计时**（≤24h · 显示旧设备最后在线 / 最早接管时间 / `offline_execute_until`），隔离期暂停 修改·批准·平台访问但 Cloud Read-Only View 保持，预估接管后进入恢复中心的旧修改规模，并提供等待期紧急人工兜底（纯人工窗口·不自动提交·「已处理」不标记成功·接管后经平台读取对账）；Standby 只读变体见下文；许可 / 同步偏好 / 关于
- **销售管理** SalesDesk — 变现闭环三 Tab：在售 Listing（改价/暂停/上架）· 报价·议价（买家 Offer vs BIN + Δ%，接受/还价/拒绝；接受走绑定确认仪式——报价→平台费→净收入 ack 门，生成托管交易）· 成交与交割（成交额/净收入 gold，托管中→待推送转移→已过户→已放款 进度，推送转移走不可逆 danger 仪式）。金只用于价值结果（估值/成交额/净收入/SOLD），过程报价用 body
- **续费** RenewDesk（从 资产库「60 天内到期」KPI 进入）— 批量续费到期域名：到期近远着色、剩余天数、逐域续费年限、自动续费开关、单价(body)/小计(gold)；BatchBar 统一年限 + 合计 vs 续费预算；确认仪式含预算余量与超预算警告（非阻断），续费为注册商操作并入 Outbox；未同步计数联动
- **DNS 与验证** DnsVerify — 跨域 DNS 健康 + 所有权总览：域名 × 所有权(已验证 gold / 待验证 / 失效) · Nameserver(指向 + 异常标红) · 记录(正常/告警/缺失) · 提供商 · 状态(正常/传播中/告警)；NS/记录/所有权三者区分（NS=注册商、记录=DNS 提供商、所有权=TXT _atomverify），修复分走对应处理平台的 NS/记录弹窗；重新验证待验证项；未同步计数联动
- **操作历史** HistoryLog — 只读 Revision 账本（追加不可篡改），主从：左账本表（rev/操作/平台/来源/条目/状态）+ 右明细（字段级 DiffValue）；**回滚生成新 Revision** 反向应用并入 Outbox（历史不删除、原 Revision 标记已回滚），含 Nameserver 的回滚走高风险确认仪式；未同步计数联动
- **批量差异预览** BatchPreview — 摘要层 / 分组层 / 明细层三层结构；高风险（Nameserver 变更）确认仪式（承认门 + 可跳过危险子集）→执行进度→部分失败结果
- **冲突中心** ConflictCenter — Base / Local / Remote 三方值对比与逐项裁决
- **恢复中心** RecoveryCenter（J-05 + J-07 · UX_FLOWS §6）— 三个**刻意不合并**的来源分 Tab：**设备候选** StaleDeviceCandidate（旧设备/旧 Epoch 未能合并的编辑）· **备份候选** RestoreCandidate（备份时间 + Revision 的字段差异）· **迟到执行事实** LateExecutionEvent（旧 Epoch 已发生的执行结果，**追加不可篡改·只读·不进入可丢弃候选**，同时见操作历史/审计时间线）。候选走 原始基线 Base / 候选值 Candidate / 当前云端 Cloud 三方裁决；选择候选=在**当前 Revision 生成新修改**（非静默覆盖），高风险字段（如 Nameserver）danger 应用 + **不参与批量恢复**；备份候选说明云端不可用时只能在隔离只读区查看；未同步计数联动
- **人工任务收件箱** TaskInbox — 可完成 Checklist + 浏览器自动化交接状态条；「授权执行」先出 **BrowserAutomationGrant**（`BrowserHandoff.jsx`，与连接用的 BrowserSessionConsent **严格区分**）——展示已确认的操作计划（N 项/平台/账户/允许 Host），授权软件在允许 Host 内点击·填写·上传 CSV·读结果，说明密码/2FA/CAPTCHA 自动切用户操作、提交前回本地确认、可随时暂停接管，承认门后才进入软件执行
- **资产保护 · 紧急下架** EmergencyDelisting（J-04 · 导航「执行 / 资产保护」danger 计数进入）— Active 设备在用户主动刷新/既有已批准平台读取中形成 SaleSignal → 建立 EmergencyDelistingIncident：事件头展示售出来源与「首版不后台轮询/无人值守」免责说明；**Priority-0 下架计划**枚举全部已知 Listing，**逐次批准·一次执行一项**（API 走 danger「批准并下架」，无 API 平台走「打开官网手工下架 → 重新检查」）；区分 confirmed / 远端等待确认 / 结果未知（只能检查·不重试）/ 可重试等操作态；仅全部确认关闭，或走 danger「接受残余风险并关闭」仪式（列未确认项 + 承认门 + 写审计）。取消某项 ≠ 关闭事件；手工下架不被冲突合并自动重新上架；未同步计数联动

**账户门禁卡片**（独立 HTML，非 index.html 内切换）:
- **账户登录** `signin.html` → `SignIn.jsx`（登录 / 注册 / 邮箱验证 / 找回密码 → 串接设备门禁）
- **接入向导** `onboarding.html` → `Onboarding.jsx`（五步接入）
- **账户已锁定** `locked.html` → `LockedGate.jsx`（J-06 · PRD §7 / UX_FLOWS §6）— 订阅 + 离线宽限均结束后的门禁：不显示业务主界面，仅 `续费` / `切换账号` / `退出`；展示 License / 到期 / 离线宽限（已结束）/ 访问状态；明示「本地数据不删除、续费后恢复，锁定期间不提供客户端只读 / 导出 / 紧急下架例外」；并说明账号网页端的导出 / 删除 / 会话·设备安全管理不受锁定影响。zh·en 双语。

**全局壳层运行态**（`Shell.jsx`）:
- **Standby 云端只读模式** `role="standby"`（J-05 · PRD 3.6 / UX_FLOWS §6）— 本机为 Standby 时整应用进入 Cloud Read-Only View：顶部常驻只读 banner（`只读视图 · 数据来自 GoodDealer Cloud · 截至 rev/时间 · 最后平台读取`，从不暗示刚从平台刷新；活动设备有未同步修改时显示其数量；右侧「切换为此设备执行」是唯一放行的变更入口）；工作区加只读 scrim（`.gd-readonly` 整体 `pointer-events:none` 保留滚动，变更类主操作 primary/gold/danger 降透明明确禁用，BatchBar 隐藏）；刷新平台按钮禁用；状态栏本机显示 Standby（蓝空心）、`只读缓存`、`云端截至`。设置·连接改为只显示**非秘密本机配置标记**（`曾配置候选` / `从未配置`，注「未验证，切换为 Active 后才能检查」），不读取 Keychain/Browser Profile/凭据值、不发起健康检查、不显示 live 连接态。状态栏本机角色段可点击切换 Active↔Standby（演示）。
- **三轴网络状态** `NetworkStatus.jsx`（跨旅程 · PRD §5 / UX_FLOWS §6）— 网络能力按 **设备基础网络 · GoodDealer Cloud · 每个目标 Provider** 三条独立轴判定。状态栏常驻三轴簇（`设备 · Cloud · 平台 N/M`，降级时显示「离线窗 mm:ss」），点击展开明细弹层（逐 Provider + 离线执行窗口 + 最严交集下的可执行/已暂停）；降级时工作区顶部浮现 `NetworkBanner`，**同时列出全部故障原因**（设备断网 danger / Cloud 不可达 warning + 离线执行窗口 ≤24h / 某 Provider 不可达 warning），权限取最严格交集，绝不以 Cloud 状态掩盖设备或平台故障。弹层内含「预览场景」切换（正常 / 设备断网 / Cloud 不可达 / 平台不可达 / 组合故障）。

组合自 `components/`（Table, BatchBar, Badge, StatusDot, Money, DiffValue, Tag, ProgressBar, Panel, KpiStat, Tabs, Dialog, Switch, Button, IconButton, Input, Select, Checkbox）。Kit-local 控件：`controls.jsx`（Pagination 分页 · EditableCell 行内编辑 · MetricStrip 指标带）、`NetworkStatus.jsx`（三轴网络状态簇 + 降级 banner）、`dialogs.jsx`（批量改价「统一 / 按比例 / 逐个」· 修改 DNS「平台 NS / 自定义」含高风险承认门 · 上架）——均由 DS 组件组合、随 Babel 加载即时生效。功能图标为 Lucide 路径（见 readme ICONOGRAPHY）。
