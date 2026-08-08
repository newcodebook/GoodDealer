// account-web mock data. License is sold by TERM (monthly / annual / lifetime), not feature tiers —
// every plan carries the full product; term only changes price & commercial validity.
window.AW_DATA={
  plans:[
    {key:"monthly",name:"月付",price:9.8,unit:"/月",period:"按月续费 · 随时取消",cta:"选择月付"},
    {key:"annual",name:"年付",price:98,unit:"/年",sub:"≈ $8.2/月 · 省 17%",period:"按年续费 · 随时取消",cta:"选择年付",popular:true},
    {key:"lifetime",name:"终身",price:498,unit:"一次性",sub:"含所有未来大版本",period:"永久授权 · 无周期扣费",cta:"选择终身",gold:true},
  ],
  // shared across all plans (license = term, not feature tier)
  features:[
    "统一资产库 · 万级域名流畅筛选排序",
    "多平台销售管理（Atom · Afternic · SellerHub）",
    "DNS 与所有权验证 · 防覆盖现有解析",
    "批量改价 / 上下架 / 验证 · 逐项差异预览",
    "双设备云同步 · 单活动设备执行权",
    "凭据本地加密 · 永不上云",
    "简体中文 · English",
  ],
  lifetimeExtra:"含所有未来大版本升级",
  // current account (authed, for 订阅管理)
  account:{email:"investor@domain.com",plan:"annual",state:"active",price:98,renews:"2026-12-31",method:"Visa · 6411",since:"2025-12-31"},
  invoices:[
    {id:"INV-2025-12",date:"2025-12-31",desc:"年付 License · 续费",amount:98,status:"paid"},
    {id:"INV-2024-12",date:"2024-12-31",desc:"年付 License",amount:98,status:"paid"},
  ],
};
