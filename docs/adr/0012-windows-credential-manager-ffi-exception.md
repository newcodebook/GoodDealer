# ADR-0012：Windows Credential Manager 使用单模块受审 FFI 例外

状态：Accepted

日期：2026-08-15

## 背景

`secure-host-core` 的 Windows Keychain 适配器必须通过 Windows Credential Manager 持久化账号 Refresh Token，并与 macOS 适配器保持相同的原子替换、缺失读取、幂等删除和失败关闭语义。固定版本 `windows = 0.61.3` 把 `CredWriteW`、`CredReadW`、`CredDeleteW` 与 `CredFree` 暴露为 `unsafe fn`，没有可用于该四个调用的安全包装；因此工作区级 `unsafe_code = "forbid"` 不能与真实适配器同时直接生效。Rust 的 `forbid` 级 lint 也不能由子模块的 `allow` 覆盖。

继续保留失败关闭占位会让 Windows 实现名义存在但无法持久化；放松整个工作区或整个 crate 的 unsafe 约束会扩大审计面，并允许无关模块静默引入新的 FFI 风险。

## 决策

只在 `crates/secure-host-core/src/keychain/windows.rs` 内把 `unsafe_code` lint 设为模块级允许。例外仅覆盖以下四个 Windows Credential Manager 调用：

- `CredWriteW`：以 `CRED_TYPE_GENERIC` 和 `CRED_PERSIST_LOCAL_MACHINE` 单次创建或替换设备本地凭据；
- `CredReadW`：读取一个目标，缺失时映射为 `Ok(None)`；
- `CredDeleteW`：删除一个目标，缺失时仍视为已提交；
- `CredFree`：释放 `CredReadW` 返回的唯一凭据缓冲区。

每个 unsafe block 必须紧邻 `SAFETY` 注释，说明指针来源、有效期、长度、所有权和释放不变量。`CredReadW` 的返回缓冲区由不可复制的私有 guard 独占；读取结果先复制到 Rust `Vec<u8>`，随后在唯一函数退出门之前显式销毁 guard。guard 在成功、not-found、畸形返回和平台错误路径都先于函数返回销毁；只要 API 填入非空指针，就恰好执行一次 `CredFree`。适配器错误保持无输入、无平台错误文本的固定脱敏表示，不保存 TargetName、credentialRef 或秘密。

根 `Cargo.toml` 的工作区 `unsafe_code = "forbid"` 保持不变，其他 crate 继续继承它。`secure-host-core` 因 Rust lint 规则无法在 `forbid` 下声明模块例外，改为 crate 级显式 `unsafe_code = "deny"`，并原样保留工作区的 Clippy `all = "deny"`、`pedantic = "warn"`；crate 根同样声明 `#![deny(unsafe_code)]`。因此除 `windows.rs` 的唯一 `allow` 外，unsafe 代码仍默认构建失败。验证必须扫描整个仓库，证明 `allow(unsafe_code)` 只出现在该文件，且生产组合根仍使用 `DenyingKeychainPort`。

Windows 凭据使用 `CRED_PERSIST_LOCAL_MACHINE`，使 Refresh Token 在本机重启后仍可用但不随企业漫游配置移动到另一台设备。这与由 `account_id + device_id` 派生的设备作用域一致。真实适配器仅保留显式 DI 构造缝；本决策不解除 P0-08 Fallback，也不把 `OsKeychainAdapter` 接入生产组合根。

## 安全边界

- 例外文件只能调用上述四个 API，不得扩展到枚举凭据、UI、认证缓冲区、任意内存或其他 Win32 API。
- `CredWriteW` 的 TargetName 是存活至调用返回的 NUL 终止 UTF-16；秘密 blob 是只读借用，长度转换为 `u32` 并受 `CRED_MAX_CREDENTIAL_BLOB_SIZE` 限制。
- `CredReadW` 成功返回的指针在复制前保持有效；空指针、类型不符、超限或非零长度空 blob 全部失败关闭。释放发生在任何结果返回前。
- `CredDeleteW` 和 `CredWriteW` 不返回需由调用方释放的凭据缓冲区；`CredFree` 只接收 `CredReadW` 返回且尚未释放的指针。
- 不向 Debug、Display、日志、IPC、TypeScript、持久化数据或不透明提交回执暴露秘密、TargetName、credentialRef、数量或部分成功状态。

## 后果

Windows 目标获得与 macOS 相同的 `KeychainPort` 生命周期语义；Linux 与 macOS 不编译该模块。代价是 `secure-host-core` 的 lint 配置需要显式复制当前工作区级别，并由结构扫描防止出现第二个例外。Windows 真机行为仍须在受支持的签名制品和原生 CI 上重新验证，才能作为解除 Fallback 的证据。

## 移除条件

当固定依赖提供覆盖这四个操作、所有权与释放契约可审计的安全 API，或项目引入经独立审查且不暴露 unsafe 给 `secure-host-core` 的专用安全包装 crate 后，必须删除 `windows.rs` 的局部 lint 例外和所有本地 unsafe block，把 `secure-host-core` 恢复为 `[lints] workspace = true` 与 crate 根 `#![forbid(unsafe_code)]`，并保留同一套跨平台契约和真机测试。移除前不得扩大本 ADR 的函数或文件边界；任何扩大都需要新的用户裁决和 ADR。

## 不采用的方案

- 不继续使用失败关闭占位，因为它不满足 Windows 真实适配器交付目标。
- 不把 workspace 或整个 crate 改成 `allow`，因为这会显著扩大可引入 unsafe 的范围。
- 不使用 `CRED_PERSIST_ENTERPRISE`，因为漫游凭据会破坏账号与设备共同作用域；也不使用仅会话持久化，因为它不满足重启后恢复。
- 不接入生产组合根；`DenyingKeychainPort` 继续是默认结构性 Fallback。
