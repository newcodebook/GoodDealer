# ADR-0005：Cloud 授权设备能力，本地数据库承载业务执行

状态：Accepted

## 决策

GoodDealer 账号、订阅/Entitlement、设备绑定、ActiveDeviceLease 和 Epoch 是 Cloud 控制面事实。
Desktop 必须验证这些事实后才开放相应业务入口；旧设备、失效 Lease 或无效订阅不能依靠本地
UI、缓存或自报状态取得执行权。

该控制面门禁与业务数据权威相互独立。门禁通过后，Desktop 的业务读写、任务、Provider 观察
和操作历史均由本地 SQLCipher 数据库承载，正常执行不通过 Cloud PostgreSQL Repository。
Cloud 故障只影响重新授权和同步能力；在已签发授权允许的离线窗口内，本地业务能力继续工作。

## 约束

- 当前产品定义的离线授权期限仍有效；本 ADR 不承诺无限离线使用。
- 并发外部副作用继续受设备 Lease/Epoch 和操作协议限制。
- 本地秘密和第三方账号信息不因登录、设备切换或同步而迁移到 Cloud 或其他设备。
- 授权过期时可以锁定入口，但不得以 Cloud 副本覆盖、清空或重新定义本地业务数据库。
- 恢复和设备迁移必须在本地重建并验证 SQLCipher 数据库后，才恢复本地 Query。
