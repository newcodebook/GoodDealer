// marketing-web content. Public top-of-funnel site. Every claim is grounded in docs/PRODUCT_REQUIREMENTS.md
// and stays HONEST about first-version scope: NO background polling / OS wakeup / Cloud Relay / unattended
// execution / auto-delist; credentials never leave the device; cloud sync is baseline (no local-only mode);
// max 2 devices, single Active; publish/公开展示 is future and not marketed. Pricing mirrors account-web.
//
// TEXT VOICE: customer-facing, outcome-oriented. No developer jargon (no "凭据/回滚/增量同步/轮询/Punycode/
// Priority-0/Active 设备/非秘密业务数据"). Technical accuracy preserved, expressed in plain language.
window.MK_DATA={
  lang:"zh",assetBase:"../../",
  nav:[["features","功能"],["platforms","平台"],["demo","演示"],["security","安全"],["pricing","定价"],["faq","FAQ"]],
  hero:{
    eyebrow:"域名批量管理软件 · 密码不上云 · 多设备同步",
    title:"分散在多个注册商与平台的域名，一处掌控",
    sub:"注册信息、DNS、价格、上架状态统一管理；两台设备同步数据，随时切换工作。",
    ctaPrimary:"下载客户端",
    ctaSecondary:"查看定价",
    trust:"你的平台密码和登录信息始终留在这台电脑——GoodDealer 云端只同步域名和价格等业务数据。",
  },
  // 好处盘点 — outcomes (what you GET), framed as before→after. Distinct from pillars (what it DOES).
  benefits:[
    {metric:"1 屏",title:"不再逐平台登录核对",from:"4 个平台 · 5 个账户来回切换",to:"注册商 · DNS · 销售状态一处总览"},
    {metric:"批量",title:"几百个域名一次改完",from:"逐个改价、逐个上下架",to:"筛选后批量执行，先看改动再提交"},
    {metric:"本地",title:"密码掌控权在你手里",from:"把账号密码托管给第三方",to:"密码和登录信息只存在你的电脑上"},
    {metric:"优先",title:"售出提醒、跨平台下架",from:"卖掉了还在为死域名续费",to:"主动刷新发现售出后，优先生成跨平台下架清单"},
  ],
  // 核心流程 — the core loop, auto-cycled on the page for a dynamic walkthrough.
  workflow:[
    {k:"01",title:"筛选资产",desc:"按标签、注册商、后缀、上架状态与到期日，筛出要处理的域名。"},
    {k:"02",title:"预览改动",desc:"逐项列出即将发生的变化、风险提示与不支持项；高风险单列，可跳过。"},
    {k:"03",title:"确认并执行",desc:"你输入登录和验证码，确认操作计划后由软件代为执行到各平台。"},
    {k:"04",title:"同步与纠正",desc:"操作结果自动同步到另一台设备；失败项可重试，已完成的改动通过新的、可审阅的纠正操作处理。"},
  ],
  // 功能动效 — features shown THROUGH motion (not static screenshots). Each panel loops a demonstration of the
  // real mechanic. Honesty: listing/pricing carry a user "确认执行" beat (not unattended); verify polling &
  // sync propagation are automatic. Alternating image/text rows. Reduced-motion freezes on a resolved frame.
  showcase:[
    {side:"left",tag:"统一归集",title:"多注册商域名，归到一张表",desc:"从 Spaceship、Namecheap、Dynadot、阿里云把域名导入统一资产表，自动识别并合并重复域名。",anim:"aggregate"},
    {side:"right",tag:"批量上架",title:"确认后批量上架到多个销售平台",desc:"确认操作计划后，一批域名同时上架到 Atom、SellerHub、Afternic，状态逐个更新。",anim:"list"},
    {side:"left",tag:"自动验证",title:"平台验证，软件自动批量完成",desc:"上架前各销售平台要求验证域名所有权。软件自动为一整批域名写入验证记录、等待生效、确认通过——不用逐个手动操作。",anim:"verify"},
    {side:"right",tag:"价格同步",title:"改一次价，支持的平台同步更新",desc:"确认批量改价后，结果同步到已支持的销售平台和第二台设备；发现错误时，重新审阅并提交一项纠正改动。",anim:"sync"},
  ],
  pillars:[
    {k:"资产库",title:"统一资产库",body:"从 Spaceship 等注册商读取域名，未接入的注册商可导入文件补充。自动识别重复域名。注册商、到期日、续费价、锁定状态与 DNS 服务商一屏可见。",items:["标签 · 投资组合 · 购入成本 · 备注","浮盈浮亏随售价一并显示"]},
    {k:"销售",title:"多平台销售管理",body:"查看 Atom、SellerHub、Afternic 的上架状态，批量设置一口价、最低报价与各平台售价；平台上的价格被手动改过时自动提醒。",items:["同平台多账户分别管理","不支持自动化的平台会生成手工操作指引"]},
    {k:"DNS",title:"DNS 与所有权验证",body:"自动识别域名实际使用的 DNS 服务商，在 Cloudflare 或注册商 DNS 添加验证记录，不会覆盖你已有的邮件相关设置（SPF / DKIM / DMARC）。",items:["修改 DNS 服务商前单独确认风险","自动等待 DNS 生效并检查验证结果"]},
    {k:"批量",title:"批量操作，先看再改",body:"按标签、注册商、后缀、上架状态与到期日筛选，批量改价、上下架、改 DNS。执行前逐项列出即将发生的变化、风险提示与不支持项。",items:["确认按钮显示精确操作数量","结果按成功 / 失败 / 等待生效 / 需手工处理分类显示"]},
  ],
  security:{
    title:"你的平台密码，始终留在这台电脑",
    sub:"这和「把账号交给第三方托管」完全不同。",
    points:[
      {t:"本地执行",tone:"gold",d:"批量操作由你当前操作的电脑直接执行到各平台。密码和登录信息存在本机——不上传到云端，GoodDealer 也读不到。"},
      {t:"云端同步",tone:"blue",d:"域名、价格、上架状态等业务数据同步到 GoodDealer 云端，供第二台设备查看。云端不存储任何密码或登录信息。"},
      {t:"两台设备 · 一台操作",tone:"gold",d:"最多绑定两台电脑，任何时候只有一台能执行操作；另一台只能查看。换第三台需要先解绑旧设备。"},
      {t:"你输入，软件执行",tone:"blue",d:"平台登录、API Key、验证码全部由你亲自输入。软件只在你确认操作计划后代为执行，全程可暂停接管。"},
    ],
  },
  plans:[
    {key:"monthly",name:"月付",price:9.8,unit:"/月",period:"按月续费 · 随时取消",cta:"选择月付"},
    {key:"annual",name:"年付",price:98,unit:"/年",sub:"≈ $8.2/月 · 省 17%",period:"按年续费 · 随时取消",cta:"选择年付",popular:true},
    {key:"lifetime",name:"终身",price:498,unit:"一次性",sub:"含所有未来大版本",period:"永久买断 · 不再扣费",cta:"选择终身",gold:true},
  ],
  planFeatures:["完整功能 · 资产库 · 销售 · DNS · 批量操作","最多两台电脑 · 一台操作","平台密码始终留在本地","14 天全额退款"],
  planNote:"三个档位功能完全一样，区别只在时长——月付、年付或一次买断。结账由 Paddle 处理，GoodDealer 不接触你的卡号。",
  faq:[
    {q:"会自动监控售出并自动下架吗？",a:"不会。首版软件不会在后台自动运行。当你主动刷新，或其他操作过程中发现域名已售出时，软件会生成跨平台下架清单，由你逐次确认后执行。"},
    {q:"平台账号密码和 API Key 会上传吗？",a:"不会。密码和登录信息始终留在你的电脑上，GoodDealer 云端和运营后台都无法读取。API Key 由你在软件的安全输入框中录入；云端只同步域名、价格等业务数据。"},
    {q:"能绑定几台设备？",a:"最多两台电脑，任何时候只有一台能执行操作，另一台只能查看。换第三台需先解绑旧设备；如果解绑的是正在操作的那台，新设备需要等旧设备完成当前操作后才能接管。"},
    {q:"支持哪些注册商与平台？",a:"正式发布目标覆盖大部分主流注册商、销售平台和 DNS 服务商，包括 Spaceship、Namecheap、Dynadot、阿里云、Cloudflare、Atom、Spaceship SellerHub 与 Afternic。每项集成只有通过兼容性与安全门禁后才会开放；暂未接入的注册商可通过导入文件补充。"},
    {q:"有纯本地、不联网的模式吗？",a:"没有。云同步是基础功能，用于两台设备之间保持数据一致和查看；平台密码仍然只在本地。"},
    {q:"买断之后还会扣费吗？",a:"终身买断一次付费，不再扣费，包含所有未来大版本更新。月付和年付可随时取消，到期后不再续费。"},
  ],
  download:{title:"在你的电脑上开始",sub:"支持 macOS 与 Windows。下载后登录账号、绑定设备，即可开始管理域名。",platforms:[["macOS","下载 for macOS"],["Windows","下载 for Windows"]],note:"首次使用需登录账号并绑定设备；域名与价格等数据同步到云端，密码留在本地。"},
  // 支持平台 — every platform name is an SEO anchor. v1 = first version; soon = planned. Honesty: only claim
  // "已支持" for what PRD §3 confirms; everything else is "即将支持".
  platforms:{
    registrars:{title:"域名注册商",sub:"读取域名资产、到期日、锁定状态与 DNS 信息",items:[
      {name:"Spaceship",releaseTarget:true},{name:"Namecheap",releaseTarget:true},{name:"Dynadot",releaseTarget:true},{name:"阿里云(万网)",releaseTarget:true},
      {name:"GoDaddy"},{name:"Porkbun"},{name:"Namesilo"},{name:"Name.com"},{name:"Epik"},{name:"Cloudflare Registrar"},
      {name:"西部数码"},{name:"新网"},{name:"腾讯云"},
    ]},
    sales:{title:"域名销售平台",sub:"上架、改价、查询状态与所有权验证",items:[
      {name:"Atom",releaseTarget:true},{name:"Spaceship SellerHub",releaseTarget:true},{name:"Afternic",releaseTarget:true},{name:"Sedo"},{name:"GoDaddy Auctions"},
      {name:"Efty"},{name:"Squadhelp"},{name:"易名"},{name:"爱名网"},
    ]},
    dns:{title:"DNS 管理平台",sub:"添加验证记录、等待生效、避免覆盖邮件设置",items:[
      {name:"Cloudflare",releaseTarget:true},{name:"注册商自带 DNS",releaseTarget:true},
      {name:"AWS Route 53"},{name:"Google Cloud DNS"},{name:"Azure DNS"},{name:"DNSPod (腾讯云)"},{name:"阿里云 DNS"},
    ]},
  },
  footer:{
    tagline:"密码留在本地 · 域名批量管理 · 多设备同步",
    cols:[
      ["产品",["价值","安全模型","定价","下载"]],
      ["账户",["登录 / 注册","管理订阅","设备与安全"]],
      ["资源",["支持中心","数据与隐私","服务条款"]],
    ],
  },
  // ui — component-level strings (section headers, eyebrows, diagram labels, animation captions).
  ui:{
    shell:{login:"登录",download:"下载",footerLegal:"Paddle 为 Merchant of Record，结账不接触卡号",footerLang:"中文优先 · English 其次"},
    hero:{eyebrowSub:"域名资产管理",titleBefore:"分散在多个注册商\n与平台的域名，",titleGold:"一处掌控"},
    benefits:{tag:"功能亮点",tagSub:"你得到什么",h2:"多注册商域名，统一批量管理",lead:"不再在注册商和销售平台之间来回切换——筛选、改价、上架、验证，一处完成。",from:"从",to:"到"},
    pillars:{tag:"核心场景",tagSub:"四项核心能力",h2:"从资产库到批量操作",lead:"注册商、DNS、销售平台各管各的；GoodDealer 把它们统一成一张可以批量操作、先看后改的域名总表。"},
    workflow:{tag:"核心流程",tagSub:"一次批量操作的四步",h2:"筛选 · 预览 · 确认 · 同步",lead:"每一次批量操作都走同一条路径——先看清即将发生的变化，再由你确认执行。"},
    showcase:{tag:"功能",tagSub:"动起来看",h2:"不是概念，是会动的功能",
      aggWin:"统一归集 · 资产库",aggSrc:"域名注册商",aggDomain:"域名",aggRegistrar:"注册商",aggNote:"连接注册商即批量拉取 · 整批沿线汇入 · 一次插入多行",
      listWin:"批量上架 · 域名 × 平台",listListed:"在售 ✓",listDone:"已上架 12 项 · 3 平台",listBody:["把选中的 ","4"," 个域名上架到 Atom · SellerHub · Afternic 共 ","3"," 个销售平台。"],listConfirm:"确认提交",listNote:"提交任务后软件自动跨平台上架 · — 未上架，在售 ✓ 已上架",
      verifyWin:"自动执行平台验证",verifyHead:"· 软件为一批域名自动跑平台验证",verifyDomain:"域名",verifyPlatform:"销售平台",verifyStatus:"验证",verifyWait:"待验证",verifyIng:"验证中 · 写 TXT",verifyOk:"已验证",verifyNote:"软件自动写入验证记录、等待生效、确认通过 · 不用逐个手动操作",
      syncWin:"价格同步 · 改一次价",syncNote:"改一次价 · 脉冲沿辐条射向各平台与设备 · 逐个同步"},
    platforms:{tag:"平台覆盖",tagSub:"注册商 · 销售 · DNS",h2:"主流注册商与销售平台，逐步全覆盖",lead:"GoodDealer 的正式发布目标覆盖大部分主流域名平台。金色表示发布目标，不表示当前已经可用；每项集成都必须先通过兼容性与安全门禁。",soon:"后续目标",footerNote:"■ 金色边框 = 正式发布目标，仍须通过兼容性与安全门禁 · 其余按需求扩展 · 未接入的注册商可导入文件补充"},
    security:{tag:"安全模型",tagSub:"密码留在本地 · 云端只读",neverLeaves:"永不离开本设备",
      localNode:{title:"你的电脑",sub:"操作在这台执行",items:["平台密码","登录信息","浏览器数据"]},
      arrow:{label:"只同步业务数据",sub:"不含密码"},
      cloudNode:{title:"GoodDealer 云端",sub:"供第二台设备查看",items:["域名 · 价格 · 上架状态","操作记录（不含密码）"]}},
    pricing:{tag:"定价",tagSub:"月付 · 年付 · 买断",h2:"选一个时长，功能完全一样",popular:"最受欢迎",oneTime:"一次买断"},
    faq:{tag:"常见问题",tagSub:"边界与承诺",h2:"把边界说清楚"},
    download:{tag:"下载",tagSub:"macOS · Windows"},
  },
};
