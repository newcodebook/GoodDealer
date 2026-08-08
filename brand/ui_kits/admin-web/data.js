// admin-web mock data. Owner-only staff console. Admins NEVER see platform credentials / cookies /
// browser profiles / DB keys / backup secrets — those fields don't exist here at all.
window.ADM_DATA={
  staff:{name:"Owner","email":"owner@gooddealer.com",passkeyFresh:"08:14",epoch:3},
  accounts:[
    {id:"acc_7Q2",email:"investor@domain.com",plan:"annual",state:"active",devices:2,secEpoch:5,created:"2025-12-31",flags:[]},
    {id:"acc_B3F",email:"seller@mail.com",plan:"lifetime",state:"active",devices:1,secEpoch:2,created:"2025-06-10",flags:[]},
    {id:"acc_M53",email:"pro@invest.io",plan:"monthly",state:"grace",devices:2,secEpoch:9,created:"2026-02-14",flags:["支付宽限"]},
    {id:"acc_K08",email:"user@example.com",plan:"annual",state:"suspended",devices:1,secEpoch:12,created:"2025-03-01",flags:["拒付"]},
    {id:"acc_33F",email:"stolen@risk.net",plan:"annual",state:"active",devices:2,secEpoch:21,created:"2025-09-09",flags:["接管恢复","安全事件"]},
  ],
  // per-account detail (loaded only after AdminReadAuthorization ceremony)
  detail:{
    entitlement:{plan:"年付 License",state:"active",revision:47,commercialExpires:"2026-12-31",offlineGraceUntil:"—",deviceLimit:2,paymentWatermark:"pw:9f3a…"},
    devices:[
      {name:"MacBook Pro",role:"active",epoch:41,credEpoch:7,last:"现在"},
      {name:"iPhone 17",role:"standby",epoch:"—",credEpoch:4,last:"08:30"},
    ],
    sessions:[{agent:"桌面客户端 · 本地",last:"现在"},{agent:"网页 · 上海",last:"3 天前",risk:true}],
    security:{state:"normal",secEpoch:5,lastPwChange:"2025-12-31"},
    entitlementEvents:[
      {at:"2025-12-31",type:"ProviderPaymentEvent",note:"年付续费 · Paddle",amount:98},
      {at:"2025-12-31",type:"ProviderPaymentEvent",note:"年付首购 · Paddle",amount:98},
    ],
  },
  // License 与订单 — global billing/entitlement ledger. Read-only, no platform creds. Paddle is the
  // Merchant of Record; GoodDealer never touches card data. Per-account changes happen in account detail
  // via AdminActionAuthorization; this page is reconciliation + append-only audit of what happened.
  licensing:{
    stats:{monthInflow:"$4,382",refunds:"$196",chargebacks:2,adjustments:5,pendingRecon:1},
    payments:[
      {at:"2026-08-08 02:11",acct:"acc_7Q2",type:"renewal",note:"年付续费",amount:98,paddle:"pdl_9f31",revision:"47→47"},
      {at:"2026-08-07 19:40",acct:"acc_M53",type:"purchase",note:"月付首购",amount:9.8,paddle:"pdl_9e02",revision:"1→2"},
      {at:"2026-08-06 11:02",acct:"acc_K08",type:"chargeback",note:"拒付 · 银行退单",amount:-98,paddle:"pdl_7b55",revision:"→suspended"},
      {at:"2026-08-05 08:30",acct:"acc_B3F",type:"purchase",note:"终身买断",amount:498,paddle:"pdl_6a10",revision:"1→1"},
      {at:"2026-08-03 14:20",acct:"acc_33F",type:"refund",note:"部分退款 · 支持裁定",amount:-98,paddle:"pdl_5c88",revision:"47→47"},
    ],
    // append-only ManualEntitlementAdjustment audit — every manual change, who/why/PurposeRef
    adjustments:[
      {at:"2026-08-07 10:05",acct:"acc_33F",by:"Owner",change:"商业到期 2026-12-31 → 2027-01-14",reason:"云端不可用补偿 14 天",purpose:"SEC-2026-003",revision:"46→47"},
      {at:"2026-08-02 16:48",acct:"acc_M53",by:"Owner",change:"宽限期 +7 天",reason:"支付网关延迟确认",purpose:"GD-4790",revision:"1→1"},
    ],
  },
  // homepage health
  health:{cloudSlo:"99.97%",openCases:3,quarantine:2,jobsHealthy:true,activeLeases:412,pendingMutations:38},
  // open cases (compliance/security/support). Each case IS the AdminPurposeRef that legitimizes a
  // read/action; its purposeType decides what scopes/actions are even permissible (see purposeMatrix).
  cases:[
    {ref:"DR-2026-014",kind:"deletion",purposeType:"datarights",acct:"acc_K08",state:"identity_verified",at:"2 小时前",
      requestType:"账号数据删除",coolingOffUntil:"2026-08-15",
      timeline:[["received","请求受理","2026-08-08 06:02","done"],["identity_verified","身份核验通过","2026-08-08 08:40","done"],["cooling_off","7 天冷静期","至 2026-08-15","current"],["fulfilled","执行删除","—","todo"]],
      authorizes:["读该账号业务明细（办理所需）","数据导出 / 数据删除（冷静期后，需 AdminActionAuthorization）"],
      denies:["不解锁 Entitlement 修改、设备强移、安全内幕读取"]},
    {ref:"SEC-2026-003",kind:"incident",purposeType:"incident",acct:"acc_33F",state:"contained",at:"今日 08:10",
      requestType:"账号接管 / 设备被盗",coolingOffUntil:null,
      timeline:[["detected","检测到异常登录","今日 07:55","done"],["contained","已遏制 · 冻结陌生会话","今日 08:10","current"],["eradicated","清除入侵向量","—","todo"],["recovered","账号恢复","—","todo"]],
      authorizes:["读安全状态 / 会话 / 设备","强制移除设备、撤销会话（需 AdminActionAuthorization）"],
      denies:["不解锁数据删除、不改计费 Entitlement"]},
    {ref:"GD-4821",kind:"support",purposeType:"support",acct:"acc_7Q2",state:"pending",at:"昨日",
      requestType:"续费发票咨询",coolingOffUntil:null,
      timeline:[["open","工单创建","昨日 14:20","done"],["pending","等待用户回复","昨日 15:00","current"],["closed","关闭","—","todo"]],
      authorizes:["读 Entitlement / 设备（诊断所需）","补偿性 Entitlement 调整（需 AdminActionAuthorization）"],
      denies:["不读安全内幕、不强移设备、不导出/删除数据"]},
  ],
  // Purpose limitation matrix — which AdminPurposeRef type legitimizes which read scope / write action.
  // allow / limited / deny. This is least-privilege made explicit: a purpose can't be repurposed.
  purposeMatrix:{
    cols:[["r_ent","读 Entitlement"],["r_dev","读 设备/会话"],["r_sec","读 安全状态"],["a_ent","改 Entitlement"],["a_dev","强移设备/撤会话"],["a_exp","数据导出"],["a_del","数据删除"]],
    rows:[
      {t:"support",label:"支持工单",cells:{r_ent:"allow",r_dev:"allow",r_sec:"deny",a_ent:"limited",a_dev:"deny",a_exp:"deny",a_del:"deny"}},
      {t:"datarights",label:"数据权利",cells:{r_ent:"allow",r_dev:"allow",r_sec:"deny",a_ent:"deny",a_dev:"deny",a_exp:"allow",a_del:"limited"}},
      {t:"incident",label:"安全事件",cells:{r_ent:"limited",r_dev:"allow",r_sec:"allow",a_ent:"deny",a_dev:"allow",a_exp:"deny",a_del:"deny"}},
    ],
    notes:{limited:"limited：受限——如支持工单仅补偿性调整、数据权利删除需冷静期、安全事件仅诊断范围读 Entitlement。"},
  },
  // Jobs 与隔离区 — controlled execution health + poison-task quarantine. Disposition never re-runs a
  // confirmed write; outcome_unknown tasks are frozen for check-only, mirroring the client crash-recovery scan.
  jobs:{
    lease:{active:412,heartbeatOk:true,idempotencyOk:true,replayBlocked:3,staleLeases:0},
    quarantine:[
      {id:"job_8831",kind:"listing_publish",acct:"acc_M53",classify:"outcome_unknown",fails:3,at:"07:52",reason:"平台返回验证码，结果未知（可能已上架）"},
      {id:"job_7720",kind:"offer_respond",acct:"acc_33F",classify:"non_idempotent",fails:5,at:"06:10",reason:"非幂等重试保护触发，禁止自动重放"},
    ],
  },
  // 同步诊断 — read-only observability into the sync engine (Lease/Mutation/Cursor/Checkpoint/Candidate/
  // LateExecution). Reconciliation ACTIONS (promote RestoreCandidate, clear StaleDeviceCandidate) run through
  // controlled Repair + AdminActionAuthorization and are high-risk / never batched — this page only observes.
  diagnostics:{
    summary:{activeLeases:412,pendingMutations:38,staleCandidates:2,lateEvents:1,checkpointLag:"12s"},
    sample:{
      acct:"acc_33F",
      lease:{holder:"MacBook Pro",epoch:41,heartbeat:"3s 前",state:"held"},
      cursors:[{device:"MacBook Pro",cursor:"m_10428",lag:0},{device:"iPhone 17",cursor:"m_10402",lag:26}],
      checkpoint:{id:"ckpt_881",at:"08:12",mutationsSince:38},
      candidates:[
        {type:"StaleDeviceCandidate",device:"iPhone 17",reason:"心跳超时 > 90s",risk:"high"},
        {type:"RestoreCandidate",source:"backup_0731",reason:"本地库校验失败",risk:"high"},
      ],
      lateExecutions:[
        {id:"le_44",task:"listing_publish",at:"07:53",note:"提交边界后到达，已按幂等键去重，未重复下单"},
      ],
    },
  },
  // 发布与政策 — release channels + the network policy that IS the source of the desktop tri-axis network's
  // Cloud axis and per-Provider axis. Pausing a provider/cloud is high-impact: it flows to every user's client.
  release:{
    channels:[
      {platform:"macOS",stable:"1.4.2",beta:"1.5.0-rc1",min:"1.3.0",rollout:"100%"},
      {platform:"Windows",stable:"1.4.2",beta:"1.5.0-rc1",min:"1.3.0",rollout:"60%"},
    ],
    cloud:{state:"available",note:"云端调度正常"},
    providers:[
      {name:"Atom",accounts:2,automation:"on"},
      {name:"Sedo",accounts:1,automation:"paused",window:"至 09:30",reason:"平台风控升级"},
      {name:"Dan",accounts:1,automation:"on"},
      {name:"Afternic",accounts:1,automation:"on"},
    ],
    policyLog:[
      {at:"今日 06:00",change:"Sedo 自动化暂停至 09:30",by:"Owner",reason:"平台风控升级",ref:"OPS-2026-102"},
    ],
  },
  // 审计 — append-only. Every controlled read/action/case/job/policy leaves a trace here. Nothing else can.
  audit:[
    {at:"今日 08:41",actor:"Owner",type:"action",target:"acc_33F",purpose:"SEC-2026-003",detail:"强制移除设备 iPhone 17 · 受控 Repair",outcome:"committed"},
    {at:"今日 08:40",actor:"Owner",type:"read",target:"acc_33F",purpose:"SEC-2026-003",detail:"AdminReadAuthorization · 4 Scope 明细读",outcome:"granted"},
    {at:"今日 08:10",actor:"Owner",type:"case",target:"SEC-2026-003",purpose:"SEC-2026-003",detail:"案件推进 → 已遏制·冻结陌生会话",outcome:"advanced"},
    {at:"今日 07:55",actor:"Owner",type:"job",target:"job_8831",purpose:"OPS-2026-102",detail:"毒任务冻结人工核对（结果未知）",outcome:"frozen"},
    {at:"今日 06:00",actor:"Owner",type:"policy",target:"Sedo",purpose:"OPS-2026-102",detail:"平台自动化暂停至 09:30",outcome:"published"},
    {at:"昨日 16:48",actor:"Owner",type:"action",target:"acc_M53",purpose:"GD-4790",detail:"ManualEntitlementAdjustment 宽限 +7 天",outcome:"committed"},
  ],
};
