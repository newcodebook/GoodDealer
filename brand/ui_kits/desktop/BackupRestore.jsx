// 本地加密备份 / BackupRestore — Settings「备份」section (UX_FLOWS §6, D-013).
// User-triggered export/restore only. Business data is encrypted by a local key. The "include platform
// credentials" toggle defaults OFF; when on it lists exactly which ProviderConnections are included, and
// the never-included list (device private key, Auth/Lease, Browser Profile, Cookie, ApprovedOperation,
// AutomationExecutionTicket, Recovery Secret) is shown per D-013. Restore first creates a local recovery
// point; the current Cloud state is the baseline and backup diffs land in the Recovery Center, never a
// silent overwrite. When Cloud is unreachable a backup can only be viewed in an isolated read-only area.
const {Panel:BPanel,Button:BBtn,Switch:BSwitch,Badge:BBadge,Dialog:BDlg,Checkbox:BCheck,Tag:BTag}=window.GoodDealerDesignSystem_b5b0b6;

const INCLUDED=["域名 · Portfolio","价格 · Listing · 目标状态","标签 · 购入成本 · 备注","脱敏操作记录（ExecutionFact 摘要）"];
const NEVER=["设备签名私钥","Auth Token · ActiveDeviceLease","Browser Profile · Cookie","ApprovedOperation · AutomationExecutionTicket","Recovery Secret · 数据库主密钥包装"];
const CRED_CONNS=["Atom · 主账户","Atom · 子账户 B","Afternic · 主账户","Cloudflare"];

const BKV=({k,children})=><div style={{display:"flex",alignItems:"baseline",gap:12,padding:"7px 0",borderBottom:"1px solid var(--gd-line)",fontSize:13}}>
  <span style={{width:104,flex:"none",color:"var(--gd-text-faint)",fontSize:12}}>{k}</span>
  <span style={{flex:1,minWidth:0,textAlign:"right"}}>{children}</span>
</div>;

