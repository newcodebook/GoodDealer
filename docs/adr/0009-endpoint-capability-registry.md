# ADR-0009：未来外部网络权威必须具体且失败关闭

状态：Accepted design constraint; no external transport is currently composed.

## 决策

未来任何外部网络或提供商操作必须由拥有模块定义具体的目的、输入、输出、秘密作用域和
最小权限。调用方不得选择任意主机、URL、端口、代理、凭据注入或适配器，也不得通过生成
或配置表面扩大网络权威。

## 当前实现

`secure-host-core` 没有公开通用网络 API，Cloud 公共业务路由和周期作业为空，浏览器自动化
不可用。Desktop 的本地业务命令不携带 URL、header、credential 或网络选择权，因此不构成
外部网络路径。

## 后果

未来外部操作需要严格 wire 验证、受限秘密 custody、实际部署、提供商批准、原生网络观察
和独立审查。在此之前，拒绝默认值是唯一有效行为。
