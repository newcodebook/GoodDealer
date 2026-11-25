# 目标设备首次安装与激活审查

范围见 [Task Frame](../phase0/TARGET_INSTALLATION_TASK_FRAME.md)。本轮接续已提交的来源交接与目标终止，交付无已初始化副本目标的下载、校验、持久首次安装和精确激活；已有副本替换、强制接管与独立跨机备份仍属完整任务。本记录支持首次安装至激活的源码验收；终止后接收另一工作流的缺口另列，平台资格不能由源码检查推定。

## 所有权与独立复审

Cloud/protocol 由 standby_cloud 实施，root 静态核对约束并在独立 UTF8 PostgreSQL 18.6 数据库运行目标旅程。Host、SQLCipher 与 custody 由 device_architecture_review 实施，root 和 standby_native 交叉审查恢复前缀、授权与可见性。Native 固定网络和协调器由 standby_native 实施，standby_cloud 独立审查并运行测试二进制。客户入口、IPC、后台调度、签名组合和 client-core 摘要由 root 实施，standby_cloud 独立验证；构建者不接受自己的结果。

## 修复发现与约束

1. 数学验签不能代替独立信任配置。claim 和 activation 保存前分别用受信 Bootstrap Capability 与 Lease registry 核验；错误配置不能留下不可用的持久能力或激活效果。第五用途不与 Grant/Lease/Standby/Context 共用名称、kid 或公钥。
2. 过期能力不能阻断原操作对账与终结。仅目标 status/cancel/receipt 使用窄 bound_device 会话准入，仍核验当前身份、刷新族、安全代次、设备和密钥。历史 committed 回执不恢复旧 nonce 或重新分配 epoch。
3. 新增 checkpoint 墓碑表不自动继承早期 account-role 权限。真实生产身份测试暴露缺项，追加 023/024 修复；只调用 gd_account_api 被允许的 consumed-capability reader。手动设置用途不能伪造有效 capability，其他用途与租户不能读表。
4. 首次安装不能由零长度数据库推断。Native marker/journal 绑定固定本机库；已有授权地板但缺初装证明的 legacy 空文件失败关闭。OrdinaryOpening、Installing、Installed 与 Initialized 区分普通初始化、完整安装和已发布结果，缺失/截断不是 fresh。
5. journal 原子发布需要先同步并读回所选文件，再推进 OS custody head。独立复审进一步发现“完整 write 后、sync 前进程退出”的恢复路径缺少同步：已在 Reserved 恢复发布前补 file sync、名称/identity 复查、目录 sync 和认证读回，并用未同步的完整写入后关闭重开覆盖。Windows 目录同步 helper 的能力与 Unix 不同，源码检查不宣称 Windows 断电元数据持久资格。秘密 journal 不进入业务备份。
6. 下载、回放和提交摘要均包含 generation 与墓碑。gen2 普通编辑和删除合法，未知实体删除、错误重加、缺页、错摘要、重复 JSON 字段和缺必填 nullable 字段拒绝。client-core 原 assets-only finalize 已同步升级，与 Native 共同 corpus 金摘要一致。
7. 激活结果未知时先持久取消意图，再查询原 activation receipt。committed 接受既成结果；uncommitted 后禁止重发激活，继续精确取消。共享 Native 串行入口不能吞掉用户取消意图。
8. Cloud 已激活而本机丢 ACK 后，重开可能先收到 Active Grant。接受精确匹配持久安装的受限身份，只放行 receipt/status/cancel；不开 Installed 业务库，不放普通同步或 Provider。客户显示 target_installation_pending。原回执和当前 Active Grant/fresh context 全部匹配后才发布业务。
9. 安装进度由 Native 后台推进，Renderer 仅确认与读取。丢回复不会重新开始，变更工作流或 port 会清除旧确认；已有副本拒绝提示保持至该工作流变化。新开始唤醒能穿过已合并的普通唤醒，但不清除网络退避；等待取消的 Settled/Running 不形成短周期自旋。
10. HTTP 的默认 JSON 解码会丢失重复字段，包括转义后的同名键。五条安装路由在解码前按对象检查 decoded key，再交回 Fastify 的原型保护 decoder；重复 nonce/id、嵌套重复、畸形 JSON、原型污染和超深输入在角色准入之前拒绝。协议 schema 严格验证不能替代这一原始字节边界。
11. 整合必须实际运行依赖检查。JSON 机制适配器的路由集合改由 HTTP composition 注入，路由之间不互相导入，公共拒绝错误归现有 HTTP adapter。命令清单通过实际安装 invoke 识别命令，避免把同前缀业务状态当作能力；单双引号未知调用仍进入精确清单校验，未放宽可执行面。

## 验证证据与剩余边界

- Cloud 最终实际 PostgreSQL OAuth 完整 99/99（无 skipped），含安装新增 13 项，日志 target/cloud-target-installation-final-oauth-pg.log；checkpoint 31/31、bootstrap 14/14 另有通过证据，不把不同套件相加当作同次全测。
- root 独立目标回归：29/29（70 项未选为 skipped），日志 target/root-target-installation-independent-pg-current.log，包含最后的表权限独立负控。
- client-core 独立 17/17，共同 gen2/双墓碑摘要通过；新 corpus 生成源在独立临时目录重生成后与仓库逐字节一致。
- UI/adapter/状态投影最新相关 46/46、i18n 19/19；命令与公开面策略 17/17。生成 Tauri 权限来自 build.rs，macOS schema 与生成的 desktop schema 同步。
- Cloud HTTP/目标控制/角色准入最终 15/15（安装 HTTP 6/6）；依赖修正后 typecheck 与边界检查通过，独立复审未发现阻塞。
- 最终 Native 144/144、Core 84/84、公开接口 3/3、doc 4/4；Cloud 独立运行最新 Native 安装 13/13、会话 32/32、终止 10/10，Core verifier 7/7。最新二进制包括 Active-before-receipt 受限准入。
- Storage 首轮全量发现新增表未入严格 schema manifest 和迁移数量快照未更新；修正后全部 26 个失败项重跑通过。新恢复/初装 11/11、公开接口 2/2、doc 28/28 通过；共 558 项非忽略测试已有通过证据，6 项忽略，最终完整单次运行仍以根检查为准。
- Linux/Windows 的 Tauri、Storage、Core 三包全目标严格 Clippy 通过，包含最新 journal durability 修复。最终根 `pnpm check` 通过：TypeScript 2370、结构策略 214、Rust 844（其中 Storage 558；6 项规模基准 ignored）。日志 target/root-target-installation-check-final.log；全仓 fmt、当前文档本地链接、生成 schema 一致性和 diff 检查通过。
- Windows/macOS 实机、真实双设备、部署 OpenBao 第五用途、Provider 及发行资格尚未取得；本机 SQLCipher/PG、测试签名器和交叉编译分别记录，不互相替代。

## 下一切片发现

首次安装 journal 一旦建立，目前只接受原 requestId；取消/过期不会释放 Installing/Installed，也没有追加新工作流入口。新工作流页面会隐去旧进度却无接收按钮。这是终止后的客户恢复缺口，不能归为已有副本替换。下一切片须保存原终态、明确区分可信未写库和可能已提交 SQL 的前缀；零长度或没有 local receipt 都不足以推断可重新接收，已写入库不得重标 Fresh。当前首次安装至激活的通过证据不覆盖此旅程。
