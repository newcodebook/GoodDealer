Native window shell — wrap a whole desktop screen so it reads as an app, not a webpage. Pair with StatusBar as the footer.

```jsx
<WindowChrome appName="GoodDealer" mark={<img src="mark-flat.svg" width={18}/>}
  context="个人 Workspace · 资产库"
  footer={<StatusBar left={[...]} right={[...]}/>}>
  <aside>…nav…</aside>
  <div style={{flex:1,display:"flex",flexDirection:"column"}}><Toolbar .../><main>…</main></div>
</WindowChrome>
```
