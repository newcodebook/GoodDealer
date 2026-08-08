# GoodDealer Phase 0 Secure Host 决策基线

状态：Active Baseline / Evidence Incomplete

更新日期：2026-08-03

## 1. 范围

本基线只覆盖 R0-02 Endpoint Capability、R0-03 Host-owned Secret 和 R0-06 Device Identity。它冻结正式实现前必须遵守的事实源、生成方向和失败关闭规则，不授权真实凭据、真实外部写入或生产 Lease。

| Finding | 权威决策 | 本轮可交付证据 | 关闭前仍需证据 | 当前状态 |
| --- | --- | --- | --- | --- |
| R0-02 | [ADR-0009](adr/0009-endpoint-capability-registry.md) | Credential Profile/Slot/SecretKind、封闭请求与公开响应 AST、`healthy_only \| health_reverification` Manifest 策略与跨字段校验、固定幂等 Header、测试专用 Fixture Registry/Executor 负向矩阵 | Host-only Active/Sunset 授权联合与跨模式拒绝；真实 health_reverification Endpoint、Provider typed extractor 和原子 health/generation 事务；消费点 mode/授权 generation/Epoch/可信时间/binding generation 复验；独立 CloudEndpointRegistry/Cloud 请求类型/Auth Token Injector 与 provider_api Keychain Namespace；Cloud↔Platform Origin/类型/Namespace/Injector 混淆测试；Windows/macOS 真实 Socket Peer、DNS 重绑定、TLS SNI/证书、代理禁用、流式/解压响应上限与 Release 制品证据 | In Progress |
| R0-03 | [ADR-0010](adr/0010-host-owned-secret-path.md) | 不可序列化/不可 Clone 且 Debug 脱敏的 Rust 秘密类型、Fixture 单 Slot 作用域与原子 Store 回执、Host-owned 私有绑定/typed extractor 接线和负向矩阵 | 完整 Namespace + 强类型 SlotId/SecretKind 的多 Slot HostCredentialBinding；Host-owned 登录/刷新 Session Command 与平台 Secret Command 类型隔离；Windows/macOS 原生输入面；Host 内最小可见性封装；DOM/Heap/IPC/Crash/DB/WAL/全部 Cloud 服务 Canary 扫描 | In Progress |
| R0-06 | [ADR-0011](adr/0011-device-identity-lifecycle.md) | Binding Challenge、含 renew/online/offline 窗口的 ActiveDeviceLease、OfflineDeviceLease、active/lifetime 与 grace Entitlement 的 lowerCamelCase 公开 Wire Golden Corpus；Safe Integer、24 小时/商业宽限时间、类型/大小写隔离；Transcript 编码固定样例单元测试 | Auth 有效 Corpus；Bootstrap/Recovery strict 判别 step request/result、实际 payload、分页与 workflow/repeated-presentation Corpus；Recovery Envelope/Key Purpose；JTI 全局唯一/消费状态表；Transcript 跨语言 Golden Vector、审查过的 Ed25519 库、Cloud 事务/唯一约束、并发轮换、账号 Security Epoch、撤销与迟到事实联合证据 | In Progress |

