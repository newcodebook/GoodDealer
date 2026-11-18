# ADR-0023：独立业务备份、换机云恢复与数据库发布

状态：Accepted

## 恢复旅程

### 独立业务备份

用户手动选择本地保存位置；恢复到最近一次备份即可，不新增自动调度、固定数据丢失窗口或
自建同步盘/NAS 集成。新备份必须在没有旧设备、旧 OS 密钥库或 GoodDealer 云的情况下解锁。
采用明确的新版本工件和用户保管的恢复材料，不能改变 v1 的解析语义或把旧安装密钥带入备份。
具体二进制格式、密钥派生参数与原生秘密输入合同须与对应实现一起定义和验证，不以本 ADR
代替密码学或平台实现。

恢复所有者仍是 `local-storage`，在隔离、加密的数据集中完成认证、结构和业务不变量校验，
随后开放查看与受控导出。这个离线数据入口不依赖付费、登录或在线授权，不装载活动工作区
的运行授权，也不产生 Outbox 或调用 Provider。只接受业务投影，不接受备份中的 SQL、数据库文件
或执行任务。恢复材料、明文解密缓冲和文件 handle 留在 Native，Renderer 仅获得受限数据视图。

历史备份本来就是旧数据，因此“读取旧备份”不要求证明数据是最新的，也不依赖旧安装的
non-rollbackable anchor。该选择不会放宽活动工作区的授权、防回滚或数据库完整性要求。
持有有效备份与恢复材料意味着能够读出该备份；在线撤销不能追溯撤销已经交给用户的离线副本。

重新登录并取得有效授权后，才可把恢复数据纳入当前工作区：预览差异、核对身份与冲突，生成
新的业务 mutation，并走现有事务、同步和墓碑规则。备份缺失的实体不能未经明确预览就删除
现有资产；备份里的 revision、cursor、Lease、设备绑定或未完成操作不获得当前权威。
Provider 凭据需要重新连接；恢复出的任务历史不自动变成执行队列。

### 换机云恢复

新设备通过正常登录、设备绑定和授权取得当前工作区的最新可用同步副本，在新安装的秘密托管
与 SQLCipher 中重建业务视图。仅恢复成功同步的允许字段，不承诺恢复从未同步的本地数据，
也不下载平台凭据、旧设备授权或运行任务。原设备丢失时不要求它参与 drain handoff；需要遵循
既有设备撤销/切换与单活动设备规则，不能跳过服务端设备权威。

两条旅程恢复后都可在有效授权下重新扫描 Provider，按来源、时间和已确认的域名绑定核对
上下架状态。平台状态与用户目标价分别保存；平台扫描不能覆盖用户备注、成本等无法重建的事实，
也不能因为平台暂时返回空列表而清空资产。

## 所有者与备份源

`local-storage` 的 `DesktopLocalHost` 拥有备份与恢复全过程。活动库以固定 SQLCipher 配置打开并固定身份，
备份源只来自同一已打开连接的私有不透明能力；调用方不能选择源数据库路径、descriptor、VFS、密钥、加密
参数或内部临时目录。用户通过原生选择器选择备份保存或读取位置，该目的地选择不赋予数据库源权威。
需要重开时只用 Host 私有配置与已验证身份；路径本身不是身份证据。自定义 VFS 不作为公开配置，新增内部
VFS 需要具体设计和原生故障审查。

## GDBK v1 协议与活动库恢复

以下规则只定义安装绑定 v1 及活动库发布；独立换机备份使用前述新版本，不沿用 v1 的安装限制。

### GDBK v1 的适用范围与授权

GDBK v1 是同一安装、同一 GoodDealer 账号、同一工作区内的本地业务备份，不是可携带的账号恢复机制。
它没有口令模式、跨设备恢复或 Cloud 托管/传输。`active` 与
`verified_local_continuation` 可以导出并检查工件；只有 `active` 可以提交恢复。Host 在工件准入、密钥操作、
文件发布和恢复提交前重新检查当前账号/工作区/安装 binding、可信时间、授权状态和 operation
generation。运行时 session、Lease 和 operation generation 是短期操作 fence，不是 Backup KEK 身份。
完整边界由 `gooddealer-local-storage` 的 `DesktopLocalHost` 拥有；Desktop 只能传入有界不可信 wire 并
接收脱敏结果，`gooddealer-secure-host-core` 不包含任何备份实现、依赖或桥接 API。

