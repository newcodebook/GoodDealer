表格分页：范围读数 + 每页尺寸 + 窗口化页码。等宽 `tabular-nums`、hairline、原生桌面感；与 `<Table/>` 配套用于分页数据集（万行场景改用虚拟滚动而非分页）。

```jsx
<Pagination page={p} pageSize={size} total={1024}
  onPageChange={setP} onPageSizeChange={setSize}
  pageSizes={[10,25,50,100]}
  note={<>组合估值 <span style={{color:"var(--gd-gold)"}}>$482,900.00</span></>}/>
```

Rules: 页码与范围一律等宽 `tabular-nums`，数字用 `toLocaleString`；范围读数 `1–25 / 1,024` 常驻。页码 >7 时自动折叠（首末 + 当前 ±1，其余 `…`）。`note` 右对齐承载运行合计等 mono 附注。置于 `<Table/>` 页脚或工具栏次栏；不与 `<BatchBar/>` 抢占同一行焦点。
