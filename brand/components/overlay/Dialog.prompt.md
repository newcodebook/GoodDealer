Confirmation/detail modal; ESC + scrim click close.

```jsx
<Dialog open={o} onClose={close} title="确认提交" width={480}
  footer={<><Button onClick={close}>取消</Button><Button variant="primary">提交 823 项修改</Button></>}>
  将向 Atom 主账户提交 823 项价格修改，其中 6 项存在冲突已排除。
</Dialog>
```

Never a bare "确定" — state the exact count/scope in the confirm button.
