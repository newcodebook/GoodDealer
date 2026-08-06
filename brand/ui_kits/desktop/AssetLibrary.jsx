const {Table,BatchBar,Badge,Money,Tag,Button,IconButton,Input,Select,KpiStat,Toolbar,Dialog}=window.GoodDealerDesignSystem_b5b0b6;
const afmt=n=>n==null?"—":Number(n).toLocaleString("en-US",{minimumFractionDigits:2,maximumFractionDigits:2});
const anum=v=>{const n=Number(String(v).replace(/[^0-9.]/g,""));return isFinite(n)?n:0;};
const nsProvider=a=>/Cloudflare/.test(a)?"Cloudflare":/销售平台/.test(a)?"销售平台":/注册商/.test(a)?"注册商":"自定义 NS";
function Ribbon({onRenew}){
  const MetricStrip=window.GDMetricStrip;
  return <MetricStrip metrics={[
    {label:"域名总数",value:"1,024",meta:"Spaceship 812 · 其他 212"},
    {label:"组合估值",value:"$284,120.00",tone:"gold",meta:"较上月 +2.1%"},
    {label:"60 天内到期",value:"18",tone:"warning",meta:"续费预算 $312.00 · 去续费 →",onClick:onRenew},
    {label:"活跃 Listing",value:"692",meta:"Atom 511 · Afternic 601"},
    {label:"待裁决冲突",value:"6",tone:"danger",meta:"同字段被远端修改"},
  ]}/>;
}
const STATUS_MAP={"全部状态":null,"已同步":"synced","等待平台":"pending","冲突":"conflict","未上架":"unlisted","已售":"sold"};
function AssetLibrary({domains,updateDomains,addUnsynced,onPlan,onOpenDomain,onRenew}){
  const I=window.GDI;
  const EditableCell=window.GDEditableCell,Pagination=window.GDPagination;
  const {BatchPriceDialog,BatchNsDialog,BatchRecordsDialog,ListDialog}=window.GDDialogs;
  const STATUS_BADGE={
    synced:<Badge tone="sync">SYNCED</Badge>,
    pending:<Badge tone="warning" mono={false}>等待平台</Badge>,
    conflict:<Badge tone="danger" mono={false}>冲突</Badge>,
    unlisted:<Badge mono={false}>未上架</Badge>,
    sold:<Badge tone="gold">SOLD</Badge>,
  };
  const [sel,setSel]=React.useState([]);
  const [q,setQ]=React.useState("");
  const [reg,setReg]=React.useState("全部");
  const [statusF,setStatusF]=React.useState("全部状态");
  const [sortKey,setSortKey]=React.useState("bin");
  const [sortDir,setSortDir]=React.useState("desc");
  const [page,setPage]=React.useState(1);
  const [pageSize,setPageSize]=React.useState(10);
  const [dlg,setDlg]=React.useState(null);      // price | dns | list | delist
  const [pending,setPending]=React.useState(null); // {row,newVal} inline edit
  React.useEffect(()=>{setPage(1);},[q,reg,statusF,pageSize]);
  const sfKey=STATUS_MAP[statusF];
  let rows=domains.filter(r=>(reg==="全部"||r.registrar===reg)&&(sfKey==null||r.status===sfKey)&&(q===""||r.domain.includes(q.toLowerCase())||r.tags.some(t=>t.includes(q))));
  rows=[...rows].sort((a,b)=>{const m=sortDir==="asc"?1:-1;const va=a[sortKey],vb=b[sortKey];if(va==null)return 1;if(vb==null)return -1;return va>vb?m:-m;});
  const viewSum=rows.reduce((s,r)=>s+(r.bin||0),0);
  const pages=Math.max(1,Math.ceil(rows.length/pageSize));
  const cur=Math.min(page,pages);
  const pageRows=rows.slice((cur-1)*pageSize,cur*pageSize);
  const selDomains=domains.filter(d=>sel.includes(d.id)).map(d=>({id:d.id,domain:d.domain,bin:d.bin}));
  const patchSel=patch=>{updateDomains(ds=>ds.map(d=>sel.includes(d.id)?{...d,...patch}:d));addUnsynced(sel.length);setSel([]);setDlg(null);};
  const queueSel=()=>{addUnsynced(sel.length);setSel([]);setDlg(null);};
  const savePending=()=>{updateDomains(ds=>ds.map(d=>d.id===pending.row.id?{...d,bin:pending.newVal}:d));addUnsynced(1);setPending(null);};
  return <div data-screen-label="资产库" style={{display:"flex",flexDirection:"column",height:"100%",minHeight:0}}>
    <Ribbon onRenew={onRenew}/>
    <Toolbar region
      left={<>
        <Input size="sm" prefix={<I.Search size={13}/>} placeholder="筛选域名、标签…" value={q} onChange={e=>setQ(e.target.value)} style={{width:210}}/>
        <Select size="sm" options={["全部","Spaceship","Namecheap","Dynadot"]} value={reg} onChange={e=>setReg(e.target.value)}/>
        <Select size="sm" options={Object.keys(STATUS_MAP)} value={statusF} onChange={e=>setStatusF(e.target.value)}/>
      </>}
      right={<>
        <Button size="sm" icon={<I.Upload size={14}/>}>导入 CSV</Button>
        <Button size="sm" variant="primary" disabled={sel.length===0} onClick={()=>setDlg("price")}>生成批量计划{sel.length>0?` · ${sel.length}`:""}</Button>
      </>}/>
    <div style={{flex:1,minHeight:0,position:"relative",display:"flex"}}>
      <Table density="regular" selectable selected={sel} onSelectionChange={setSel} onRowClick={r=>onOpenDomain(r.id)}
        sortKey={sortKey} sortDir={sortDir} onSort={(k,d)=>{setSortKey(k);setSortDir(d);}}
        maxHeight="100%" style={{flex:1,minHeight:0,border:"none",borderRadius:0}}
        columns={[
          {key:"domain",label:"域名",sortable:true,render:r=><span style={{fontFamily:"var(--font-mono)",fontSize:12,color:"var(--text-1)"}}>{r.domain}</span>},
          {key:"tags",label:"标签",render:r=><span style={{display:"inline-flex",gap:4}}>{r.tags.map(t=><Tag key={t} color={t.startsWith("portfolio")?"var(--gd-blue)":undefined}>{t}</Tag>)}</span>},
          {key:"registrar",label:"注册商",muted:true},
          {key:"dns",label:"DNS",muted:true},
          {key:"platforms",label:"平台",muted:true},
          {key:"status",label:"状态",render:r=>STATUS_BADGE[r.status]},
          {key:"bin",label:"BIN",numeric:true,sortable:true,render:r=><EditableCell value={r.bin} prefix="$" display={<Money amount={r.bin}/>} onCommit={v=>setPending({row:r,newVal:anum(v)})}/>},
          {key:"expiry",label:"到期",numeric:true,muted:true,sortable:true,render:r=><span style={{fontSize:12,color:r.expiry<"2026-10-01"?"var(--gd-warning)":undefined}}>{r.expiry}</span>},
        ]}
        rows={pageRows}
        footer={<Pagination page={cur} pageSize={pageSize} total={rows.length} onPage={setPage} onPageSize={setPageSize}
          note={<>视图估值 <span style={{color:"var(--gd-gold)"}}>${afmt(viewSum)}</span></>}/>}/>
      {sel.length>0&&<div style={{position:"absolute",bottom:14,left:0,right:0,display:"flex",justifyContent:"center",pointerEvents:"none",zIndex:5}}>
        <BatchBar count={sel.length} onClear={()=>setSel([])} style={{pointerEvents:"auto"}}>
          <Button size="sm" variant="primary" onClick={()=>setDlg("price")}>批量改价</Button>
          <span className="gd-batchbar-sep"></span>
          <Button size="sm" onClick={()=>setDlg("ns")}>变更 NS</Button>
          <Button size="sm" onClick={()=>setDlg("records")}>DNS 记录</Button>
          <span className="gd-batchbar-sep"></span>
          <Button size="sm" onClick={()=>setDlg("list")}>上架</Button>
          <Button size="sm" onClick={()=>setDlg("delist")}>下架</Button>
        </BatchBar>
      </div>}
    </div>
    {dlg==="price"&&<BatchPriceDialog open domains={selDomains} onClose={()=>setDlg(null)} onSubmit={c=>{setDlg(null);onPlan(c);}}/>}
    {dlg==="ns"&&<BatchNsDialog open domains={selDomains} onClose={()=>setDlg(null)} onApply={({applied})=>patchSel({dns:nsProvider(applied)})}/>}
    {dlg==="records"&&<BatchRecordsDialog open domains={selDomains} onClose={()=>setDlg(null)} onApply={()=>queueSel()}/>}
    {dlg==="list"&&<ListDialog open domains={selDomains} onClose={()=>setDlg(null)} onApply={({platforms,price})=>patchSel(price!=null?{status:"synced",platforms:platforms.join(" · "),bin:price}:{status:"synced",platforms:platforms.join(" · ")})}/>}
    <Dialog open={dlg==="delist"} onClose={()=>setDlg(null)} title={`下架 · ${sel.length} 个域名`} width={440} danger
      footer={<><Button onClick={()=>setDlg(null)}>取消</Button><Button variant="danger" onClick={()=>patchSel({status:"unlisted",platforms:"—"})}>下架 · {sel.length} 项</Button></>}>
      <span style={{fontSize:13}}>将 <b style={{fontFamily:"var(--font-mono)"}}>{sel.length}</b> 个域名从当前销售平台下架。可安全重试；结果以平台 Listing 状态为准，写入未同步修改。</span>
    </Dialog>
    <Dialog open={!!pending} onClose={()=>setPending(null)} title="保存并同步" width={420}
      footer={<><Button onClick={()=>setPending(null)}>放弃</Button><Button variant="primary" onClick={savePending}>保存并同步</Button></>}>
      {pending&&<div style={{display:"flex",flexDirection:"column",gap:10}}>
        <div style={{display:"flex",alignItems:"center",gap:10,fontSize:13}}>
          <span style={{fontFamily:"var(--font-mono)"}}>{pending.row.domain}</span>
          <span style={{color:"var(--gd-text-faint)"}}>BIN</span>
          <span style={{fontFamily:"var(--font-mono)",color:"var(--gd-text-faint)"}}>${afmt(pending.row.bin)}</span>
          <span style={{color:"var(--gd-text-faint)"}}>→</span>
          <span style={{fontFamily:"var(--font-mono)",color:"var(--gd-gold)"}}>${afmt(pending.newVal)}</span>
        </div>
        <span style={{fontSize:11,color:"var(--gd-text-faint)"}}>保存写入未同步修改，将在下次同步时提交到销售平台；放弃则不改动。</span>
      </div>}
    </Dialog>
  </div>;
}
window.GDAssetLibrary=AssetLibrary;
