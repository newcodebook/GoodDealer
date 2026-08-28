// 运营概览 Dashboard — MRR trend, plan mix, recent transactions, attention feed, fleet health.
const {Panel:DPanel,Badge:DBadge,Button:DBtn,Money:DMoney,StatusDot:DDot}=window.GoodDealerDesignSystem_b5b0b6;

function Bars({series}){
  const max=Math.max(...series),min=Math.min(...series);
  return <div style={{display:"flex",alignItems:"flex-end",gap:5,height:96,marginTop:4}}>
    {series.map((v,i)=>{const h=8+((v-min)/(max-min||1))*82;const last=i===series.length-1;
      return <div key={i} title={"$"+v+"k"} style={{flex:1,display:"flex",flexDirection:"column",justifyContent:"flex-end",alignItems:"stretch",gap:5}}>
        <div style={{height:h,borderRadius:"2px 2px 0 0",background:last?"var(--gd-gold)":"rgba(212,164,55,0.32)"}}></div>
        <span style={{fontSize:9,color:"var(--text-3)",textAlign:"center",fontFamily:"var(--font-mono)"}}>{i+1}</span>
      </div>;})}
  </div>;
}

function AttnRow({icon,tone,text,meta,cta,onGo}){
  const I=window.GDI;const Ic=I[icon];const col=`var(--gd-${tone})`;
  return <div style={{display:"flex",gap:11,padding:"11px 0",borderBottom:"1px solid var(--gd-line)",alignItems:"flex-start"}}>
    <span style={{width:26,height:26,flex:"none",borderRadius:6,background:`var(--gd-${tone}-tint)`,display:"flex",alignItems:"center",justifyContent:"center",color:col}}><Ic size={14}/></span>
    <div style={{flex:1,minWidth:0}}><div style={{fontSize:12.5,color:"var(--text-1)"}}>{text}</div><div style={{fontSize:11,color:"var(--text-3)",marginTop:2}}>{meta}</div></div>
    <button onClick={onGo} style={{flex:"none",background:"none",border:"none",color:"var(--gd-blue)",fontSize:11.5,cursor:"pointer",fontFamily:"var(--font-sans)",whiteSpace:"nowrap",padding:"2px 0"}}>{cta}</button>
  </div>;
}

