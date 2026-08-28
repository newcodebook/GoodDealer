# GoodDealer 安全模型

## 适用范围

本文件区分当前安全基础和已接受的未来安全要求。目标要求约束后续实现；它们不说明任何
产品路径现已启用。

## 当前安全基础

| 边界 | 当前事实 |
| --- | --- |
| Secure Host | 公开面只有窄备份与非秘密 Cloudflare 观察类型。Cloudflare Token、Credential Fence、Provider wire 和加固 HTTPS Transport 保持私有；没有通用 HTTP 面、Tauri 业务 Command或原生秘密录入。 |
| Desktop | Tauri 只公开本地业务状态、Portfolio 读取和 DomainAsset 写入三个命令；无路径、密钥、SQL、Provider 账号或 Cloud Repository 参数。 |
| Local data | SQLCipher 业务表和 secret-free Outbox 原子提交；Provider 账号及密封凭据只写本地且不生成 Mutation。 |
| Local backup | 生产业务数据库已存在；备份导出与恢复组合仍不可用。 |
| Browser | 自动化宿主报告不可用；没有浏览器会话、远程页面桥接或执行组合。 |
| Cloud | 公共业务路由和周期作业均为空；边界探针不能授予业务权限。 |
| Release | 未发布请求只能做严格验证，不能产生签名、发行或 Gate 结论。 |

## 已接受的目标安全架构

### 信任域

1. **展示域**：UI、文案和浏览器可见状态只显示已验证的投影，不能保管秘密、作出授权
   决定或直接触发外部副作用。
2. **业务域**：每个领域模块拥有自己的规则、数据模型和最小端口。跨模块调用必须经声明
   的合同，而非直接数据库访问或深层导入。
3. **Host 域**：只有被明确设计的、具体的本地操作可以接触秘密或受保护资源。Host 不提供
   可供调用方任意选择秘密、URL、适配器、配置或持久化的宽泛接口。
4. **Cloud 域**：账号/授权控制面和同步恢复副本必须执行鉴权、租户隔离和持久化边界；Cloud
   业务副本不能成为 Desktop Repository，客户端类型也不能自行证明服务器权限。
5. **外部域**：提供商、操作系统秘密存储、签名服务和部署平台均需要独立的可验证证据。

Cloudflare Provider 协议由私有 Service 自主维护。调用方不能取得普通 `String` Credential、
Transport、Environment、任意 endpoint 或原始 Provider 错误。所有 Provider wire 必须在 Host 内
有界解析、闭合映射并经过现有 Credential Fence；源码中定义 endpoint 不授予运行时可达性。

### 数据与秘密

- 所有不可信输入从 `unknown` 进行严格解析；未知、越界或秘密字段在边界拒绝。
- 第三方账号、Provider Account ID、账号别名、Credential Binding、原始秘密、密钥材料、
  Cookie、认证头、2FA、Browser Profile 和外部响应体不得进入同步、Cloud、普通日志、错误、
  UI 投影或非秘密持久化。
- 未来秘密操作应使用完整目的与作用域绑定，并在资源边界前后复核相关授权状态。
- 备份必须使用受封闭的 Host 操作；当前不可用证据不能演化成秘密或恢复权威。

### 审计

M013 是目录已接入的服务器审计基础。持久化种类仅为 `user`、`staff` 和 `service`；受限
Security 发射不创建额外持久化种类或链。审计通过规范字节、追加式链和签名的
`signing_key_transition_id` 连接密钥边界。生产目标使用每个环境和审计目的独立、不可导出的
受管 KMS/HSM 密钥；审计服务只有指定键的签名权，Security Custodian 与 Platform Operations
Owner 共同批准生命周期操作，且没有软件回退签名器。详见
[ADR-0014](adr/0014-audit-signer-custody.md)。默认生产签名构造仍拒绝，尚无生产 custody 或
KMS/HSM。

### 未来副作用

任何未来提供商调用、浏览器活动、业务写入、备份导出或恢复都必须由具体拥有模块显式
组合，使用最小输入、可观察结果和失败关闭控制。它们不能通过视觉回调、测试缝隙、本地
报告或通用 Host 表面获得权威。

## 外部资格边界

当前源码或本地检查不证明托管 PostgreSQL 18.6、原生秘密 custody、部署、提供商访问、
已签名或已公证应用、持久归档、独立审查、发行或 Gate closure。每项结论都需要与最终
构件和环境绑定的外部证据。
