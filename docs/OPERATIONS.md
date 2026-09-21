# GoodDealer 操作编排与任务语义

## 适用范围

本文件定义未来业务变更和外部副作用的目标合同。当前没有客户操作被组合；这里的状态机
和限制是后续实现要求，不是可执行接口。

## 目标操作模型

```text
user intent
  → bounded plan and preview
  → server/local authorization by owning domain
  → one specific execution boundary
  → observed outcome
  → redacted audit and user-visible result
```

### 1. 计划与预览

每个操作计划必须绑定有界目标、输入版本、预期差异、风险、可取消性和外部副作用类别。
批量操作在提交前必须能够显示纳入项、排除项和影响；UI 不能把单次点击、禁用状态或样例
数据当作授权。

### 2. 授权

拥有领域必须根据实际账户、工作区、目的、范围和当前状态验证授权。展示层、客户端缓存、
视觉夹具和调用方自报字段均不能产生权威。未来业务写入、外部连接和本地资源必须使用各自
最小的授权输入，不得依赖全局通用执行接口。

### 3. 执行

执行只允许通过具体拥有模块的受限边界发生。调用方不能选择任意秘密、网络目标、适配器、
文件位置或背景处理器。任何资源前后的状态变化、不确定性或验证失败都必须失败关闭。

### 4. 结果与恢复

结果至少区分：已确认完成、明确未执行/失败、以及无法确认的外部结果。未知结果不得自动
视为成功或无条件重放。后续恢复、重试、补偿和人工处理必须保留原计划、授权前提、观察和
脱敏审计之间的可追溯联系。

### 5. 审计

服务器审计使用 M013 的闭合模型：持久化种类只有 `user`、`staff` 和 `service`，并以规范
证据和签名的 `signing_key_transition_id` 保持链连续性。审计不保存原始秘密，也不产生新的
执行权威。

## 当前组合

Cloud 已有账号激活、Desktop Grant、账号 billing、Desktop OAuth 与支付 webhook 边界；周期作业
精确包含 Licensing provider inbox、reconciliation、首购退款 termination/refund operation 与受控重驱。
退款请求接受会立即撤销商业写入；unknown/manual 状态保持只读，订阅 termination 必须先确认，固定期
必须由 exact full-refund Provider 事实完成。共享开发环境已部署自托管周期 worker 并接入 Stripe
test mode；这不构成 live merchant、退款生产路径或生产 worker 资格。Desktop OAuth 已组合 Keychain device identity、challenge/PoP、近期 Web 重新认证首次绑定、access/refresh、
Bearer Grant 拉取与 build-pinned 双用途验签 registry。生产构建固定使用
`https://api.gooddealer.com/`，并必须设置 `GOODDEALER_DESKTOP_AUTHORIZATION_KEYS_JSON`，且 active `kid`/公钥
必须与经过资格确认的 OpenBao Grant/Lease key version 一致；轮换期 registry 和 Cloud Lease
verifier 必须重叠保留旧/新 key。Desktop 已有窄本地资产读写与认证命令，但尚未组合客户可用的任务执行、排程、取消、
重试或 Provider 提交。嵌入式 Browser 自动化不可用，Secure Host 也没有公开通用网络 API。

Licensing 投影中的 `credentialRefreshDueAt` 只表达下一次 Provider 事实刷新应被调度的时间。仓库中的
周期定义和端口测试本身不证明 scheduler 已按该时间执行；共享开发 worker 的 systemd/作业观察也只
证明该开发环境。不能把这一提示当作商业授权截止。
active、grace 与 inactive 的硬边界分别由商业到期、离线 grace 和已回查 Provider 状态决定，而每次
Lease 自身仍把外部执行限制在最长 24 小时。

## 交付条件

一个操作域要变为可用能力，必须具备实际组合、严格协议、授权与租户边界、负向测试、
可观察的外部结果和适用独立审查。提供商执行、部署、原生资格、发行和 Gate closure 均
不能从仓库类型或本地测试推断。
