# GoodDealer Design System

> **边界声明**：`brand/` 目录是品牌与界面设计的事实源和参考实现，不属于产品代码，不参与任何构建。目录内的组件、UI kit 与样式仅供设计对照；生产组件的归属是 `packages/ui` 与各 App 的 `src/`，设计向产品目录的迁移是后续工作。

GoodDealer 是一款「本地执行、云端同步」的域名资产管理桌面客户端（Tauri）：域名投资人在一个界面统一管理分散在多个注册商（Spaceship）、DNS（Cloudflare）和交易平台（Atom、Afternic、SellerHub）的资产——注册信息、DNS、价格、销售状态、所有权验证、批量操作。最多两台绑定设备，单活动设备持有执行权（Active 金实心点 / Standby 蓝空心点）；平台凭据永不上云。

**视觉气质**：私人银行终端 / 硬件钱包，而非通用 SaaS。资产感（金）、掌控感（黑）、安全感（蓝）。中文优先（zh-CN 默认 locale），en-US 其次。

## Sources

- Codebase: `GoodDealer/` monorepo（本地挂载，只读）。UI 代码为 Phase 0 脚手架（`apps/desktop`、`apps/account-web`、`apps/admin-web`、`packages/ui` 均为占位）——**`brand/` 目录与 `docs/` 是设计事实源**：
  - `brand/README.md` 品牌视觉规范（色彩 70/20/10、金色分层、红线）
  - `brand/guidelines/coin-seal-spec.html` 主标制图规范（「圩印 Coin Seal」：外圆内方 + 骑缝）
  - `brand/tokens/*.css` 官方 token（`--gd-*`；base / colors / typography / spacing / motion / fonts / hierarchy）
  - 风格对标：Linear 工艺 / Carbon 密度 / Kraken 表格 / Mercury 文案 / Amex 金色纪律（散见本文各节）
  - `docs/UX_FLOWS.md`、`docs/PRODUCT_REQUIREMENTS.md`、`docs/GLOSSARY.md`、`docs/USER_JOURNEYS.md` 界面流程与术语
- 无 Figma、无成品 UI 截图。UI kit 屏幕是按上述文档首次实例化，非对既有界面的复刻。

## CONTENT FUNDAMENTALS

- **语气**：Mercury 式克制——安静、精确、不营销。陈述事实与数量，不感叹（全库无"！"）。"金越少越贵"同样适用于文案：短句、名词化标题（"批量差异预览""冲突中心""人工任务收件箱"）。
- **精确数字是尊重**：确认按钮永远带实际数量（"将提交 823 项修改"），禁止只写"确定"的模糊按钮。数量、时间、Revision 常驻可见（"未同步修改 3 · 最后同步 14:02"）。
- **中英混排**：产品术语保留英文原词并首字母大写或全大写：`Active` / `Standby` / `Revision` / `Outbox` / `Epoch` / `License` / `BIN`；状态徽章用全大写等宽（`SYNCED`）。中文与英文/数字之间留一个空格宽的呼吸（排版由字体处理，文案不强制加空格）。
- **人称**：对用户用"您"不常见——直接祈使或描述（"选择域名后生成计划""旧设备排空后……"）。系统自述用产品名（"数据来自 GoodDealer Cloud"）。
- **安全与风险文案**：说明为什么与后果，不吓唬。危险操作按三档视觉分级（常规蓝 / 需留意橙 / 高风险红）；高风险（Nameserver 变更[注册商处理]、Sold 覆盖）走确认仪式——陈述后果 + 精确数量入按钮 + 承认门解锁危险主操作 + 提供「仅提交常规·跳过危险子集」出口，并给出回滚路径。区分 NS 与 DNS 记录：Nameserver 变更由注册商处理（高风险），DNS 记录（A/CNAME/TXT/MX）由 DNS 提供商即时下发（需留意档，说明影响即可）。规范见 `guidelines/risk-confirmation.html`，实例见桌面 UI kit 批量执行确认。
- **无 emoji**。状态一律用色点、徽章、图标表达。
- 示例（来自 docs）："只读视图始终显示'数据来自 GoodDealer Cloud'、云端数据截至时间"；"'重试失败项'只选择 failed_retryable，不会重提成功项"。

## VISUAL FOUNDATIONS

