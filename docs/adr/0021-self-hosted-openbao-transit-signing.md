# ADR-0021：生产签名 KMS 使用自托管 OpenBao Transit

状态：Accepted production security design; local adapter and isolated development instance exist,
but no production OpenBao cluster or key is provisioned.

## 决策

GoodDealer 生产签名 KMS 统一使用自托管 OpenBao Transit。生产、预发布和开发分别使用隔离的
OpenBao 实例或严格隔离的 namespace、工作负载身份、策略、密钥和审计目标；OpenBao 不与普通
Cloud 应用共享进程、管理员身份或持久化凭据。

`DesktopAuthorizationGrantV3`、`ActiveDeviceLeaseV1`、`user_audit`、`staff_audit` 与
`service_audit` 分别使用独立的 Ed25519 Transit key 和只允许对应 `transit/sign/<key>` 的策略。
业务工作负载不得创建、读取私钥、导出、备份、删除、配置或轮换 key；key 必须保持
`exportable=false`、`allow_plaintext_backup=false`、`deletion_allowed=false` 且不启用派生签名。

Cloud 只向固定 HTTPS origin 提交规范 transcript、固定 key name 和显式 key version。OpenBao
返回的 `vault:vN:` 必须与请求版本一致，签名必须由 Cloud 使用独立发布、部署时固定的 Ed25519
公钥立即复验；OpenBao 同一响应或同一工作负载令牌不得替换该信任锚。应用 receipt 只记录
OpenBao request id、purpose、key/version/kid 和 transcript/签名摘要，不记录 token、SecretID、
原始认证响应或其他秘密。

生产 Cloud 通过 OpenBao Agent 或平台 workload identity 获得短期、最小权限 token。静态 root token、
仓库或数据库中的 token、生产应用持有的长期 AppRole SecretID，以及在失败日志或错误中输出 token
均被禁止。网络只允许到固定私有 TLS 入口，禁止重定向，并对连接、响应大小和调用时长设界。

轮换先创建新 key version，独立取得并批准新公钥与 `kid`，把旧/新验证材料随应用配置发布，
再切换显式签名版本；旧公钥只保留到已签发 envelope 和审计验证窗口结束。轮换、撤销、备份
恢复、seal/unseal、OpenBao audit device、HA 故障和灾难恢复必须在生产启用前演练。

OpenBao Transit 是软件 KMS 边界，不自动等价于硬件 HSM。若风险或合规要求硬件不可导出根
保护，OpenBao 的 seal/root custody 必须接入获批的 HSM；无 HSM 的环境不得宣称 HSM 保证。

## 理由

统一 OpenBao 能让私钥始终留在独立签名控制面，同时保留自托管、目的分钥、策略、审计和轮换
能力。显式版本和独立公钥复验避免把 OpenBao API 响应本身当作最终信任根；短期 workload
identity 避免把长期 KMS 凭据变成普通应用秘密。

## 当前实现

Cloud 已有窄 OpenBao Transit adapter，覆盖 Grant/Lease 的 key name、`kid` 与 Ed25519 key material
分离、固定版本、HTTPS、显式 token policy allowlist、短期 token source、有界响应、非成功响应取消、
通用失败错误、receipt 和本地 Ed25519 复验，并有 provider-wire 负向测试。部署公开配置为每个
purpose 保存 1–8 把 verifier key，并以 `(name, version, kid)` 明确选择唯一 active signer；轮换期
Cloud Lease verifier 与 Desktop registry 同时保留旧/新 key，signer 只使用 active key。
隔离的开发 VPS 已运行 OpenBao 2.6.2 单节点 Raft、开发 TLS、声明式 file audit、五把目的分离的
Ed25519 v1 key 和只可签 Grant/Lease 的 15 分钟 AppRole token；公开验证材料与恢复材料保存在
仓库外的受限开发目录。详细运行边界见[开发 OpenBao 运行手册](../DEVELOPMENT_OPENBAO.md)。

开发组合根已通过 `api.gooddealer.com` 的 Cloudflare/Nginx HTTPS 入口部署在同一开发 VPS；Cloud、
PostgreSQL 与 OpenBao 分别只监听 loopback。Cloud 从 `root:gooddealer 0640` 文件按需读取七天有效的
AppRole RoleID/SecretID，只把换得的 15 分钟 token 缓存在内存，并在提前量到达后重新登录。该开发
例外不适用于生产部署；生产仍必须替换为 Agent 或平台 workload identity，不能把 SecretID 文件
随应用发布。

仓库当前没有 production composition root。Audit 默认签名构造仍为 Denying；Grant/Lease 的
production signer 尚未配置或资格化，不能表述为生产正在使用某个 Denying Grant signer。已部署的
开发组合根只完成真实 PostgreSQL migration、AppRole、Grant/Lease Transit 签名和本地公钥复验。
开发实例没有 HA、HSM/auto-unseal、生产 workload identity、生产 key、公钥批准记录、轮换/恢复
演练或独立资格，因此本 ADR 不声明 production custody 已完成。
