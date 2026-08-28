# ADR-0001：Tauri Desktop 以本地业务数据库为运行核心

状态：Accepted

## 决策

GoodDealer Desktop 采用 Tauri、TypeScript 与 Rust。Desktop 的业务读写以设备上的 SQLCipher
活动工作区数据库为唯一运行权威；正常查询和业务事务不得以 Cloud 可达、Cloud PostgreSQL
或同步完成为前提。

账号登录、订阅/Entitlement、设备绑定和 ActiveDeviceLease 仍由 Cloud 控制面授权。有效授权
决定用户能否进入或继续使用受保护能力，但授权门禁不改变业务数据的所有权：通过门禁后，
Desktop 从本地数据库读取并向本地数据库提交业务事务。

Renderer 不接触数据库路径、数据库密钥、Provider 凭据或通用 SQL。Tauri Host 拥有本地数据库
路径和解锁材料，只公开按业务能力命名、严格验证输入和输出的窄命令。

## 后果

- Cloud 不可达时，已获准的本地业务操作仍可提交；它们只进入“待同步”状态。
- 账号、订阅或 Lease 失效可以锁定业务入口，但不能把 Cloud 数据库变成 Desktop Repository。
- 本地业务提交和 Sync Outbox 写入必须位于同一事务。
- 第三方平台账号、账号标识、别名及全部凭据材料只能由本地 Host 和本地加密存储持有。
- UI、领域模块、授权判定、Provider 执行和同步运输保持分层，不能互相伪造权威。

完整数据边界和同步不变量见 ADR-0016。
