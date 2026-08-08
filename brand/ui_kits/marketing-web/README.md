# marketing-web — GoodDealer 营销官网 UI Kit

公开落地页(漏斗顶部),服务 J-01「发现 → 获取」旅程。是四个表面里**唯一使用品牌表现层**的——
desktop / account-web / admin-web 都刻意克制(功能层纯金、无 display 大标题、无 Coin Seal 华彩);
营销站正是 `.gd-t-display`、105° 流沙金渐变、Coin Seal 与金色辉光该出场的地方。

## 运行方式
和其他 kit 一致:React 18 UMD + 浏览器内 Babel(`type="text/babel"`),DS 组件来自 `../../_ds_bundle.js`
(`window.GoodDealerDesignSystem_b5b0b6`),tokens 来自 `../../styles.css`。无构建工具。打开 `index.html` 预览。
**单页长滚动**:`index.html` 顺序堆叠各 section 组件,顶栏锚点跳转(`#value`/`#security`/`#pricing`/`#faq`/`#download`)。

## 设计语言:「镌刻凭证 / 铸币印记」
把官网当成一张**镌刻的所有权凭证 / 私人银行票据 / 铸币**,而非 App 广告——产品内核是「对分散托管资产的主权掌控」。
这是**证券印刷(guilloché 雕纹)+ 骑缝钢印 + 账簿细线**的语言,也是四个表面里唯一的品牌表现层。
- **金的纪律(brand readme 硬约束「金越少越贵」「金不做大面积填充」)**:金只出现在①雕纹印记 ②发丝分隔/骑缝线 ③金色等宽数字(定价 `$9.8/$98/$498` tabular-nums)④钢印方块 CTA(9px 金方块作印,`.mk-stamp i`)⑤标题一个重点词。**全站无实心金按钮、无柔光辉光。**
- **雕纹印记 `Seal.jsx`(`MKSeal`)**:同心发丝环 + 币缘齿纹 + guilloché 波纹 + 外圆内方回声,中心镌刻 Coin Seal(`mark.svg`)。取代通用柔光光晕。
- **编排式非对称**:hero 左栏文案 + 右侧印记;登记行 eyebrow(`.mk-eyebrow2`:mono 金标签 + 发丝 `.mk-rule` + 描述);章节间 **骑缝** `.mk-seam`(金色虚线)。
- **Pillars 账簿式**:弃卡片网格 → 金色 mono 编号(01–04)+ 发丝行 + 右置能力列(Kraken 密度)。
- **Pricing 票据**:价格金色等宽大数字(终身档金色 + 金发丝边),`.mk-tag` 克制 mono 标签(非彩色填充),推荐档顶部骑缝齿孔,`.mk-stamp` CTA。
- **CTA**:`.mk-stamp`(钢印方块 + 描线,悬停方块旋转「盖章」)为主,`.mk-quiet`(文字 + 箭头)为次。**已无 `.mk-cta--gold` 实心填充。**
- **Mercury 式克制**:安静、精确、名词化标题。**全站无「！」、无 emoji**(色点/发丝/印记表达状态;`✓ ◆ ○` 为 UI 字形非表情)。
- **金蓝语义**:安全模型图中金=本地/密码/资产、蓝=云端/系统/业务数据,遵循 data-viz 规则。
- **CTA 单色金纪律**:主 CTA `.mk-stamp` 为**单色金片**——金文字 + 金描线 + 金钢印方块 + 透明底,悬停才叠 `--gd-gold-tint` 薄洗 + 方块旋转「盖章」。注:`.mk-top-right a` 会以更高优先级把 `.mk-stamp` 文字压成灰(顶栏 CTA「配色文字相冲」的真因),已用 `.mk-top-right a.mk-stamp{color:var(--gd-gold)}` 修正。次 CTA `.mk-quiet` 中性文字 + 箭头(悬停右移)。

## 文案原则(v2 重写)
- **说人话**:不用"凭据/回滚/增量同步/轮询/Punycode/Priority-0/Active 设备/非秘密业务数据"等开发者术语。技术准确性不变,用结果和场景替换机制。
- **标题兼顾品牌感与搜索意图**:每个 h2 含至少一个场景关键词(域名批量管理 / 多注册商 / 密码不上云)。
- **FAQ 诚实边界不变**:红线内容(不自动下架 / 不纯本地 / 密码不上云)一字不改,但换成日常语言——读完能复述给朋友听。

## SEO
- **title**:`GoodDealer — 域名批量管理软件 | 多注册商、多平台一处掌控`
- **meta description**:覆盖核心价值(统一管理 / 批量上架 / 自动验证 / 密码本地)+ 平台(macOS / Windows)。
- **Open Graph + Twitter Card**:标题/描述,社交分享出预览卡。`og:image` 待正式域名确定后补。
- **JSON-LD `SoftwareApplication`**:产品名、平台(macOS/Windows)、三档价格,触发搜索富摘要。
- **关键词矩阵**:核心词(域名管理软件 / 域名批量管理)、场景词(多注册商域名管理 / 域名价格同步)、长尾词(批量上架域名到销售平台 / Spaceship 域名管理)。

