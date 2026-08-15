// marketing-web English content. Public top-of-funnel site. Every claim is grounded in
// docs/PRODUCT_REQUIREMENTS.md and stays HONEST about first-version scope: NO background polling /
// OS wakeup / Cloud Relay / unattended execution / auto-delist; credentials never leave the device;
// cloud sync is baseline (no local-only mode); max 2 devices, single Active; publish/公开展示 is
// future and not marketed. Pricing mirrors account-web.
//
// TEXT VOICE: customer-facing, outcome-oriented. No developer jargon (no "credentials/rollback/
// incremental sync/polling/Punycode/Priority-0/Active device/non-secret business data").
// Technical accuracy preserved, expressed in plain language.
import type { MkData, PageMeta } from "./types";

export const meta: PageMeta = {
  lang: "en",
  title: "GoodDealer — Domain Bulk Management Software | Multi-Registrar, Multi-Platform Control",
  description:
    "Manage domains from Spaceship, Namecheap, Dynadot, and more in one place. Bulk-list on Atom, Afternic, and other sales platforms. Auto-verify ownership. Sync prices in one click. Platform passwords always stay on your computer. Desktop software for macOS and Windows.",
  ogLocale: "en_US",
  ogTitle: "GoodDealer — Domain Bulk Management Software",
  ogDescription:
    "Multi-registrar domain management, bulk listing, auto-verification, price sync. Platform passwords always stay on your computer.",
  twitterTitle: "GoodDealer — Domain Bulk Management Software",
  twitterDescription:
    "Multi-registrar domain management, bulk listing, auto-verification, price sync. Passwords never leave your device.",
  jsonLd: [
    {
      "@context": "https://schema.org",
      "@type": "SoftwareApplication",
      name: "GoodDealer",
      applicationCategory: "BusinessApplication",
      operatingSystem: "macOS, Windows",
      description:
        "Desktop software for bulk domain management. Unify domains from multiple registrars, bulk-list on sales platforms, auto-verify ownership, and sync prices. Platform passwords always stay local.",
      offers: [
        { "@type": "Offer", price: "9.80", priceCurrency: "USD", name: "Monthly" },
        { "@type": "Offer", price: "98.00", priceCurrency: "USD", name: "Annual" },
        { "@type": "Offer", price: "498.00", priceCurrency: "USD", name: "Lifetime" },
      ],
    },
    {
      "@context": "https://schema.org",
      "@type": "FAQPage",
      mainEntity: [
        {
          "@type": "Question",
          name: "Does it automatically monitor sales and delist domains?",
          acceptedAnswer: {
            "@type": "Answer",
            text: "No. The first version does not run in the background automatically. When you refresh, or when a sale is detected during another operation, the software generates a cross-platform delist checklist for you to confirm and execute.",
          },
        },
        {
          "@type": "Question",
          name: "Are platform passwords and API keys uploaded?",
          acceptedAnswer: {
            "@type": "Answer",
            text: "No. Passwords and login details always stay on your computer. GoodDealer's cloud and operations backend cannot read them. API keys are entered in a secure input field within the software; the cloud only syncs domain names, prices, and other business data.",
          },
        },
        {
          "@type": "Question",
          name: "How many devices can I link?",
          acceptedAnswer: {
            "@type": "Answer",
            text: "Up to two computers. Only one can execute operations at a time; the other can only view. Adding a third requires unlinking an existing one first.",
          },
        },
        {
          "@type": "Question",
          name: "Which registrars and platforms are supported?",
          acceptedAnswer: {
            "@type": "Answer",
            text: "Registrars start with Spaceship, Namecheap, Dynadot, and Alibaba Cloud. DNS supports Cloudflare and registrar-native DNS. Sales platforms cover Atom (Dan.com), Afternic, and SellerHub. Registrars not yet integrated can be supplemented via file import.",
          },
        },
        {
          "@type": "Question",
          name: "Is there a purely local, offline mode?",
          acceptedAnswer: {
            "@type": "Answer",
            text: "No. Cloud sync is a core feature for keeping data consistent between your two computers. Platform passwords still only exist locally.",
          },
        },
        {
          "@type": "Question",
          name: "Will I be charged again after the lifetime purchase?",
          acceptedAnswer: {
            "@type": "Answer",
            text: "No. The lifetime purchase is a one-time payment with no recurring charges. It includes all future major version updates. Monthly and annual plans can be cancelled anytime and stop billing at the end of the period.",
          },
        },
      ],
    },
  ],
};

