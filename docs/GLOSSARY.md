# GoodDealer 术语索引

## 当前基础术语

| 术语 | 含义 |
| --- | --- |
| M013 | 已显式接入 Cloud 迁移目录的服务器审计基础，标识为 `202608200013-server-audit-substrate`。 |
| M001–M014 中央目录 | Cloud 唯一、字面有序的生产迁移目录；M002 直接建立显式 `workspace_replica_*` 完整副本 schema，M014 是默认工作区控制面。 |
| 本地提交序列 | `local_commit_sequence`；描述 SQLCipher 本地事务顺序，与 Cloud `server_revision` 分离。 |
| Cloud 业务副本 | `workspace_replica_*`；只保存允许字段、复制顺序和恢复证据，不是 Desktop Repository。 |
| 服务器审计种类 | 仅 `user`、`staff` 和 `service` 三种可持久化种类。 |
| Security 发射 | 受限服务器发射；不创建额外持久化审计种类或链。 |
| `signing_key_transition_id` | 首个进入新签名密钥边界的记录携带的签名规范字段，用于连接既有链连续性。 |
| 个人默认工作区 | 账户完成验证并激活时原子创建的唯一首发 Workspace；其范围由服务器端绑定导出。 |
| Host-owned SQLite 源能力 | 与 Rust 所有者已打开 SQLite 连接绑定的一次性不透明备份源；不是路径、VFS 名称或文件身份字符串。 |
| Cloudflare 只读连接 | 首发唯一提供商能力；仅为明确 Zone 使用 `Zone:Read`、`DNS:Read` Token 读取 Zone/DNS 观察。 |
| 首发浏览器排除 | 首发不嵌入或自动化浏览器，也不以浏览器作为 API 回退的产品边界。 |
| 单区域生产模型 | 首发 Cloud、数据库、KMS/HSM 与监控同处一个获批区域，环境之间严格隔离。 |
| Secure Host | 公开窄备份与非秘密 Cloudflare 观察类型的 Rust 边界；Token、Credential Fence、Provider wire、endpoint 和 Transport 保持私有。 |
| 备份证据 | `local-storage` 写出的固定 schema-v1 不可用报告，不是备份工件。 |
| 浏览器自动化 | 当前不可用的自动化宿主能力，不存在 Desktop 业务组合。 |
| 公共业务路由 | Cloud 对客户业务能力的路由登记；当前为空。 |
| 周期作业 | Cloud 调度的重复业务工作；当前为空。 |
| 未发布 Release | 仅可被严格验证、不能发行的 release 请求状态。 |
| 外部资格 | 需在仓库外独立证明的运行、签名、部署、提供商、审查、发行或 Gate 状态。 |

本索引只定义当前源码支持的边界；它不把产品意图或测试资料列为已交付能力。
