Primary (app) or secondary (in-content) toolbar; the native alternative to a floating action row.

```jsx
<Toolbar left={<><b>资产库</b><span style={{color:"var(--text-3)"}}>1,024</span></>} right={<><CmdSearch/><IconButton label="刷新"><RefreshIcon/></IconButton></>}/>
<Toolbar region left={<Select .../>} right={<Button variant="primary">生成计划</Button>}/>
```
