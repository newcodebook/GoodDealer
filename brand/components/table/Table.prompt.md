The core component: financial-grade data table for domain assets (万行虚拟滚动场景按此视觉规范)。

```jsx
<Table density="regular" selectable selected={sel} onSelectionChange={setSel}
  sortKey={k} sortDir={d} onSort={(k2,d2)=>{setK(k2);setD(d2);}}
  maxHeight={420}
  columns={[
    {key:"domain",label:"域名",sortable:true,render:r=><span style={{fontFamily:"var(--font-mono)",fontSize:12}}>{r.domain}</span>},
    {key:"registrar",label:"注册商",muted:true},
    {key:"status",label:"状态",render:r=><Badge tone="sync">SYNCED</Badge>},
    {key:"bin",label:"BIN",numeric:true,sortable:true,render:r=><Money amount={r.bin}/>},
    {key:"expiry",label:"到期",numeric:true,muted:true},
  ]}
  rows={rows} footer={<span>1,024 个域名 · 已选 {sel.length}</span>}/>
```

Rules: 数字列必 `numeric`（右对齐等宽）；域名用 12px mono；估值用 `<Money/>`（金色）；状态用 `<Badge/>`/`<StatusDot/>`；表头 11px 大写。Densities: compact 32 · regular 40 · spacious 48. Pair with `<BatchBar/>` when `selectable`.

**列优先级（窄视图自动下沉，不挤压）**：给列标 `priority`——`"essential"`（默认，永远显示：身份/估值/状态/操作）· `"secondary"`（表宽 < `bpSecondary` 默认 640 时隐藏：平台、次要计数）· `"supplementary"`（< `bpSupplementary` 默认 900 时隐藏：浏览量、日期）。判定用**表自身宽度**（内建 ResizeObserver），窄面板里也会下沉，与窗口宽度无关；隐藏列数在表脚提示「N 列已折叠」，绝不静默。`responsive={false}` 关闭；`forceWidth` 用于测试。真正超宽表仍走 `overflow-x:auto` 横滚。导出 `visibleColumns(columns,w)` 纯函数复用。
