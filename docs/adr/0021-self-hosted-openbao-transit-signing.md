# ADR-0021：OpenBao 签名托管、用途隔离与轮换

状态：Accepted

## 签名边界

GoodDealer 生产签名 KMS 统一使用自托管 OpenBao Transit。生产、预发布和开发分别使用隔离的
OpenBao 实例或严格隔离的 namespace、工作负载身份、策略、密钥和审计目标；OpenBao 不与普通
Cloud 应用共享进程、管理员身份或持久化凭据。

`DesktopAuthorizationGrantV3`、`ActiveDeviceLeaseV1`、`DesktopStandbyGrantV1`、`user_audit`、`staff_audit` 与
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

## 审计职责与密钥轮换

审计应用身份只可对其被分配的键执行签名，且只能接收已规范化的审计 transcript。它不能
创建、删除、导出或重新授权密钥，也不能把签名接口变成通用签名服务。Security Custodian
拥有密钥策略；Platform Operations Owner 负责运行环境。创建、轮换、禁用或紧急替换必须有
两者的可审计批准，且两项职责不得由同一运行时身份兼任。

轮换至少每年进行一次，并在疑似泄露、策略变化或算法不再适用时立即进行。新键开始签名
前必须按 M013 追加规范的 `audit_signing_key_transition` 记录，并以
`signing_key_transition_id` 保持审计链连续性。不存在软件私钥、测试键提升或其他回退签名器。

Desktop 的 Grant、Lease 与 Standby Grant 使用互不通用的 build-pinned 公钥 allowlist。先发布包含旧、新验证材料
的签名与公证 Desktop，再切换签名版本，最后按撤销策略移除旧 `kid`。开发配置与操作记录见
[OpenBao 运行手册](../DEVELOPMENT_OPENBAO.md)，不作为生产授权。