### 严格 GDBK v1 容器

GDBK v1 解析器只接受精确的 `GDBK\0V1\0` prelude、固定顺序和宽度的
有界二进制 header、header digest、一个被包装的内容密钥、连续编号且种类闭合的 manifest/data/trailer
AEAD frame，以及文件末尾。它不使用 JSON header，也不做宽松兼容。未知版本或 suite、未知或重复
字段、序号跳跃、重排、重复/缺失 frame、非法长度、整数溢出、截断、篡改、final frame 后数据和尾随
字节全部失败关闭。

v1 固定 XChaCha20-Poly1305 与 HKDF-SHA256，header 不包含原始账号、工作区、设备、路径或授权 ID。
header digest、Host 重新计算的 binding digest、backup ID、frame kind/sequence/length 和用途域进入相应
AAD。每个备份使用 Host CSPRNG 生成的新内容密钥、包装 nonce 和不重复 frame nonce。文件最多
16,384 个 frame、每 frame 最多 1 MiB 明文、总工件最多 512 MiB；所有计数在解密和分配前检查。
解析、认证或 binding 失败统一返回粗粒度 `BACKUP_ARTIFACT_REJECTED`，不形成格式或身份 oracle。

### 安装级 Backup KEK

Desktop Local Host 以 `backup-wrap-v1` 为固定用途，在 OS 非同步、ThisDeviceOnly、应用受控的秘密存储中保管
安装级 Backup KEK。每个 key slot 具有调用方不可选择、不可枚举的不透明 ID 和单调版本。导入只按
严格 header 中的精确 retained slot 选择密钥，随后重新计算当前 binding 并验证 wrap 与 manifest；
没有猜测、口令或其他 key fallback。

最多保留三个版本。轮换先增加新的加解密 slot，再把旧 slot 改为仅解密；本地目录仍引用某 slot 时
不能退役它。slot 缺失/已退役、ACL 漂移、注册表回滚或版本倒退、密钥丢失统一以
`BACKUP_KEY_UNAVAILABLE` 失败关闭。该保留策略意味着足够旧或外部复制的工件可能在 slot 合法退役后
不可恢复；产品必须如实呈现这个限制，不能把 GDBK v1 称为灾难恢复或跨设备备份。
rollback anchor 必须来自与 KEK registry blob 独立的持久机制；同源 blob 不能证明自身未被回滚。
普通 Keychain 也不证明 non-rollbackable monotonicity；生产组合没有合格的独立 anchor 时 continuity
保持 `unavailable`。真正的新安装 `(None, None)` 不能因此阻止 fresh live Grant，半组合或有业务数据但
缺失/不匹配的 continuity 状态则失败关闭。

### 备份数据与秘密生命周期

`BackupSource` 只借用本 ADR 定义的、已经由 Host 按固定配置打开的 SQLCipher 连接。它先创建事务
一致的隔离 SQLCipher 快照，再从已验证快照生成确定性、完整集合的业务 root 投影。磁盘临时快照始终
保持 SQLCipher 密文；明文 row、投影、规范序列化、frame、内容密钥、KEK、nonce 和临时数据库 key
从首次分配起即由 zeroizing owner 持有，并在退出时清零；不得先产生普通 `String`/`Vec` 再复制到
清零容器。临时 key/file 清理失败时，工件不能进入 finalized/catalog-available，只能明确隔离。

工件明确排除 Provider 凭据和本地 Provider 账号/连接身份、OAuth code/token/cookie/session、数据库
解锁材料、Lease、Grant、Ticket、ApprovedOperation、授权或 entitlement 状态、同步 delivery owner、
reader cursor、Inbox、conflict、receipt、rebootstrap journal 和 backup catalog。调用方请求
`includePlatformCredentials=true` 必须返回 `BACKUP_CREDENTIALS_NOT_ALLOWED`。

### 工件准入与两阶段文件日志

Renderer 从不接触路径。原生文件选择器产生 Desktop Local Host 私有 handle；所有者通过同一个 handle 验证并读写 regular
file，拒绝 symlink、hard-link 异常、reparse point、特殊文件、不安全 owner/mode、文件身份或大小变化。
Unix 使用 no-follow/create-exclusive 和 directory-relative 操作；Windows 验证 reparse tag 与 handle
file identity。路径、目录项、文件名或目录记录都不是文件权威。

