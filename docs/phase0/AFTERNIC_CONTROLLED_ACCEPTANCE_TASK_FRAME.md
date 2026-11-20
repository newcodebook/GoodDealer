# Afternic 当前 Linux 受控客户验收

root 冻结；在持久上架/改价完整切片整合之后实施。用户已授权当前 Linux 与 `wecin.com` 的上架/改价/下架测试，并要求先走真实业务、后续分别解决 Windows/macOS；这不缩减双系统总目标。最终规则按 ADR-0027/0025，普通文档不能令“尚无生产资格”循环阻断首次真实取证。

## 目标与固定范围

在真实开发 Cloud 登录取得当前 Grant/Lease/执行上下文 → 原 Native 受限输入 → 当前账号完整市场库存 → `wecin.com` 的持久预览/整批一次批准 → 官方 create/update/remove → 精确 GET、真实状态与重开对账。取证不授予生产资格，也不开放其他域名、Provider、DNS 或资金操作。私有所有权验证/DNS 仍是后续真实实现。

仅显式、非默认 Cargo feature `afternic-controlled-acceptance`，由 Tauri 转发 local-storage；release 编译带该 feature 必须 compile_error。正常构建的生产资格登记仍为空，禁止环境开关、Renderer acceptance=true、fake signer/transport、直接Core脚本写入或全局qualification覆盖。受控功能仍用相同Host、单writer、Native capture/custody、ProviderLane、命令与客户UI。

## 拥有模块与持久准入

local-storage拥有窄验收run与追加迁移 `202611190007`。编译固定run为 `afternic-wecin-linux-20261119`，固定截止 `2026-11-26T23:59:59Z`，scope固定Afternic和 `wecin.com` 的create/update/remove，inventory允许读取同一受限凭据账户完整portfolio。仅Linux debug构建准入，其余系统和release拒绝，不影响Windows/macOS后续完整目标。

第一次prepare连接在同一业务事务原子绑定run、当前GoodDealer account/workspace/device/Lease epoch、唯一connection id/incarnation/generation/public proof；任何重开只恢复原绑定，不绑定第二连接、不自动换epoch/凭据。scope不含Provider账号或任何秘密。连接失败/撤销保留记录及已有审计，不删除证据来重新授scope。

每个入口仍检查当前真实Grant/Lease/capabilities、execution context、continuous time、连接/资产/绑定代次、power/取消与最终提交栅栏。验收截止使用已验签执行上下文的连续时间投影，不能取系统wall time延长。prepare/resume/recheck/scan/preview/approve/next/claim/reconcile/defer及最终提交均复核exact run；预览与claim逐项目核对domain/action，持久历史也不能越过scope。未知请求先GET，scope失效后拒绝网络/业务提交并保留unknown；不能重发。

不扩大Cloud的角色：Cloud只发既有身份/商业/设备权威和接收原闭合证据流，不持有Provider身份/秘密或执行Provider请求。不新增通用Provider代理/工作流/规则引擎、第二数据库或secret bridge。

## 封闭结果合同与客户入口

Afternic connections/delist/listing-write status 增加必须出现的 nullable `controlledAcceptance`：`{runId:"afternic-wecin-linux-20261119",domain:"wecin.com",expiresAt:"2026-11-26T23:59:59Z",connectionId:string|null}`。Host从真实授权和持久run派生，不是Renderer输入；default为null。原observeQualified/writeQualified保持真实false，不伪造资格。UI以当前entitlement、runtime、qualified或受控状态共同决定入口，并准确显示仅wecin.com的开发验收和截止；默认产品入口继续拒绝未取得资格的能力。

所有DTO从unknown严格验证；status额外字段或不一致scope拒绝。Native只传Host脱敏状态，不增新IPC。Renderer修改目标/价格必须重新预览，不能替Host判准入。受控模式下连接选择只展示可用唯一绑定；后端仍独立拒绝其他选择。

## 所有权与独立接受

- device_architecture_review：Storage/Host、窄持久run及迁移007、public DTO及SQLCipher/代次/并发/重开/最终栅栏负测。开始前先完成已有SchemaRejected诊断，不混两切片提交。
- standby_cloud：client-core三个严格结果合同与测试、生成/类型边界；独立审查Storage/Host。不碰Cloud权威或真实商业数据。
- standby_native：Tauri feature转发/release编译保护、Native组合作用及状态派生核对与测试；独立评估root客户入口。Core不增通用能力或秘密输入。
- root：最终ADR主题规则、TaskFrame、Renderer/i18n/应用共享面、文档/执行台账、独立审查Native/client、真实Linux旅程与完整检查和切片提交。

所有成员使用Provider worktree `/home/sean/.codex/worktrees/afternic-listing/GoodDealer`，基线 `b1fd9d5`，分支 `codex/afternic-controlled-acceptance`；主目录同时验证精确Listing整合源码，不得修改主目录。完成前根检查串行，Provider worktree的Rust target同一时刻仅一个构建者。独立审查不能由实现者接受自身修改。

## Native旧入口必须同步补齐

connect/refresh/recover/scan_and_commit复用既有NativePowerGate的power epoch；capture循环、publish/load槽、HTTP前后及每个await均检查，最后库存提交保持power→cancel→Host锁序。休眠时不提交迟到结果，唤醒后先恢复。revoke/purge仍允许减少秘密持有。recover不能仅认observe_qualified而跳过受控prepared/active后误报完成，必须匹配Host返回的唯一controlledAcceptance.connectionId，并逐槽恢复；controlled非空不能授权所有连接。

Tauri与local-storage都在build.rs检查真实PROFILE为debug及target_os为linux，源码还检查debug_assertions；release即使显式开启debug assertions仍拒绝，自定义release profile也拒绝。Native负责Tauri构建源，Storage负责其build.rs/Cargo与模块声明；生成物由root最后统一再生成。

## 验收及允许声明

默认构建仍拒绝；错provider/domain/action、账号/租户/设备/epoch、过期/连续时钟失效、第二连接/替换incarnation/generation/proof、并发绑定与await/final-fence变更均拒绝。scope跨关闭重开保持且不恢复旧执行权，unknown不重发，原批准不受新目标/价格复用。debug feature实跑相关tests，release+feature必须实际编译失败并核对预期诊断。

真实报告绑定commit、binary SHA、run与实际Linux环境，记录当前Cloud授权、Native真实输入/托管、精确GET→preview→write→GET→重开。未实际取得的429、断线、私有验证、Windows/macOS实机和发行证据逐项保留，不以fake、测试数量或feature存在宣称产品交付。根pnpm check及相称SQLCipher/模块/生成物/链接/差异检查，完整切片提交后继续下一可实施任务。

## 本轮经验约束

上下文恢复先查具体goal全文、HEAD、worktree、拥有文件和已有执行记录；先核对环境名/配置路径/已有SSH，不在已给授权下反复索要材料。公开registry应来自部署配置的确定性生成和摘要核对，秘密不得回显。源码测试、受控真实接口、目标系统与发行分别取证；资格清单不能成为绕过真实取证的循环，也不能用开放开关伪装取得资格。
