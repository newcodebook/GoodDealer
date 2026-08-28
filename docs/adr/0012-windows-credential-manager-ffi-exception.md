# ADR-0012：Windows Credential Manager FFI 例外不在当前实现中

状态：Superseded by the current `forbid(unsafe_code)` Secure Host surface.

`secure-host-core` 当前禁止 unsafe 代码，且没有 Windows Credential Manager 适配器、通用
密钥链 API 或生产秘密组合。本 ADR 不授权恢复该接口。

若未来确实需要受支持的 Windows 原生秘密存储，必须先有新的、具体的设计决定，限定 API
和审计范围，并提供独立安全审查与原生资格证据。不得以本历史例外扩大当前 Host 公开面。
