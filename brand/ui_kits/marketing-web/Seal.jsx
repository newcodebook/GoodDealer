// Seal — the engraved medallion. Replaces the generic soft glow with security-printing craft: crisp concentric
// hairlines + coin reeding + a low-opacity guilloché rosette + the 外圆内方 square echo, with the real Coin Seal
// minted at center. Gold appears only as hairline engraving (per the brand's gold discipline: no fills/glows).
const {}={};
function Seal({size=248}){
  const c=size/2, R=size/2;
  const g="var(--gd-gold)";
  // coin reeding — fine radial ticks around the rim
  const N=84;
  const reed=[...Array(N)].map((_,i)=>{const a=i*Math.PI*2/N; const r1=R*0.86,r2=R*0.92;
    return {x1:c+Math.cos(a)*r1,y1:c+Math.sin(a)*r1,x2:c+Math.cos(a)*r2,y2:c+Math.sin(a)*r2};});
  // guilloché rosette — overlapping thin circles on a ring, forms an engraved interference pattern
  const M=44, d=R*0.30, rr=R*0.34;
  const rosette=[...Array(M)].map((_,i)=>{const a=i*Math.PI*2/M;return {cx:c+Math.cos(a)*d,cy:c+Math.sin(a)*d,r:rr};});
  const sq=R*0.30; // 外圆内方 echo
  return <svg className="mk-seal" width={size} height={size} viewBox={`0 0 ${size} ${size}`} fill="none" aria-hidden="true" style={{display:"block",overflow:"visible"}}>
    {/* guilloché rosette (subtle texture) — counter-rotates by default */}
    <g className="mk-rose" stroke={g} strokeWidth="0.55" opacity="0.07">{rosette.map((o,i)=><circle key={i} cx={o.cx} cy={o.cy} r={o.r}/>)}</g>
    {/* concentric hairline rings */}
    <circle cx={c} cy={c} r={R*0.94} stroke={g} strokeWidth="0.75" opacity="0.42"/>
    <circle cx={c} cy={c} r={R*0.84} stroke={g} strokeWidth="0.6" opacity="0.24"/>
    <circle cx={c} cy={c} r={R*0.60} stroke={g} strokeWidth="0.6" opacity="0.5"/>
    {/* coin reeding */}
    <g className="mk-reed" stroke={g} strokeWidth="0.8" opacity="0.3">{reed.map((o,i)=><line key={i} x1={o.x1} y1={o.y1} x2={o.x2} y2={o.y2}/>)}</g>
    {/* 外圆内方 — two rotated squares echoing the Coin Seal; on hover they counter-rotate (法阵 effect) */}
    <rect className="mk-sq mk-sq-1" x={c-sq} y={c-sq} width={sq*2} height={sq*2} stroke={g} strokeWidth="0.7" opacity="0.16" fill="none"/>
    {/* sq-2: 45° base rotation via CSS (not SVG attr) so CSS animation can compose cleanly */}
    <rect className="mk-sq mk-sq-2" x={c-sq} y={c-sq} width={sq*2} height={sq*2} stroke={g} strokeWidth="0.7" opacity="0.16" fill="none"/>
    {/* ripple — hover only; ORIGINATES at the mark (center Coin Seal, r≈R*0.33) and expands outward BEYOND the
        outer ring. non-scaling-stroke keeps the ring hairline while it scales up. Modeled on the brand 圜纹. */}
    <g stroke={g} strokeWidth="1" fill="none">
      <circle className="mk-ripple mk-ripple-1" cx={c} cy={c} r={R*0.33} vectorEffect="non-scaling-stroke" opacity="0"/>
      <circle className="mk-ripple mk-ripple-2" cx={c} cy={c} r={R*0.33} vectorEffect="non-scaling-stroke" opacity="0"/>
      <circle className="mk-ripple mk-ripple-3" cx={c} cy={c} r={R*0.33} vectorEffect="non-scaling-stroke" opacity="0"/>
    </g>
    {/* minted Coin Seal at center */}
    <image href={(window.MK_DATA&&window.MK_DATA.assetBase||"../../")+"assets/logo/mark.svg"} x={c-R*0.34} y={c-R*0.34} width={R*0.68} height={R*0.68}/>
  </svg>;
}
window.MKSeal=Seal;