- **色彩 70/20/10**：黑是舞台（`#0A0B0F` 墨黑带蓝偏，禁纯黑）、金是主角（≤20%，越少越贵）、蓝是工作人员（系统语言）。面板 `#10131A`，描线 `#1E2230`。
- **金色分层（核心决策）**：品牌层 = 105° 流沙金渐变（`#F2D488→#D4A437→#8A671D`），只用于 Logo ≥48px、开屏、徽章、营销；功能层 = 纯色 `#D4A437`，界面内一切估值数字、图标、描边。红线：禁高饱和纯金 `#FFD700`；金蓝不混渐变（唯一例外：数据可视化"投入→增值"序列）；蓝永远哑光（蓝一上渐变/辉光即塌成 Web3）；金不做大面积填充与正文。
- **文本**：雾白 `#EAE8E1`（非纯白）、次级 `#8D93A3`。估值/金额 = 本色金 + `tabular-nums` 等宽。
- **字体**：西文几何无衬线 General Sans（brand 方向：Aeonik / General Sans / Neue Haas；明确避免 Inter/Space Grotesk）；数字/代码 JetBrains Mono；中文 MiSans/HarmonyOS Sans 方向，CDN 以 Noto Sans SC 代替。UI 基准 13px；表头 11px 大写 +0.08em 字距。
- **层次**：Linear 式——用描线色阶（`--gd-line` → `--gd-line-strong`）与面板色阶构建层次，不用透明度叠层。阴影安静（overlay 才有大阴影）。数据表面（表格/表单/diff）完全不透明；半透明 + 低强度 blur 仅限壳层（侧边栏、命令面板、模态遮罩）。
- **圆角**：小而克制——按钮/输入 5px、卡片 7px、对话框 10px、药丸 999px。原生桌面感，非 Web 圆润。
- **动效**：克制。120–160ms ease-out 淡入/2px 位移；无弹跳、无弹簧。悬停 = 面板提亮一档（`--gd-panel-raised`）或描线变亮；按下 = 颜色加深（蓝 `#2F62D8`），不缩放。系统级时长/缓动用 `--dur-fast/-base/-slow` 与 `--ease-out`（`tokens/spacing.css`）；`tokens/motion.css` 仅承载品牌层（`--gd-motion-*` 时长、`--gd-ease-*` 缓动）。**品牌动效**（开屏/成交/绑定/解锁/交权，从 Coin Seal 长出）另属「可表现」层：绑定类 `.gd-strike/.gd-seam/.gd-ripple/.gd-spin/.gd-gilt/.gd-draw/.gd-unlock/.gd-failover` + `--gd-motion-*` token，规范见 `guidelines/brand-motion.html`；`prefers-reduced-motion` 自动关闭品牌层、保留系统 transition。品牌华彩绝不泄进密集数据界面。
- **焦点态**：清晰的 2px 蓝色 ring（键盘优先，Raycast/Linear 心智）。
- **卡片**：`--gd-panel` 底 + 1px `--gd-line` 描边 + 7px 圆角 + 微阴影；禁"彩色左边框卡片"模式。
- **数据可视化**：蓝 = 投入/过程，金 = 增值/结果，灰 `#6E7482` = 回撤/中性；辅助线/基线用描线色；数据标签等宽字体。
- **语义扩展色**（本系统新增，见 Intentional additions）：成功 `#5CAE7D`、危险 `#E5735F`、警告 `#E08A48`——哑光、深底可读、与金保持距离。
- **界面语义**：同步状态 = 蓝色药丸（`SYNCED`）；执行权 = 金实心点，Standby = 蓝空心点；估值 = 金色等宽数字。
- **Standby 云端只读模式**：本机为 Standby 时整应用进入 Cloud Read-Only View——常驻「数据来自 GoodDealer Cloud · 截至 rev/时间」只读 banner（从不暗示刚从平台刷新）、变更类主操作明确禁用、刷新平台禁用、状态栏显示只读缓存；仅「切换为此设备执行」放行。连接页只显示非秘密本机标记（`曾配置候选`/`从未配置` + 「未验证，切换 Active 后才能检查」），不读取 Keychain/Browser Profile/凭据值、不发起健康检查。实现见 `ui_kits/desktop/Shell.jsx`（`role`）与 `SettingsPanel.jsx`。
- **三轴网络状态**：网络能力按 **设备基础网络 · GoodDealer Cloud · 每个目标 Provider** 三条独立轴判定（绿=可达 / 橙=降级或离线执行窗口 / 红=不可达）。状态栏常驻三轴簇，降级时工作区顶部 banner 同时列出全部故障原因、权限取最严格交集，绝不以 Cloud 状态掩盖设备或平台故障；仅 Cloud 不可达且 Provider 可达时显示签名离线执行窗口（≤24h）。实现见 `ui_kits/desktop/NetworkStatus.jsx`。

