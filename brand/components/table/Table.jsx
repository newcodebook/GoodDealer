import React from "react";
import { ensureGdCss } from "../buttons/Button.jsx";
import { Checkbox } from "../inputs/Checkbox.jsx";
const css=`
.gd-table-shell{border:1px solid var(--gd-line);border-radius:var(--radius-md);background:var(--gd-panel);overflow:hidden;display:flex;flex-direction:column}
.gd-table-scroll{overflow:auto;flex:1;min-height:0}
.gd-table{width:100%;border-collapse:separate;border-spacing:0;font-size:13px;color:var(--gd-text)}
.gd-table th{position:sticky;top:0;z-index:2;background:var(--gd-panel);text-align:left;font-size:11px;font-weight:500;letter-spacing:var(--tracking-caps);text-transform:uppercase;color:var(--gd-text-muted);border-bottom:1px solid var(--gd-line-strong);padding:0 12px;height:34px;white-space:nowrap;user-select:none}
.gd-table td{border-bottom:1px solid var(--gd-line);padding:0 12px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.gd-table tr:last-child td{border-bottom:none}
.gd-table--compact td{height:var(--row-compact);font-size:12px}
.gd-table--regular td{height:var(--row-regular)}
.gd-table--spacious td{height:var(--row-spacious)}
.gd-table tbody tr{transition:background var(--dur-fast) var(--ease-out)}
.gd-table--hover tbody tr:hover td{background:var(--gd-panel-raised)}
.gd-table tr.gd-row--selected td{background:rgba(77,141,255,0.07);border-bottom-color:rgba(77,141,255,0.14)}
.gd-table--hover tbody tr.gd-row--selected:hover td{background:rgba(77,141,255,0.11)}
.gd-table tr.gd-row--clickable{cursor:pointer}
.gd-table .gd-cell--num,.gd-table th.gd-cell--num{text-align:right;font-family:var(--font-mono);font-variant-numeric:tabular-nums}
.gd-table th.gd-cell--num{font-family:var(--font-sans)}
.gd-table .gd-cell--center{text-align:center}
.gd-table .gd-cell--muted{color:var(--gd-text-muted)}
.gd-table .gd-cell--check{width:36px;padding:0 0 0 14px}
.gd-th-sort{display:inline-flex;align-items:center;gap:4px;cursor:pointer;border-radius:3px}
.gd-th-sort:hover{color:var(--gd-text)}
.gd-th-sort svg{opacity:0;transition:opacity var(--dur-fast)}
.gd-th-sort--active{color:var(--gd-text)}
.gd-th-sort--active svg{opacity:1}
.gd-th-sort:hover svg{opacity:.6}
.gd-table-empty{padding:48px 16px;text-align:center;color:var(--gd-text-faint);font-size:12px}
.gd-table-foot{border-top:1px solid var(--gd-line-strong);background:var(--gd-panel);padding:8px 14px;font-size:12px;color:var(--gd-text-muted);display:flex;align-items:center;gap:12px}
`;
ensureGdCss("gd-table-css",css);
const SortGlyph=({dir})=><svg width="8" height="10" viewBox="0 0 8 10" fill="none"><path d={dir==="desc"?"M1 4L4 8L7 4":"M1 6L4 2L7 6"} stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round"/></svg>;
export function Table({columns=[],rows=[],rowKey="id",density="regular",selectable=false,selected=[],onSelectionChange,sortKey,sortDir="asc",onSort,onRowClick,hover=true,maxHeight,footer,emptyText="没有匹配的项目",style}){
  const sel=new Set(selected);
  const keyOf=(r,i)=>typeof rowKey==="function"?rowKey(r):(r[rowKey]!==undefined?r[rowKey]:i);
  const allKeys=rows.map(keyOf);
  const allSel=rows.length>0&&allKeys.every(k=>sel.has(k));
  const someSel=allKeys.some(k=>sel.has(k));
  const toggleAll=()=>onSelectionChange&&onSelectionChange(allSel?[]:allKeys);
  const toggleOne=k=>{const n=new Set(sel);n.has(k)?n.delete(k):n.add(k);onSelectionChange&&onSelectionChange([...n]);};
  const cellCls=c=>`${c.numeric?" gd-cell--num":""}${c.align==="right"&&!c.numeric?" gd-cell--num":""}${c.align==="center"?" gd-cell--center":""}${c.muted?" gd-cell--muted":""}`;
  return <div className="gd-table-shell" style={style}>
    <div className="gd-table-scroll" style={maxHeight?{maxHeight}:undefined}>
      <table className={`gd-table gd-table--${density}${hover?" gd-table--hover":""}`}>
        <thead><tr>
          {selectable&&<th className="gd-cell--check"><Checkbox checked={allSel} indeterminate={someSel&&!allSel} onChange={toggleAll}/></th>}
          {columns.map(c=><th key={c.key} className={cellCls(c)} style={c.width?{width:c.width}:undefined}>
            {c.sortable?<span className={`gd-th-sort${sortKey===c.key?" gd-th-sort--active":""}`} onClick={()=>onSort&&onSort(c.key,sortKey===c.key&&sortDir==="asc"?"desc":"asc")}>{c.label}<SortGlyph dir={sortKey===c.key?sortDir:"asc"}/></span>:c.label}
          </th>)}
        </tr></thead>
        <tbody>
          {rows.map((r,i)=>{const k=keyOf(r,i);const isSel=sel.has(k);
            return <tr key={k} className={`${isSel?"gd-row--selected":""}${onRowClick?" gd-row--clickable":""}`} onClick={onRowClick?()=>onRowClick(r):undefined}>
              {selectable&&<td className="gd-cell--check"><Checkbox stop checked={isSel} onChange={()=>toggleOne(k)}/></td>}
              {columns.map(c=><td key={c.key} className={cellCls(c)} style={c.width?{width:c.width}:undefined}>{c.render?c.render(r,i):r[c.key]}</td>)}
            </tr>;})}
        </tbody>
      </table>
      {rows.length===0&&<div className="gd-table-empty">{emptyText}</div>}
    </div>
    {footer&&<div className="gd-table-foot">{footer}</div>}
  </div>;
}
