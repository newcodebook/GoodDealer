// 销售管理 / Sales Desk — the revenue surface: Listings · Offers(议价) · Deals(成交与交割).
// Money moments: 接受报价 = binding commitment (precise offer/fee/net + ack); 推送转移 = registrar handoff to buyer.
// Gold is reserved for value results (成交额 / 净收入 / 挂牌估值 / SOLD) — never process amounts.
const {Tabs:LTabs,Table:LTable,Badge:LBadge,Money:LMoney,Button:LBtn,Input:LInput,Dialog:LDlg,Checkbox:LCheck,ProgressBar:LProg,Tag:LTag,Toolbar:LToolbar}=window.GoodDealerDesignSystem_b5b0b6;
const FEE={Atom:0.10,Afternic:0.15,SellerHub:0.12};
const lnum=v=>{const n=Number(String(v).replace(/[^0-9.]/g,""));return isFinite(n)?n:0;};
const money=n=>Number(n).toLocaleString("en-US",{minimumFractionDigits:2,maximumFractionDigits:2});

function lseed(){
  return {
    listings:[
      {id:1,domain:"vault.io",platforms:"Atom · Afternic",bin:280000,views:1240,offers:3,status:"active",listed:"06-02"},
      {id:2,domain:"kanban.ai",platforms:"Atom",bin:99999,views:860,offers:1,status:"active",listed:"07-14"},
      {id:3,domain:"quanta.trade",platforms:"Atom · SellerHub",bin:42000,views:410,offers:1,status:"active",listed:"05-20"},
      {id:4,domain:"helio.systems",platforms:"Afternic",bin:18500,views:96,offers:0,status:"paused",listed:"04-11"},
      {id:5,domain:"mint.money",platforms:"Atom",bin:65000,views:520,offers:0,status:"active",listed:"07-28"},
      {id:6,domain:"forge.dev",platforms:"—",bin:12000,views:0,offers:0,status:"draft",listed:"—"},
    ],
    offers:[
      {id:"f1",domain:"vault.io",buyer:"buyer·7Q2",offer:212000,bin:280000,platform:"Atom",state:"pending",age:"2 小时前"},
      {id:"f2",domain:"kanban.ai",buyer:"buyer·A19",offer:88000,bin:99999,platform:"Atom",state:"pending",age:"今日 09:40"},
      {id:"f3",domain:"quanta.trade",buyer:"buyer·M53",offer:31000,bin:42000,platform:"SellerHub",state:"countered",age:"昨日",ask:37000},
      {id:"f4",domain:"vault.io",buyer:"buyer·K08",offer:150000,bin:280000,platform:"Afternic",state:"declined",age:"07-30"},
      {id:"f5",domain:"mint.money",buyer:"buyer·33F",offer:64000,bin:65000,platform:"Atom",state:"pending",age:"30 分钟前"},
    ],
    deals:[
      {id:"d1",domain:"oxide.dev",amount:52000,platform:"Atom",buyer:"buyer·55A",stage:"transfer_pending"},
      {id:"d2",domain:"arc.exchange",amount:33000,platform:"Afternic",buyer:"buyer·9C1",stage:"escrow"},
      {id:"d3",domain:"north.capital",amount:21500,platform:"Atom",buyer:"buyer·B7X",stage:"transferred"},
      {id:"d4",domain:"legacy.io",amount:14200,platform:"Atom",buyer:"buyer·2D0",stage:"paid"},
    ],
  };
}
const OFFER_STATE={pending:{tone:"warning",label:"待回应"},countered:{tone:"sync",label:"已还价"},accepted:{tone:"gold",label:"已接受"},declined:{tone:null,label:"已拒绝"},expired:{tone:null,label:"已过期"}};
const STAGE=[["escrow","托管中",0.25,"warning"],["transfer_pending","待推送转移",0.5,"sync"],["transferred","已过户·待放款",0.75,"sync"],["paid","已放款·完成",1,"success"]];
const stageOf=k=>STAGE.find(s=>s[0]===k);