## INFORMATION HIERARCHY（信息层级规范 · 系统性）

一套封闭、可执行的层级系统，横跨**文字 / 颜色 / 组件 / 页面**四个尺度。规则：任何元素通过下述「角色」表达层级——不手动定字号、不用临时灰值。规范源：`tokens/hierarchy.css`；specimen：`guidelines/hierarchy.html`（文本角色）、`emphasis.html`（注意力阶梯）、`layering.html`（高度阶梯）、`page-zoning.html`（页面分区）。

### 1) 文字 — 封闭文本角色集（9 个，全局 class）
| 角色 | class | 规格 | 用途 |
| --- | --- | --- | --- |
| display | `.gd-t-display` | 40/600 -0.01em · text-1 | 仅营销/开屏 |
| title | `.gd-t-title` | 20/600 · text-1 | 页/视图标题 |
| section | `.gd-t-section` | 16/600 · text-1 | 区块标题 |
| panel | `.gd-t-panel` | 14/600 · text-1 | 面板标题 |
| label | `.gd-t-label` | 11/500 +0.08em UPPER · text-2 | 表头/字段名/KPI 标签 |
| body / body-2 | `.gd-t-body(-2)` | 13/400 · text-1 / text-2 | 正文 / 次要正文 |
| meta | `.gd-t-meta` | 11/400 · text-3 | 时间戳/ID/提示/占位 |
| metric / metric-sm | `.gd-t-metric(-sm)` | 28 / 16 · mono tabular | KPI 数字 / 行内值 |
| code | `.gd-t-code` | 12/400 · mono · text-2 | 记录/域名/ID |

### 2) 颜色 — 中性明度阶 + 单义强调
- **中性明度阶（结构，无语义）**：ink `#0A0B0F` → panel `#10131A` → raised `#14171F` → line `#1E2230` → line-strong `#2A3040` → text-3 `#5C6272` → text-2 `#8D93A3` → text-1 `#EAE8E1`。层次靠此阶推进。
- **文本 3 级**：`--text-1/2/3`（主/次/三）。禁用/更弱 = text-3 + opacity。
- **单义强调（一色一义）**：`--emphasis-value`(金)=金额/所有权/品牌时刻；`--emphasis-system`(蓝)=交互/同步/链接。状态另属：success/warning/danger（语义，非装饰）。金占比 ≤20%。

### 3) 组件 — 每个原语映射到角色 + 注意力档（E1 响→E4 静）
- **注意力阶梯**：`Button` primary=E1（实心蓝，每视图一个）· secondary=E2（描边/提亮）· ghost=E3 · 链接/文本=E4。`IconButton`=E3。危险动作走 danger 语义色。
- **高度阶梯（L0–L4）**：`--surface-app` app → `--surface-card` region/card（`Panel`/`Toolbar region`）→ `--surface-raised` 悬停/当前行 → `--surface-chrome` 标题/状态栏 → `--surface-raised` 浮层（唯一大阴影）。区块间 1px `--gd-line` 缝合，不用投影堆叠。
- **文本角色映射**：`Table` 表头=label、单元=body/code、估值=metric-sm(金)；`KpiStat`=label+metric+meta；`Panel` 标题=panel；`Badge`=mono label 尺度；`StatusBar`=meta(mono)。
- **密度 3 档**：compact 32 / regular 40 / spacious 48（表格与控件同源）。

### 4) 页面 — 信息分区 + 焦点法则
- **6 固定带**（自上而下，注意力递减）：① 标题栏(标识/环境) → ② 工具栏(导航+⌘K, E2) → ③ 指标 Ribbon(概览/次焦点) → ④ 工作面/数据表(**主焦点 E1，最大视觉权重**) → ⑤ 动作层(BatchBar，按需浮现) → ⑥ 状态栏(环境)。
- **焦点法则**：每页恰好一个主焦点（工作面）；概览为次，壳层为环境。
- **深度轴**：面对万行不直接展开——摘要层 → 分组层 → 明细层（虚拟滚动），见 UX_FLOWS。

