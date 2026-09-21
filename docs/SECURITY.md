# GoodDealer 安全模型

## 适用范围

本文件区分当前安全基础和已接受的未来安全要求。目标要求约束后续实现；它们不说明任何
产品路径现已启用。

## 当前安全基础

| 边界 | 当前事实 |
| --- | --- |
| Secure Host | 公开面包含 Desktop OAuth/授权验证和非秘密 Cloudflare 观察类型；不包含任何备份实现、依赖或桥接。Cloudflare Token、OAuth verifier/refresh token、Credential Fence、Provider wire 和加固 HTTPS Transport 保持私有。 |
| Desktop | Tauri 公开本地业务、备份和认证命令；备份命令只是有界 raw-wire → 单次 `spawn_blocking` → 脱敏结果的薄适配器，无路径、密钥、SQL、Provider 账号、OAuth URL、token 或 Cloud Repository 参数。 |
| Local data | SQLCipher 业务表和 secret-free Outbox 原子提交；Provider 账号及密封凭据只写本地且不生成 Mutation。 |
| Local backup | `gooddealer-local-storage` 的 `DesktopLocalHost` 独占严格 GDBK v1、Backup KEK、allowlisted projection、隔离 candidate、诚实业务恢复及严格 client/IPC 合同；完整 continuity/rebootstrap runtime/custody/database 协议仅在 `cfg(test)` 编译，私有开发 E2E 只证明该协议。生产只保留 fixed-resource residue absence gate，且 native picker/handle、真实 KEK、独立 non-rollbackable anchor、true create-only slot key、safe active-database move detection 和目标平台故障资格未完成，备份、continuity、rebootstrap 均为 `unavailable`。 |
| Browser | 自动化宿主报告不可用；没有浏览器会话、远程页面桥接或执行组合。 |
| Cloud | 公共边界含账号激活、Desktop Grant 与账号 billing 路由；另有隔离的 Identity、Desktop OAuth 和支付 webhook 入口。Identity 源码组合注册、邮箱验证、密码登录、真实 Account Web session 与加密邮件 outbox；生产邮件和公开注册仍未资格化。生产 PostgreSQL 组合从会话推导租户、设备与工作区并失败关闭。 |
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
- Desktop OAuth 授权码与 token 只以 SHA-256 摘要进入 Cloud 数据库；原始 access token 仅驻留
  Native 内存，原始 refresh token 仅进入目的隔离的系统凭据项。refresh 请求由 Native 预先持久化
  的 request ID 绑定；Cloud 以所呈现 refresh token 为 HMAC key，并绑定 token kind、request ID 与
  rotation generation，确定性恢复 outcome-unknown 请求的原 token pair 和过期时间而不持久化原始
  token。已轮换凭据只允许旧 token 加同一 request ID 重放；不同 request ID 视为 reuse 并撤销 token
  family。网络错误或 `temporarily_unavailable` 保留 Native refresh custody 与 pending request ID，只有
  确定的 `invalid_grant` 清除它们。Account Web Cookie 与 Desktop Bearer 客户端类型严格分离，混合
  凭证请求失败关闭。
- Account Web 明文密码只进入独立 Identity ingress 的有界解析和一次性可清零容器，不进入共享
  协议、日志、错误或持久化。邮箱验证码只保存带独立 server pepper 的 HMAC digest；durable email
  outbox 使用独立 AES-256-GCM key 加密收件人和正文。开发 SMTP 只允许 loopback Mailpit，生产
  transport 未资格化时保持拒绝。
- Desktop 设备 Ed25519 seed、Device ID 与 Key ID 使用独立 Keychain item。Cloud challenge 只持久化
  nonce digest 和 Account Web session digest，并把账户、设备、key、PKCE、固定 client/redirect、
  期限绑定进签名 transcript；首次 binding 仅接受五分钟内由密码/Passkey 创建的 Web 会话，且
  两段浏览器流程必须使用同一会话。challenge 验签/消费、首次 binding 与 OAuth code 写入位于
  同一账户事务。
- Desktop Grant/Lease 公钥是签名/notarized 构件内的严格 build-pinned allowlist；两个 purpose 均
  必须存在，未知或被移除的 `kid` 失败关闭。轮换先发布 old+new allowlist，再切 OpenBao key version。
- 未来秘密操作应使用完整目的与作用域绑定，并在资源边界前后复核相关授权状态。
- 备份必须使用受封闭的 Host 操作；当前不可用证据不能演化成秘密或恢复权威。

### 本地备份安全边界

- 只接受严格 `GDBK v1` 二进制容器。固定版本/suite、长度、frame 顺序和终止条件必须在解密或
  分配前有界验证；重复、缺失、重排、截断、篡改、尾随字节和未知兼容性全部失败关闭。解析、认证
  和 binding 错误统一为 `BACKUP_ARTIFACT_REJECTED`，不能泄露哪一项接近有效。
- Backup KEK 由 `gooddealer-local-storage` 的 `DesktopLocalHost` 以 `backup-wrap-v1` 用途隔离、安装级
  OS non-sync、ThisDeviceOnly 秘密保存。它独立于
  session/Lease/generation 的短期操作 fence；caller 不能选择或枚举 slot。slot 缺失/退役、ACL 漂移、
  registry rollback/version regression 或 key loss 返回 `BACKUP_KEY_UNAVAILABLE`，不猜测 fallback。回滚
  anchor 必须是独立持久机制；没有独立 anchor 的生产组合保持 unavailable。
