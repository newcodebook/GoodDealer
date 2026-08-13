// marketing-web shell — public site chrome: sticky top nav (brand + section anchors + 登录 / 下载 CTA) and a
// multi-column footer. CTAs hand off to account-web (登录/注册 → Auth, 管理订阅 → Subscription). This is the
// brand-expressive surface, but the voice stays Mercury-restrained: no exclamation, no emoji.
const {}={};
function SiteShell({children}){
  const D=window.MK_DATA;const U=D.ui.shell;
  return <div className="mk">
    <header className="mk-top">
      <a href="#top" className="mk-brand"><img src={D.assetBase+"assets/logo/mark-flat.svg"} width="20" height="20" alt=""/>GoodDealer</a>
      <nav className="mk-top-nav">
        {D.nav.map(([id,label])=><a key={id} href={"#"+id}>{label}</a>)}
      </nav>
      <div className="mk-top-right">
        <a href="../account-web/index.html">{U.login}</a>
        <a href="#download" className="mk-stamp" style={{height:34,padding:"0 14px",fontSize:13}}><i></i>{U.download}</a>
      </div>
    </header>
    <main className="mk-main" id="top">{children}</main>
    <footer className="mk-foot">
      <div className="mk-foot-inner">
        <div style={{flex:"1 1 240px",minWidth:0}}>
          <div style={{display:"flex",alignItems:"center",gap:9,fontSize:15,fontWeight:600}}><img src={D.assetBase+"assets/logo/mark-flat.svg"} width="18" height="18" alt=""/>GoodDealer</div>
          <div style={{fontSize:12,color:"var(--text-3)",marginTop:8,fontFamily:"var(--font-mono)"}}>{D.footer.tagline}</div>
        </div>
        {D.footer.cols.map(([title,links])=><div key={title} style={{flex:"0 0 auto"}}>
          <div style={{fontSize:11,letterSpacing:"0.06em",textTransform:"uppercase",color:"var(--text-3)",marginBottom:10}}>{title}</div>
          <div style={{display:"flex",flexDirection:"column",gap:8}}>{links.map(l=><a key={l} href="#" style={{fontSize:13,color:"var(--text-2)",textDecoration:"none"}}>{l}</a>)}</div>
        </div>)}
      </div>
      <div style={{maxWidth:1120,margin:"28px auto 0",paddingTop:16,borderTop:"1px solid var(--gd-line)",display:"flex",gap:14,flexWrap:"wrap",fontSize:11,color:"var(--text-3)"}}>
        <span>© 2026 GoodDealer</span><span>·</span><span>{U.footerLegal}</span><span>·</span><span>{U.footerLang}</span>
      </div>
    </footer>
  </div>;
}
window.MKShell=SiteShell;
