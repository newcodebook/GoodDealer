# GoodDealer Phase 0 Secure Host 决策基线

状态：Active Baseline / Evidence Incomplete

更新日期：2026-08-01

## 1. 范围

本基线只覆盖 R0-02 Endpoint Capability、R0-03 Host-owned Secret 和 R0-06 Device Identity。它冻结正式实现前必须遵守的事实源、生成方向和失败关闭规则，不授权真实凭据、真实外部写入或生产 Lease。

| Finding | 权威决策 | 本轮可交付证据 | 关闭前仍需证据 | 当前状态 |
| --- | --- | --- | --- | --- |
| R0-02 | [ADR-0009](adr/0009-endpoint-capability-registry.md) | Manifest Schema、单向生成器、Rust 预发网验证、Fake Registry 负向测试 | Fake Provider、DNS 重绑定、双平台网络栈与制品证据 | In Progress |
| R0-03 | [ADR-0010](adr/0010-host-owned-secret-path.md) | 不可序列化/不可 Clone 且 Debug 脱敏的 Rust 秘密类型、批量 Store/typed extractor Contract | Windows/macOS 原生输入面；Host 内最小可见性封装；DOM/Heap/IPC/Crash/DB/WAL/Cloud Canary 扫描 | In Progress |
| R0-06 | [ADR-0011](adr/0011-device-identity-lifecycle.md) | 公开 Wire Golden Corpus、Transcript 编码属性测试、状态机负向测试 | Transcript 跨语言 Golden Vector、审查过的 Ed25519 库、Cloud 事务/唯一约束、并发轮换、撤销与迟到事实联合证据 | In Progress |

当前四个生产 Connector Manifest 都是空 Endpoint 列表，因此生成注册表是明确的 deny-all，不具备真实发网能力。现有 Schema/生成器只证明单向生成、Hash、固定 Origin/Method、路径、凭据策略标签、重试/Extractor/脱敏元数据和结构负向校验；在首个 Fixture Endpoint 前仍需补精确 Credential Slot、Query/Body Schema 和 Fake Provider 执行器，不能把空注册表视为 R0-02 已完成。

## 2. 不可越过的实现边界

- TypeScript 不选择 Host、Origin、端口、凭据注入或 `credentialRef`，也不能获得通用 HTTP/Keychain/Shell。
- Manifest 只能在构建期扩大；运行时配置和 Cloud 不能扩大网络权限。
- Secret 不得进入普通 WebView/TS DTO；Host-owned Response 不得先返回完整 Body 再清洗。
- 设备 Challenge、Nonce、Key Version、Credential Epoch 和 JTI 都由 Cloud 权威持久化；客户端自报不能替代服务端事实。
- Contract/Golden 测试只证明格式与状态机边界，不能冒充平台秘密泄漏扫描、真实 DNS 防护或密码学实现审计。

## 3. 准入结论

完成本基线后可以继续 Fake Provider、原生秘密输入面和 Device Identity 联合 Spike。R0-02/R0-03/R0-06 全部关闭前，不得实现真实平台凭据主链、真实 Connector 写入、生产设备绑定或 Lease 签发。