function BackupRestore({addUnsynced}){
  const I=window.GDI;
  const [dlg,setDlg]=React.useState(null); // 'export' | 'restore'
  const [inclCred,setInclCred]=React.useState(false);
  const [ackRestore,setAckRestore]=React.useState(false);
  const [points,setPoints]=React.useState([{id:1,at:"07-28 09:12",schema:"v3",size:"4.2 MB",note:"恢复前自动创建"}]);
  const openExport=()=>{setInclCred(false);setDlg("export");};
  const openRestore=()=>{setAckRestore(false);setDlg("restore");};
  const doRestore=()=>{setDlg(null);setPoints(p=>[{id:Date.now(),at:"现在",schema:"v3",size:"4.3 MB",note:"恢复前自动创建"},...p]);};

  return <div style={{display:"flex",flexDirection:"column",gap:14}}>
    <BPanel title="本地加密备份">
      <div style={{display:"flex",flexDirection:"column",gap:12}}>
        <span style={{fontSize:12,color:"var(--gd-text-muted)",lineHeight:1.6}}>所有备份由你手动触发；业务数据由本地密钥加密，文件自行保管。云端不可用时，备份只能在隔离只读区查看。</span>
        <div style={{display:"flex",gap:10}}>
          <div style={{flex:1,border:"1px solid var(--gd-line)",borderRadius:7,background:"var(--gd-panel)",padding:"13px 14px",display:"flex",flexDirection:"column",gap:8}}>
            <div style={{display:"flex",alignItems:"center",gap:8}}><I.Upload size={15} style={{color:"var(--gd-text-muted)"}}/><b style={{fontSize:13,fontWeight:500}}>导出加密备份</b></div>
            <span style={{fontSize:11,color:"var(--gd-text-faint)",lineHeight:1.5}}>导出业务数据到加密文件；凭据默认不含。</span>
            <BBtn size="sm" variant="primary" style={{alignSelf:"flex-start"}} onClick={openExport}>导出备份…</BBtn>
          </div>
          <div style={{flex:1,border:"1px solid var(--gd-line)",borderRadius:7,background:"var(--gd-panel)",padding:"13px 14px",display:"flex",flexDirection:"column",gap:8}}>
            <div style={{display:"flex",alignItems:"center",gap:8}}><I.RefreshCw size={15} style={{color:"var(--gd-text-muted)"}}/><b style={{fontSize:13,fontWeight:500}}>从备份恢复</b></div>
            <span style={{fontSize:11,color:"var(--gd-text-faint)",lineHeight:1.5}}>差异进恢复中心逐项确认，不直接覆盖。</span>
            <BBtn size="sm" style={{alignSelf:"flex-start"}} onClick={openRestore}>选择备份文件…</BBtn>
          </div>
        </div>
      </div>
    </BPanel>

    <BPanel flush title="本地恢复点" actions={<span style={{fontSize:11,color:"var(--gd-text-faint)"}}>恢复前自动创建 · 可回退</span>}>
      {points.map((p,i)=><div key={p.id} style={{display:"flex",alignItems:"center",gap:12,padding:"11px 14px",borderBottom:i<points.length-1?"1px solid var(--gd-line)":"none"}}>
        <I.History size={15} style={{color:"var(--gd-text-muted)",flex:"none"}}/>
        <span style={{width:120,flex:"none",fontFamily:"var(--font-mono)",fontSize:12}}>{p.at}</span>
        <span style={{flex:1,minWidth:0,fontSize:12,color:"var(--gd-text-muted)"}}>{p.note}</span>
        <BTag>Schema {p.schema}</BTag>
        <span style={{width:64,flex:"none",textAlign:"right",fontFamily:"var(--font-mono)",fontSize:11,color:"var(--gd-text-faint)"}}>{p.size}</span>
        <BBtn size="sm" variant="ghost">回退到此</BBtn>
      </div>)}
    </BPanel>

    {/* export */}
    <BDlg open={dlg==="export"} onClose={()=>setDlg(null)} title="导出加密备份" width={560}
      footer={<><BBtn onClick={()=>setDlg(null)}>取消</BBtn><BBtn variant="primary" onClick={()=>setDlg(null)}>导出加密备份</BBtn></>}>
      <div style={{display:"flex",flexDirection:"column",gap:12}}>
        <div style={{border:"1px solid var(--gd-line-strong)",borderRadius:7,background:"var(--gd-panel)",padding:"6px 14px"}}>
          <BKV k="备份范围"><div style={{display:"flex",flexWrap:"wrap",gap:5,justifyContent:"flex-end"}}>{INCLUDED.map(x=><BTag key={x}>{x}</BTag>)}</div></BKV>
          <BKV k="来源设备">MacBook Pro</BKV>
          <BKV k="Schema"><span style={{fontFamily:"var(--font-mono)"}}>BackupExportSchema v3</span></BKV>
          <BKV k="加密">本地密钥 · AES-256</BKV>
          <BKV k="目标位置"><span style={{fontFamily:"var(--font-mono)",fontSize:11}}>~/GoodDealer/backups/</span></BKV>
        </div>
        <div style={{border:`1px solid ${inclCred?"var(--gd-warning)":"var(--gd-line)"}`,background:inclCred?"var(--gd-warning-tint)":"transparent",borderRadius:7,padding:"11px 13px",display:"flex",flexDirection:"column",gap:9}}>
          <div style={{display:"flex",alignItems:"center",gap:10}}>
            <BSwitch checked={inclCred} onChange={()=>setInclCred(v=>!v)}/>
            <div style={{flex:1}}><div style={{fontSize:13}}>包含平台 API 凭据</div><div style={{fontSize:11,color:"var(--gd-text-faint)"}}>默认关闭 · 打开将逐项列出包含的连接</div></div>
          </div>
          {inclCred&&<div style={{borderTop:"1px solid rgba(224,138,72,0.24)",paddingTop:9,display:"flex",flexDirection:"column",gap:6}}>
            <span style={{fontSize:11,color:"var(--gd-warning)"}}>将包含以下连接的加密凭据（仅这些）：</span>
            <div style={{display:"flex",flexWrap:"wrap",gap:5}}>{CRED_CONNS.map(c=><BTag key={c}>{c}</BTag>)}</div>
          </div>}
        </div>
        <div style={{border:"1px solid var(--gd-line)",borderRadius:7,padding:"10px 13px"}}>
          <div style={{fontSize:11,color:"var(--gd-danger)",marginBottom:7,letterSpacing:"0.04em"}}>永不包含（不可移植 · D-013）</div>
          <div style={{display:"flex",flexWrap:"wrap",rowGap:6,columnGap:12}}>{NEVER.map(x=><span key={x} style={{display:"inline-flex",alignItems:"center",gap:5,fontSize:11,color:"var(--gd-text-muted)"}}><I.X size={11} style={{color:"var(--gd-danger)"}}/>{x}</span>)}</div>
        </div>
      </div>
    </BDlg>

    {/* restore */}
    <BDlg open={dlg==="restore"} onClose={()=>setDlg(null)} title="从备份恢复" width={520}
      footer={<><BBtn onClick={()=>setDlg(null)}>取消</BBtn><BBtn variant="primary" disabled={!ackRestore} onClick={doRestore}>创建恢复点并恢复</BBtn></>}>
      <div style={{display:"flex",flexDirection:"column",gap:12}}>
        <div style={{display:"flex",alignItems:"center",gap:11,padding:"11px 13px",border:"1px solid var(--gd-line)",borderRadius:7,background:"var(--gd-panel)"}}>
          <I.FileText size={16} style={{color:"var(--gd-text-muted)",flex:"none"}}/>
          <div style={{flex:1,minWidth:0}}><div style={{fontSize:13,fontFamily:"var(--font-mono)"}}>gooddealer-backup-0728.enc</div><div style={{fontSize:11,color:"var(--gd-text-faint)"}}>Schema v3 · 4.2 MB · 备份于 07-28 09:12</div></div>
          <BBadge tone="success" mono={false}>可解密</BBadge>
        </div>
        <div style={{border:"1px solid var(--gd-line-strong)",background:"var(--gd-panel)",borderRadius:7,padding:"11px 13px",fontSize:12,color:"var(--gd-text-muted)",lineHeight:1.6}}>
          恢复前将<b style={{color:"var(--gd-text)",fontWeight:500}}>自动创建本地恢复点</b>。<b style={{color:"var(--gd-text)",fontWeight:500}}>云端当前数据为基线</b>——备份与云端的差异进入<b style={{color:"var(--gd-text)",fontWeight:500}}>恢复中心逐字段确认</b>，不直接覆盖现有数据；高风险字段不批量静默恢复。
        </div>
        <div style={{borderTop:"1px solid var(--gd-line)",paddingTop:10}}><BCheck checked={ackRestore} onChange={()=>setAckRestore(a=>!a)} label="我理解备份差异将进入恢复中心确认，而非直接覆盖当前数据"/></div>
      </div>
    </BDlg>
  </div>;
}
window.GDBackupRestore=BackupRestore;
