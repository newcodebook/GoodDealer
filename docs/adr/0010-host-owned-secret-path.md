# ADR-0010：未来秘密操作必须由受限 Host 所有

状态：Accepted design constraint; no general secret interface is exposed.

## 决策

未来需要秘密的本地操作必须把原始值、密钥材料和秘密响应留在受限 Host 内部。展示层和
普通 TypeScript 只能接收最小、脱敏、目的明确的结果，不能读取秘密引用、选择存储位置或
调用通用秘密读写接口。

## 当前实现

`secure-host-core` 只公开具体的 OAuth/设备/授权验证/Cloudflare 能力，没有通用会话、秘密、密钥链或
网络 API。备份秘密路径完全位于 `gooddealer-local-storage` 的 Desktop Local Host 私有边界；它不向
`secure-host-core` 或 Desktop 暴露备份 key、binding、handle、candidate、plaintext 或通用解密接口，
具体生产 native 备份组合保持拒绝。

## 后果

未来秘密路径必须由具体产品能力定义，严格验证输入，阻止日志和错误泄漏，并用最终原生
构件的可观察证据和独立审查证明其边界。仓库测试不能作为原生秘密 custody 结论。
