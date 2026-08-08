// marketing-web content. Public top-of-funnel site. Every claim is grounded in docs/PRODUCT_REQUIREMENTS.md
// and stays HONEST about first-version scope: NO background polling / OS wakeup / Cloud Relay / unattended
// execution / auto-delist; credentials never leave the device; cloud sync is baseline (no local-only mode);
// max 2 devices, single Active; publish/公开展示 is future and not marketed. Pricing mirrors account-web.
//
// TEXT VOICE: customer-facing, outcome-oriented. No developer jargon (no "凭据/回滚/增量同步/轮询/Punycode/
// Priority-0/Active 设备/非秘密业务数据"). Technical accuracy preserved, expressed in plain language.
window.MK_DATA={
  nav:[["benefits","好处"],["value","能力"],["showcase","界面"],["security","安全"],["pricing","定价"],["faq","FAQ"]],
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
    {metric:"即时",title:"售出即时告警、跨平台下架",from:"卖掉了还在为死域名续费",to:"发现售出立刻生成跨平台下架清单"},
  ],
  // 核心流程 — the core loop, auto-cycled on the page for a dynamic walkthrough.
  workflow:[
    {k:"01",title:"筛选资产",desc:"按标签、注册商、后缀、上架状态与到期日，筛出要处理的域名。"},
    {k:"02",title:"预览改动",desc:"逐项列出即将发生的变化、风险提示与不支持项；高风险单列，可跳过。"},
    {k:"03",title:"确认并执行",desc:"你输入登录和验证码，确认操作计划后由软件代为执行到各平台。"},
    {k:"04",title:"同步与撤回",desc:"操作结果自动同步到另一台设备；失败项可重试，改动可撤回。"},
  ],
  // 功能动效 — features shown THROUGH motion (not static screenshots). Each panel loops a demonstration of the
  // real mechanic. Honesty: listing/pricing carry a user "确认执行" beat (not unattended); verify polling &
  // sync propagation are automatic. Alternating image/text rows. Reduced-motion freezes on a resolved frame.
  showcase:[
    {side:"left",tag:"统一归集",title:"多注册商域名，归到一张表",desc:"从 Spaceship、Namecheap、Dynadot、阿里云把域名导入统一资产表，自动识别并合并重复域名。",anim:"aggregate"},
    {side:"right",tag:"批量上架",title:"确认后批量上架到多个销售平台",desc:"确认操作计划后，一批域名同时上架到 Atom、SellerHub、Afternic，状态逐个更新。",anim:"list"},
    {side:"left",tag:"自动验证",title:"平台验证，软件自动批量完成",desc:"上架前各销售平台要求验证域名所有权。软件自动为一整批域名写入验证记录、等待生效、确认通过——不用逐个手动操作。",anim:"verify"},
    {side:"right",tag:"价格同步",title:"改一次价，所有平台同步更新",desc:"批量改价后自动同步到各销售平台和第二台设备，价格始终一致，改错了可以撤回。",anim:"sync"},
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
    {q:"支持哪些注册商与平台？",a:"注册商以 Spaceship 起步，DNS 支持 Cloudflare 与注册商自带 DNS，销售平台覆盖 Atom、SellerHub、Afternic；未接入的注册商可通过导入文件补充。"},
    {q:"有纯本地、不联网的模式吗？",a:"没有。云同步是基础功能，用于两台设备之间保持数据一致和查看；平台密码仍然只在本地。"},
    {q:"买断之后还会扣费吗？",a:"终身买断一次付费，不再扣费，包含所有未来大版本更新。月付和年付可随时取消，到期后不再续费。"},
  ],
  download:{title:"在你的电脑上开始",sub:"支持 macOS 与 Windows。下载后登录账号、绑定设备，即可开始管理域名。",platforms:[["macOS","下载 for macOS"],["Windows","下载 for Windows"]],note:"首次使用需登录账号并绑定设备；域名与价格等数据同步到云端，密码留在本地。"},
  footer:{
    tagline:"密码留在本地 · 域名批量管理 · 多设备同步",
    cols:[
      ["产品",["价值","安全模型","定价","下载"]],
      ["账户",["登录 / 注册","管理订阅","设备与安全"]],
      ["资源",["支持中心","数据与隐私","服务条款"]],
    ],
  },
};
