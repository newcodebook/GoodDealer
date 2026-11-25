# Spaceship SellerHub 账户挂牌归集复审

范围为独立 marketplace 连接、预检、完整归集、刷新与重开续读，以及撤销后的凭据清理。官方合同见 [API 核查](../PROVIDER_API_REVIEW.md)。本切片的可写事务只处理本地业务状态。

## 本地业务与信任边界

复查了连接 incarnation、工作区、设备与 Lease 对请求和完成的绑定，以及同一 SQLCipher 事务中的资产、Outbox、挂牌观察、回执和请求消费。扫描缺席时已有观察转为未知，远端删除与所有权结论仍需精确证据。资产重加后的新代次独立取得本地 Listing 身份。关闭重开、最终栅栏回滚、错误设备与 Lease、重复回执、跨连接隔离、撤销和空库存见 SQLCipher 回归。价格只取明确启用的一口价，超出现有销售投影范围时仅保存挂牌状态。

发现 Spaceship 原撤销实现依赖解码原凭据，损坏或重复项会卡住恢复。修复改为在原 guard 与 mutex 内以精确槽位元数据清理并确认缺席。独立复审关闭该项。Linux 隔离 D-Bus 与 Secret Service 的合成凭据测试通过，覆盖损坏、重复、拒绝过时授权和保留邻近用途。

## 桌面组合

复查了 Native 预检和托管读回、受能力限制的具名 IPC、单一 ProviderLane、取消与电源 epoch，以及 read-only 设置视图。刷新受理前保存持久请求，SellerHub 与 Registrar 分别跟踪恢复状态。独立复审确认 Tauri 策略包含 SellerHub adapter 的字面命令核对，凭据托管、授权阻断与取消录入映射为闭合结果。面板测试覆盖连接、刷新、只读权限和保留最近结果。

## 实际接口与目标系统

Linux 匿名直连库存、精确域名和验证记录入口均返回 401。认证真实读取需在具名开发限制内以 Native 录入具有 `sellerhub:read` 的受控凭据，核对分页、挂牌状态及重开。Windows GNU 严格 Clippy 是目标编译证据。Windows/macOS 实机与发行资格分别验收。
