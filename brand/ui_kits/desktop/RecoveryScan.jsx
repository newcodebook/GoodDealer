// 崩溃恢复启动扫描 / RecoveryScan — J-07 (§6.3 Operation/Attempt commit boundaries).
// After a crash / force-quit, on startup the app scans non-terminal tasks and classifies them by their
// commit boundary BEFORE any worker takes new work: confirmed (skip), failed-before-side-effect
// (safe retry), crashed-after-possible-side-effect (outcome_unknown → FROZEN, check-only never retry),
// remote-confirmation-pending (check). Confirmed writes are never re-run.
const {WindowChrome:RWin,Button:RBtn,Badge:RBadge,StatusDot:RDot}=window.GoodDealerDesignSystem_b5b0b6;

const BUCKETS=[
  {key:"confirmed",n:812,tone:"success",label:"已确认成功",note:"跳过 · 不重复已确认的写操作"},
  {key:"retry",n:3,tone:"warning",label:"可安全重试",note:"副作用边界前失败，可安全重试"},
  {key:"unknown",n:2,tone:"danger",label:"结果未知 · 冻结",note:"可能已越过副作用边界，只能检查平台状态"},
  {key:"waiting",n:1,tone:"sync",label:"等待平台确认",note:"请求已被远端接受，待确认"},
];
const FROZEN=[
  {id:1,op:"Afternic · 上传价格 CSV",account:"主账户",reason:"请求已发出，进程崩溃，结果未知"},
  {id:2,op:"Atom · 改价 vault.io → 268,000",account:"主账户",reason:"已提交，未收到响应"},
];

function RecoveryScan({onContinue}){
  const I=window.GDI;
  const [checked,setChecked]=React.useState([]);
  const check=id=>setChecked(c=>c.includes(id)?c:[...c,id]);
  const allChecked=checked.length>=FROZEN.length;

  return <RWin appName="GoodDealer" context="崩溃恢复" mark={<img src="../../assets/logo/mark-16.svg" width="16" height="16" alt=""/>}
    style={{width:600,height:640,maxWidth:"100%",maxHeight:"100%"}} onClose={onContinue}>
    <div style={{flex:1,minWidth:0,display:"flex",flexDirection:"column",background:"var(--gd-ink)",overflowY:"auto"}}>
      <div style={{padding:"28px 36px 20px"}}>
        <div style={{display:"flex",alignItems:"center",gap:11,marginBottom:10}}>
          <span style={{width:34,height:34,borderRadius:8,background:"var(--gd-panel-raised)",border:"1px solid var(--gd-line-strong)",display:"flex",alignItems:"center",justifyContent:"center"}}><I.History size={18} style={{color:"var(--gd-blue)"}}/></span>
          <div>
            <div style={{fontSize:18,fontWeight:600,color:"var(--text-1)"}}>崩溃恢复 · 核对未完成任务</div>
            <div style={{fontSize:12,color:"var(--gd-text-muted)",marginTop:2}}>上次未正常退出 · 按提交边界核对，核对完成前不领取新任务</div>
          </div>
        </div>
        <div style={{display:"flex",alignItems:"center",gap:8,fontSize:12,color:"var(--gd-success)"}}><I.Check size={14}/>扫描完成 · 818 项非终态任务已分类</div>
      </div>

      <div style={{padding:"0 36px",display:"flex",flexDirection:"column",gap:8}}>
        {BUCKETS.map(b=><div key={b.key} style={{display:"flex",alignItems:"center",gap:12,padding:"11px 14px",border:"1px solid var(--gd-line)",borderRadius:7,background:b.key==="unknown"?"var(--gd-danger-tint)":"var(--gd-panel)"}}>
          <RDot kind={b.tone} size={9}/>
          <span style={{width:150,flex:"none",fontSize:13,color:"var(--text-1)"}}>{b.label}</span>
          <span style={{flex:1,minWidth:0,fontSize:11,color:"var(--gd-text-muted)"}}>{b.note}</span>
          <span style={{fontFamily:"var(--font-mono)",fontSize:15,color:`var(--gd-${b.tone})`}}>{b.n}</span>
        </div>)}
      </div>

      <div style={{padding:"18px 36px 8px"}}>
        <div style={{fontSize:11,letterSpacing:"0.06em",textTransform:"uppercase",color:"var(--gd-text-faint)",marginBottom:8}}>结果未知 · 需逐项确认（只能检查，不自动重试）</div>
        <div style={{border:"1px solid var(--gd-line)",borderRadius:7,overflow:"hidden"}}>
          {FROZEN.map((f,i)=>{const done=checked.includes(f.id);
            return <div key={f.id} style={{display:"flex",alignItems:"center",gap:12,padding:"11px 14px",borderBottom:i<FROZEN.length-1?"1px solid var(--gd-line)":"none",opacity:done?.6:1}}>
              <RDot kind={done?"success":"danger"} size={8}/>
              <div style={{flex:1,minWidth:0}}>
                <div style={{fontSize:13,color:"var(--text-1)"}}>{f.op}<span style={{color:"var(--gd-text-faint)",fontSize:11}}> · {f.account}</span></div>
                <div style={{fontSize:11,color:"var(--gd-text-muted)"}}>{f.reason}</div>
              </div>
              {done?<RBadge tone="success" mono={false}>已核对</RBadge>
                :<RBtn size="sm" icon={<I.RefreshCw size={13}/>} onClick={()=>check(f.id)}>检查平台状态</RBtn>}
            </div>;})}
        </div>
      </div>

      <div style={{marginTop:"auto",padding:"14px 36px 24px",borderTop:"1px solid var(--gd-line)",display:"flex",alignItems:"center",gap:12}}>
        <span style={{flex:1,fontSize:11,color:"var(--gd-text-faint)",lineHeight:1.5}}>已确认成功的写操作不会重复执行；结果未知项确认后进入对账，未确认前不领取新任务。</span>
        <RBtn variant="primary" onClick={onContinue}>{allChecked?"进入主界面":`进入主界面 · ${FROZEN.length-checked.length} 项待确认`}</RBtn>
      </div>
    </div>
  </RWin>;
}
window.GDRecoveryScan=RecoveryScan;
