const {Badge,Button,Panel,StatusDot}=window.GoodDealerDesignSystem_b5b0b6;
function TaskInbox(){
  const I=window.GDI;
  const [cur,setCur]=React.useState(1);
  const [doneIds,setDoneIds]=React.useState([]);
  const [automation,setAutomation]=React.useState("user"); // user | software | paused
  const [grant,setGrant]=React.useState(false);
  const tasks=window.GD_DATA.tasks;
  const t=tasks.find(x=>x.id===cur);
  const isDone=doneIds.includes(cur);
  const badge=b=>b==="danger"?<Badge tone="danger" mono={false}>高优先级</Badge>:b==="warning"?<Badge tone="warning" mono={false}>等待人工</Badge>:<Badge mono={false}>低优先级</Badge>;
  return <div data-screen-label="人工任务收件箱" style={{display:"flex",gap:14,height:"100%",minHeight:0,maxWidth:1080,margin:"0 auto",padding:16,width:"100%"}}>
    <div style={{width:300,flex:"none",display:"flex",flexDirection:"column",gap:8}}>
      <span style={{fontSize:16,fontWeight:600,padding:"2px 2px 6px"}}>人工任务 <span style={{fontFamily:"var(--font-mono)",fontSize:12,color:"var(--gd-text-muted)"}}>· {tasks.length-doneIds.length} 待处理</span></span>
      {tasks.map(x=>{const d=doneIds.includes(x.id);
        return <button key={x.id} onClick={()=>setCur(x.id)} style={{textAlign:"left",background:cur===x.id?"var(--gd-panel-raised)":"var(--gd-panel)",border:`1px solid ${cur===x.id?"var(--gd-line-strong)":"var(--gd-line)"}`,borderRadius:7,padding:"10px 12px",cursor:"pointer",fontFamily:"var(--font-sans)",display:"flex",flexDirection:"column",gap:6,opacity:d?.55:1}}>
          <span style={{fontSize:13,fontWeight:500,color:"var(--gd-text)",display:"flex",alignItems:"center",gap:6}}>{d&&<I.Check size={13} style={{color:"var(--gd-success)"}}/>}{x.title}</span>
          <span style={{display:"flex",gap:8,alignItems:"center"}}>{d?<Badge tone="success" mono={false}>已完成</Badge>:badge(x.badge)}<span style={{fontSize:11,color:"var(--gd-text-faint)"}}>{x.account}{x.domains?` · ${x.domains} 域名`:""}</span></span>
        </button>;})}
      <span style={{fontSize:11,color:"var(--gd-text-faint)",padding:"4px 2px"}}>自动化失败会回到同一任务，不创建重复项</span>
    </div>
    <div style={{flex:1,minWidth:0,display:"flex",flexDirection:"column",gap:12}}>
      <Panel title={t.title} actions={isDone?<Badge tone="success" mono={false}>已完成</Badge>:badge(t.badge)}>
        <div style={{display:"flex",flexDirection:"column",gap:12,fontSize:13}}>
          <div style={{display:"grid",gridTemplateColumns:"96px 1fr",rowGap:8,columnGap:12,fontSize:12}}>
            <span style={{color:"var(--gd-text-faint)"}}>为什么需要人工</span><span>{t.why}</span>
            <span style={{color:"var(--gd-text-faint)"}}>目标</span><span>{t.platform} · {t.account}</span>
            <span style={{color:"var(--gd-text-faint)"}}>影响域名</span><span style={{fontFamily:"var(--font-mono)"}}>{t.domains||"—"}</span>
            <span style={{color:"var(--gd-text-faint)"}}>已准备</span><span style={{display:"flex",alignItems:"center",gap:6}}>{t.prepared!=="—"&&<I.FileText size={13} style={{color:"var(--gd-text-muted)"}}/>}{t.prepared}</span>
            <span style={{color:"var(--gd-text-faint)"}}>完成条件</span><span>{t.done}</span>
            <span style={{color:"var(--gd-text-faint)"}}>最后检查</span><span style={{fontFamily:"var(--font-mono)"}}>{t.lastCheck}</span>
          </div>
          <div style={{display:"flex",gap:8,flexWrap:"wrap"}}>
            <Button icon={<I.ExternalLink size={13}/>}>打开平台并登录</Button>
            <Button variant="gold" onClick={()=>setGrant(true)}>授权执行</Button>
            <Button variant="ghost" onClick={()=>setDoneIds(d=>isDone?d.filter(i=>i!==cur):[...d,cur])}>{isDone?"重新打开":"我已完成"}</Button>
            <Button variant="ghost" icon={<I.RefreshCw size={13}/>}>重新检查</Button>
          </div>
          <span style={{fontSize:11,color:"var(--gd-text-faint)"}}>「我已完成」不会直接标记成功——系统将读取平台状态验证完成条件</span>
        </div>
      </Panel>
      <Panel title="Remote Browser · 交接状态" actions={<Badge tone="sync">SESSION 22:41</Badge>}>
        <div style={{display:"flex",flexDirection:"column",gap:12}}>
          <div style={{display:"flex",gap:16,alignItems:"center",fontSize:12,color:"var(--gd-text-muted)"}}>
            <span style={{display:"flex",alignItems:"center",gap:6}}><I.Monitor size={14}/>{t.platform} · {t.account}</span>
            <span style={{fontFamily:"var(--font-mono)",fontSize:11}}>允许 Host: *.{t.platform.toLowerCase()}.com</span>
            <span style={{marginLeft:"auto"}}>{automation==="software"?<StatusDot kind="sync" pulse label="软件执行中 · 剩余 3 项"/>:automation==="paused"?<StatusDot kind="warning" label="已暂停 · 等待接管"/>:<StatusDot kind="neutral" label="用户操作（密码 / 2FA / CAPTCHA）"/>}</span>
          </div>
          <div style={{background:"var(--gd-ink)",border:"1px solid var(--gd-line)",borderRadius:5,padding:"8px 12px",fontFamily:"var(--font-mono)",fontSize:11,color:"var(--gd-text-muted)",display:"flex",justifyContent:"space-between"}}>
            <span>下一步：{automation==="software"?"填写价格表单 → 提交":"等待用户完成登录"}</span><span>队列 {automation==="software"?"3":"—"} / 12</span>
          </div>
          <div style={{display:"flex",gap:8}}>
            <Button size="sm" icon={<I.Pause size={12}/>} onClick={()=>setAutomation("paused")} disabled={automation!=="software"}>暂停并接管</Button>
            <Button size="sm" icon={<I.Play size={12}/>} onClick={()=>setAutomation("software")} disabled={automation==="software"}>继续</Button>
            <Button size="sm" variant="danger" onClick={()=>setAutomation("user")}>终止</Button>
            <span style={{marginLeft:"auto",fontSize:11,color:"var(--gd-text-faint)",alignSelf:"center"}}>密码、2FA、CAPTCHA 页面自动切换为用户操作</span>
          </div>
        </div>
      </Panel>
    </div>
    <window.GDBrowserAutomationGrant open={grant} platform={t.platform} account={t.account} planCount={t.domains||1}
      planAction={t.platform==="Afternic"?"上传价格 CSV":"下架 Listing"}
      onClose={()=>setGrant(false)} onGrant={()=>{setGrant(false);setAutomation("software");}}/>
  </div>;
}
window.GDTaskInbox=TaskInbox;
