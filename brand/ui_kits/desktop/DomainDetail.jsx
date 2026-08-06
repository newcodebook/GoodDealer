// Domain detail screen — reached by clicking a row in the asset library.
const {Panel:DPanel,Badge:DBadge,Money:DMoney,Tag:DTag,Button:DBtn,Switch:DSwitch,StatusDot:DDot,Table:DTable,Dialog:DDlg}=window.GoodDealerDesignSystem_b5b0b6;
const dfmt=n=>n==null?"—":Number(n).toLocaleString("en-US",{minimumFractionDigits:2,maximumFractionDigits:2});
const dnum=v=>{const n=Number(String(v).replace(/[^0-9.]/g,""));return isFinite(n)?n:0;};
const nsProv=a=>/Cloudflare/.test(a)?"Cloudflare":/销售平台/.test(a)?"销售平台":/注册商/.test(a)?"注册商":"自定义 NS";

function synth(d){
  const yr=+d.expiry.slice(0,4);
  const created=(yr-2)+d.expiry.slice(4);
  const nsMap={"Cloudflare":["ada.ns.cloudflare.com","bob.ns.cloudflare.com"],"注册商":["ns1."+d.registrar.toLowerCase()+".com","ns2."+d.registrar.toLowerCase()+".com"]};
  const ns=nsMap[d.dns]||["ns1."+d.dns.toLowerCase()+".com","ns2."+d.dns.toLowerCase()+".com"];
  const records=[
    {type:"A",host:"@",value:"185.199.108.153",ttl:"Auto"},
    {type:"CNAME",host:"www",value:d.domain,ttl:"Auto"},
    {type:"TXT",host:"_atomverify",value:"atom-verify=8f2a…",ttl:"3600"},
    {type:"MX",host:"@",value:"10 mail."+d.domain,ttl:"3600"},
  ];
  const plats=d.platforms==="—"?[]:d.platforms.split(" · ");
  const listings=plats.map((p,i)=>({platform:p,status:d.status==="sold"&&i===0?"sold":d.status==="pending"?"pending":"active",price:d.bin,updated:i===0?"14:02":"07-28"}));
  const history=[
    {rev:"8,241",when:"今日 14:02",who:"批量改价 −8%",field:"BIN"},
    {rev:"8,180",when:"07-30 09:11",who:"同步 · Atom",field:"Listing"},
    {rev:"7,905",when:"07-14 16:40",who:"手动编辑",field:"标签"},
  ];
  return {created,ns,records,listings,history};
}