## NATIVE DESKTOP FORM（原生桌面形态，非 SaaS）

对标私人银行终端 / 硬件钱包 / 原生桌面软件（Ledger Live、Linear、Warp、Kraken Pro），刻意避开通用 SaaS 网页观感。规范见 `guidelines/native-chrome.html`。

- **窗口壳层**：`WindowChrome` 提供标题栏（品牌标 + 居中上下文 + 窗口控制键）；应用坐落于深色「桌面」之上、带窗口圆角与外阴影——像原生窗口，不像网页。
- **窗口尺寸与断点**（规范见 `guidelines/window-sizing.html`，token 在 `tokens/spacing.css`）：原生桌面终端用刻意档位而非流式适配——**最小 960×640、默认首启 1280×832**（写进 `apps/desktop/src-tauri/tauri.conf.json`，非只在 CSS）。断点按窗口宽度：**compact <1080**（主 nav 收 56px 图标轨、状态栏留核心 4 段、⌘K 转图标+键位）· **regular 1080–1320**（full nav）· **wide ≥1320**（状态栏全环境段）。收轨专治设置类双侧栏挤压。
- **命令工具栏**：`Toolbar` 主栏含 ⌘K 命令域（Raycast/Linear 心智）；次栏（`region`）承载筛选与主动作，而非页面顶部漂浮的 CTA 行。
- **终端式状态栏**：`StatusBar` 常驻底部，等宽、hairline 分段，显示同步态 / 未同步数 / 最后同步 / Revision / Active 设备 / Epoch / License——原生软件最强信号。
- **缝合式区块**：内容区用 1px 描线彼此缝合、边到边（KPI 用分隔条 ribbon 而非漂浮卡片网格），结构面无投影；圆角只留给交互控件（按钮/输入/药丸），结构区块方角。
- **金色克制**：chrome 中金色仅作 hairline（激活导航条、Active 设备点、金额数字），绝不大面积。

## LAYOUT ROBUSTNESS（布局稳健 · 可执行）

从 BatchBar 竖排事故沉淀的红线——浮层与紧凑横条的宽度约束：

- **自动宽度浮层的居中**：绝不用 `left:50% + translateX(-50%)` 给「内容定宽」的浮层居中。绝对定位盒的收缩宽度被「50% 锚点→容器右缘」的距离夹死，内容一旦超出就竖排/挤压而非横向溢出。**统一做法**：整宽 flex 容器承载——`position:absolute;left:0;right:0;display:flex;justify-content:center;pointer-events:none`，浮层自身 `pointer-events:auto`；或给浮层 `width:max-content`。BatchBar 浮层即用前者。
- **例外仅限单行短文**：`left:50%/translateX(-50%)` 只允许用于**必然单行**的浮层，且必须 `white-space:nowrap` + 内容短到不撞右缘（`WindowChrome` 居中上下文、`Tooltip` 气泡即此类，已合规）。
- **紧凑横条**（BatchBar / Toolbar / StatusBar）：文字块一律 `white-space:nowrap`；分组用 flex `gap` 与显式分隔符（`.gd-batchbar-sep`），不靠空白符或 auto 宽度承载多元素；计数/标签做成定宽 chip 锚点，避免被压缩。
- **审查通过**：全库 `left:50%/translateX(-50%)` 两处——WindowChrome context、Tooltip bubble（均为 nowrap 短文，安全）；BatchBar 已改整宽 flex，不再使用。新增浮层须过此三条。
- **浮层继承 `white-space:nowrap`**：`position:fixed` 只脱离布局定位，不脱离 DOM 继承链。渲染在 `.gd-statusbar-seg`（nowrap）内的浮层（如 `NetworkStatus` 三轴弹层）会继承 nowrap，长文案不换行而溢出定宽浮层——浮层根须显式 `whiteSpace:"normal"` 复位。任何挂在 StatusBar/Tooltip 等 nowrap 容器内的浮层同理。
- **窄窗（应用 minWidth 960）体检**：验证不能只断言"文案在"，要量**列对齐与横向溢出**。双侧栏界面（设置 = Shell nav 210 + 设置子栏 176）在 compact 档主 nav 收 56px 图标轨补回内容宽度；仍要量最小档：多列行改为收窄定宽 + `minWidth:0` 让次要列 ellipsis 降级（勿让定宽列之和超容器）；并排的多卡/时钟+详情行用 `flexWrap:"wrap"` + `flex:"1 1 220px"` 在窄区自然堆叠。判定真溢出以 `main.scrollWidth>clientWidth`（页面横向滚动）为准，单元素因 ellipsis 产生的 `scrollWidth>clientWidth` 属预期截断、非缺陷。