- GDBK 只允许同一安装、账号和工作区。`active` 与 `verified_local_continuation` 可导出/
  检查；只有 `active` 可恢复。每次 durable publish 前重新验证 binding、可信时间、authorization 和
  generation，防止陈旧 lease、撤销或重放绕过门禁。
- Provider 凭据与账号/连接身份、数据库 key、OAuth/token/cookie/session、Lease/Grant/Ticket/
  ApprovedOperation、authority/entitlement 和 sync control/delivery 状态全部排除；
  `includePlatformCredentials=true` 始终返回 `BACKUP_CREDENTIALS_NOT_ALLOWED`。明文与临时/内容 key
  只留在 Host/local-storage 有界借用和 zeroizing buffer；磁盘临时快照始终为 SQLCipher 密文。
- Desktop Local Host 的目标 native composition 必须产生稳定 handle；所有者通过同一个 handle 拒绝 symlink/hard-link 异常、reparse、特殊
  文件、owner/mode/file-id/size 变化。导出协议使用 create-new、fsync、atomic no-clobber rename、目录 fsync
  和 `reserved -> writing -> fsynced -> renamed -> catalog_available` 两阶段日志。路径与 catalog
  metadata 都不是文件权威，外部工件每次重新准入。
- 导入只在隔离 candidate 中验证。最终恢复不把旧 SQLCipher 文件切换成 active pointer，也不抬高
  revision/cursor/epoch 等 floor；它在当前 active DB 中通过 exact CAS 创建新的 mutation、field version、
  tombstone、history 和 secret-free Outbox，并保留全部当前 authority/sync control 状态。冲突或并发编辑
  拒绝，receipt 使崩溃重放幂等。
- IPC 只允许版本、不透明 operation/dialog ID、脱敏 artifact identity、expected current revision、
  candidate set/version、确认值和 credentials boolean；路径、key、原始账号/工作区/设备 ID、明文、
  manifest、Provider/Cloud/OAuth/session/authority 字段和反射型 parser 诊断不得进入 Renderer、日志或错误。

详细合同见
[ADR-0023](adr/0023-installation-bound-gdbk-backup-and-honest-business-restore.md)。GDBK 没有口令、
跨设备或 Cloud 托管模式。源码与本地测试已覆盖严格格式、key/plaintext、binding/authority、
time/generation、isolated candidate、restore replay、redaction 和注入式 handle/journal 故障路径；
真实 native picker/stable-handle TOCTOU、安装级 KEK custody、独立 non-rollbackable continuity anchor、
true create-only rebootstrap slot custody、safe `SQLITE_FCNTL_HAS_MOVED`/custody VFS、durable filesystem 与
签名目标平台故障资格尚未完成。官方 `security-framework` 3.7.0 不提供满足全部属性的 safe
create-only slot API；普通 Keychain/upsert 不是单调或 create-only 证据。生产 rebootstrap 因而在任何
协议副作用前失败关闭。完整 runtime/custody/database 协议与内存 quarantine Host 只在 `cfg(test)`；
生产 plan facade 在读取 wire/locks 前返回同一 `Unavailable`。生产 startup 在 process/directory guard 后、
数据库/key 副作用前只检查固定 journal/candidate/sidecar/A-B slot 是否全部缺失，任何残留或检查不确定性
都终止构造，不解析、不修复、不清理，也不发布 live Host。retained-fd 身份/摘要检查不能阻止同
UID swap-and-swap-back 造成的 SQLite 副作用，因此备份、continuity 与 rebootstrap 都保持 `unavailable`。

### 审计

M013 是目录已接入的服务器审计基础。持久化种类仅为 `user`、`staff` 和 `service`；受限
Security 发射不创建额外持久化种类或链。审计通过规范字节、追加式链和签名的
`signing_key_transition_id` 连接密钥边界。生产目标使用每个环境和审计目的独立、不可导出的
自托管 OpenBao Transit key；审计服务只有指定键的签名权，Security Custodian 与 Platform Operations
Owner 共同批准生命周期操作，且没有软件回退签名器。详见
[ADR-0014](adr/0014-audit-signer-custody.md) 与
[ADR-0021](adr/0021-self-hosted-openbao-transit-signing.md)。默认生产签名构造仍拒绝，尚无生产
OpenBao cluster、key 或 workload identity。

### 未来副作用

任何提供商调用、浏览器活动、业务写入、备份导出或恢复都必须由具体拥有模块显式
组合，使用最小输入、可观察结果和失败关闭控制。它们不能通过视觉回调、测试缝隙、本地
报告或通用 Host 表面获得权威。

## 外部资格边界

当前源码或本地检查不证明托管 PostgreSQL 18.6、原生秘密 custody、GDBK/Backup KEK 平台行为、
部署、提供商访问、已签名或已公证应用、持久归档、独立审查、发行或 Gate closure。每项结论都需要
与最终构件和环境绑定的外部证据。
