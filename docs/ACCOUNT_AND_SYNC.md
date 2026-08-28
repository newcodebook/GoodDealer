# GoodDealer 账号、授权与同步边界

## 两类权威

Cloud 控制面拥有 GoodDealer 账号、登录会话、订阅/Entitlement、设备绑定、ActiveDeviceLease
和 Epoch。Desktop 必须验证这些事实后开放相应能力。该门禁不拥有业务数据：通过门禁后，
Desktop 从本地 SQLCipher 读取并向本地 SQLCipher 提交业务事务。

每个账号首发只有一个由服务器身份和 default-owner binding 导出的个人默认工作区。Renderer、
请求参数或本地样例不能选择或伪造 `(accountId, workspaceId)`。Host 只使用已验证授权中绑定的
工作区打开对应本地数据库。

## 同步模型

```text
local business transaction
  +-- business rows
  `-- sync_outbox (allowlisted, secret-free)
              |
              v
        Cloud sync replica -- ACK/Cursor --> local replication metadata

Cloud pull --> strict validation --> conflict decision --> local transaction --> local Query
```

同步是本地业务数据库的异步复制机制，不是业务调用链。Cloud transport 失败时，本地事务仍成功，
并保持待同步状态。Cloud 空结果不是删除指令；删除必须是具名、经过验证并可冲突处理的 Mutation。

## 数据边界

允许同步的数据必须逐实体、逐字段列入协议白名单。V1 `domain_asset` 可包含 note、portfolioId、
tags、targetPrice 等业务字段。未知字段失败关闭。

以下信息全部只留本地，即使其中一部分通常被称为 metadata：第三方平台账号、Provider Account
ID、账号别名、API Key、Token、Cookie、密码、2FA、Browser Profile、Credential Binding、
恢复/解锁材料。它们不得进入 Outbox、wire、Cloud、日志、错误、审计 payload、fixture 或 UI
普通状态。

## Provider 边界

Provider 调用只能由本地 Secure Host 使用本地凭据发起。观察或操作结果先原子写入本地业务库，
随后才生成允许同步的脱敏业务投影。Cloud 可以保存该投影供同步和恢复，但不持有连接账号，
不读取凭据，也不调用 Provider。

## 授权失效与离线

登录、订阅或 Lease 失效可以锁定业务入口，旧设备不能依靠本地缓存扩大执行权。Cloud 暂时不可达
时，已签发授权只在产品定义的有效离线期限内继续；这不是无限离线承诺。锁定、重新登录或设备
切换不得用 Cloud 副本覆盖或清空本地数据库。

详细不变量见 [ADR-0016](adr/0016-local-business-database-and-cloud-sync-boundary.md)。
