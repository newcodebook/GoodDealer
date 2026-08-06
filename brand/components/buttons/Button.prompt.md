Standard action button; primary is matte tech blue, `gold` is an outline variant reserved for identity/value moments only.

```jsx
<Button variant="primary" size="md" onClick={run}>批准执行 823 项</Button>
<Button variant="secondary">导出预览</Button>
<Button variant="danger">强制切换</Button>
<Button variant="gold">验证所有权</Button>
```

Variants: primary / secondary (default) / ghost / danger / gold. Sizes sm 24 · md 28 · lg 34. Confirm buttons must state the real count ("将提交 823 项"), never a bare "确定".
