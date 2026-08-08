Selection action bar for batch operations; place under (or floating over) a selectable Table.

```jsx
<BatchBar count={sel.length} onClear={()=>setSel([])}>
  <Button size="sm" variant="primary">批量改价</Button>
  <Button size="sm">修改 DNS</Button>
</BatchBar>
```