## 交互与动效(克制,`prefers-reduced-motion` 自动关闭)
- **进场**:hero 文案 `.mk-rise` 上浮淡入,印记 `.mk-seal-anim` 缩放淡入(0.12s 错峰)。
- **印记(复用品牌动效资产)**:
  - **默认(无悬停)**:只有外圈——币缘齿纹 `.mk-reed` 循环转动(`mk-bezel` 30s),guilloché 波纹 `.mk-rose` 反向 60s 慢转;中心 Coin Seal 与外圆内方不动。**默认不起涟漪**(ripple `animation:none`、`opacity:0`)。
  - **悬停**:转动继续,同时**涟漪与之一起出现**——三圈金色环**从中心 mark(Coin Seal)边缘起始**(基准半径 `R*0.33` ≈ mark 边缘),向外扩散**明显越过外圈**(scale→4.2);`vectorEffect="non-scaling-stroke"` 使放大时描线仍为发丝;svg `overflow:visible`。**外圆内方两个方形法阵旋转**——sq-1 顺时针 18s、sq-2 逆时针 14s(从 45° 起始),速度差形成法阵干涉;opacity 从 0.16 升到 0.28。
  - **呼吸节奏**:单圈 5s 一息——吸(0→0.42 峰值)→ 呼(自 mark 扩散越过外圈、淡出)→ **静止间隙**(约 3–5s 段停顿),品牌 `--gd-ease-inout` 缓动;三圈错峰 5s/3。
- **滚动揭示**:`main > section` 进入视口淡入上浮(`index.html` 内 IntersectionObserver;**JS 门控**——脚本不跑则内容默认可见,不会隐藏)。
- **焦点态**:键盘 `:focus-visible` 2px 蓝 ring(Linear/Raycast 心智)。
- reduced-motion 下全部动效关闭、内容即时可见。

## 内容诚实边界(营销站最易翻车处,已严格守)
- **不夸大 Priority-0**:FAQ 明确「不会自动监控售出并下架」——首版无后台周期轮询 / OS 后台唤醒 / Cloud Relay / 无人值守执行;售出下架需用户在场逐次批准。
- **无纯本地模式**:云同步是基础能力,不宣传离线独占。
- **密码始终留在本地 / 最多两台 · 一台操作 / publish 是未来功能不宣传**。
- 所有能力文案锚定 `docs/PRODUCT_REQUIREMENTS.md §3`。

## 组件
| 全局 | 文件 | 说明 |
|---|---|---|
| `MKShell` | `SiteShell.jsx` | 粘性顶栏(品牌 + section 锚点 + 登录 + `.mk-stamp` 下载 CTA)+ 多列页脚。CTA 交接 account-web(登录→Auth,管理→Subscription)。 |
| `MKSeal` | `Seal.jsx` | 雕纹印记:同心发丝环 + 币缘齿纹 + guilloché 波纹 + 外圆内方(法阵旋转) + 中心 Coin Seal。hero 与 download 复用。 |
| `MKHero` | `Hero.jsx` | 编排式非对称:左栏(登记行 + display 标题〔金重点词「一处掌控」〕+ 定位 + 钢印/文字 CTA + 发丝信任承诺)+ 右侧 `MKSeal`,收于骑缝。 |
| `MKBenefits` | `Benefits.jsx` | **好处盘点(你得到什么)**:转变磁贴(金色 metric + 「从(灰)→ 到(金)」outcome),h2 含搜索关键词「多注册商域名，统一批量管理」。 |
| `MKPillars` | `Pillars.jsx` | 四价值支柱(PRD §3)的**账簿**:金色 mono 编号 01–04 + 发丝行 + 右置能力列。h2「从资产库到批量操作」。 |
| `MKWorkflow` | `Workflow.jsx` | **核心流程(动态)**:横向四步(筛选→预览改动→确认执行→同步/撤回),高亮**自动轮转**(2.4s)+ 金色进度轨;可点选、hover/reduced-motion 暂停。 |
| `MKShowcase` | `Showcase.jsx` | **功能动效**:左右交替行,每个窗口面板**循环演示一个真实功能的机制**(用动效表达,非静态截图)——统一归集(多注册商域名批量导入 + 资产表)、批量上架(前置确认弹窗→逐项状态更新)、自动验证(写入验证记录→等待生效→确认通过,脉冲金点 + 描述性状态)、价格同步(改价→向各平台/设备扩散→SYNCED)。诚实护栏:上架带「确认执行」拍子(非无人值守),验证/同步为自动。`prefers-reduced-motion` 落在已完成静态帧。 |
| `MKSecurity` | `Security.jsx` | 差异化图解:你的电脑(金,持密码/永不离开)—只同步业务数据(不含密码)→ GoodDealer 云端(蓝,只读)+ 四点模型。 |
| `MKPricing` | `Pricing.jsx` | 三档期限定价(与 account-web 一致:月 9.8 / 年 98 popular / 终身 498 gold),价格金色等宽大数字 + 票据框 + `.mk-tag` + 钢印 CTA;h2「选一个时长，功能完全一样」;交接 account-web 结账。 |
| `MKFaq` | `Faq.jsx` | 手风琴 FAQ,诚实回答红线问题(自动下架 / 密码上传 / 设备数 / 平台支持 / 纯本地 / 买断扣费),日常语言而非开发者术语。 |
| `MKDownload` | `DownloadCTA.jsx` | 收尾 CTA:`MKSeal` 印记复现(非辉光)+ macOS / Windows 钢印/文字 CTA + 登录/绑定前置说明。 |
| — | `data.js` | `window.MK_DATA`:nav / hero / benefits / pillars / workflow / showcase / security / plans / faq / download / footer。 |

**分区架构(版式刻意多样化)**:`Hero`(非对称)→ `Benefits`(转变磁贴)→ `Pillars`(账簿)→ `Workflow`(横向动态步进)→ `Showcase`(左右交替 + **会动的功能演示面板**)→ `Security`(图解)→ `Pricing`(卡片)→ `Faq`(手风琴)→ `Download`(居中印记)。相邻分区版式互不重复。

## 交接关系
营销站是入口,不做实际购买或账户操作——所有 CTA 指向 **account-web**:下载后登录/注册走 account-web Auth,
购买走 account-web Checkout(Paddle MoR),管理订阅走 Subscription。营销站定价数字与 account-web `AW_DATA.plans` 保持一致。