当前所有生产 Connector Manifest 都是空 Credential Profile 与 Endpoint 列表，因此生成注册表是明确的 deny-all，不具备真实发网能力。独立 Fixture Manifest 单向生成到仅测试编译的 Rust Registry；Fixture 包含一个公开 JSON Endpoint 和一个 `host_owned` Token 轮换 Endpoint，两者均为 `credentialAccessPolicy=healthy_only`，尚未交付真实 `health_reverification` Endpoint/Host 事务。每个 Endpoint 显式声明 `platformAction` 与 credential policy，动作权限不从 HTTP Method 推导。Manifest 不选择具体 extractor，Rust 测试模块的私有编译期表把 Fixture Token Endpoint 绑定到专用 typed extractor；两张表作为同一不可变执行注册表视图传递，并在任何 Host 资源前做全表双向一致性校验。当前 Fixture 只覆盖手工注入的单 Slot health 快照，并未实现从 HostCredentialBinding 读取及消费点复验权威 health generation 的完整循环。测试专用 Executor 按值消费不可克隆的基础 `PlatformAccessContext`，先按 Endpoint 动作授权，再查询 Fixture Binding 并按编译期 credential policy 校验 health；任一失败在 DNS、秘密和 Transport 前拒绝。其后才执行参数与请求上限、DNS 公网检查、验证地址集合传递、Fixture Slot 秘密延迟加载、禁代理/禁重定向契约、响应上限检查与白名单投影或 Host-owned Body 消费。Host-owned typed extractor 只接受 2xx 和封闭响应结构，以 Device/Provider Connection/Profile/来源 Endpoint 作用域做一次原子 Store，并只返回脱敏状态；Store 的不透明回执只表达整批提交，失败状态、无效 Body 或 Store `Err` 都不返回成功。该 Executor 和 Registry 仍只在测试构建中存在，尚未实现 Active/Sunset 授权联合、health_reverification 裁决/原子 generation 更新，或在消费点向 Host-owned 当前 mode/generation、Epoch 与可信时钟重新核对，不能证明 `mint -> 状态/时间推进 -> consume` 会被拒绝；也不包含真实平台 HTTP Client、Keychain 或可证明清零解析器内部 scratch buffer 的实现。因此不能替代 Windows/macOS Socket Peer、TLS、系统代理、重绑定、流式解压上限、原生秘密输入和进程外泄漏扫描证据，也不能把 R0-02、R0-03、R0-12 或 R0-16 标记为完成。

当前 auth response parser 也仅为 `cfg(test)` 旧 Fixture，会把 Access/Refresh 两个 Token 写入同一个 Fake SecretStore；它不代表生产存储设计。生产 Host-owned Session Command 必须拆成耐久 RefreshTokenStore 与可清零的内存 AccessTokenSessionStore，持久化 Refresh 成功后才建立内存 Session，任一步失败都不得返回 authenticated；该接线仍属于 R0-03/R0-06 未完成证据。

当前 `protocol/devices` 只有静态 Bootstrap Capability Envelope，没有 Bootstrap/Recovery step request/result、Recovery Capability Envelope、分页/工作流状态机或对应 Cloud/Rust Handler。文档中的 V1 判别联合是待实现合同，不是已交付 Wire；R0-06/R0-08/R0-16 在共享正负 Corpus、CAS/重复呈交和真实 Adapter/Handler 接线通过前保持未关闭。

## 2. 不可越过的实现边界

- TypeScript 不选择 Host、Origin、端口、凭据注入或 `credentialRef`，也不能获得通用 HTTP/Keychain/Shell。
- Manifest 只能在构建期扩大；运行时配置和 Cloud 不能扩大网络权限。
- Secret 不得进入普通 WebView/TS DTO；Host-owned Response 不得先返回完整 Body 再清洗。
- 设备 Challenge、Nonce、Key Version、Credential Epoch 和 JTI 都由 Cloud 权威持久化；客户端自报不能替代服务端事实。
- Contract/Golden 测试只证明格式与状态机边界，不能冒充平台秘密泄漏扫描、真实 DNS 防护或密码学实现审计。

## 3. 准入结论

当前可以继续在生产 Endpoint 保持 deny-all 的前提下实现 Windows/macOS 原生网络 Transport、原生秘密输入面、Device Identity，以及使用假凭据/Canary、Fake Provider 和受控 Gate 环境验证完整主链；Fixture Executor 只作为这些实现的契约基线。R0-02/R0-03/R0-06 全部关闭前，不得启用生产 Endpoint、接收真实用户平台凭据、对真实平台产生副作用，或向生产账号签发设备绑定与 Lease。
