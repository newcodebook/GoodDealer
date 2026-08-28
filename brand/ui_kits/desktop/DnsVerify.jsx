// DNS 与验证 / DNS & Verification — cross-domain NS/records health + ownership verification.
// NS(注册商委派) vs 记录(DNS 提供商) kept distinct; 所有权 via TXT _atomverify (gold moment).
// Fix actions reuse the batch NS / records dialogs; re-verify re-checks the TXT token.
const {Table:VTable,Badge:VBadge,Button:VBtn,StatusDot:VDot,Select:VSel,Input:VInput,Toolbar:VToolbar,Tag:VTag,Dialog:VDlg}=window.GoodDealerDesignSystem_b5b0b6;

function vseed(){
  const t=d=>"_atomverify="+d.replace(/\W/g,"").slice(0,4)+Math.floor(Math.random()*90+10);
  const r=(id,domain,owner,ns,nsOk,records,provider,status,last)=>({id,domain,owner,ns,nsOk,records,provider,status,last,token:t(domain)});
  return [
    r(1,"vault.io","verified","Cloudflare",true,"ok","Cloudflare","ok","14:02"),
    r(2,"kanban.ai","verified","Cloudflare",true,"ok","Cloudflare","ok","14:01"),
    r(3,"goldrail.com","pending","Cloudflare",true,"warn","Cloudflare","propagating","13:40"),
    r(4,"quanta.trade","verified","Cloudflare",true,"ok","Cloudflare","ok","12:20"),
    r(5,"helio.systems","failed","ns.dynadot.com",false,"missing","Dynadot","warn","07-30"),
    r(6,"crest.capital","verified","Cloudflare",true,"warn","Cloudflare","warn","11:05"),
    r(7,"north.capital","pending","ns.spaceship.com",false,"ok","Spaceship","warn","09-12"),
    r(8,"mint.money","verified","Cloudflare",true,"ok","Cloudflare","ok","14:00"),
    r(9,"forge.dev","pending","未知 NS",false,"missing","—","warn","—"),
    r(10,"spark.trade","verified","Cloudflare",true,"ok","Cloudflare","ok","13:58"),
  ];
}
const OWNER={verified:{tone:"gold",label:"已验证"},pending:{tone:"warning",label:"待验证"},failed:{tone:"danger",label:"失效"}};
const REC={ok:{tone:"success",label:"正常"},warn:{tone:"warning",label:"告警"},missing:{tone:"danger",label:"缺失"}};
const STAT={ok:{dot:"success",label:"正常"},propagating:{dot:"sync",label:"传播中"},warn:{dot:"warning",label:"告警"}};

