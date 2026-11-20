# Afternic Linux 受控验收审查

范围见 [工作包](../phase0/AFTERNIC_CONTROLLED_ACCEPTANCE_TASK_FRAME.md)。设置、原生凭据输入、完整库存读取、批量预览和后台执行沿现有 Afternic Service 与 ProviderLane。local-storage 追加 `202611190007`，首次连接原子绑定当前账户、工作区、设备、Lease epoch、连接 incarnation、凭据代次和 proof。真实商业授权与连续时间验证仍是先决条件。受控写入目标固定为 `wecin.com`，三个结果面显示范围和截止，保留生产资格状态。

Storage/Host 独立审查复现了 SQL 三值逻辑会遗漏空 `entity_id` 的问题。修复后独立 27 例拒绝测试、来自实际 Host 的三类结果 33 次 client 解析均通过。Storage feature Afternic 83 项、默认 71 项，受控专项 13 项覆盖绑定、并发、SQLCipher 重开、过期、代次、事务末栅栏和未知结果，严格 Clippy 通过。Native 在电源事件、托管锁等待和恢复时重查授权，新增 5 项边界测试通过。独立 UI 验证 7 文件 74 项通过，重点覆盖可见的受控连接、非目标拒绝、权限撤回和迟到响应。

实际 Cargo release 开启 debug assertions 仍由 Storage 构建脚本以预期诊断拒绝。独立 Cargo profile 探针对原构建保护复现了自定义 dev profile 的 `PROFILE=debug`，修复后使用实际 artifact profile 校验。新鲜根 `pnpm check` 退出 0，结构 215 项、Native 176 项、Storage 610 项、Core 94 项通过；既有 ignored 各 6 与 2 项。主工作区 `887f1c2` 另完成根检查和实际 PostgreSQL 18.6 的 Desktop OAuth、强制接管、Afternic 三动作证据组合 162/162。既有 006 和本地已打开构建中的 007 字节保留。

Linux 受控构建使用部署公开验证 registry，最终可执行文件 SHA256 `360f162f9f6b6b34b0216be96a01caaa77dad666c50da4ddef4f59574149ec03`。此前应用已恢复真实会话，用户从设置确认当前设备。2026-11-20 UTC，经明确授权的开发 Cloud 两项配置生效，Cloud/worker 重启为 active。唯一 Stripe test-mode 元数据更新生成一个新事件，真实签名接收与对账均各 1 条，当前投影归属该观察，商业 revision 推进、摘要更新，恰好新增批准的 Afternic 读取与写入。Stripe 原账单字段和已有 metadata 保持一致，商业期限相同。服务器保留受限操作与前后证据，审查中没有输出账户、支付、Provider 资源标识或秘密。

当前已在普通模式重开最新版 Linux 应用，真实凭据录入和 Afternic 库存结果待用户现场确认。开发 Cloud 的 71 条迁移是源码 73 条的精确前缀，仍缺 030/031 Listing 上架及改价证据迁移。真实 Listing、重启对账、私有所有权验证和 DNS、Windows/macOS 实机与发行资格继续验收。