export const data: MkData = {
  nav: [
    ["features", "Features"],
    ["platforms", "Platforms"],
    ["demo", "Demo"],
    ["security", "Security"],
    ["pricing", "Pricing"],
    ["faq", "FAQ"],
  ],
  hero: {
    eyebrow: "Domain Bulk Management Software · Passwords Stay Local · Multi-Device Sync",
    title: "Domains across registrars and platforms, controlled in one place",
    titleGold: "one place",
    sub: "Registration, DNS, pricing, and listing status managed together. Sync data between two computers and pick up where you left off.",
    ctaPrimary: "Download",
    ctaSecondary: "See Pricing",
    trust: "Your platform passwords and login details always stay on this computer — GoodDealer's cloud only syncs domain and pricing data.",
  },
  benefits: [
    { metric: "1 Screen", title: "Stop logging into platforms one by one", from: "4 platforms · 5 accounts to juggle", to: "Registrar · DNS · listing status in one view" },
    { metric: "Bulk", title: "Change hundreds of domains at once", from: "Editing prices and listings one by one", to: "Filter, bulk-execute, preview before committing" },
    { metric: "Local", title: "Your passwords stay in your hands", from: "Trusting a third party with your login details", to: "Passwords and credentials stored only on your computer" },
    { metric: "Priority", title: "Sold-domain alerts, cross-platform delisting", from: "Still renewing dead domains after a sale", to: "Sales found during a refresh are prioritized with a delist checklist" },
  ],
  workflow: [
    { k: "01", title: "Filter Assets", desc: "Filter domains by tag, registrar, TLD, listing status, and expiry date." },
    { k: "02", title: "Preview Changes", desc: "Review every change about to happen — risk warnings and unsupported items listed separately. High-risk items can be skipped." },
    { k: "03", title: "Confirm & Execute", desc: "You enter logins and verification codes, confirm the plan, and the software executes across platforms on your behalf." },
    { k: "04", title: "Sync & Correct", desc: "Results sync to your other computer automatically. Failed items can be retried; completed changes can be corrected through a new reviewed action." },
  ],
  showcase: [
    { side: "left", tag: "Aggregate", title: "Domains from multiple registrars, unified in one table", desc: "Import domains from Spaceship, Namecheap, Dynadot, and Alibaba Cloud into a single asset table. Duplicates are detected and merged automatically.", anim: "aggregate" },
    { side: "right", tag: "Bulk Listing", title: "Confirm, then list across multiple sales platforms at once", desc: "After you confirm the action plan, a batch of domains is listed on Atom, SellerHub, and Afternic simultaneously, with status updates as each one completes.", anim: "list" },
    { side: "left", tag: "Auto-Verify", title: "Platform verification, handled automatically in bulk", desc: "Sales platforms require domain ownership verification before listing. The software writes verification records, waits for propagation, and confirms — no manual per-domain work.", anim: "verify" },
    { side: "right", tag: "Price Sync", title: "Change a price once, synced across every platform", desc: "After a confirmed bulk price change, results sync to supported sales platforms and your second computer. If a value is wrong, review and submit a corrective change.", anim: "sync" },
  ],
  pillars: [
    { k: "asset", title: "Unified Asset Library", body: "Read domains from registrars like Spaceship. Registrars not yet integrated can be supplemented with file imports. Duplicates are detected automatically. Registrar, expiry, renewal cost, lock status, and DNS provider visible on one screen.", items: ["Tags · Portfolios · Acquisition cost · Notes", "Unrealized gain/loss shown alongside asking price"] },
    { k: "sales", title: "Multi-Platform Sales Management", body: "View listing status on Atom, SellerHub, and Afternic. Set buy-it-now prices, minimum offers, and per-platform prices in bulk. Alerts when a platform price has been manually changed.", items: ["Multiple accounts per platform, managed separately", "Platforms without API support get a manual task guide"] },
    { k: "dns", title: "DNS & Ownership Verification", body: "Automatically detect the DNS provider a domain actually uses. Add verification records on Cloudflare or registrar DNS without overwriting your existing email-related settings (SPF / DKIM / DMARC).", items: ["Changing DNS provider requires explicit confirmation", "Auto-waits for DNS propagation and checks verification results"] },
    { k: "batch", title: "Bulk Operations — Preview Before You Commit", body: "Filter by tag, registrar, TLD, listing status, and expiry. Bulk-change prices, list/delist, and edit DNS. Every change, risk warning, and unsupported item is listed before execution.", items: ["Confirm button shows the exact operation count", "Results categorized: success / failed / pending / needs manual action"] },
  ],
  security: {
    title: "Your platform passwords always stay on this computer",
    sub: "This is fundamentally different from handing your accounts to a third party.",
    points: [
      { t: "Local Execution", tone: "gold", d: "Bulk operations run from the computer you're working on, directly to each platform. Passwords and login details are stored locally — never uploaded to the cloud. GoodDealer cannot read them." },
      { t: "Cloud Sync", tone: "blue", d: "Domain names, prices, listing status, and other business data sync to GoodDealer's cloud so your second computer can view them. No passwords or login details are stored in the cloud." },
      { t: "Two Computers · One Operator", tone: "gold", d: "Link up to two computers. Only one can execute operations at any time; the other can only view. Adding a third requires unlinking an existing one." },
      { t: "You Type, Software Executes", tone: "blue", d: "Platform logins, API keys, and verification codes are all entered by you. The software only executes after you confirm the action plan. You can pause and take over at any time." },
    ],
  },
  plans: [
    { key: "monthly", name: "Monthly", price: 9.8, unit: "/mo", period: "Billed monthly · Cancel anytime", cta: "Choose Monthly" },
    { key: "annual", name: "Annual", price: 98, unit: "/yr", sub: "≈ $8.2/mo · Save 17%", period: "Billed annually · Cancel anytime", cta: "Choose Annual", popular: true },
    { key: "lifetime", name: "Lifetime", price: 498, unit: "one-time", sub: "Includes all future major versions", period: "Pay once · Never charged again", cta: "Choose Lifetime", gold: true },
  ],
  planFeatures: ["Full features · Asset Library · Sales · DNS · Bulk Operations", "Up to two computers · One operator", "Platform passwords always stay local", "14-day full refund"],
  planNote: "All three plans include the exact same features — the only difference is duration: monthly, annual, or one-time purchase. Checkout is handled by Paddle. GoodDealer never touches your card number.",
  faq: [
    { q: "Does it automatically monitor sales and delist domains?", a: "No. The first version does not run in the background automatically. When you refresh, or when a sale is detected during another operation, the software generates a cross-platform delist checklist for you to confirm and execute." },
    { q: "Are platform passwords and API keys uploaded?", a: "No. Passwords and login details always stay on your computer. GoodDealer's cloud and operations backend cannot read them. API keys are entered in a secure input field within the software; the cloud only syncs domain names, prices, and other business data." },
    { q: "How many devices can I link?", a: "Up to two computers. Only one can execute operations at a time; the other can only view. Adding a third requires unlinking an existing one first. If you unlink the active computer, the new device must wait for the current operation to finish before taking over." },
    { q: "Which registrars and platforms are supported?", a: "The release target covers mainstream registrars, sales platforms, and DNS providers, including Spaceship, Namecheap, Dynadot, Alibaba Cloud, Cloudflare, Atom, Spaceship SellerHub, and Afternic. Each integration is released only after its compatibility and safety gates pass; unsupported registrars can be supplemented via file import." },
    { q: "Is there a purely local, offline mode?", a: "No. Cloud sync is a core feature for keeping data consistent between your two computers. Platform passwords still only exist locally." },
    { q: "Will I be charged again after the lifetime purchase?", a: "No. The lifetime purchase is a one-time payment with no recurring charges. It includes all future major version updates. Monthly and annual plans can be cancelled anytime and stop billing at the end of the period." },
  ],
  download: {
    title: "Get started on your computer",
    sub: "Available for macOS and Windows. Download, sign in, link your device, and start managing domains.",
    platforms: [
      ["macOS", "Download for macOS"],
      ["Windows", "Download for Windows"],
    ],
    note: "First use requires signing in and linking a device. Domain and pricing data syncs to the cloud; passwords stay local.",
  },
  platforms: {
    registrars: {
      title: "Domain Registrars",
      sub: "Read domain assets, expiry, lock status & DNS info",
      items: [
        { name: "Spaceship", releaseTarget: true },
        { name: "Namecheap", releaseTarget: true },
        { name: "Dynadot", releaseTarget: true },
        { name: "Alibaba Cloud (万网)", releaseTarget: true },
        { name: "GoDaddy" },
        { name: "Porkbun" },
        { name: "Namesilo" },
        { name: "Name.com" },
        { name: "Epik" },
        { name: "Cloudflare Registrar" },
        { name: "西部数码" },
        { name: "新网" },
        { name: "腾讯云" },
      ],
    },
    sales: {
      title: "Domain Sales Platforms",
      sub: "List, reprice, check status & verify ownership",
      items: [
        { name: "Atom", releaseTarget: true },
        { name: "Spaceship SellerHub", releaseTarget: true },
        { name: "Afternic", releaseTarget: true },
        { name: "Sedo" },
        { name: "GoDaddy Auctions" },
        { name: "Efty" },
        { name: "Squadhelp" },
        { name: "易名" },
        { name: "爱名网" },
      ],
    },
    dns: {
      title: "DNS Management",
      sub: "Add verification records, wait for propagation, protect email settings",
      items: [
        { name: "Cloudflare", releaseTarget: true },
        { name: "Registrar-Native DNS", releaseTarget: true },
        { name: "AWS Route 53" },
        { name: "Google Cloud DNS" },
        { name: "Azure DNS" },
        { name: "DNSPod (Tencent Cloud)" },
        { name: "Alibaba Cloud DNS" },
      ],
    },
  },
  footer: {
    tagline: "Passwords stay local · Bulk domain management · Multi-device sync",
    cols: [
      ["Product", ["Features", "Security Model", "Pricing", "Download"]],
      ["Account", ["Sign In / Register", "Manage Subscription", "Devices & Security"]],
      ["Resources", ["Support Center", "Data & Privacy", "Terms of Service"]],
    ],
  },
  // ui — component-level strings that are NOT in the data blocks above (section headers, eyebrows,
  // diagram labels, animation captions). Keyed by component for easy lookup.
  ui: {
    shell: { login: "Sign In", download: "Download", footerLegal: "Paddle is the Merchant of Record — checkout never touches your card number", footerLang: "English first · 中文也有" },
    hero: { eyebrowSub: "Domain Asset Management", titleBefore: "Domains across registrars\nand platforms, ", titleGold: "controlled in one place" },
    benefits: { tag: "Feature Highlights", tagSub: "What You Get", h2: "Multi-registrar domains, unified bulk management", lead: "Stop switching between registrars and sales platforms — filter, reprice, list, verify, all in one place.", from: "From", to: "To" },
    pillars: { tag: "Core Scenarios", tagSub: "Four Core Capabilities", h2: "From asset library to bulk operations", lead: "Registrars, DNS, and sales platforms each go their own way. GoodDealer unifies them into one domain table you can bulk-edit — preview before you commit." },
    workflow: { tag: "Core Workflow", tagSub: "Four steps in every bulk operation", h2: "Filter · Preview · Confirm · Sync", lead: "Every bulk operation follows the same path — see exactly what will change, then confirm." },
    showcase: {
      tag: "Features",
      tagSub: "See them in action",
      h2: "Not concepts — working features in motion",
      aggWin: "Aggregate · Asset Library",
      aggSrc: "Domain Registrars",
      aggDomain: "Domain",
      aggRegistrar: "Registrar",
      aggNote: "Connect a registrar to pull domains in batch · whole batch arrives along the line · multi-row insert",
      listWin: "Bulk Listing · Domain × Platform",
      listListed: "Listed ✓",
      listDone: "Listed 12 items · 3 platforms",
      listBody: ["List the selected ", "4", " domains on Atom · SellerHub · Afternic across ", "3", " sales platforms."],
      listConfirm: "Confirm",
      listNote: "After confirming, the software lists across platforms · — unlisted, Listed ✓ listed",
      verifyWin: "Auto-Verify Ownership",
      verifyHead: "· Software auto-verifies a batch of domains",
      verifyDomain: "Domain",
      verifyPlatform: "Sales Platform",
      verifyStatus: "Verify",
      verifyWait: "Pending",
      verifyIng: "Verifying · TXT",
      verifyOk: "Verified",
      verifyNote: "Auto-writes verification records, waits for propagation, confirms — no manual work",
      syncWin: "Price Sync · Change Once",
      syncNote: "Change once · pulse travels along spokes · synced one by one",
    },
    platforms: { tag: "Platform Coverage", tagSub: "Registrars · Sales · DNS", h2: "Mainstream registrars and sales platforms, expanding coverage", lead: "GoodDealer's release target covers most mainstream domain platforms. Gold marks the release target, not current availability: every integration remains unavailable until its compatibility and safety gates pass.", soon: "Future target", footerNote: "■ Gold border = release target, subject to compatibility and safety gates · Others follow by demand · Unsupported registrars can import files" },
    security: {
      tag: "Security Model",
      tagSub: "Passwords stay local · Cloud read-only",
      neverLeaves: "Never leaves this device",
      localNode: { title: "Your Computer", sub: "Operations execute here", items: ["Platform passwords", "Login details", "Browser data"] },
      arrow: { label: "Only business data syncs", sub: "No passwords" },
      cloudNode: { title: "GoodDealer Cloud", sub: "For your second device to view", items: ["Domains · Prices · Listing status", "Operation logs (no passwords)"] },
    },
    pricing: { tag: "Pricing", tagSub: "Monthly · Annual · Lifetime", h2: "Pick a duration — features are exactly the same", popular: "Most Popular", oneTime: "One-Time Purchase" },
    faq: { tag: "FAQ", tagSub: "Boundaries & Commitments", h2: "Let's be clear about the boundaries" },
    download: { tag: "Download", tagSub: "macOS · Windows" },
  },
};
