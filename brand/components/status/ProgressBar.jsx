import React from "react";
export function ProgressBar({segments,value,max=100,height=6,showTrack=true,style}){
  const segs=segments||[{value:Math.min(100,(value/max)*100),tone:"sync"}];
  const colors={sync:"var(--gd-blue)",gold:"var(--gd-gold)",success:"var(--gd-success)",warning:"var(--gd-warning)",danger:"var(--gd-danger)",neutral:"var(--gd-viz-drawdown)"};
  return <div style={{display:"flex",height,borderRadius:height/2,overflow:"hidden",background:showTrack?"var(--gd-line)":"transparent",width:"100%",...style}}>
    {segs.map((s,i)=><div key={i} style={{width:`${s.value}%`,background:colors[s.tone]||colors.sync,transition:"width var(--dur-slow) var(--ease-out)"}}></div>)}
  </div>;
}
