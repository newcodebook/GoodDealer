# GoodDealer Phase 0 编码前全面审查

状态：Final Review / Conditional Go

审查日期：2026-08-01

基线提交：`9798b5a122a0a8be6cda02ba66722c282d2ef121`

基线分支：`main`

基线工作区：Clean，只有文档，尚未初始化应用代码

## 1. 最终结论

本次审查结论为 **Conditional Go**。

允许立即开始：

- 锁定工具链、支持矩阵和 CI 基线。
- 初始化 monorepo、App/Package/Crate 空壳和 Composition Root。
- 建立依赖边界、协议出口、结构测试和不含真实秘密/副作用的 Fixture。
- 开展明确标注为可丢弃的 SQLCipher、Keychain、WebView2、WKWebView、签名和打包 Spike。

暂不允许：

- 把当前 Phase 0 Roadmap 当作一个可以整体开工、整体完成的单一迭代。
- 在相关 Finding 关闭前冻结 `secure-http`、Sync Outbox、设备签名、Recipe、Ticket、备份包或 Job TenantContext 的正式契约。
- 在 Phase 0 Safety Envelope 建立前对真实用户资产或生产平台账户执行写操作。
- 在 JF-01 正式落档前实现首账号/首设备 Bootstrap 的生产主链。
- 把 Phase 0 原型代码默认视为后续生产实现。

这不是 No-Go。现有工程结构、核心信任边界和大部分正确性原则足以支持工程初始化；问题主要集中在“跨语言、跨持久化边界如何被机器强制证明”，而不是产品方向完全未定。

## 2. 审查章程

### 2.1 目标

本次审查回答四个问题：

1. 哪些现有决定已经足够稳定，不应在编码前反复重开。
2. 哪些缺口会使基础协议、存储形状或安全边界一开始就走错。
3. 哪些问题只阻塞对应 Phase 或能力，不应阻塞仓库初始化。
4. Phase 0 必须留下什么可复现证据，才能进入 Phase 1。

### 2.2 权威层级

