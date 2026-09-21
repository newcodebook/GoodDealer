# ADR-0020：商业授权失效不得剥夺本地数据访问

状态：Accepted

## 决策

GoodDealer 将商业事实、服务器运行授权和本地数据访问视为三种不同权威。

- Cloud Licensing 拥有计划、循环订阅或固定期限预付授权、付款状态、退款、Entitlement 修订和商业期限。
- Cloud Devices 根据有效账号、Entitlement、设备绑定和安全 Epoch 签发短期、目的限定的运行授权。
- `gooddealer-local-storage` 的 Desktop Local Host 拥有本地数据库身份、SQLCipher key 和有效本地能力
  裁决；`secure-host-core` 持有 OAuth/device/Provider 等非存储能力；Renderer 不能扩大任何能力。

License Key 只能作为一次性兑换材料，不能成为 Desktop 的长期执行权威。所有能够扩大权限的
服务器字段必须被目的限定的服务器签名覆盖，并绑定账号、个人默认工作区、设备、安全 Epoch、
Lease Epoch、能力和期限。

付款 webhook 是商业事实的触发器而不是直接权威。已启用的 provider adapter 必须先验证原始消息，
再通过对应官方服务端 SDK 回查当前 Subscription、Checkout 或 Order，并用显式
product/plan allowlist 生成 provider-neutral 快照。固定期限付款与退款必须关联可信 Checkout/Order
创建命令在 Provider 调用前保存的服务器端 `ProviderBinding`；不得
依赖自由文本、客户端提交的账号或 webhook 中未经回查的字段推断权益。

商业授权到期、暂停或退款后，已经在该 Host 上验证并绑定的本地工作区仍允许查看和受控导出，
但不允许本地业务修改、同步或 Provider 外部操作。设备撤销、账号安全恢复或本地完整性失败属于
安全锁定，不继承该商业只读能力；数据保持加密且不被删除，只能通过重新认证或受控恢复重新开放。

## 能力裁决

Host 计算的有效能力是服务器签名授权、设备与 Lease 状态、商业状态、本地完整性、可信时间和
本地安全策略的交集。当前能力集合为：

- `local:read`
- `local:export`
- `workspace:mutate`
- `sync:replicate`
- `provider:execute`

商业只读只包含前两项。有效离线 Lease 可继续授权本地业务修改，但不能由客户端延长；同步需要
Cloud transport，Provider 外部操作还必须满足操作自身的最小能力和副作用协议。

## 商业计划、退款与 Provider

首发提供同一功能权益的一档产品：USD 9.80 月付订阅、USD 98 年付订阅，以及 USD 498 的 10 年
固定期限预付授权。10 年授权从首次付款成功时起计算，不自动续费；它不是永久买断。月付和年付
可随时取消续费，权益保留至已付周期结束。

同一 GoodDealer 账号任何时候最多有一个正在创建、待批准或有效的商业购买。首发只在 catalog 和
客户界面中开放 Stripe；PayPal adapter 是可选扩展能力，不参与首发或生产资格判定，只有在未来完成
独立配置和资格后才可发布。切换 Provider 时先取消旧订阅续费，待已付周期结束后再通过另一已启用
Provider 购买。GoodDealer 统一校验优惠活动的资格、期限和次数，再映射到已启用 Provider 的受控
价格、计划或优惠对象，未知或不可映射的优惠失败关闭且不可叠加。

不提供免费试用。每个 GoodDealer 账号终身唯一的首次 settled acquisition 从 Provider 结算时间起
享有 336 小时全额退款窗口；续费不会移动截止时间或产生新窗口。退款请求一经接受就原子撤销
商业写入、同步和 Provider 执行能力并进入商业只读；订阅必须先确认 termination 才能规划退款，
unknown/manual 状态不表示完成，固定期限必须由 exact binding、同币种完整剩余金额的成功退款事实完成。公开
价格不含适用税费，结账只向已经完成支付和税务合规准备的国家或地区开放。

所有商业计划继续采用最多两台绑定设备、一台活动设备，以及最长 24 小时的外部执行授权窗口。将来若延长
纯本地编辑窗口，必须使用独立期限，不能同时扩大 Provider 外部副作用窗口。

`credentialRefreshDueAt` 表达服务器 Entitlement 投影下一次应刷新 Provider 事实的调度时间，不是
商业授权硬截止。没有实际组合刷新任务时，设备资格不得据此提前中断已付周期：active 截止于
`commercialExpiresAt`，grace 截止于 `offlineGraceUntil`，已回查为 pending、suspended 或 revoked
仍立即失败关闭。上述商业期限不扩大单次 Lease 最长 24 小时的外部执行窗口。

## 后果

- Desktop 不能再以单一 `ready` 布尔值同时控制读取和修改。
- Host 必须保存一个仅用于定位既有数据库和授予本地只读的已验证工作区绑定；该绑定不能签发、
  延长或替代服务器运行授权。
- 商业到期、设备撤销和完整性失败必须显示为不同状态。
- 远程撤销在在线刷新时立即生效；离线设备最迟在已签授权到期时失效，产品不得承诺无法实现的
  即时离线撤销。
- 授权失效、恢复和设备切换不得清空本地数据库，也不得用 Cloud 副本覆盖本地权威。
- Grant 与 Lease 的生产签名私钥不得进入普通 Cloud 应用进程；按
  [ADR-0021](0021-self-hosted-openbao-transit-signing.md) 使用自托管 OpenBao Transit，按 purpose
  分钥、固定版本、审计和轮换，并由 Cloud 使用独立受信公钥复验返回签名。
