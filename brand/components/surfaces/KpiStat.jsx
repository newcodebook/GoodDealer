import React from "react";
import { Money } from "../status/Money.jsx";
export function KpiStat({label,value,currency,tone="body",meta,style}){
  const isNum=typeof value==="number";
  const toneColor=tone==="gold"?"var(--gd-gold)":tone==="danger"?"var(--gd-danger)":tone==="warning"?"var(--gd-warning)":"var(--text-1)";
  return <div style={{display:"flex",flexDirection:"column",gap:4,...style}}>
    <span className="gd-t-label">{label}</span>
    {isNum&&currency?<Money amount={value} currency={currency} showCurrency size={28} tone={tone==="body"?"gold":tone}/>:
      <span className="gd-t-metric" style={{color:toneColor}}>{isNum?value.toLocaleString("en-US"):value}</span>}
    {meta&&<span className="gd-t-meta">{meta}</span>}
  </div>;
}