按 [USER_JOURNEYS.md](USER_JOURNEYS.md#9-评审与维护规则) 已有规则执行：

- Journey 文档拥有端到端目标、覆盖状态和阶段 Gate。
- 专题文档拥有具体状态机、协议和恢复语义。
- [ENGINEERING_STRUCTURE.md](ENGINEERING_STRUCTURE.md) 拥有目录、依赖和工程归属。
- ADR 和已接受产品决定拥有不应由实现者擅自改变的决策。
- Review Finding 不是产品决定；只有落入权威专题文档、ADR 或决策记录并补齐验收后才能关闭。本报告裁定 Finding 的级别、阻塞范围和关闭证据；其中的方案在正式落档前均只是建议关闭方向，不能被实现者直接当成已批准契约。

发生冲突时不按“最后更新的文件”自动覆盖，而是登记冲突并回到相应权威层处理。

### 2.3 方法

本次审查并行执行了四个独立通道：

- 产品与用户旅程。
- 安全与威胁模型。
- 数据权威性、同步、状态机与故障恢复。
- 工程可实现性与 Phase 0 交付。

所有候选结论均由主审重新阅读原文、构造失败事件序列并去重。独立审查意见没有被直接采纳。

严重度继续使用 Journey 基线中的 J0～J3；处置另分为：

- `Start Blocker`：不阻塞全部代码，但阻塞受影响工作包的正式实现。
- `Phase Gate`：可以设计和 Spike，必须在对应 Phase 退出前关闭。
- `Accepted Risk`：产品已明确接受，保留验证和披露义务。
- `Backlog`：不影响当前正确性主链。

## 3. 已验证成立的设计基线

以下结论跨 PRD、专题文档、ADR 和 Journey 一致，本轮不重新开启：

1. Standby 只读，Active 独占业务修改、平台读取、批准和执行。
2. 平台凭据、账号 Token、数据库密钥、Browser Profile 与原始挑战值不得进入 GoodDealer Cloud。
3. Cloud Desired State 不能直接触发平台副作用；必须由当前 Active 设备重新预览并产生本机批准。
4. Local App WebView 与 Remote Browser WebView 是不同信任域；Remote WebView 不得拥有数据库、Keychain、Shell、通用文件或高权限 Tauri Command。
5. BrowserSessionConsent、BrowserAutomationGrant、ApprovedOperation 和执行 Ticket 是不同授权层级。
6. `EXECUTED` 或无报错不等于成功；跨过副作用边界后只能确认，不能盲目重试。
7. SyncMutation、LateExecutionEvent 与 Candidate 的业务语义和回放目的不同；AuditEvent 原则上拥有独立日志，但旧 Epoch AuditEvent 的 Ingest 与记录归属仍须由 G4 关闭。
8. 强制切换必须等待旧设备离线执行许可到期；外部平台无法理解 Epoch 是明确接受的残余风险。
9. 备份恢复必须在隔离 Staging 中进行，以当前 Cloud 为业务基线；旧 Operation、批准和 Outbox 不回放。
10. Public HTTP、Admin HTTP 和 Jobs 使用不同入口与授权上下文；Admin 只能调用模块公开管理 Port。
11. 本地与 Cloud 共享协议语言和确定性 Codec，不共享 Repository、ORM、Migration 或写事务。
12. 云同步不等于公开发布；Publication Projection 与私有 Workspace 分离。

## 4. Phase 0 工作包与准入边界

Phase 0 必须拆成可独立关闭的工作包。每个工作包都要有负责人、假设、环境矩阵、自动测试或可复现制品、失败后的 fallback 和状态。

| Work Package | 允许立即开展 | 在正式契约冻结前必须关闭 |
| --- | --- | --- |
| WP-0 Engineering Baseline | 工具链、目录、CI、空壳、结构测试 | R0-10、R0-11 |
| WP-1 Secure Local Host | SQLCipher/Keychain/签名/HTTP 的隔离 Spike | R0-02、R0-03、R0-06 |
| WP-2 Account, Device & Sync | Fixture 下的 Lease/Mutation/Query 原型 | R0-04、R0-05、R0-06、R0-12、JF-01 |
| WP-3 Browser Dual Engine | Profile、窗口、导航、下载、上传的无副作用 Spike | R0-07、R0-13 |
| WP-4 Cloud Boundary & Jobs | Public/Admin 分入口、带租户 Fixture 的 Job 原型 | R0-09 |
| WP-5 Backup & Recovery | 不含运行时状态的加密容器和错误注入 Spike | R0-08；JD-02 只阻塞离线灾难语义 |
| WP-6 Connector Modes | Mock/Fake Provider 下五种模式演示 | R0-02、R0-03、R0-13、R0-14；真实写另受 Safety Envelope 限制 |

负责人先使用角色而不是具体姓名：Engineering Baseline、Secure Host、Cloud Identity/Devices、Cloud Workspace、Browser Host、Connector、Recovery、Security Reviewer。一个人可以兼任，但验收人不能只是实现者自己声明通过。

## 5. Phase 0 新增或重新打开的 Finding

### R0-01：Phase 0 目前不是可独立验收的执行计划

- 级别：J1。
- 处置：Start Blocker，仅不阻塞最小工程初始化。
- 证据：[ROADMAP.md](ROADMAP.md#phase-0技术验证) 包含约三十项跨 Desktop、Cloud、Auth、Sync、Admin、Jobs、Backup、Connector 和 Browser 的任务，但只有一个复合退出段；Roadmap 同时要求每阶段确认责任人。
- 风险：一次演示可能被误当成可重复证据；外部平台、证书或某个 OS 阻塞会拖住整个阶段；无法知道哪些原型可丢弃。
- 关闭条件：建立 `Gate ID → Journey/Finding → 假设 → Fixture/平台 → OS 矩阵 → 证据 → Owner → Fallback → 状态` 台账，并采用本报告 WP-0～WP-6 边界。

### R0-02：Secure HTTP 缺少跨 TypeScript/Rust 的可信 Endpoint Capability

- 级别：J0。
- 处置：Start Blocker，阻塞正式 `secure-http` 和真实连接器。
- 证据：[CONNECTORS.md](CONNECTORS.md#5-安全-http-gateway) 让 TypeScript 连接器按 Endpoint ID 声明 Host、Method、Path、凭据注入和脱敏；[ENGINEERING_STRUCTURE.md](ENGINEERING_STRUCTURE.md#8-rust-crate-边界) 又让 Rust `secure-host-core` 拥有 Allowlist 和凭据注入，但没有定义 Rust 如何取得并验证连接器声明。
- 失败路径：信任 TS 传入规则会退化为任意 HTTP/SSRF/凭据外送；Rust 手写第二份表会产生漂移。
- 建议关闭方向（待落档）：使用版本化、声明式、不可执行的 `EndpointManifest` 作为规范输入，构建时生成/嵌入 Rust 注册表和 TS 类型。Host 只接受制品内已登记条目，并校验 `device_id + provider_connection_id + provider + credentialRef + endpoint` 的完整绑定。
- 关闭证据：URL 编码、userinfo、端口、重定向、DNS/IP、跨连接 credentialRef、Cloud/平台凭据命名空间混淆负向测试全部在发网前拒绝。

### R0-03：平台秘密输入和秘密响应尚未形成 Host-owned 数据路径

- 级别：J0。
- 处置：Start Blocker，阻塞真实 API Key/OAuth/Challenge 流程。
- 证据：[SECURITY.md](SECURITY.md#2-信任边界) 限制普通 TypeScript/WebView 只能取得脱敏数据；[BROWSER_AUTOMATION.md](BROWSER_AUTOMATION.md#11-首批场景) 要求 API Key 直接交给 Secure Host，但未定义输入界面；普通 React 输入框必然先让值进入 WebView DOM/JS。
- 失败路径：前端依赖污染、XSS、调试注入、日志或崩溃报告读取原始平台密钥；API 响应中的新密钥/挑战先返回 TS 再清洗。
- 建议关闭方向（待落档）：Phase 0 选择一种 Host 控制的专用凭据输入面；可以是原生控件，也可以是 Host 创建、无第三方依赖、无持久化、只拥有单一 `store_secret` 能力的隔离专用 Surface，但不能使用普通应用 WebView 表单。秘密响应由 Host typed extractor 直接折叠为 Keychain 条目，只返回 opaque ref/fingerprint。
- 关闭证据：Canary Secret 在普通 DOM、TS heap、IPC trace、前端日志、Crash Report、Outbox 和 Cloud 中均不可见。

### R0-04：Sync Projection 的权威强制点和分类来源不统一

- 级别：J0。
- 处置：Start Blocker，阻塞 Sync Mutation 原型被认定为安全。
- 证据：[ACCOUNT_AND_SYNC.md](ACCOUNT_AND_SYNC.md#23-字段分类) 和 [CONNECTORS.md](CONNECTORS.md#5-安全-http-gateway) 说 Secure Host 在写 Outbox 前删除秘密；[ENGINEERING_STRUCTURE.md](ENGINEERING_STRUCTURE.md#client-core) 又把 Outbox 交给 `client-core/sync`；[VERIFICATION.md](VERIFICATION.md#8-秘密-sync-projection) 则正确要求显式 Projection，禁止先序列化本地实体再清洗。
- 失败路径：秘密可能已经进入本地实体、WAL、Outbox、备份或日志，上传前删除为时已晚；Connector 分类与 Workspace protocol 分类可能冲突。
- 建议关闭方向（待落档）：不允许“完整实体序列化后清洗”。client-core 只能构造 protocol/workspace 明确允许的封闭 Sync Projection；`local-storage/active-workspace/cloud-sync` 是唯一 Outbox 写入口，拒绝未知字段和 DEVICE_SECRET。Rust 端使用由同一协议构建产物生成的投影校验清单，执行 fail-closed 验证，不修改后放行未知 Payload。
- 关闭证据：对 API Token、Cookie、Auth Code、挑战值、原始 URL/Header/Body 和诊断数据做 Canary/属性测试，扫描 DB、WAL、Outbox、备份、日志和 Cloud。

### R0-05：优先级 Outbox 与单一 `client_sequence` 无法证明排空

- 级别：J0。
- 处置：Start Blocker，阻塞设备切换与 Sync Drain 正式协议。
- 证据：[ACCOUNT_AND_SYNC.md](ACCOUNT_AND_SYNC.md#63-上传优先级) 允许非 FIFO 优先上传，但续签和切换只上报“最后上传的 `client_sequence`”；[ENGINEERING_STRUCTURE.md](ENGINEERING_STRUCTURE.md#9-cloud-模块所有权) 也只要求核对最后序号。
- 最小失败序列：低优 `seq=101` 未上传，高优 `seq=102` 先上传；若 102 被当成排空水位，正常切换会在 101 未到达时释放旧 Lease。
- 建议关闭方向（待落档）：分开 `last_assigned_sequence`、`highest_seen_sequence` 和 `contiguous_received_through`；Drain 只接受连续确认水位等于本地已分配尾部且本地没有待提交记录。Mutation、Execution Event、Audit 若为独立日志，使用独立命名的序列空间和逐流 Drain Manifest。
- 关闭证据：乱序、缺口、重复、跨批次和切换并发测试不能误判排空。

### R0-06：设备身份与签名凭证仍只有字段，没有可信生命周期协议

- 级别：J0。
- 处置：Start Blocker，重新打开 JF-02 的设计完成状态。
- 证据：[ACCOUNT_AND_SYNC.md](ACCOUNT_AND_SYNC.md#3-账号绑定与活动设备) 定义公钥、Key ID、版本和状态字段，但没有设备绑定仪式、旧钥 PoP、轮换和撤销时序；[LICENSING.md](LICENSING.md#3-登录与授权凭证) 的签名凭证也缺少明确类型、issuer、audience、kid、schema version 和唯一 ID。
- 失败路径：被盗 Auth Session 替换设备公钥；跨 Token 解析器类型混淆；旧签名 Key 或旧 Envelope 无法安全撤销；撤销前发生但撤销后上传的事实无确定规则。
- 建议关闭方向（待落档）：设备绑定使用服务端 Nonce + 设备私钥 PoP + 账号重新认证；轮换要求旧钥或恢复流程证明并原子推进版本。每类服务端签名凭证使用强类型 Envelope 和独立密钥或严格域分离，至少包含 `typ/iss/aud/kid/schema_version/account_id/device_id/jti`。
- 关闭证据：替换公钥、Nonce 重放、并发轮换、版本回退、跨 Token 类型、旧 Key 和撤销前后迟到事实均有确定结果。

### R0-07：受限 Recipe 和一次性 Ticket 尚未形成可执行安全模型

- 级别：J0。
- 处置：Start Blocker，阻塞 Browser Automation 写能力；不阻塞双 WebView/Profile Spike。
- 证据：[BROWSER_AUTOMATION.md](BROWSER_AUTOMATION.md#6-自动化-recipe) 只列允许/禁止动作，但未定义 AST、raw JavaScript 禁令和 Host 语义校验；同文又让每个 HostActionCommand 携带一次性 Ticket，同时 Recipe 是多步骤流程。
- 失败路径：有效签名只能证明发布者和内容 Hash，不能证明 `recipe_step` 没有越权 JavaScript；若 Ticket 首步后失效，多步骤无法执行，若复用则可重放。
- 建议关闭方向（待落档）：定义版本化 Recipe AST/bytecode、允许 opcode、selector/输入/输出 Schema、大小和时间上限；Rust automation-host 二次验证并生成动作，TS 不能提交 raw JS。根 Ticket 只能单次兑换为 Host 内存执行会话，每一步派生严格递增、单次 Action Capability；接管、导航越界或崩溃使余下能力失效。未知 Host 在 Consent/自动化内失败关闭；用户坚持访问时转系统浏览器或全新无 Session Surface，并结束自动化。
- 关闭证据：畸形 AST、密码字段、越权 selector、超大输出、重复/乱序 Step、导航竞争、接管和各崩溃边界负向测试通过。

### R0-08：最终备份投影未定义，可能误包含运行时授权

- 级别：J0。
- 处置：Start Blocker，阻塞 Phase 0 Backup Gate 被认定通过。
- 证据：[DATA_LIFECYCLE.md](DATA_LIFECYCLE.md#31-backup-content-manifest) 默认包含 Active Workspace 的一致性快照，同时永不包含 ApprovedOperation、Ticket、Auth/Lease；同文要求备份从 SQLite Backup API 或等效一致性快照产生，但没有定义最终 Export Schema、允许表/字段或从一致性来源到最终工件的投影规则。
- 失败路径：实现者若把一致性来源快照直接当成最终工件或复制完整数据库，会把不可移植授权和队列带进备份；现有文档没有提供可机器强制的边界来阻止这一误实现，恢复时可能重新入队或违反永不包含清单。
- 建议关闭方向（待落档）：SQLite Backup API 只用于取得一致性读取源，不直接成为最终工件。最终工件使用版本化 Backup Export Schema/临时数据库，按白名单复制业务数据和允许历史，结构上不存在 Outbox、Queue、Grant、批准、设备身份、Lease 和运行时恢复标记。定义版本化 Crypto Profile：内存困难 KDF、AEAD、Manifest AAD、Nonce 唯一性、流式加密、凭据独立密钥域、无明文临时文件和原子发布。
- 关闭证据：源库含真实 pending 状态时，导出包结构扫描为零；错误口令、篡改、截断、降级、崩溃和磁盘明文扫描全部通过。

### R0-09：Job TenantContext 缺少可信来源与系统任务 Fan-out

- 级别：J0。
- 处置：Start Blocker，重新打开 JF-15 的设计完成状态。
- 证据：[ENGINEERING_STRUCTURE.md](ENGINEERING_STRUCTURE.md#appscloud) 同时要求周期性 Checkpoint/压缩和“不得无租户扫描”，但没有定义系统任务如何受控枚举租户，也没有说明 TenantContext 是否来自可信认证上下文还是 Payload。
- 失败路径：攻击者替换 Job Payload 中的租户；周期任务引入全局管理员上下文；连接池、Repository 或对象存储 Key 漏传导致跨租户读取/删除。
- 建议关闭方向（待落档）：TenantContext 只能由认证入口、受控系统 Fan-out 或已授权 Admin Context 派生，进入不可变 Job Envelope；业务 Payload 不得覆盖。系统 Fan-out 只产生逐租户子 Job。Repository 主键/外键、事务和对象存储前缀强制携带租户；评估 PostgreSQL RLS 作为纵深防御，不把它作为唯一控制。
- 关闭证据：两个租户同业务 ID、Payload 篡改、连接池复用、对象 Key、Quarantine 重放、Admin Scope 不匹配和周期 Fan-out 负向矩阵通过。

### R0-10：跨语言契约与 Connector Composition 边缺少可执行事实源

- 级别：J1。
- 处置：Start Blocker，阻塞正式 IPC/Auth wire 和 import-boundary 基线。
- 证据：[ENGINEERING_STRUCTURE.md](ENGINEERING_STRUCTURE.md#10-依赖与导入规则) 的允许方向没有列出 Desktop Composition Root 到具体 Connectors 的合法边，但同文要求 Desktop 注册连接器；Port DTO/Zod 与 Rust 镜像 DTO 只有“契约测试”目标，没有生成、未知字段和版本策略。
- 建议关闭方向（待落档）：增加唯一窄边 `apps/desktop composition-root -> packages/connectors/*`，其他 Desktop Feature、client-core、Cloud、account/admin 均不得使用。指定 Zod/规范 Schema 到 Rust 生成，或至少建立共享正/负 Golden Corpus；明确 unknown/missing field、enum、版本协商和错误 Envelope。Host-owned Auth response 使用不向普通 TS 导出的私有版本化 Wire Contract。
- 关闭证据：结构测试允许唯一注册边并拒绝其他消费者；TS/Rust/Cloud 同跑兼容 Golden Corpus。

### R0-11：工具链、目标 OS 和证据矩阵尚未锁定

- 级别：J1。
- 处置：Start Blocker，阻塞“可复现工程骨架”和 Phase 0 通过声明；不阻塞临时 Spike。
- 证据：[ARCHITECTURE.md](ARCHITECTURE.md#11-初始技术基线) 只列大版本和工具类别；[BROWSER_AUTOMATION.md](BROWSER_AUTOMATION.md#8-会话与-cookie) 已承认 macOS 14+ 与更低版本隔离能力不同。
- 关闭条件：锁定 Node/pnpm/Rust channel+components/Tauri/Wry/SQLCipher/PostgreSQL 版本和升级策略；确定 Windows 最低版本、架构和 WebView2 分发策略，macOS 最低版本、Intel/Apple Silicon；定义 native CI runner、制品留存、签名/公证责任。随后落地版本文件、lockfile 和 CI matrix。

### R0-12：设备切换后的凭据可用性存在直接文档冲突

- 级别：J1。
- 处置：Start Blocker，阻塞 J-05 切换原型验收，不阻塞设备协调基础设施。
- 证据：[PRODUCT_REQUIREMENTS.md](PRODUCT_REQUIREMENTS.md#36-账号设备与云同步) 与 [ACCOUNT_AND_SYNC.md](ACCOUNT_AND_SYNC.md#22-默认不同步仅设备本地) 无条件描述切换后重新录入；[UX_FLOWS.md](UX_FLOWS.md#账号门禁) 又明确此前在该设备配置的凭据可继续安全保留，切回时无需临时录入。
- 建议关闭方向（待落档）：按设备状态化处理，而不是“一律重输”。本机已有、未撤销且健康检查通过的 DeviceCredentialBinding 可以继续使用；缺失、过期、不可验证或 Browser Session 失效时才重新录入/登录。共享 ProviderConnection 健康不能替代设备本地健康。
- 关闭证据：J-05 覆盖首次配置、切回已有凭据、凭据撤销、Keychain 丢失、浏览器会话过期五种场景。

### R0-13：Phase 0 真实平台写入缺少 Safety Envelope

- 级别：J0。
- 处置：Start Blocker，仅阻塞真实外部副作用；Fake Provider 和本地 Fixture 可继续。
- 证据：[ROADMAP.md](ROADMAP.md#phase-0技术验证) 要求 Cloudflare 最小读写和五种模式演示，而完整 Operation/Attempt、批准和防重放 Gate 位于 Phase 2。
- 建议关闭方向（待落档）：任何 Phase 0 Live Write 只能使用专用测试账号、专用可丢弃资产、允许动作白名单、最小数量、显式人工确认、独立审计、执行前后截图/读取证据、清理步骤和紧急停用。Ticket Spike 使用固定 Stub Plan，不提前冻结 Phase 2 Operation 聚合。
- 关闭证据：每个 Live Spike 有资产清单、批准人、执行窗口、回滚/清理结果和残余风险记录。

### R0-14：Connector 级 `supportsIdempotency` 无法安全驱动逐操作重试

- 级别：J0，相对于外部写主链。
- 处置：Start Blocker，阻塞 connector-sdk 正式接口和真实写；只读 Spike 可继续。
- 证据：[CONNECTORS.md](CONNECTORS.md#3-capability-descriptor) 只有连接器全局布尔值，但同一 Provider 通常同时存在安全读、有幂等键的写和无幂等保证的提交。
- 建议关闭方向（待落档）：按 feature/operation/endpoint 声明 `retrySafety: safe | provider_idempotency_key | confirm_before_retry | never`，并记录 Key 注入位置、稳定期、提交边界和确认通道。Operation Attempt 消费逐操作策略，不能消费连接器全局布尔值。
- 关闭证据：Contract Test Kit 对同一连接器的混合安全等级、超时和重复请求逐操作验证。

## 6. 后续 Phase Gate Finding

以下问题不阻塞 WP-0 工程初始化，但必须保留为阶段硬门槛。

### G1：字段级合并缺少可持久的历史基线

- 级别：J0；Phase 1 Mutation 实现前关闭。
- 证据：[SYNC_SEMANTICS.md](SYNC_SEMANTICS.md#1-活动设备与云端合并) 需要 `cloud_base/device_local/cloud_current`；[ACCOUNT_AND_SYNC.md](ACCOUNT_AND_SYNC.md#7-云同步与执行数据模型) 的 Mutation 只有全局 `base_revision + changed_fields`；历史又会被 Checkpoint 压缩。
- 要求：Mutation 携带受影响字段的稳定 Base Fingerprint/Value，或服务端持久化字段最后修改 Revision；定义 `base_too_old`，不得猜测合并。压缩不能假定 Device Cursor 等于本地所有未上传 Outbox 的最小基线。

### G2：Cursor 与持续 Schema 兼容协议不完整

- 级别：J1；Phase 1 退出前关闭。
- 问题一：Reader Cursor 可丢弃，却能作为最慢 Cursor 永久阻塞压缩。要求 Cursor Lease/TTL、`cursor_expired/rebootstrap_required` 和可从 Checkpoint 重建的规则。
- 问题二：Schema 门禁只发生在激活，新版本 Cloud 上线后，已 Active 的旧客户端仍可能编辑和批准。要求 `min_read_version/min_write_version`、Lease 续签兼容门禁、Upgrade Required 状态和旧 Outbox 转换/隔离规则。

### G3：恢复与首次导入合同仍未闭合

- 级别：J1；Phase 1 退出前关闭。
- 保留现有 JF-08 和 JF-12；D-013 只解决备份内容，不等于完整恢复合同已解决。
- 要求：
  - 首次分页导入定义 Observed/Base/Desired 的原子初始化、部分 Run、重复、分页重排和远端中途变化语义。
  - RestoreCandidate 保存比较 Revision/字段 Hash，并具有 `open/rebase_required/applied/discarded/expired` 与 CAS。
  - JD-02 在 Phase 1 前确认。若采用当前方向，应拆成 Synchronized Backup 与 Emergency Local Snapshot；后者恢复只产生 Candidate。

### G4：Operation 聚合、日志归属和浏览器批量影响范围仍不完整

- 级别：J0/J1；Phase 2 正式写入前关闭。
- JF-06 应从 `Design Resolved` 调整为 `Partially Resolved / Phase 2 Gate`：Attempt 提交边界已清楚，但 OperationBatch、Workflow、Node、OperationItem、Attempt 的状态派生、事务边界、重试代次、取消、补偿和 Roll-up 尚未形成一套权威状态机。
- 旧 Epoch 的真正 AuditEvent 不能改写为 LateExecutionEvent；需要明确独立 Audit Ingest，或只在 Execution Event 中保存 `audit_event_ref/hash`。
- JF-04/JF-17 的影响旅程应补 J-02，因为 Afternic 上传和日常批量管理同样使用 Browser Transport。
- [USER_JOURNEYS.md](USER_JOURNEYS.md#82-批量操作与自动化) 的 `needs_replan` 用例应限定为“计划实际依赖的 Observed/Credential/Capability/RRset 变化”，并增加无关变化不失效的反例。

### G5：Verification 与 Operations 缺少持久、幂等交接

- 级别：J1；Phase 3 实现前关闭。
- 要求：定义版本化 `OperationOutcomeRecorded` 或确定性查询恢复规则，使用 `operation_id + workflow_node_id + attempt_generation` 幂等推进 VerificationAttempt，拒绝迟到结果覆盖已取消/过期的新代 Attempt。

### G6：商业与运营 Finding 保持原阶段边界

- JF-10/JD-01：Phase 3 紧急下架承诺前关闭。
- JF-11/JD-09：支付接入前关闭，Provider Payment Event 是事实，Entitlement 是可重建投影。
- JF-13/JF-14/JD-05：Phase 4 Support/合规/Admin 高风险动作前关闭。
- JF-16/JD-06：Phase 4 生产发布前关闭 RPO/RTO/SLO、KMS、PITR、恢复演练和 Runbook。
- JF-17：首个正式网页写连接器前至少完成签名、灰度、撤销、Anti-Rollback 和离线规则；完整运营在 Phase 4。

## 7. 现有 Finding 状态复核

| Finding | 主审决定 |
| --- | --- |
| JF-01 | 保持 J1/Open Finding；不升级为阻塞整个项目的全局 J0，但阻塞 Bootstrap Application Service 正式实现 |
| JF-02 | 调整为 `Partially Resolved / Phase 0 Gate`；两阶段激活正确，设备密钥绑定/轮换/撤销协议未闭合 |
| JF-03 | 保持 Open / Phase 1 |
| JF-04 | 调整为 `Partially Resolved / Phase 0 Gate`；批准消费原则正确，Recipe/Ticket 多步骤模型未闭合，影响范围补 J-02 |
| JF-05 | 保持 Design Resolved / Phase 2 Gate |
| JF-06 | 调整为 `Partially Resolved / Phase 2 Gate`；Attempt 已补，聚合状态机未闭合 |
| JF-07 | 保持 Design Resolved / Phase 0 Gate |
| JF-08 | 保持 Open / Phase 1 |
| JF-09 | 保持 Design Resolved / Phase 3 Gate |
| JF-10 | 保持 Decision Required / Phase 3 |
| JF-11 | 保持 Open / Phase 4；Phase 0 只做非生产参数的签名凭证原型 |
| JF-12 | 保持 Decision Required / Phase 1；D-013 只关闭内容清单，不关闭 JD-02/恢复合同 |
| JF-13 | 保持 Open / Phase 4 |
| JF-14 | 保持 Partially Resolved / Phase 4 Gate |
| JF-15 | 调整为 `Partially Resolved / Phase 0 Gate`；Job 基础语义正确，Tenant 派生与系统 Fan-out 未闭合 |
| JF-16 | 保持 Open / Phase 4 |
| JF-17 | 保持 Open；最小链 Phase 2 前，完整运营 Phase 4 |

## 8. Accepted Risk

以下风险已被产品明确接受，本轮不把它们重新包装成 Finding：

- 云端可读取域名、价格、成本、Listing 和脱敏业务数据；风险通过“不持有平台凭据”和本机批准收窄，而不是宣称为零。
- 默认持久 Browser Session 的 Cookie 保护依赖 OS 用户隔离；同时提供私密会话和清除入口。
- 当前 Active 设备在签名离线窗口内最多继续平台操作 24 小时；强制切换因此不能即时完成。
- 单 Owner 首版没有多人审批；使用 Passkey 重新认证、Scope、CaseReference、前后摘要和审计控制。
- 平台 ToS/政策不是全项目统一硬门槛；但每个 `provider + capability` 必须有 `allowed/restricted/prohibited/unknown` 结论。`prohibited` 必须禁用，`unknown` 默认 Manual fallback，不能把“非统一硬门槛”解释成忽略已知禁止。
- 本机管理员权限攻击者可能读取 WebView Cookie或篡改本地审计；产品只承诺合理隔离和篡改检测。

## 9. 主审对独立意见的调整

为避免把候选报告直接当成结论，本次做了以下实质调整：

- 没有把 JF-01 升级为阻塞所有代码的 J0；它只阻塞 Bootstrap 正式实现。
- 没有要求所有 Draft 文档转 Accepted 才能初始化工程；已接受 ADR、工程结构和本报告足以支持 WP-0。
- 没有禁止所有 Phase 0 真实平台写入；在 Safety Envelope 下允许专用测试资产的受控 Spike。
- 没有强制凭据输入必须使用原生控件；目标是普通应用 WebView 和第三方前端依赖不可读取原值，具体 Surface 由 Spike 证伪选择。
- 没有把平台政策改成统一发布阻塞；维持 D-006，但补充 provider/capability 级失败关闭。
- 将旧 Epoch Audit 归属问题从独立 J0 调整为 Phase 2 的 J1/J0 边界问题，随 Operation/Execution Ledger 正式实现关闭。
- 将 Reader Cursor 问题定为 Phase 1 协议 J1，而不是当前 Phase 0 全局阻塞。

## 10. 执行顺序

1. **开工前基线**：关闭 R0-01、R0-10、R0-11；建立 Gate 台账、工具链、支持矩阵、CI 和唯一 Connector 注册边。
2. **Secure Host 设计包**：关闭 R0-02、R0-03、R0-06；冻结 EndpointManifest、凭据输入、typed secret response 和签名 Envelope。
3. **设备与同步设计包**：关闭 R0-04、R0-05、R0-12，并将 JF-01 落入正式 Bootstrap 协议。
4. **浏览器设计包**：关闭 R0-07、R0-13；先跑无副作用双引擎 Spike，再决定是否允许 Live Write。
5. **Cloud Job 设计包**：关闭 R0-09，再宣告 JF-15 Phase 0 Gate 通过。
6. **备份设计包**：关闭 R0-08；Phase 0 只证明容器、投影和密码学，JD-02 留到 Phase 1 前决策。
7. **连接器设计包**：关闭 R0-14；五种模式先用 Fixture/Fake Provider，真实平台逐个进入 Policy/Safety Gate。
8. **Phase 0 Exit**：每个 WP 独立出具证据；最后再执行 J-01/J-03/J-05/J-08 的联合 Happy Path、权限拒绝、中断恢复和结果未知 E2E。

## 11. 最终准入标准

Phase 0 可以宣告完成，必须同时满足：

- R0-01～R0-14 均已关闭。当前 Roadmap 保留 Cloudflare 最小读写和五种执行模式演示，因此 R0-13、R0-14 不得以后续能力为由豁免。
- 如果产品决定把全部真实写或部分执行模式后移，必须先正式修改 Roadmap 和相应 Journey Gate；该缩减版本不得宣称通过本报告所审查的当前 Phase 0 Gate。
- JF-02、JF-04、JF-07、JF-15 的 Phase 0 设计与负向证据闭合。
- 所有 WP 有可重跑的测试、制品或演示脚本；只有录屏和口头说明不算充分证据。
- Windows/macOS 支持矩阵上的打包产物通过相同 Gate。
- 真实外部副作用只发生在 Safety Envelope 内，并完成清理和对账。
- 没有普通 TypeScript/WebView、Outbox、WAL、日志、Crash Report 或 Cloud 泄漏 Canary Secret。
- 并发激活、乱序 Mutation、Ticket 重放、TenantContext 篡改、跨连接 credentialRef 和 Public/Admin 越权全部失败关闭。
- Phase 1 的 Decision Required 已列出责任人与最迟决策时间，没有被原型默认值悄悄决定。

在此之前，项目状态应持续标记为 **Conditional Go / Phase 0 Validation**，不得描述为“架构已经验证”或“可以进入正式业务实现”。