## ICONOGRAPHY

- **品牌场景图标**（随库提供，`assets/icons/`）：`keyhole.svg`（安全能力：外圆内方金库 + 核心锁孔；本地密钥、设备门禁）、`active-lease.svg`（骑缝双持：金实心 = 执行设备，蓝空心 = Standby）。徽章体系 `assets/graphics/seal.svg`（铸缘金印：铣边铸币 + 外圆内方 + 骑缝；认证/会员/成交凭证）；辅助图形 `sand-flow.svg`（圩纹：同心钱波 + 内方节点，开屏/底纹）、`ascent.svg`（涨值：投入蓝→增值金的递增钱，营销/空状态）。
- **功能图标**：代码库无图标集。**替代：Lucide（CDN）**，1.5px 描边与几何无衬线气质匹配；尺寸 14/16px，颜色随文本层级（`--text-muted` 默认，激活为 `--gd-text` 或语义色）。金色图标仅用于价值时刻。需要品牌定制图标集时替换。
- **无 emoji、无 Unicode 字符图标**。状态用色点（StatusDot）与徽章（Badge）。
- Logo 使用规矩（见 `guidelines/coin-seal-spec.html`）：≥48px 用渐变 `mark.svg`；24–48px 强制单色 `mark-flat.svg`；≤20px 用无缝版 `mark-16.svg`；金/浅底用 `mark-ink.svg`；禁旋转/拉伸/改色/辉光/描边/圆角方孔/填实方孔；内方永远直角正交、骑缝永远垂直居中；安全区 = 内方 □（Ø⅓，30U）。

## Intentional additions

品牌只定义三色体系；以下为界面必需的最小扩展，均已按"哑光、深底、远离金"的红线调校：

- 语义状态色 success/danger/warning（操作结果、风险分级——UX_FLOWS 要求成功/失败/高风险的视觉分级）
- `--gd-line-strong`、`--gd-text-faint`、tint 色（选中行、徽章底）
- Lucide 功能图标集（CDN 替代，见 ICONOGRAPHY）
- 组件库为标准集（代码库 `packages/ui` 为空占位，无既有组件清单）
- 原生桌面壳层 `WindowChrome` / `Toolbar` / `StatusBar`（风格对标 Warp 状态栏、Linear/Raycast 壳层工艺——去 SaaS 化的界面语言）

## FONT SUBSTITUTIONS — 需要你提供

repo 无任何字体文件。当前 CDN 替代：General Sans（Fontshare，brand 列出的方向之一）、JetBrains Mono（Google）、**Noto Sans SC 代替 MiSans/HarmonyOS Sans**。若有 Aeonik / Neue Haas / MiSans 授权文件，请提供以替换 `tokens/fonts.css`。

## Index

- `styles.css` — 全局入口（@import tokens/*）
- `tokens/` — colors / typography / spacing / fonts / base
- `assets/` — logo（5 版本）、graphics（3）、icons（2）
- `guidelines/` — 规范 specimen 卡片
- `components/` — 23 个组件：
  - buttons/: Button, IconButton
  - inputs/: Input, Select, Checkbox, Switch
  - table/（核心）: Table, BatchBar, Pagination
  - status/: Badge, StatusDot, Money, DiffValue, Tag, ProgressBar
  - overlay/: Dialog, Tooltip
  - navigation/: Tabs, StatusBar
  - surfaces/: Panel, KpiStat, Toolbar, WindowChrome
- `ui_kits/desktop/` — 桌面客户端 UI kit（接入 Onboarding / 资产库 / 域名详情 / 批量差异预览 / 续费 / 同步中心·Outbox / 销售管理·议价交割 / DNS 与验证 / 冲突中心 / 恢复中心 / 人工任务 / 资产保护·紧急下架 / 操作历史·回滚 / 设置·设备门禁 / 账户登录·锁定门禁）
- `SKILL.md` — agent 使用指南
