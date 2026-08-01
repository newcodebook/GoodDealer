# GoodDealer Phase 0 Secure Host 决策基线

状态：Active Baseline / Evidence Incomplete

更新日期：2026-08-01

## 1. 范围

本基线只覆盖 R0-02 Endpoint Capability、R0-03 Host-owned Secret 和 R0-06 Device Identity。它冻结正式实现前必须遵守的事实源、生成方向和失败关闭规则，不授权真实凭据、真实外部写入或生产 Lease。

| Finding | 权威决策 | 本轮可交付证据 | 关闭前仍需证据 | 当前状态 |
| --- | --- | --- | --- | --- |
| R0-02 | [ADR-0009](adr/0009-endpoint-capability-registry.md) | Credential Profile/Slot/SecretKind、封闭请求与公开响应 AST、固定幂等 Header、测试专用 Fixture Registry/Executor 负向矩阵 | Windows/macOS 真实 Socket Peer、DNS 重绑定、TLS SNI/证书、代理禁用、流式/解压响应上限与 Release 制品证据 | In Progress |
| R0-03 | [ADR-0010](adr/0010-host-owned-secret-path.md) | 不可序列化/不可 Clone 且 Debug 脱敏的 Rust 秘密类型、批量 Store/typed extractor Contract | Windows/macOS 原生输入面；Host 内最小可见性封装；DOM/Heap/IPC/Crash/DB/WAL/Cloud Canary 扫描 | In Progress |
| R0-06 | [ADR-0011](adr/0011-device-identity-lifecycle.md) | 公开 Wire Golden Corpus、Transcript 编码属性测试、状态机负向测试 | Transcript 跨语言 Golden Vector、审查过的 Ed25519 库、Cloud 事务/唯一约束、并发轮换、撤销与迟到事实联合证据 | In Progress |

当前四个生产 Connector Manifest 都是空 Credential Profile 与 Endpoint 列表，因此生成注册表是明确的 deny-all，不具备真实发网能力。独立 Fixture Manifest 单向生成到仅测试编译的 Rust Registry；Fixture Endpoint 使用版本化 Profile、精确 Slot/SecretKind 与 Header 注入、固定幂等 Header、封闭 Query/Body AST 和公开响应白名单。测试专用 Executor 固定执行 Registry/Runtime/Profile/参数与请求上限校验；非 Active 模式在绑定、DNS、秘密和 Transport 前拒绝，凭据 Header 只接受有界安全字节，凭据与幂等 Header 受累计上限约束；随后才执行 DNS 公网检查、验证地址集合传递、完整作用域秘密延迟加载、禁代理/禁重定向契约、响应上限检查与白名单投影。它不包含真实平台 HTTP Client，因此不能替代 Windows/macOS Socket Peer、TLS、系统代理、重绑定和流式解压上限证据，也不能把 R0-02 标记为完成。

## 2. 不可越过的实现边界

- TypeScript 不选择 Host、Origin、端口、凭据注入或 `credentialRef`，也不能获得通用 HTTP/Keychain/Shell。
- Manifest 只能在构建期扩大；运行时配置和 Cloud 不能扩大网络权限。
- Secret 不得进入普通 WebView/TS DTO；Host-owned Response 不得先返回完整 Body 再清洗。
- 设备 Challenge、Nonce、Key Version、Credential Epoch 和 JTI 都由 Cloud 权威持久化；客户端自报不能替代服务端事实。
- Contract/Golden 测试只证明格式与状态机边界，不能冒充平台秘密泄漏扫描、真实 DNS 防护或密码学实现审计。

## 3. 准入结论

当前可以继续 Windows/macOS 原生网络 Transport、原生秘密输入面和 Device Identity 联合 Spike；Fixture Executor 只作为这些实现的契约基线。R0-02/R0-03/R0-06 全部关闭前，不得实现真实平台凭据主链、真实 Connector 写入、生产设备绑定或 Lease 签发。