导出使用 `reserved -> writing -> fsynced -> renamed -> catalog_available` 的两阶段 filesystem/catalog
journal，另有 `invalid`/`quarantined`。所有者以 create-new 临时 handle 写入，fsync 文件，执行原子
no-clobber rename，fsync 目录，持久化私有 locator 与不可变 file-id/size/digest，再以事务标记
目录可用。启动恢复只按日志状态和精确 handle 身份推进或隔离，绝不根据文件存在自行猜测。用户选择的
外部工件每次都必须重新选择并重新准入，catalog metadata 不能授权再次按路径打开。

### 诚实业务恢复

导入先在隔离 candidate sink 中完成容器认证、binding、schema、数据分类、完整集合和业务不变量验证，
只向上层暴露脱敏 `VerifiedArtifact`。最终恢复不切换旧数据库指针，也不把备份中的 revision、cursor、
epoch 或其他水位抬高成当前值。

`RestoreTransaction` 在当前 active SQLCipher 数据库中运行一个 `IMMEDIATE` 事务，精确 CAS 当前业务
revision、candidate set/version、artifact/dialog/operation identity 与 authority snapshot。它把选定的旧
业务内容写成新的本地 mutation、field version、business history 和 secret-free outbox row；对于完整
备份集合中缺失、但当前存在的实体，只有差异预览明确确认删除后才创建显式 tombstone。它推进正常的本地/device mutation sequence，
并保留当前 workspace identity、server revision/cursor、Inbox、receipt、conflict、delivery ownership、
backup catalog 和全部授权/控制水位。并发编辑或冲突在本版直接拒绝并回滚；提交 receipt 使崩溃后的
operation replay 幂等。后续 Cloud push/pull 只处理这些普通新 mutation，并继续使用既有冲突和 tombstone
屏障。

### Continuity 与 rebootstrap 资格

备份 authority continuity、A/B rebootstrap 和 GDBK 工件是不同但同属 `DesktopLocalHost` 的私有协议。
发布状态机为 `Prepared -> CandidateReserved -> Verified -> PublishIntent -> Published ->
ReopenedVerified -> RetiredOld`，单次 exchange、取消、恢复、隔离与 alias 修复均服从以下规则。
测试 fake 不得成为生产 fallback，也不证明原生资格。

该协议使用 journal schema v3，但 old/candidate slot envelope origin 与
`old_slot_created_by_operation` 均为必填证据；解析和恢复禁止默认、推断、fallback 或自动升级。缺少这些
字段的旧 v3 中间态严格解析失败并只读 quarantine。exchange 前的恢复只能取消，不能推进 exchange；
`Prepared` 即使尚无 candidate 文件与 slot key，也必须能沿无越权清理路径取消。这些恢复规则必须由生产原生实现及故障证据验证。

启动必须有界读取并验证从首个 `publicationSequence == 1` 的 `Prepared` 开始的完整、非轮换 v3
因果链，逐项验证阶段、operation/sequence、slot/origin 和单调 evidence；不得只解析最后一条记录。
解析前，retained no-follow descriptor 必须做两次有界 positional read，并证明声明 size/EOF、两次内容
digest、before/mid/after uid/mode/nlink/dev/ino/size/mtime/ctime 以及 fixed path/目录 identity 全部稳定。
这只是 observed content-snapshot stability，不是 cryptographic/monotonic anchor，也不提供 same-UID immunity。
缺前缀、跳步、重复、重排、跨 operation 漂移、证据改变、非法终态后记录或持久化 `Quarantined`
都只产生内存 quarantine，不能 append、truncate、repair、读取 alias、删除 slot、unlink 或可写打开
SQLite。quarantine Host 在整个存活期保留进程锁与目录 identity guard，阻止第二实例在检查 journal、
slot、alias、数据库或 key 前继续；该 guard 不含数据库 descriptor、SQLCipher key、runtime 或 capability。

`Cancelled` 是 cleanup-complete 终态，必须在全部允许的清理与 active alias readback durable 完成后最后
append/fsync；终态之后不得继续 destructive cleanup。pre-EXCHANGE executor 的唯一顺序是：删除并目录
fsync 精确 candidate 文件、精确删除并回读 candidate slot、在仍有认证 old slot/key 时修复并回读 old-key
alias、仅当 old slot 由本 operation 创建时再删除并回读它，最后写入 `Cancelled`。crash restart 只接受
这个顺序产生的精确缺失前缀；candidate 文件仍在但 slot 已缺失、pre-existing old slot 缺失、sidecar/
inode/origin/evidence 不一致都只读 quarantine。alias 通常只是可修复 cache；只有 candidate 文件与 slot
都已按序消失且 operation-created old slot 也已删除时，它才可作为 sole credential，并必须通过 journal
old-key digest 与 retained old descriptor/workspace/schema/logical proof 的 immutable 验证。合法
`Cancelled`/`RetiredOld` 终态只可在 exact active slot 与 immutable proof 成功后修复 alias，不得修改
数据库、slot 或 journal。

