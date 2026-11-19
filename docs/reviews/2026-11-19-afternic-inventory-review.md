# Afternic 连接与库存归集审查

基线 `61979a5`；范围见 [Task Frame](../phase0/AFTERNIC_LISTING_TASK_FRAME.md)。这是连接/归集/恢复切片，尚不包含批量 Listing 写入、自动所有权验证、DNS 或双系统真实资格。

## 实现与独立责任

- Cloud/protocol 具名商业权限：standby_cloud 构建，standby_native 独立评估。
- Native authority/floor 与 Afternic Core/Tauri 组合：standby_native 构建，standby_cloud 独立评估。
- 本地迁移/Listing 读投影：device_architecture_review 构建，standby_cloud 独立评估。
- 业务资产事务、Afternic 持久归集与 Host：root 构建，device_architecture_review 独立评估。
- Renderer/client-core/adapter：root 构建，standby_cloud 独立评估。
- root 整合公开面、当前文档和最终验证；未改已应用 SQL，追加 `202611180003`，保留单 writer 与最终提交栅栏。

## 发现及落实的经验

1. 平台授权不能从旧 Cloudflare entitlement 推导。Active Grant v4/commercialAuthority v2 与 role v5 明确具名权限；空权限保留有效本地授权，write 必须带 observe。当前 Licensing 快照精确交集及 Native floor/runtime/final fence 同步，逻辑 `.v3` 签名用途保持稳定。
2. 原授权 digest 不适合作为 prepared 重启恢复的永久条件：普通刷新也会变化。保留原摘要审计，由当前有效授权加载精确 incarnation/generation/proof；缺槽只进入修复，不能重新 capture 覆盖。测试真正关闭重开 SQLCipher 并刷新 Grant。
3. Provider 使用和本地撤销清理需要独立准入。revoked handle 在仍有 observe 权限时必须拒绝网络使用；失去权限后仍可首次撤销及 purge。修正 purge 误用 Provider gate；epoch 变化在最终提交前回滚资产、观察和激活。
4. 完整扫描必须原子提交资产/Outbox/绑定/原始观察。空扫描和全部跳过墓碑不制造 run/target；既有用户字段不改，历史删除/待重新添加不自动复活。扫描时间与凭据变更时间分开。
5. 同市场多连接按绑定 incarnation/代次读取；旧不存在结果在断连后也降为 unknown。容量与 Settings 可见集合一致，retired 历史不占位置；purge 后隐藏连接并保留审计事实。
6. 新模块注册必须同步精确策略扫描。命令扫描器原先只读 adapter index，现明确检查独立 Afternic adapter，补缺失/符号链接/未审核命令负测；Desktop capability 断言同步四个命令。不是在 index 放置未使用字符串骗过策略。
7. Cargo 测试运行期间避免另一次编译替换相同 target 二进制；先释放运行资源再重编译。混合写入的日志不作为证据，失败后按独立日志重新执行。新增迁移后必须同时运行通用 manifest 验证，不能只按新平台名称筛选测试；本轮旧迁移数/表数断言已同步为 30/59 并定向通过。

## 已取得的有界证据

- Cloud/protocol 独立复审 PASS，新鲜定向 Protocol 44、Cloud 46；此前独立 PostgreSQL 18.6 desktop-oauth 39。构建者完整 Protocol 488、Cloud 798 通过。
- Native authority/floor/reopen/final fence 独立 11+8+1+1+1；维护准入与重开最终独立 2。Native lane 11、raw IPC 1、命令策略 6 独立通过。
- 迁移 10、销售读取回归 12 独立通过；root 业务/Host 定向 16 通过（其中含迁移回归），最终 retired 容量及增强 Host 真正重开/撤权清理各 1 独立通过。
- Renderer/client-core/adapter 独立 client-core 3、Desktop 32 与两包 typecheck 通过；未知响应只读状态、不重发，接受入队不宣称完成。
- 早期整仓检查因 Desktop 精确权限断言遗漏四命令失败；已修复并定向 6/6 通过。最后还同步了证据 collector 的精确命令/文件指纹，以及迁移清单 30/59；共享政策独立复核未放宽拒绝条件。最终完整根 `pnpm check` exit 0（`/tmp/gooddealer-afternic-final-passing-check.log`）：local-storage 463（6 项既有 ignored）、Native 89、Core 56、结构 205、Protocol 488、Cloud 798、Desktop 330、client-core 418。Desktop production build、三个 Native crate 全 targets Clippy `-D warnings` 和差异/文档链接检查通过。

## 声明边界

固定官方 API、公开脚本和 TLS fixture 只证明协议来源与本地行为。真实 Afternic 账号、私有验证会话、Windows/macOS 原生录入/custody、实际 Cloud/OpenBao 部署和发行资格未取得。Host 资格清单保持关闭。macOS 有录入实现，Linux/macOS 有 custody 源码，Windows custody 及 Linux/Windows capture 仍待实现。Core 写入方法没有持久计划/批准/对账组合，不是已交付的 Listing 客户闭环。
