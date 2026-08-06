Status pill; the sync language of the app.

```jsx
<Badge tone="sync">SYNCED</Badge>
<Badge tone="warning" mono={false}>等待平台</Badge>
<Badge tone="danger" dot>高风险</Badge>
```

Mono-uppercase for machine states (SYNCED / OUTBOX 3); `mono={false}` for Chinese labels.
