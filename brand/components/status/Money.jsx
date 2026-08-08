import React from "react";
export function Money({amount,currency="USD",size=13,tone="gold",showCurrency=false,sign=false,style}){
  let text=amount;
  if(typeof amount==="number"){
    const abs=Math.abs(amount);
    text=abs.toLocaleString("en-US",{minimumFractionDigits:2,maximumFractionDigits:2});
    if(amount<0)text="−"+text;else if(sign&&amount>0)text="+"+text;
  }
  const colors={gold:"var(--gd-gold)",body:"var(--gd-text)",muted:"var(--gd-text-muted)",success:"var(--gd-success)",danger:"var(--gd-danger)"};
  if(amount==null||amount==="")return <span style={{color:"var(--gd-text-faint)",fontFamily:"var(--font-mono)",fontSize:size,...style}}>—</span>;
  return <span style={{fontFamily:"var(--font-mono)",fontVariantNumeric:"tabular-nums",fontSize:size,color:colors[tone]||colors.gold,...style}}>
    {showCurrency&&<span style={{color:"var(--gd-text-faint)",fontSize:Math.max(10,size-3),marginRight:5}}>{currency}</span>}{text}
  </span>;
}
