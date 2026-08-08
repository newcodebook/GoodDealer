// admin-web shell — internal Owner console chrome. Gold top accent + STAFF chip mark it as the staff
// surface (never mistakable for the user account web). Left nav; Owner identity + Passkey freshness top-right.
const {}={};
const ADMIN_NAV=[
  {key:"overview",label:"概览"},
  {key:"accounts",label:"账号"},
  {key:"licensing",label:"License 与订单"},
  {key:"cases",label:"案件"},
  {key:"diagnostics",label:"同步诊断"},
  {key:"jobs",label:"Jobs 与隔离区"},
  {key:"release",label:"发布与政策"},
  {key:"audit",label:"审计"},
];

function AdminShell({page,onGo,onLogout,children}){
  const s=window.ADM_DATA.staff;
  return <div className="adm">
    <header className="adm-top">
      <span className="adm-brand"><img src="../../assets/logo/mark-flat.svg" width="18" height="18" alt=""/>GoodDealer</span>
      <span className="adm-staff">ADMIN · STAFF</span>
      <div className="adm-top-right">
        <span style={{display:"inline-flex",alignItems:"center",gap:6}}>
          <img src="../../assets/icons/keyhole.svg" width="13" height="13" alt="" style={{opacity:.85}}/>
          <span style={{fontFamily:"var(--font-mono)",fontSize:11}}>{s.email}</span>
          <span style={{fontSize:10,color:"var(--gd-gold)",border:"1px solid var(--gd-line-strong)",borderRadius:3,padding:"0 5px",lineHeight:"16px"}}>Owner</span>
        </span>
        <span style={{fontSize:11,color:"var(--text-3)"}}>Passkey 新鲜 {s.passkeyFresh}</span>
        <button onClick={onLogout}>登出</button>
      </div>
    </header>
    <div className="adm-body">
      <aside className="adm-side">
        {ADMIN_NAV.map(n=><button key={n.key} className={`adm-nav${n.key===page?" adm-nav--on":""}${n.soon?" adm-nav--soon":""}`} onClick={()=>{if(!n.soon)onGo(n.key);}}>
          {n.label}{n.soon&&<span style={{marginLeft:"auto",fontSize:9,color:"var(--text-3)"}}>即将</span>}
        </button>)}
      </aside>
      <main className="adm-main"><div className="adm-main-inner">{children}</div></main>
    </div>
    <footer className="adm-foot"><span>GoodDealer 运营后台 · 单 Owner</span><span>·</span><span>受控管理 Port · 无任意 SQL / 直接 Repository 编辑</span><span>·</span><span>管理员不可读平台凭据 / 密钥 / 备份秘密</span></footer>
  </div>;
}
window.ADMShell=AdminShell;