function DnsVerify({addUnsynced}){
  const I=window.GDI;
  const {BatchNsDialog,BatchRecordsDialog}=window.GDDialogs;
  const [rows,setRows]=React.useState(vseed);
  const [q,setQ]=React.useState("");
  const [ownerF,setOwnerF]=React.useState("全部");
  const [verifying,setVerifying]=React.useState({});
  const [dlg,setDlg]=React.useState(null); // {type:'ns'|'records', domain}
  const [tokenFor,setTokenFor]=React.useState(null);
  const OWNERF={全部:null,已验证:"verified",待验证:"pending",失效:"failed"};
  const view=rows.filter(r=>(OWNERF[ownerF]==null||r.owner===OWNERF[ownerF])&&(q===""||r.domain.includes(q)||r.provider.includes(q)));
  const verified=rows.filter(r=>r.owner==="verified").length;
  const pending=rows.filter(r=>r.owner!=="verified").length;
  const nsBad=rows.filter(r=>!r.nsOk).length;
  const recBad=rows.filter(r=>r.records!=="ok").length;
  const propagating=rows.filter(r=>r.status==="propagating").length;
  const kpis=[["已验证所有权",String(verified),"gold"],["待验证 / 失效",String(pending),"warning"],["NS 指向异常",String(nsBad),"danger"],["记录告警 / 缺失",String(recBad),"warning"],["传播中",String(propagating),"blue"]];
  const kcolor=t=>t==="gold"?"var(--gd-gold)":t==="warning"?"var(--gd-warning)":t==="danger"?"var(--gd-danger)":t==="blue"?"var(--gd-blue)":"var(--text-1)";
  const reverify=r=>{setVerifying(v=>({...v,[r.id]:true}));setTimeout(()=>{setVerifying(v=>({...v,[r.id]:false}));setRows(rs=>rs.map(x=>x.id===r.id?{...x,owner:"verified",last:"现在"}:x));},1200);};
  const applyNs=r=>{setRows(rs=>rs.map(x=>x.id===r.id?{...x,ns:"Cloudflare",nsOk:true,provider:"Cloudflare",status:"propagating",last:"现在"}:x));addUnsynced&&addUnsynced(1);setDlg(null);};
  const applyRec=r=>{setRows(rs=>rs.map(x=>x.id===r.id?{...x,records:"ok",status:"propagating",last:"现在"}:x));addUnsynced&&addUnsynced(1);setDlg(null);};
  const pendingCount=rows.filter(r=>r.owner==="pending").length;
  const reverifyAll=()=>{const ids=rows.filter(r=>r.owner==="pending").map(r=>r.id);setVerifying(v=>{const n={...v};ids.forEach(i=>n[i]=true);return n;});setTimeout(()=>{setVerifying({});setRows(rs=>rs.map(x=>ids.includes(x.id)?{...x,owner:"verified",last:"现在"}:x));},1400);};

  const actionCell=r=>{
    if(verifying[r.id])return <span style={{display:"inline-flex",alignItems:"center",gap:6,color:"var(--gd-blue)",fontSize:12,justifyContent:"flex-end"}}><I.RefreshCw size={12} style={{animation:"gd-spinner 1s linear infinite"}}/>验证中</span>;
    if(r.owner!=="verified")return <VBtn size="sm" onClick={()=>reverify(r)}>重新验证</VBtn>;
    if(!r.nsOk)return <VBtn size="sm" onClick={()=>setDlg({type:"ns",row:r})}>改 NS</VBtn>;
    if(r.records!=="ok")return <VBtn size="sm" onClick={()=>setDlg({type:"records",row:r})}>改记录</VBtn>;
    return <VBtn size="sm" variant="ghost" onClick={()=>setTokenFor(r)}>验证 TXT</VBtn>;
  };

  const MetricStrip=window.GDMetricStrip;
  return <div data-screen-label="DNS 与验证" style={{display:"flex",flexDirection:"column",height:"100%",minHeight:0}}>
    <MetricStrip metrics={kpis.map(k=>({label:k[0],value:k[1],tone:k[2]}))}/>
    <VToolbar region
      left={<>
        <VInput size="sm" prefix={<I.Search size={13}/>} placeholder="搜索域名 / 提供商" value={q} onChange={e=>setQ(e.target.value)} style={{width:210}}/>
        <VSel size="sm" options={Object.keys(OWNERF)} value={ownerF} onChange={e=>setOwnerF(e.target.value)}/>
      </>}
      right={<VBtn size="sm" variant="primary" disabled={pendingCount===0} onClick={reverifyAll} icon={<I.Shield size={14}/>}>重新验证待验证项{pendingCount?` · ${pendingCount}`:""}</VBtn>}/>
    <div style={{padding:"8px 16px",borderBottom:"1px solid var(--gd-line)",background:"var(--gd-panel)",display:"flex",alignItems:"center",gap:8,flex:"none",fontSize:12,color:"var(--gd-text-muted)"}}>
      <I.Shield size={13} style={{color:"var(--gd-text-faint)",flex:"none"}}/>
      <span><b style={{color:"var(--gd-text)",fontWeight:500}}>Nameserver</b> 由注册商委派、<b style={{color:"var(--gd-text)",fontWeight:500}}>DNS 记录</b> 由 DNS 提供商下发；<b style={{color:"var(--gd-text)",fontWeight:500}}>所有权</b>经 DNS TXT <span style={{fontFamily:"var(--font-mono)",color:"var(--gd-text)"}}>_atomverify</span> 校验。修复分别走对应处理平台。</span>
    </div>
    <div style={{flex:1,minHeight:0}}>
      <VTable density="regular" rowKey="id" maxHeight="100%" style={{border:"none",borderRadius:0}}
        columns={[
          {key:"domain",label:"域名",render:r=><span style={{fontFamily:"var(--font-mono)",fontSize:12,color:"var(--text-1)"}}>{r.domain}</span>},
          {key:"owner",label:"所有权",width:96,render:r=><VBadge tone={OWNER[r.owner].tone} mono={false}>{OWNER[r.owner].label}</VBadge>},
          {key:"ns",label:"Nameserver",render:r=><span style={{display:"inline-flex",alignItems:"center",gap:6,fontFamily:"var(--font-mono)",fontSize:12,color:r.nsOk?"var(--gd-text-muted)":"var(--gd-danger)"}}>{!r.nsOk&&<I.AlertTriangle size={12}/>}{r.ns}</span>},
          {key:"records",label:"记录",width:84,render:r=><VBadge tone={REC[r.records].tone} mono={false}>{REC[r.records].label}</VBadge>},
          {key:"provider",label:"DNS 提供商",muted:true,width:112},
          {key:"status",label:"状态",width:100,render:r=><span style={{display:"inline-flex",alignItems:"center",gap:6,fontSize:12}}><VDot kind={STAT[r.status].dot} pulse={r.status==="propagating"}/>{STAT[r.status].label}</span>},
          {key:"last",label:"最后校验",numeric:true,muted:true,width:92},
          {key:"act",label:"",width:118,render:r=><span style={{display:"flex",justifyContent:"flex-end"}}>{actionCell(r)}</span>},
        ]}
        rows={view}/>
    </div>
    {dlg&&dlg.type==="ns"&&<BatchNsDialog open domains={[{id:dlg.row.id,domain:dlg.row.domain}]} onClose={()=>setDlg(null)} onApply={()=>applyNs(dlg.row)}/>}
    {dlg&&dlg.type==="records"&&<BatchRecordsDialog open domains={[{id:dlg.row.id,domain:dlg.row.domain}]} onClose={()=>setDlg(null)} onApply={()=>applyRec(dlg.row)}/>}
    <VDlg open={!!tokenFor} onClose={()=>setTokenFor(null)} title="所有权验证 · DNS TXT" width={460}
      footer={<VBtn variant="primary" onClick={()=>setTokenFor(null)}>完成</VBtn>}>
      {tokenFor&&<div style={{display:"flex",flexDirection:"column",gap:12}}>
        <div style={{display:"flex",alignItems:"center",gap:8}}><VBadge tone="gold">OWNER VERIFIED</VBadge><span style={{fontSize:12,color:"var(--gd-text-muted)"}}>{tokenFor.domain} · 最后校验 {tokenFor.last}</span></div>
        <div style={{display:"flex",flexDirection:"column",gap:6}}>
          <span className="gd-t-label">验证记录（DNS 提供商 · {tokenFor.provider}）</span>
          <div style={{display:"grid",gridTemplateColumns:"64px 1fr",gap:8,fontFamily:"var(--font-mono)",fontSize:12}}>
            <span style={{color:"var(--gd-text-faint)"}}>类型</span><span style={{color:"var(--gd-blue)"}}>TXT</span>
            <span style={{color:"var(--gd-text-faint)"}}>主机</span><span>_atomverify</span>
            <span style={{color:"var(--gd-text-faint)"}}>值</span><span style={{color:"var(--gd-text)",wordBreak:"break-all"}}>{tokenFor.token}</span>
          </div>
        </div>
        <span style={{fontSize:11,color:"var(--gd-text-faint)"}}>该 TXT 记录用于向平台证明域名所有权；本地密钥签发，删除会导致验证失效。</span>
      </div>}
    </VDlg>
  </div>;
}
window.GDDnsVerify=DnsVerify;
