Persistent bottom status bar; the terminal-style ledger of live app state.

```jsx
<StatusBar
  left={[<><Dot tone="sync"/> SYNCED</>, "未同步 0", "最后同步 14:02", "rev 8,241"]}
  right={["4 平台", <>MacBook Pro <Dot tone="active"/> Active</>, "Epoch 41", "年付"]}/>
```

Each array item is one hairline-divided segment. Keep it mono and terse.
