# ADR-0010：秘密输入与秘密响应由 Host 全程拥有

状态：Accepted

日期：2026-08-01

## 背景

普通 React 输入框会让 API Key、OAuth Token 或恢复材料先进入 Local App WebView 的 DOM 和 JavaScript Heap；把完整平台响应返回 TypeScript 后再脱敏，也会让新 Token、Challenge 或 Secret 在清洗前越过最高信任边界。这两条路径都不满足“普通 TypeScript 只能获得脱敏数据”的安全目标。

## 决策

Phase 0 使用由 Rust Host 创建并拥有的原生秘密输入面。主应用 WebView 只能发起带非秘密上下文的 `begin_secret_capture`，不能提交秘密值、读取输入控件或获得通用 Keychain API。原生输入面直接把秘密交给 Secure Host 的私有内存类型，批量写入 OS Keychain/Credential Manager，并只向普通 TypeScript 返回 `credential_binding_id`、fingerprint、版本和脱敏状态；Keychain `credentialRef` 不离开 Host。

若某个平台响应包含 Auth Token、Refresh Token、Challenge 或其他 `DEVICE_SECRET`，Manifest 只能把该 Endpoint 标记为 `host_owned`；具体 Rust typed extractor 由 Host 私有编译期绑定表按 Endpoint ID 选择，Manifest、生成的 TypeScript、运行时配置和 Connector 代码都不能指定 extractor ID、函数、JSONPath 或脚本。Endpoint Registry 与私有绑定表必须在绑定元数据、DNS、秘密读取和 Transport 前做全表双向一致性校验：每个 `host_owned` Endpoint 恰有一个绑定，绑定不得指向公开 JSON、未知或重复 Endpoint。

Transport 接收的所有原始响应 Body 都使用不可 Clone、Debug 脱敏并在释放时清零的 `SecretResponseBody`。公开 JSON 路径只能借用该 Body 做封闭白名单投影；Host-owned 路径只接受 2xx，直接消费 Body 进入 typed extractor，3xx、其他非 2xx、超限、畸形、缺失、未知或错类型字段一律不得写入秘密存储。Extractor 校验秘密值与生命周期后，以包含 Device、Account 或 Provider Connection、Profile 版本和来源 Endpoint 的强类型完整作用域调用原子 `SecretStore::store_batch`。Store 的返回类型只能表达“整批已持久提交”，不暴露条目数、部分成功或 Keychain Ref；`Ok` 表示整批已提交，`Err` 表示零条目提交。公开结果只能是专用脱敏状态，不能包含通用 JSON、原始 Body、Token、Secret Ref 或 Keychain Ref。

秘密生命周期为 `Absent -> Capturing -> Stored(version) -> Superseded | Deleted`。`Capturing` 不持久化；Host 崩溃、用户取消、Keychain 批量写入失败、未知秘密字段或脱敏失败都回到无新秘密的状态。不得降级写入配置、SQLite、临时文件、剪贴板、普通 IPC 或日志。

核心秘密类型不实现序列化和 Clone，Debug 始终脱敏，并在释放时尽力清零其拥有的缓冲区。当前 Fixture 的 `serde_json` 解析器对成功物化的秘密字段使用清零包装，但无法保证字符串解析失败前的内部 scratch buffer 被清零；这也不是对操作系统交换区、调试器或高权限本机攻击者的绝对防护。生产 typed extractor 启用前必须评估可审计的最小分配/清零解析路径，并通过 Heap、Crash、日志与平台原生输入面 Canary 扫描。

## 后果

- Desktop UI 必须围绕 Host-owned Capture Session 设计，不能复用普通表单组件。
- 每种 Secret-bearing Response 都需要专用 Rust Contract 和私有编译期绑定，不能使用动态 JSONPath、Manifest extractor ID 或 Connector 自定义脚本提取。
- R0-03 在 Windows 11 与 macOS 15 的原生输入面、Canary Secret 全链扫描和崩溃证据完成前保持 `In Progress`。

## 不采用的方案

- 不使用普通 Local App WebView 或 Remote Browser WebView 输入平台 API Secret。
- 不提供通用 `store_secret(value)` Tauri Command，也不向普通 TypeScript 返回 Keychain Ref。
- 不把 Stronghold Guest API、Keychain 读写或完整 Token Response 暴露给 TypeScript。