function AdminDashboard({go}){
  const D=window.GD_ADMIN;const I=window.GDI;const K=D.kpis;const MetricStrip=window.GDMetricStrip;
  const totalMrr=D.planMix.reduce((s,p)=>s+p.mrr,0);
  const fleetStates=[["active","Active",1842,"gold"],["standby","Standby",1903,"blue"],["activating","激活中",41,"blue"],["draining","排空中",18,"warning"],["sunset","Sunset 保留",302,"neutral"]];
  return <div data-screen-label="运营概览" style={{display:"flex",flexDirection:"column",minHeight:0}}>
    <MetricStrip metrics={[
      {label:"活跃客户",value:K.activeCustomers.toLocaleString(),meta:"试用 "+K.trials+" · 流失率 "+K.churnRate+"%"},
      {label:"月经常性收入 MRR",value:"$48,210",tone:"gold",meta:"ARR $578,520 · 环比 +0.6%"},
      {label:"在线设备",value:K.devicesOnline.toLocaleString(),meta:"绑定 "+K.devicesBound.toLocaleString()+" · 单活动"},
      {label:"同步健康",value:K.syncHealth+"%",tone:"success",meta:"队列 128 · p95 42ms"},
      {label:"待处理工单",value:K.openTickets,tone:"warning",meta:"2 高优先级",onClick:()=>go("support")},
      {label:"高风险告警",value:K.alerts,tone:"danger",meta:"1 服务降级",onClick:()=>go("infra")},
    ]}/>
    <div style={{padding:18,display:"flex",flexDirection:"column",gap:14}}>
      <div style={{display:"grid",gridTemplateColumns:"1fr 340px",gap:14,alignItems:"start"}}>
        <div style={{display:"flex",flexDirection:"column",gap:14,minWidth:0}}>
          <DPanel title="月经常性收入 · 近 12 个月" actions={<><span style={{fontFamily:"var(--font-mono)",fontSize:15,color:"var(--gd-gold)"}}>$48.2k</span><span style={{fontSize:11,color:"var(--gd-success)",marginLeft:8}}>+26% YoY</span></>}>
            <Bars series={D.revenueSeries}/>
            <div style={{display:"flex",gap:18,marginTop:14,paddingTop:12,borderTop:"1px solid var(--gd-line)"}}>
              {D.planMix.map(p=><div key={p.plan} style={{display:"flex",flexDirection:"column",gap:4,flex:1}}>
                <span style={{display:"flex",alignItems:"center",gap:6,fontSize:11,color:"var(--text-2)"}}><span style={{width:8,height:8,borderRadius:2,background:p.color,flex:"none"}}></span>{p.plan}</span>
                <span style={{fontFamily:"var(--font-mono)",fontSize:14,color:"var(--text-1)"}}>{p.count.toLocaleString()}</span>
                <span style={{fontSize:11,color:"var(--text-3)",fontFamily:"var(--font-mono)"}}>${(p.mrr/1000).toFixed(1)}k MRR</span>
              </div>)}
            </div>
          </DPanel>
          <DPanel flush title="近期交易" actions={<DBtn size="sm" variant="ghost" onClick={()=>go("revenue")}>全部 →</DBtn>}>
            <table style={{width:"100%",borderCollapse:"collapse",fontSize:12.5}}>
              <tbody>{D.transactions.slice(0,5).map((t,i)=><tr key={t.id} style={{borderBottom:i<4?"1px solid var(--gd-line)":"none"}}>
                <td style={{padding:"9px 16px",fontFamily:"var(--font-mono)",fontSize:11,color:"var(--text-3)"}}>{t.id}</td>
                <td style={{padding:"9px 8px",color:"var(--text-1)"}}>{t.customer}</td>
                <td style={{padding:"9px 8px"}}>{t.type==="refund"?<DBadge tone="neutral" mono={false}>退款</DBadge>:t.status==="failed"?<DBadge tone="danger" mono={false}>失败</DBadge>:<DBadge tone="success">成功</DBadge>}</td>
                <td style={{padding:"9px 16px",textAlign:"right"}}><DMoney amount={t.amount} size={12} tone={t.type==="refund"?"danger":"gold"} sign={t.type==="refund"}/></td>
              </tr>)}</tbody>
            </table>
          </DPanel>
        </div>
        <DPanel flush title="需要关注" actions={<DBadge tone="danger">{2+2+2} 项</DBadge>}>
          <div style={{padding:"2px 16px 4px"}}>
            <AttnRow icon="Activity" tone="warning" text="Webhooks 服务降级" meta="Afternic 回调延迟 340ms · INC-241" cta="查看" onGo={()=>go("infra")}/>
            <AttnRow icon="CreditCard" tone="danger" text="2 笔扣款失败" meta="Sana Qureshi · Halcyon Group · past_due" cta="处理" onGo={()=>go("revenue")}/>
            <AttnRow icon="LifeBuoy" tone="warning" text="2 个高优先级工单" meta="设备门禁 · 批量改价未生效" cta="收件箱" onGo={()=>go("support")}/>
            <AttnRow icon="Cpu" tone="warning" text="1 台设备激活滞留" meta="Sana Qureshi · D-9111 · 排空 2 天" cta="舰队" onGo={()=>go("fleet")}/>
            <AttnRow icon="Users" tone="neutral" text="186 个试用将在 14 天内到期" meta="转化提醒" cta="客户" onGo={()=>go("customers")}/>
          </div>
        </DPanel>
      </div>
      <DPanel title="设备舰队健康" actions={<DBtn size="sm" variant="ghost" onClick={()=>go("fleet")}>舰队详情 →</DBtn>}>
        <div style={{display:"flex",gap:0}}>
          {fleetStates.map(([k,label,n,tone],i)=><div key={k} style={{flex:1,display:"flex",flexDirection:"column",gap:6,padding:"4px 16px",borderRight:i<fleetStates.length-1?"1px solid var(--gd-line)":"none"}}>
            <span style={{display:"flex",alignItems:"center",gap:7,fontSize:11,color:"var(--text-2)"}}><DDot kind={k==="active"?"active":k==="standby"?"standby":tone==="warning"?"warning":"neutral"}/>{label}</span>
            <span style={{fontFamily:"var(--font-mono)",fontSize:20,color:tone==="gold"?"var(--gd-gold)":tone==="warning"?"var(--gd-warning)":"var(--text-1)"}}>{n.toLocaleString()}</span>
          </div>)}
        </div>
      </DPanel>
    </div>
  </div>;
}
window.GDAdminDashboard=AdminDashboard;