function KV({k,children}){
  return <div style={{display:"flex",alignItems:"center",gap:12,padding:"8px 0",borderBottom:"1px solid var(--gd-line)",fontSize:13}}>
    <span style={{width:96,flex:"none",color:"var(--gd-text-faint)",fontSize:12}}>{k}</span>
    <span style={{flex:1,display:"flex",alignItems:"center",gap:8,justifyContent:"flex-end",textAlign:"right"}}>{children}</span>
  </div>;
}
function DomainDetail({domain,onBack,updateDomains,addUnsynced}){
  const I=window.GDI;
  const s=React.useMemo(()=>synth(domain),[domain.id]);
  const [autoRenew,setAutoRenew]=React.useState(true);
  const [lock,setLock]=React.useState(true);
  const [dlg,setDlg]=React.useState(null); // dns | list | price | delist
  const [priceVal,setPriceVal]=React.useState("");
  const {BatchNsDialog,BatchRecordsDialog,ListDialog}=window.GDDialogs;
  const one=[{id:domain.id,domain:domain.domain,bin:domain.bin}];
  const set=patch=>{updateDomains(ds=>ds.map(x=>x.id===domain.id?{...x,...patch}:x));addUnsynced(1);};
  const STATUS={synced:<DBadge tone="sync">SYNCED</DBadge>,pending:<DBadge tone="warning" mono={false}>等待平台</DBadge>,conflict:<DBadge tone="danger" mono={false}>冲突</DBadge>,unlisted:<DBadge mono={false}>未上架</DBadge>,sold:<DBadge tone="gold">SOLD</DBadge>};
  const listed=domain.status!=="unlisted"&&domain.status!=="sold";
  const soon=domain.expiry<"2026-10-01";
  const ribbon=[
    {l:"BIN 估值",v:<DMoney amount={domain.bin} size={26}/>},
    {l:"当前状态",v:<span style={{display:"inline-flex"}}>{STATUS[domain.status]}</span>},
    {l:"到期",v:<span style={{fontFamily:"var(--font-mono)",fontSize:16,color:soon?"var(--gd-warning)":"var(--text-1)"}}>{domain.expiry}</span>},
    {l:"活跃 Listing",v:<span style={{fontFamily:"var(--font-mono)",fontSize:18}}>{s.listings.filter(x=>x.status==="active").length}</span>},
  ];
  const lstBadge=st=>st==="sold"?<DBadge tone="gold">SOLD</DBadge>:st==="pending"?<DBadge tone="warning" mono={false}>等待</DBadge>:<DBadge tone="success" mono={false}>在售</DBadge>;
  return <div data-screen-label="域名详情" style={{display:"flex",flexDirection:"column",height:"100%",minHeight:0,overflow:"auto"}}>
    <div style={{display:"flex",alignItems:"center",gap:12,padding:"14px 18px",borderBottom:"1px solid var(--gd-line)",flex:"none"}}>
      <DBtn size="sm" variant="ghost" icon={<I.ChevronLeft size={15}/>} onClick={onBack}>资产库</DBtn>
      <span style={{fontFamily:"var(--font-mono)",fontSize:20,color:"var(--text-1)"}}>{domain.domain}</span>
      {STATUS[domain.status]}
      <span style={{display:"inline-flex",gap:5}}>{domain.tags.map(t=><DTag key={t} color={t.startsWith("portfolio")?"var(--gd-blue)":undefined}>{t}</DTag>)}</span>
      <span style={{marginLeft:"auto",display:"flex",gap:8}}>
        <DBtn size="sm" onClick={()=>{setPriceVal(domain.bin!=null?String(domain.bin):"");setDlg("price");}}>编辑价格</DBtn>
        {listed?<DBtn size="sm" onClick={()=>setDlg("delist")}>下架</DBtn>:<DBtn size="sm" variant="primary" onClick={()=>setDlg("list")}>上架</DBtn>}
        <DBtn size="sm" variant="ghost" icon={<I.ExternalLink size={13}/>}>打开注册商</DBtn>
      </span>
    </div>
    <div style={{display:"flex",background:"var(--surface-region)",borderBottom:"1px solid var(--gd-line)",flex:"none"}}>
      {ribbon.map((r,i)=><div key={i} style={{flex:1,padding:"12px 18px",borderRight:i<ribbon.length-1?"1px solid var(--gd-line)":"none",display:"flex",flexDirection:"column",gap:5}}>
        <span className="gd-t-label">{r.l}</span>{r.v}</div>)}
    </div>
    <div style={{display:"grid",gridTemplateColumns:"minmax(0,1fr) minmax(0,1.1fr)",gap:14,padding:16,alignItems:"start"}}>
      <div style={{display:"flex",flexDirection:"column",gap:14,minWidth:0}}>
        <DPanel title="注册信息">
          <div style={{display:"flex",flexDirection:"column"}}>
            <KV k="注册商">{domain.registrar}</KV>
            <KV k="注册日期"><span style={{fontFamily:"var(--font-mono)",color:"var(--gd-text-muted)"}}>{s.created}</span></KV>
            <KV k="到期"><span style={{fontFamily:"var(--font-mono)",color:soon?"var(--gd-warning)":undefined}}>{domain.expiry}</span></KV>
            <KV k="自动续费"><DSwitch checked={autoRenew} onChange={()=>{setAutoRenew(v=>!v);addUnsynced(1);}}/></KV>
            <KV k="转移锁"><DSwitch checked={lock} onChange={()=>{setLock(v=>!v);addUnsynced(1);}}/></KV>
            <KV k="DNS 提供商"><span style={{color:"var(--gd-text-muted)"}}>{domain.dns}</span></KV>
            <div style={{display:"flex",alignItems:"center",gap:12,padding:"8px 0",fontSize:13}}>
              <span style={{width:96,flex:"none",color:"var(--gd-text-faint)",fontSize:12}}>Nameserver</span>
              <span style={{flex:1,display:"flex",alignItems:"center",justifyContent:"flex-end",gap:8}}>
                <span style={{fontFamily:"var(--font-mono)",fontSize:12,color:"var(--gd-text-muted)"}}>{s.ns[0]}</span>
                <DBtn size="sm" variant="ghost" onClick={()=>setDlg("ns")}>变更</DBtn>
              </span>
            </div>
            <div style={{padding:"6px 0 0",fontSize:11,color:"var(--gd-text-faint)"}}>Nameserver 由注册商管理 · DNS 记录由 DNS 提供商下发</div>
          </div>
        </DPanel>
        <DPanel title="所有权验证" actions={<DBadge tone="success" mono={false}>已验证</DBadge>}>
          <div style={{display:"flex",gap:12,alignItems:"flex-start"}}>
            <img src="../../assets/icons/keyhole.svg" width="30" height="30" alt="" style={{opacity:.9,flex:"none",marginTop:2}}/>
            <div style={{flex:1,fontSize:12,color:"var(--gd-text-muted)",lineHeight:1.6}}>
              通过 DNS TXT <span style={{fontFamily:"var(--font-mono)",color:"var(--gd-text)"}}>_atomverify</span> 验证所有权 · 最后验证 07-30 09:11。<br/>本地密钥签发 License，凭据永不上云。
            </div>
          </div>
        </DPanel>
      </div>
      <div style={{display:"flex",flexDirection:"column",gap:14,minWidth:0}}>
        <DPanel flush title="销售 Listing" actions={listed?<DBtn size="sm" variant="ghost" onClick={()=>setDlg("price")}>改价</DBtn>:null}>
          {s.listings.length>0?<DTable density="compact" rowKey="platform"
            columns={[
              {key:"platform",label:"平台"},
              {key:"status",label:"状态",render:r=>lstBadge(r.status)},
              {key:"price",label:"价格",numeric:true,render:r=><DMoney amount={r.price}/>},
              {key:"updated",label:"更新",numeric:true,muted:true},
            ]} rows={s.listings} style={{border:"none",borderRadius:0}}/>
          :<div style={{padding:"20px 14px",fontSize:12,color:"var(--gd-text-faint)",display:"flex",alignItems:"center",gap:10}}>
            未在任何平台上架 · <DBtn size="sm" variant="primary" onClick={()=>setDlg("list")}>上架</DBtn></div>}
        </DPanel>
        <DPanel flush title="DNS 记录" actions={<DBtn size="sm" variant="ghost" onClick={()=>setDlg("records")}>修改记录</DBtn>}>
          <DTable density="compact" rowKey="host"
            columns={[
              {key:"type",label:"类型",render:r=><span style={{fontFamily:"var(--font-mono)",fontSize:11,color:"var(--gd-blue)"}}>{r.type}</span>,width:64},
              {key:"host",label:"主机",render:r=><span style={{fontFamily:"var(--font-mono)",fontSize:12}}>{r.host}</span>},
              {key:"value",label:"值",render:r=><span style={{fontFamily:"var(--font-mono)",fontSize:12,color:"var(--gd-text-muted)"}}>{r.value}</span>},
              {key:"ttl",label:"TTL",numeric:true,muted:true,width:64},
            ]} rows={s.records} style={{border:"none",borderRadius:0}}/>
        </DPanel>
        <DPanel flush title="操作历史">
          <div>{s.history.map((h,i)=><div key={i} style={{display:"flex",alignItems:"center",gap:12,padding:"9px 14px",borderBottom:i<s.history.length-1?"1px solid var(--gd-line)":"none",fontSize:12}}>
            <span style={{fontFamily:"var(--font-mono)",color:"var(--gd-text-faint)",width:52}}>rev {h.rev}</span>
            <span style={{flex:1}}>{h.who}</span>
            <DTag>{h.field}</DTag>
            <span style={{fontFamily:"var(--font-mono)",color:"var(--gd-text-faint)",width:90,textAlign:"right"}}>{h.when}</span>
          </div>)}</div>
        </DPanel>
      </div>
    </div>
    {dlg==="ns"&&<BatchNsDialog open domains={one} onClose={()=>setDlg(null)} onApply={({applied})=>{set({dns:nsProv(applied)});setDlg(null);}}/>}
    {dlg==="records"&&<BatchRecordsDialog open domains={one} onClose={()=>setDlg(null)} onApply={()=>{addUnsynced(1);setDlg(null);}}/>}
    {dlg==="list"&&<ListDialog open domains={one} onClose={()=>setDlg(null)} onApply={({platforms,price})=>{set({status:"synced",platforms:platforms.join(" · "),bin:price!=null?price:domain.bin});setDlg(null);}}/>}
    <DDlg open={dlg==="price"} onClose={()=>setDlg(null)} title={`编辑价格 · ${domain.domain}`} width={420}
      footer={<><DBtn onClick={()=>setDlg(null)}>取消</DBtn><DBtn variant="primary" onClick={()=>{set({bin:dnum(priceVal)});setDlg(null);}}>保存并同步</DBtn></>}>
      <div style={{display:"flex",flexDirection:"column",gap:12}}>
        <div style={{display:"flex",alignItems:"center",gap:12}}>
          <span style={{fontSize:12,color:"var(--gd-text-muted)"}}>当前 <span style={{fontFamily:"var(--font-mono)",color:"var(--gd-text-faint)"}}>${dfmt(domain.bin)}</span></span>
          <span style={{color:"var(--gd-text-faint)"}}>→</span>
          <input autoFocus value={priceVal} onChange={e=>setPriceVal(e.target.value)} inputMode="decimal"
            style={{width:150,height:30,background:"var(--gd-ink)",border:"1px solid var(--gd-blue)",boxShadow:"0 0 0 2px rgba(77,141,255,0.25)",borderRadius:5,color:"var(--gd-text)",fontFamily:"var(--font-mono)",fontSize:14,textAlign:"right",padding:"0 9px",outline:"none"}}/>
        </div>
        <span style={{fontSize:11,color:"var(--gd-text-faint)"}}>保存后写入未同步修改，将在下次同步时提交到销售平台。</span>
      </div>
    </DDlg>
    <DDlg open={dlg==="delist"} onClose={()=>setDlg(null)} title={`下架 · ${domain.domain}`} width={420}
      footer={<><DBtn onClick={()=>setDlg(null)}>取消</DBtn><DBtn variant="danger" onClick={()=>{set({status:"unlisted",platforms:"—"});setDlg(null);}}>下架并从平台移除</DBtn></>}>
      <span style={{fontSize:13}}>将 <b style={{fontFamily:"var(--font-mono)"}}>{domain.domain}</b> 从当前销售平台下架。可安全重试；结果以平台 Listing 状态为准。</span>
    </DDlg>
  </div>;
}
window.GDDomainDetail=DomainDetail;
