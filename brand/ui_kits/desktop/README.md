# GoodDealer Desktop UI Kit

桌面客户端（Tauri）核心界面。代码库 UI 为 Phase 0 占位，本 kit 按 `docs/UX_FLOWS.md` + `docs/PRODUCT_REQUIREMENTS.md` + `brand/` 规范首次实例化，非复刻。

Screens（index.html 内点击侧栏切换 / 点击资产行进入详情）:
- **接入 · Onboarding** Onboarding（`onboarding.html` 独立卡片；应用内可从 设置·连接「重新运行接入向导」启动）— 首次接入五步向导：欢迎 → 设备门禁（本地密钥签发 ActiveDeviceLease·Epoch 1，此设备设为 Active）→ 连接账户（注册商/DNS/交易平台，≥1）→ 首次导入（拉取 823 域名建立基线 rev 1）→ 完成。左竖向 Stepper（done 金勾 / current 金环 / upcoming）
- **资产库** AssetLibrary — KPI 总览 + 筛选（注册商 / 状态）+ 分页资产表；行内双击 BIN 编辑，离开提示「保存并同步」并写入未同步计数；选择→BatchBar（批量改价 / 修改 DNS / 上架 / 下架）或生成批量计划；点击行进入域名详情
- **设置** Settings — 连接（注册商/DNS/交易平台，已连接/需重新授权/未连接）；**设备与运行态**：ActiveDeviceLease 门禁——Active(金实心)/Standby(蓝空心)/激活中/排空中/Sunset·LocalContinuation(保留态·本地只读) 差异化视觉，移交执行权走确认仪式（排空→安全激活→Epoch 递增），联动状态栏 Active 设备与 Epoch；许可 / 同步偏好 / 关于
- **销售管理** SalesDesk — 变现闭环三 Tab：在售 Listing（改价/暂停/上架）· 报价·议价（买家 Offer vs BIN + Δ%，接受/还价/拒绝；接受走绑定确认仪式——报价→平台费→净收入 ack 门，生成托管交易）· 成交与交割（成交额/净收入 gold，托管中→待推送转移→已过户→已放款 进度，推送转移走不可逆 danger 仪式）。金只用于价值结果（估值/成交额/净收入/SOLD），过程报价用 body
- **续费** RenewDesk（从 资产库「60 天内到期」KPI 进入）— 批量续费到期域名：到期近远着色、剩余天数、逐域续费年限、自动续费开关、单价(body)/小计(gold)；BatchBar 统一年限 + 合计 vs 续费预算；确认仪式含预算余量与超预算警告（非阻断），续费为注册商操作并入 Outbox；未同步计数联动
- **DNS 与验证** DnsVerify — 跨域 DNS 健康 + 所有权总览：域名 × 所有权(已验证 gold / 待验证 / 失效) · Nameserver(指向 + 异常标红) · 记录(正常/告警/缺失) · 提供商 · 状态(正常/传播中/告警)；NS/记录/所有权三者区分（NS=注册商、记录=DNS 提供商、所有权=TXT _atomverify），修复分走对应处理平台的 NS/记录弹窗；重新验证待验证项；未同步计数联动
- **操作历史** HistoryLog — 只读 Revision 账本（追加不可篡改），主从：左账本表（rev/操作/平台/来源/条目/状态）+ 右明细（字段级 DiffValue）；**回滚生成新 Revision** 反向应用并入 Outbox（历史不删除、原 Revision 标记已回滚），含 Nameserver 的回滚走高风险确认仪式；未同步计数联动
- **批量差异预览** BatchPreview — 摘要层 / 分组层 / 明细层三层结构；高风险（Nameserver 变更）确认仪式（承认门 + 可跳过危险子集）→执行进度→部分失败结果
- **冲突中心** ConflictCenter — Base / Local / Remote 三方值对比与逐项裁决
- **人工任务收件箱** TaskInbox — 可完成 Checklist + 浏览器自动化交接状态条

组合自 `components/`（Table, BatchBar, Badge, StatusDot, Money, DiffValue, Tag, ProgressBar, Panel, KpiStat, Tabs, Dialog, Switch, Button, IconButton, Input, Select, Checkbox）。Kit-local 控件：`controls.jsx`（Pagination 分页 · EditableCell 行内编辑）、`dialogs.jsx`（批量改价「统一 / 按比例 / 逐个」· 修改 DNS「平台 NS / 自定义」含高风险承认门 · 上架）——均由 DS 组件组合、随 Babel 加载即时生效。功能图标为 Lucide 路径（见 readme ICONOGRAPHY）。
