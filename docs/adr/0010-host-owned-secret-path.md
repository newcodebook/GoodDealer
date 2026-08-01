# ADR-0010：秘密输入与秘密响应由 Host 全程拥有

状态：Accepted

日期：2026-08-01

## 背景

普通 React 输入框会让 API Key、OAuth Token 或恢复材料先进入 Local App WebView 的 DOM 和 JavaScript Heap；把完整平台响应返回 TypeScript 后再脱敏，也会让新 Token、Challenge 或 Secret 在清洗前越过最高信任边界。这两条路径都不满足“普通 TypeScript 只能获得脱敏数据”的安全目标。

## 决策

Phase 0 使用由 Rust Host 创建并拥有的原生秘密输入面。主应用 WebView 只能发起带非秘密上下文的 `begin_secret_capture`，不能提交秘密值、读取输入控件或获得通用 Keychain API。原生输入面直接把秘密交给 Secure Host 的私有内存类型，批量写入 OS Keychain/Credential Manager，并只向普通 TypeScript 返回 `credential_binding_id`、fingerprint、版本和脱敏状态；Keychain `credentialRef` 不离开 Host。

若某个平台响应包含 Auth Token、Refresh Token、Challenge 或其他 `DEVICE_SECRET`，该 Endpoint 必须绑定一个 Rust typed extractor。Extractor 从限量响应中直接解析并原子写入 Keychain；公开响应由白名单字段重新构造。禁止把完整响应 Body 返回 TypeScript 后再删除字段。

秘密生命周期为 `Absent -> Capturing -> Stored(version) -> Superseded | Deleted`。`Capturing` 不持久化；Host 崩溃、用户取消、Keychain 批量写入失败、未知秘密字段或脱敏失败都回到无新秘密的状态。不得降级写入配置、SQLite、临时文件、剪贴板、普通 IPC 或日志。

核心秘密类型不实现序列化和 Clone，Debug 始终脱敏，并在释放时尽力清零缓冲区。这不是对操作系统交换区、调试器或高权限本机攻击者的绝对防护；平台原生输入面、Crash Reporter 和日志配置仍需独立验证。

## 后果

- Desktop UI 必须围绕 Host-owned Capture Session 设计，不能复用普通表单组件。
- 每种 Secret-bearing Response 都需要专用 Rust Contract，不能使用动态 JSONPath 或 Connector 自定义脚本提取。
- R0-03 在 Windows 11 与 macOS 15 的原生输入面、Canary Secret 全链扫描和崩溃证据完成前保持 `In Progress`。

## 不采用的方案

- 不使用普通 Local App WebView 或 Remote Browser WebView 输入平台 API Secret。
- 不提供通用 `store_secret(value)` Tauri Command，也不向普通 TypeScript 返回 Keychain Ref。
- 不把 Stronghold Guest API、Keychain 读写或完整 Token Response 暴露给 TypeScript。
