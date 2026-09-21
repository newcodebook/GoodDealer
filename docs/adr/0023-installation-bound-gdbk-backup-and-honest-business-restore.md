# ADR-0023：GDBK v1 使用安装级 Backup KEK，并以新业务历史恢复到当前数据库

状态：Accepted；私有开发组合只证明协议，生产备份、continuity 与 rebootstrap 在原生资格验证前保持不可用。

## 背景

GoodDealer 的本地 SQLCipher 数据库同时包含业务事实、Provider 本地身份与凭据引用、同步控制状态、
授权状态和恢复目录。复制整个数据库会把不属于备份的数据带入工件，也会让旧数据库中的同步或授权
水位看似成为当前权威。用户备份与 A/B rebootstrap 是不同的恢复机制；后者用于 Cloud rebootstrap，
不能定义用户备份的最终恢复语义。Rust 的 crate 可见性也不能安全表达跨 sibling crate 的“朋友”边界，
因此所有能够观察备份明文或决定备份权威的阶段必须位于同一个所有者中。

## 决策

### 适用范围与授权

GDBK 是同一安装、同一 GoodDealer 账号、同一工作区内的本地业务备份，不是可携带的账号恢复机制。
它没有口令模式、跨设备恢复或 Cloud 托管/传输。`active` 与
`verified_local_continuation` 可以导出并检查工件；只有 `active` 可以提交恢复。Host 在工件准入、密钥操作、
文件发布和恢复提交前重新检查当前账号/工作区/安装 binding、可信时间、授权状态和 operation
generation。运行时 session、Lease 和 operation generation 是短期操作 fence，不是 Backup KEK 身份。
完整边界由 `gooddealer-local-storage` 的 `DesktopLocalHost` 拥有；Desktop 只能传入有界不可信 wire 并
接收脱敏结果，`gooddealer-secure-host-core` 不包含任何备份实现、依赖或桥接 API。

### 严格 GDBK v1 容器

GDBK v1 是唯一接受的首发格式。解析器只接受精确的 `GDBK\0V1\0` prelude、固定顺序和宽度的
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

`BackupSource` 只借用 ADR-0015 定义的、已经由 Host 按固定配置打开的 SQLCipher 连接。它先创建事务
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
备份集合中缺失、但当前存在的实体创建显式 tombstone。它推进正常的本地/device mutation sequence，
并保留当前 workspace identity、server revision/cursor、Inbox、receipt、conflict、delivery ownership、
backup catalog 和全部授权/控制水位。并发编辑或冲突在本版直接拒绝并回滚；提交 receipt 使崩溃后的
operation replay 幂等。后续 Cloud push/pull 只处理这些普通新 mutation，并继续使用既有冲突和 tombstone
屏障。

### Continuity 与 rebootstrap 资格

备份 authority continuity、A/B rebootstrap 和 GDBK 工件是不同但同属 `DesktopLocalHost` 的私有协议。
私有 `cfg(test)` 组合可以用 atomic create-only fake 验证 continuity receipt，以及
`Prepared -> CandidateReserved -> Verified -> PublishIntent -> Published -> ReopenedVerified ->
RetiredOld`、单次 exchange、cancel/recovery/quarantine 和 alias cache repair。该 fake 没有 Cargo feature、
环境开关、公开 constructor 或生产 fallback，不能被描述为 native/macOS 证据。

该私有协议继续使用 journal schema v3，但 old/candidate slot envelope origin 与
`old_slot_created_by_operation` 均为必填证据；解析和恢复禁止默认、推断、fallback 或自动升级。缺少这些
字段的旧 v3 中间态严格解析失败并只读 quarantine。exchange 前的恢复只能取消，不能推进 exchange；
`Prepared` 即使尚无 candidate 文件与 slot key，也必须能沿无越权清理路径取消。此处描述的是私有
`TestRecovery` 合同，不会扩大生产启动行为。

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

当前官方 `security-framework` 3.7.0 没有一个 safe API 能同时提供 true create-only `SecItemAdd` 与要求的
Data Protection Keychain、ThisDeviceOnly、non-sync 和 ACL 属性；preflight 后调用会 duplicate-to-update
的 setter 仍是 upsert，不是 create-only。P0 不引入 fork。完整 rebootstrap runtime、journal parser、
phase/action/evidence、custody/database executor 与 recovery classifier 全部只在 `cfg(test)` 编译；生产没有
dormant shell。non-test plan facade 在读取输入、parser、operation/runtime/custody lock 或状态前直接返回
`Unavailable`。生产 startup 在 root 验证、process lock 与 active-workspace directory identity 后、普通
数据库/key 创建或打开前，只检查固定 journal、A/B candidate 及 sidecar、A/B slot account 是否全部
不存在；任何 bytes、inode、slot、检查不确定性或 storage error 都终止 Host 构造，不解析、不追认、不
删除、不修复、不发布 live quarantine Host。调用方必须把该构造失败视为本进程 terminal。

此外，pinned `rusqlite` 没有 safe `SQLITE_FCNTL_HAS_MOVED` wrapper。retained descriptor、pre/post file
identity 和 ciphertext digest 能阻止错误 inode 被发布，却不能阻止同 UID 进程在 SQLite 的 path-based
writable open 周围 swap-and-swap-back 并造成副作用。只有 safe wrapper 或 custody-controlled
VFS/open-by-handle 加目标平台 crash/fsync 测试可以解除该边界。普通激活和本地业务操作不依赖生产
rebootstrap 可用性。

## 理由

安装级 KEK 让备份在普通 session 或 Lease 更新后仍可读取，同时不引入口令保管和跨设备威胁面。严格
二进制容器把兼容性、大小和完整性变成可枚举的拒绝合同。业务投影避免复制秘密和控制面状态；在当前
数据库中创建新历史，则保持本地权威、同步因果和安全水位真实。handle-based 准入与两阶段日志覆盖了
检查到使用、rename 到 catalog 之间的崩溃窗口。

## 后果与资格边界

新版本或 crypto suite 必须使用新 encoder/parser 并经过新的 ADR；v1 只在对应 KEK slot 仍受政策保留时
继续解析，不提供宽松迁移。若 opened-connection 投影无法避免非受控明文持久化、目标 OS 无法提供要求
的非同步 ThisDeviceOnly custody，或恢复产生的新 mutation 不能维持同步冲突语义，备份能力保持不可用，
不得退回整库复制、口令容器、路径重开或 Cloud 上传。

源码与测试已把 authority continuity protocol、容器/KEK/rollback-anchor capability、native
handle/journal、投影、ephemeral candidate 和恢复事务收敛到 `gooddealer-local-storage` 私有实现；Desktop
仅保留有界 raw IPC、单次 `spawn_blocking` 调用和脱敏映射，client-core 仅保留严格一次性/CAS 合同。
私有开发组合覆盖真实 SQLCipher → GDBK AEAD → admitted file/journal → authenticated reread → current-DB
restore，以及 test-only continuity/rebootstrap 状态机。该证据不包含生产 native picker/stable-handle
TOCTOU、真实安装级 KEK custody、独立 non-rollbackable anchor、true create-only slot custody、safe
active-database move detection、durable filesystem 或签名目标平台的 ENOSPC/short-write/fsync/crash
资格。上述原生资格完成前，备份、continuity 与 rebootstrap 保持 `unavailable`；仓库测试不得被描述为
生产备份、灾难恢复或发行 Gate 已通过。
