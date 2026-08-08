// account-web shell — a WEB app chrome (top bar + responsive account left-nav), brand-consistent but
// deliberately NOT the desktop native-window shell. Public flows (pricing/checkout) use a centered
// column; the authed account area adds a left nav. The account web stays reachable even when the
// desktop client is Locked (it hosts the compliance entries), so it never imitates a native window.
const {Badge:AWBadge}=window.GoodDealerDesignSystem_b5b0b6;

const ACCOUNT_NAV=[
  {key:"overview",label:"概览",soon:true},
  {key:"subscription",label:"订阅与账单"},
  {key:"devices",label:"设备"},
  {key:"security",label:"安全"},
  {key:"data",label:"数据与隐私"},
  {key:"support",label:"支持"},
];
const AUTHED_PAGES=["subscription","devices","security","data","support"];

function AWShell({page,onGo,children}){
  const authed=AUTHED_PAGES.includes(page);
  const mark=<img src="../../assets/logo/mark-flat.svg" width="20" height="20" alt=""/>;
  return <div className="aw">
    <header className="aw-top">
      <a className="aw-brand" href="#" onClick={e=>{e.preventDefault();onGo("pricing");}}>{mark}GoodDealer</a>
      <nav className="aw-top-nav">
        {!authed&&<button onClick={()=>onGo("pricing")}>定价</button>}
        {authed
          ?<><span style={{color:"var(--text-3)",fontFamily:"var(--font-mono)",fontSize:12}}>investor@domain.com</span><button onClick={()=>onGo("pricing")}>登出</button></>
          :<button onClick={()=>onGo("signin")}>登录</button>}
      </nav>
    </header>
    <div className="aw-body">
      {authed?<>
        <aside className="aw-side">
          <span className="aw-side-sec">账户</span>
          {ACCOUNT_NAV.map(n=><button key={n.key} className={`aw-nav${n.key===page?" aw-nav--on":""}${n.soon?" aw-nav--soon":""}`} onClick={()=>{if(!n.soon)onGo(n.key);}}>
            {n.label}{n.soon&&<span style={{marginLeft:"auto",fontSize:9,color:"var(--text-3)"}}>即将</span>}
          </button>)}
        </aside>
        <main className="aw-main"><div className="aw-main-inner">{children}</div></main>
      </>:<div className="aw-flow"><div className="aw-flow-inner">{children}</div></div>}
    </div>
    <footer className="aw-foot">
      <span>© GoodDealer</span><span>·</span><span>本地执行 · 云端同步</span><span>·</span><span>支付由 Paddle 处理（Merchant of Record）</span>
    </footer>
  </div>;
}
window.AWShell=AWShell;
