// Content model for the marketing site. Structure mirrors brand/ui_kits/marketing-web
// data.en.js / data.zh.js (window.MK_DATA) verbatim, minus the kit-only `lang` /
// `assetBase` fields — assets are resolved through @gooddealer/ui imports here, and the
// page language lives in PageMeta.

export interface PageMeta {
  lang: string;
  title: string;
  description: string;
  ogLocale: string;
  ogTitle: string;
  ogDescription: string;
  twitterTitle: string;
  twitterDescription: string;
  jsonLd: object[];
}

export interface Benefit {
  metric: string;
  title: string;
  from: string;
  to: string;
}

export interface WorkflowStep {
  k: string;
  title: string;
  desc: string;
}

export interface ShowcaseItem {
  side: "left" | "right";
  tag: string;
  title: string;
  desc: string;
  anim: "aggregate" | "list" | "verify" | "sync";
}

export interface Pillar {
  k: string;
  title: string;
  body: string;
  items: string[];
}

export interface SecurityPoint {
  t: string;
  tone: "gold" | "blue";
  d: string;
}

export interface Plan {
  key: string;
  name: string;
  price: number;
  unit: string;
  period: string;
  cta: string;
  sub?: string;
  popular?: boolean;
  gold?: boolean;
}

export interface FaqItem {
  q: string;
  a: string;
}

export interface PlatformItem {
  name: string;
  releaseTarget?: boolean;
}

export interface PlatformCategory {
  title: string;
  sub: string;
  items: PlatformItem[];
}

export interface SecurityNodeUi {
  title: string;
  sub: string;
  items: string[];
}

export interface MkData {
  nav: [string, string][];
  hero: {
    eyebrow: string;
    title: string;
    titleGold?: string;
    sub: string;
    ctaPrimary: string;
    ctaSecondary: string;
    trust: string;
  };
  benefits: Benefit[];
  workflow: WorkflowStep[];
  showcase: ShowcaseItem[];
  pillars: Pillar[];
  security: {
    title: string;
    sub: string;
    points: SecurityPoint[];
  };
  plans: Plan[];
  planFeatures: string[];
  planNote: string;
  faq: FaqItem[];
  download: {
    title: string;
    sub: string;
    platforms: [string, string][];
    note: string;
  };
  platforms: {
    registrars: PlatformCategory;
    sales: PlatformCategory;
    dns: PlatformCategory;
  };
  footer: {
    tagline: string;
    cols: [string, string[]][];
  };
  ui: {
    shell: { login: string; download: string; footerLegal: string; footerLang: string };
    hero: { eyebrowSub: string; titleBefore: string; titleGold: string };
    benefits: { tag: string; tagSub: string; h2: string; lead: string; from: string; to: string };
    pillars: { tag: string; tagSub: string; h2: string; lead: string };
    workflow: { tag: string; tagSub: string; h2: string; lead: string };
    showcase: {
      tag: string;
      tagSub: string;
      h2: string;
      aggWin: string;
      aggSrc: string;
      aggDomain: string;
      aggRegistrar: string;
      aggNote: string;
      listWin: string;
      listListed: string;
      listDone: string;
      listBody: [string, string, string, string, string];
      listConfirm: string;
      listNote: string;
      verifyWin: string;
      verifyHead: string;
      verifyDomain: string;
      verifyPlatform: string;
      verifyStatus: string;
      verifyWait: string;
      verifyIng: string;
      verifyOk: string;
      verifyNote: string;
      syncWin: string;
      syncNote: string;
    };
    platforms: { tag: string; tagSub: string; h2: string; lead: string; soon: string; footerNote: string };
    security: {
      tag: string;
      tagSub: string;
      neverLeaves: string;
      localNode: SecurityNodeUi;
      arrow: { label: string; sub: string };
      cloudNode: SecurityNodeUi;
    };
    pricing: { tag: string; tagSub: string; h2: string; popular: string; oneTime: string };
    faq: { tag: string; tagSub: string; h2: string };
    download: { tag: string; tagSub: string };
  };
}
