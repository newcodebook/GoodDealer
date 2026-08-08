import React from "react";
export function DiffValue({oldValue,newValue,mono=true,size=12,style}){
  const f=mono?{fontFamily:"var(--font-mono)",fontVariantNumeric:"tabular-nums"}:{};
  return <span style={{display:"inline-flex",alignItems:"center",gap:7,fontSize:size,...f,...style}}>
    <span style={{color:"var(--gd-text-faint)",textDecoration:"line-through",textDecorationColor:"rgba(92,98,114,0.6)"}}>{oldValue??"—"}</span>
    <svg width="11" height="8" viewBox="0 0 12 8" fill="none" style={{flex:"none"}}><path d="M1 4H10M10 4L7 1M10 4L7 7" stroke="var(--gd-text-muted)" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round"/></svg>
    <span style={{color:"var(--gd-text)"}}>{newValue??"—"}</span>
  </span>;
}
