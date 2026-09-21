# ADR-0015：本地备份只从 Host 所有的已打开 SQLite 连接取得源能力

状态：Accepted

## 决策

活动工作区数据库只能由 Rust `local-storage` 所有者使用固定、受审查的 SQLCipher/SQLite 打开
配置创建。该所有者在打开时固定数据库身份，并只向同一 `DesktopLocalHost` 备份聚合内部提供私有
不透明源能力。调用方不能提供或选择数据库路径、文件名、文件描述符、VFS 名称、加密
参数、密钥、临时目录或输出位置。

备份从同一个已打开连接，在所有者控制的序列化/快照边界内通过 SQLite 的受限备份机制生成。
需要重新打开数据库时，也只能使用相同的 Host 私有配置和已验证身份；文件路径本身从不是
数据库身份的证明。SQLCipher 密钥及其解锁材料继续只由受限本地秘密边界持有。

已打开连接和 retained descriptor 证明所有权与预期 inode 绑定，但当前 pinned `rusqlite` 没有 safe
`SQLITE_FCNTL_HAS_MOVED` wrapper。在禁止 unsafe FFI 的仓库内，pre/post identity 或 ciphertext digest
只能发现错误 inode，不能阻止同 UID 进程在 SQLite 后续 path-based writable open 时交换 active path、
制造副作用后再换回。因此任何依赖 active-database swap-and-swap-back 防护的生产 rebootstrap 资格
保持不可用，直到经审查的 safe wrapper 或 custody-controlled VFS/open-by-handle 和目标平台故障证据存在。

首发不公开或配置自定义 SQLite VFS。若平台证据证明必须引入 VFS，它只能作为 `local-storage`
内部实现，经新的 ADR、原生故障测试和独立审查后加入；不得成为调用方可选择的兼容接口。

## 理由

将备份源绑定到已打开的连接，避免了按路径重开文件导致的符号链接、替换、WAL/快照错配和
调用方伪造资源问题。它也让 `DesktopLocalHost` 保持窄操作权威，而非演变成通用文件或数据库服务；
`secure-host-core` 不参与备份边界。

## 当前实现边界

`local-storage` 已拥有生产活动工作区的 SQLCipher 打开、迁移、业务事务和受限读取能力。备份
导出与恢复组合遵守本 ADR 的 `DesktopLocalHost`-owned 源能力约束；生产 native 资格未完成时必须显式不可用，
但不能因此回退为 Cloud 业务 Repository。私有测试可验证 rebootstrap 聚合协议；它不能证明上述
active-file 绑定或生产资格。