function SalesDesk({addUnsynced}){
  const I=window.GDI;
  const [d,setD]=React.useState(lseed);
  const [tab,setTab]=React.useState("offers");
  const [accept,setAccept]=React.useState(null);
  const [ackA,setAckA]=React.useState(false);
  const [counter,setCounter]=React.useState(null);
  const [cVal,setCVal]=React.useState("");
  const [xfer,setXfer]=React.useState(null);
  const [ackX,setAckX]=React.useState(false);

  const pendingOffers=d.offers.filter(o=>o.state==="pending").length;
  const listedValue=d.listings.filter(l=>l.status==="active").reduce((s,l)=>s+l.bin,0);
  const monthGmv=d.deals.reduce((s,x)=>s+x.amount,0);
  const settling=d.deals.filter(x=>x.stage!=="paid").length;
  const kpis=[["在售 Listing",String(d.listings.filter(l=>l.status==="active").length),null],["挂牌估值","$"+money(listedValue),"gold"],["待处理报价",String(pendingOffers),"warning"],["成交额（本月）","$"+money(monthGmv),"gold"],["交割中",String(settling),"blue"]];
  const kcolor=t=>t==="gold"?"var(--gd-gold)":t==="warning"?"var(--gd-warning)":t==="blue"?"var(--gd-blue)":"var(--text-1)";

  const feeOf=o=>FEE[o.platform]??0.12;
  const netOf=o=>Math.round(o.offer*(1-feeOf(o)));
  const doAccept=()=>{const o=accept;setAccept(null);setAckA(false);
    setD(s=>({...s,offers:s.offers.map(x=>x.id===o.id?{...x,state:"accepted"}:x),deals:[{id:"d"+Date.now(),domain:o.domain,amount:o.offer,platform:o.platform,buyer:o.buyer,stage:"escrow"},...s.deals]}));
    setTab("deals");};
  const doCounter=()=>{const o=counter;const v=lnum(cVal);setCounter(null);setCVal("");if(!v)return;setD(s=>({...s,offers:s.offers.map(x=>x.id===o.id?{...x,state:"countered",ask:v}:x)}));};
  const decline=o=>setD(s=>({...s,offers:s.offers.map(x=>x.id===o.id?{...x,state:"declined"}:x)}));
  const doXfer=()=>{const x=xfer;setXfer(null);setAckX(false);setD(s=>({...s,deals:s.deals.map(y=>y.id===x.id?{...y,stage:"transferred"}:y)}));addUnsynced&&addUnsynced(1);};

  // Column priority (reference adoption of GDResponsiveTable): identity/value/status/actions are essential;
  // platform & offer-count are secondary; view-count & listed-date are supplementary (drop first when narrow).
  const listingsTab=<window.GDResponsiveTable density="regular" rowKey="id" maxHeight="100%" style={{border:"none",borderRadius:0}}
    columns={[
      {key:"domain",label:"域名",priority:"essential",render:r=><span style={{fontFamily:"var(--font-mono)",fontSize:12,color:"var(--text-1)"}}>{r.domain}</span>},
      {key:"platforms",label:"平台",priority:"secondary",muted:true},
      {key:"bin",label:"BIN",priority:"essential",numeric:true,render:r=><LMoney amount={r.bin}/>},
      {key:"views",label:"浏览",priority:"supplementary",numeric:true,muted:true,width:72,render:r=><span style={{fontFamily:"var(--font-mono)"}}>{r.views.toLocaleString()}</span>},
      {key:"offers",label:"询价",priority:"secondary",numeric:true,width:64,render:r=><span style={{fontFamily:"var(--font-mono)",color:r.offers?"var(--gd-blue)":"var(--gd-text-faint)"}}>{r.offers}</span>},
      {key:"status",label:"状态",priority:"essential",width:88,render:r=><LBadge tone={r.status==="active"?"success":r.status==="paused"?"warning":undefined} mono={false}>{r.status==="active"?"在售":r.status==="paused"?"暂停":"草稿"}</LBadge>},
      {key:"listed",label:"上架",priority:"supplementary",numeric:true,muted:true,width:80},
      {key:"act",label:"",priority:"essential",width:150,render:r=><span style={{display:"flex",gap:6,justifyContent:"flex-end"}}>{r.status==="draft"?<LBtn size="sm" variant="primary">上架</LBtn>:<><LBtn size="sm" variant="ghost">改价</LBtn><LBtn size="sm" variant="ghost">{r.status==="paused"?"恢复":"暂停"}</LBtn></>}</span>},
    ]} rows={d.listings}/>;

  const offersTab=<window.GDResponsiveTable density="regular" rowKey="id" maxHeight="100%" style={{border:"none",borderRadius:0}}
    columns={[
      {priority:"essential",key:"domain",label:"域名",render:r=><span style={{fontFamily:"var(--font-mono)",fontSize:12,color:"var(--text-1)"}}>{r.domain}</span>},
      {priority:"secondary",key:"buyer",label:"买家",render:r=><span style={{fontFamily:"var(--font-mono)",fontSize:12,color:"var(--gd-text-muted)"}}>{r.buyer}</span>,width:104},
      {priority:"essential",key:"offer",label:"报价",numeric:true,render:r=><span style={{display:"inline-flex",flexDirection:"column",alignItems:"flex-end"}}><LMoney amount={r.offer} tone="body"/><span style={{fontSize:10,color:"var(--gd-text-faint)",fontFamily:"var(--font-mono)"}}>BIN {money(r.bin)} · {Math.round((r.offer/r.bin-1)*100)}%</span></span>},
      {priority:"secondary",key:"ask",label:"我方还价",numeric:true,width:104,render:r=>r.ask?<LMoney amount={r.ask} tone="body"/>:<span style={{color:"var(--gd-text-faint)"}}>—</span>},
      {priority:"secondary",key:"platform",label:"平台",muted:true,width:88},
      {priority:"essential",key:"state",label:"状态",width:88,render:r=><LBadge tone={OFFER_STATE[r.state].tone} mono={false}>{OFFER_STATE[r.state].label}</LBadge>},
      {priority:"supplementary",key:"age",label:"时间",numeric:true,muted:true,width:92},
      {priority:"essential",key:"act",label:"",width:184,render:r=>["pending","countered"].includes(r.state)?<span style={{display:"flex",gap:6,justifyContent:"flex-end"}}>
        <LBtn size="sm" variant="primary" onClick={()=>{setAccept(r);setAckA(false);}}>接受</LBtn>
        <LBtn size="sm" onClick={()=>{setCounter(r);setCVal(String(r.ask||Math.round((r.offer+r.bin)/2)));}}>还价</LBtn>
        <LBtn size="sm" variant="ghost" onClick={()=>decline(r)}>拒绝</LBtn>
      </span>:<span style={{fontSize:11,color:"var(--gd-text-faint)"}}>{r.state==="accepted"?"已转成交":"—"}</span>},
    ]} rows={d.offers}/>;

  const dealsTab=<window.GDResponsiveTable density="regular" rowKey="id" maxHeight="100%" style={{border:"none",borderRadius:0}}
    columns={[
      {priority:"essential",key:"domain",label:"域名",render:r=><span style={{fontFamily:"var(--font-mono)",fontSize:12,color:"var(--text-1)"}}>{r.domain}</span>},
      {priority:"essential",key:"amount",label:"成交额",numeric:true,render:r=><LMoney amount={r.amount}/>},
      {priority:"secondary",key:"net",label:"净收入",numeric:true,width:120,render:r=><LMoney amount={Math.round(r.amount*(1-(FEE[r.platform]??0.12)))}/>},
      {priority:"secondary",key:"platform",label:"平台",muted:true,width:84},
      {priority:"supplementary",key:"buyer",label:"买家",muted:true,width:96,render:r=><span style={{fontFamily:"var(--font-mono)",fontSize:12}}>{r.buyer}</span>},
      {priority:"essential",key:"stage",label:"交割进度",width:190,render:r=>{const st=stageOf(r.stage);return <div style={{display:"flex",flexDirection:"column",gap:4}}><LBadge tone={r.stage==="paid"?"gold":st[3]} mono={false}>{st[1]}</LBadge><LProg segments={[{value:st[2]*100,tone:st[3]}]} height={4}/></div>;}},
      {priority:"essential",key:"act",label:"",width:132,render:r=>r.stage==="transfer_pending"?<LBtn size="sm" variant="primary" onClick={()=>{setXfer(r);setAckX(false);}} icon={<I.ExternalLink size={13}/>}>推送转移</LBtn>:r.stage==="escrow"?<span style={{fontSize:11,color:"var(--gd-text-faint)"}}>待买家付款</span>:r.stage==="transferred"?<LBtn size="sm" variant="ghost">确认放款</LBtn>:<LBadge tone="gold">SOLD</LBadge>},
    ]} rows={d.deals}/>;

  const MetricStrip=window.GDMetricStrip;
  return <div data-screen-label="销售管理" style={{display:"flex",flexDirection:"column",height:"100%",minHeight:0}}>
    <MetricStrip metrics={kpis.map(k=>({label:k[0],value:k[1],tone:k[2]}))}/>
    <LToolbar region
      left={<LTabs active={tab} onChange={setTab} items={[{key:"listings",label:"在售 Listing",count:d.listings.filter(l=>l.status==="active").length},{key:"offers",label:"报价 · 议价",count:pendingOffers},{key:"deals",label:"成交与交割",count:settling}]} style={{border:"none"}}/>}
      right={<LBtn size="sm" variant="primary" icon={<I.Upload size={14}/>}>新建 Listing</LBtn>}/>
    <div style={{flex:1,minHeight:0}}>{tab==="listings"?listingsTab:tab==="offers"?offersTab:dealsTab}</div>

    <LDlg open={!!accept} onClose={()=>{setAccept(null);setAckA(false);}} title="接受报价 · 生成托管交易" width={464}
      footer={<><LBtn onClick={()=>{setAccept(null);setAckA(false);}}>取消</LBtn><LBtn variant="primary" disabled={!ackA} onClick={doAccept}>接受 · 净 ${accept&&money(netOf(accept))}</LBtn></>}>
      {accept&&<div style={{display:"flex",flexDirection:"column",gap:12}}>
        <span style={{fontSize:13}}>接受 <b style={{fontFamily:"var(--font-mono)"}}>{accept.buyer}</b> 对 <b style={{fontFamily:"var(--font-mono)"}}>{accept.domain}</b> 的报价。</span>
        <div style={{border:"1px solid var(--gd-line-strong)",borderRadius:7,background:"var(--gd-panel)",padding:"11px 13px",display:"flex",flexDirection:"column",gap:7,fontSize:13}}>
          <div style={{display:"flex",justifyContent:"space-between"}}><span style={{color:"var(--gd-text-muted)"}}>报价</span><LMoney amount={accept.offer}/></div>
          <div style={{display:"flex",justifyContent:"space-between"}}><span style={{color:"var(--gd-text-muted)"}}>{accept.platform} 平台费 {Math.round(feeOf(accept)*100)}%</span><span style={{fontFamily:"var(--font-mono)",color:"var(--gd-danger)"}}>−${money(Math.round(accept.offer*feeOf(accept)))}</span></div>
          <div style={{display:"flex",justifyContent:"space-between",borderTop:"1px solid var(--gd-line)",paddingTop:7}}><span>预计净收入</span><LMoney amount={netOf(accept)} size={15}/></div>
        </div>
        <div style={{borderTop:"1px solid var(--gd-line)",paddingTop:10}}><LCheck checked={ackA} onChange={()=>setAckA(a=>!a)} label="我确认接受此报价；接受即生成托管交易，具约束力"/></div>
      </div>}
    </LDlg>

    <LDlg open={!!counter} onClose={()=>{setCounter(null);setCVal("");}} title="还价 · Counter" width={420}
      footer={<><LBtn onClick={()=>{setCounter(null);setCVal("");}}>取消</LBtn><LBtn variant="primary" onClick={doCounter}>发送还价</LBtn></>}>
      {counter&&<div style={{display:"flex",flexDirection:"column",gap:12}}>
        <div style={{display:"flex",alignItems:"center",gap:10,fontSize:13}}>
          <span style={{fontFamily:"var(--font-mono)"}}>{counter.domain}</span>
          <span style={{color:"var(--gd-text-faint)"}}>买家 ${money(counter.offer)} · BIN ${money(counter.bin)}</span>
        </div>
        <LInput label="我方还价" size="md" mono prefix="$" value={cVal} onChange={e=>setCVal(e.target.value)} style={{width:200}}/>
        <span style={{fontSize:11,color:"var(--gd-text-faint)"}}>还价通过平台发送给买家，等待其回应；不改变 Listing BIN。</span>
      </div>}
    </LDlg>

    <LDlg open={!!xfer} onClose={()=>{setXfer(null);setAckX(false);}} title="推送域名转移 · 交割" width={484} danger
      footer={<><LBtn onClick={()=>{setXfer(null);setAckX(false);}}>取消</LBtn><LBtn variant="danger" disabled={!ackX} onClick={doXfer}>推送转移到买家</LBtn></>}>
      {xfer&&<div style={{display:"flex",flexDirection:"column",gap:12}}>
        <span style={{fontSize:13}}>将 <b style={{fontFamily:"var(--font-mono)"}}>{xfer.domain}</b> 转移至买家 <b style={{fontFamily:"var(--font-mono)"}}>{xfer.buyer}</b>（成交额 ${money(xfer.amount)}）。</span>
        <div style={{border:"1px solid var(--gd-danger)",background:"var(--gd-danger-tint)",borderRadius:7,padding:"11px 13px",display:"flex",flexDirection:"column",gap:9}}>
          <div style={{display:"flex",alignItems:"center",gap:8}}><I.AlertTriangle size={15} style={{color:"var(--gd-danger)",flex:"none"}}/><b style={{color:"var(--gd-danger)",fontSize:13}}>不可逆 · 所有权转移</b><span style={{marginLeft:"auto",fontSize:11,color:"var(--gd-text-muted)"}}>由注册商执行</span></div>
          <span style={{fontSize:12,color:"var(--gd-text)",lineHeight:1.5}}>推送后在注册商发起转移授权码，所有权移交买家，不可撤销。请确认已收到托管放款条件满足。</span>
          <div style={{borderTop:"1px solid rgba(229,115,95,0.24)",paddingTop:9}}><LCheck checked={ackX} onChange={()=>setAckX(a=>!a)} label="我确认托管条件满足，推送不可逆的所有权转移"/></div>
        </div>
      </div>}
    </LDlg>
  </div>;
}
window.GDSalesDesk=SalesDesk;