journal 的 file/recovery digest 是 transition 完成时的历史证据，在 durable terminal 之前保持严格。
terminal 之后 fresh authority 可合法 RW 打开并提交业务/sync 写入，当前 ciphertext、size、counter 与 row
digest 因此不得再与历史 Prepared/Verified/Published 值比较。终态重启改为验证 complete ancestry、当前
selected key/envelope、workspace/schema/manifest、descriptor-bound immutable current DB，并对
`RetiredOld` 或继承的 published ancestry 验证精确且 `verified` 的 publication-link row。该证据不证明
same-key/workspace monotonic rollback；没有独立合格 anchor 时，旧的同 lineage 快照仍可能通过，因此生产
资格和 unavailable 边界不变。

完整链同时派生 active publication link：`Cancelled` 保留此前最近一次 `RetiredOld` 的 link，新的
`RetiredOld` 用本 operation 的精确 link 替换它；仅有初始 ancestry 与 cancellations 时保持 `None`，不得
虚构 link。终态 custody 在同一个 retained current descriptor 与 active key 上同时证明 current clean-start
invariant 和（存在时）恰好一条 `state='verified'` 的 exact link row。

checkpoint 安装是 staged clone 上的 merge，不丢弃既有 local pending/conflicted facts。安装前必须证明
checkpoint baseline 不低于 workspace-wide applied、reader read-through、pinned target、checkpoint-through
及 anti-rollback server revision floor，并以连续 replay 精确到达不回退的 final head；任一 floor/schema/
page/proof 不满足都在 staged candidate 持久化前失败关闭。取消路径只保留旧 local facts；成功 resume/
terminal 保留这些 facts 并合入远端 checkpoint/replay，且不产生 remote echo Outbox。

所有 classification、完整链验证和 immutable descriptor proof 失败都要求 journal、alias、文件、slot 与
sidecar 零修改。只有 exact post-EXCHANGE topology 和只读 proof 已生成一次性 plan 后，active alias repair
才是允许先于下一条 journal confirmation 的 durable prefix；若随后 append 失败，重启仍忽略 alias 的
拓扑投票，重新验证完整链与 file/slot evidence，再幂等执行同一 repair。不得 exchange-back、补偿 alias
或在 `ReopenedVerified`/`RetiredOld` 前授予 runtime authority。

生产发布必须具备 true create-only slot custody（含 Data Protection、ThisDeviceOnly、non-sync 与 ACL）、
独立 rollback anchor、safe active-database move detection 或 custody-controlled VFS/open-by-handle，以及
目标平台 crash/fsync/ENOSPC/short-write 故障证据。preflight 后 upsert 不等于 create-only；文件身份和 digest
前后检查不能阻止 SQLite path-based writable open 的 swap-and-swap-back 副作用。

尚未取得上述资格时，不发布 active-store 替换或恢复权威。未启用的生产启动路径在普通数据库与 key 打开前，
只检查固定 journal、A/B candidate、sidecar 与 slot 均不存在；残留或不确定性使 Host 构造终止，不解析、追认、
修复或清理。普通激活与本地业务不依赖 rebootstrap 可用性。离线历史备份查看采用前述隔离入口，
不要求证明历史数据最新，也不继承旧安装 anchor。


## 验收

Windows 与 macOS 的新版本备份必须互相恢复；旧设备和旧密钥库移除、Cloud 阻断时仍可查看、导出。
错误恢复材料、篡改、截断、未知格式与恶意长度均拒绝，恢复不产生执行授权或外部副作用。
云恢复须在原设备不可用时完成，授权或副本校验失败不覆盖现有数据；恢复后重新连接平台并对账。
新格式与 crypto suite 使用独立 encoder/parser，并随实现确定密码学参数、原生秘密输入及故障测试；
v1 不提供宽松迁移、口令 fallback、整库复制或 Cloud 上传。
