# GoodDealer 开源实现参考登记表

## 目的与权威性

此表记录用于评估实现方式的开源项目和官方资料。它不是依赖批准、供应商认证、生产资格
或安全审查结论。当前源码、锁文件和已接受架构决定优先于此表。

## 当前参考类别

| 类别 | 参考 | 使用方式 |
| --- | --- | --- |
| 桌面宿主 | [Tauri](https://tauri.app/) | 评估未来桌面壳、权限和打包边界；当前 Desktop 没有业务命令。 |
| Rust 安全基础 | [Rust](https://www.rust-lang.org/) 和 [RustSec](https://rustsec.org/) | 评估语言、依赖和安全检查；不证明原生秘密 custody。 |
| 严格协议 | [Zod](https://zod.dev/) | 支持 TypeScript 的未知输入验证；合同测试不替代业务服务。 |
| Cloud 数据库 | [PostgreSQL](https://www.postgresql.org/) | 评估未来持久化和租户隔离；M013 目录接入不等于托管 PostgreSQL 18.6 资格。 |
| 本地数据库 | [SQLite](https://sqlite.org/) 和 [SQLCipher](https://www.zetetic.net/sqlcipher/) | 评估未来本地数据保护；当前备份仍不可用。 |
| 浏览器平台 | [WebView2](https://developer.microsoft.com/microsoft-edge/webview2/) 和 [WKWebView](https://developer.apple.com/documentation/webkit/wkwebview) | 不属于首发；仅在未来新的浏览器 ADR 获批后重新评估。 |

## 引入规则

新参考或依赖需记录用途、许可证、维护状态、信任边界、替代方案和验证计划。任何可能接触
秘密、网络、持久化、密码学、浏览器或外部副作用的依赖还需要拥有模块、最小 API、负向
测试和适用的独立审查。
