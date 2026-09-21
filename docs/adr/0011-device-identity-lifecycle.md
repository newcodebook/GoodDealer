# ADR-0011：设备身份使用服务端 challenge、Native Ed25519 持钥证明与原子绑定

状态：Accepted and composed for Desktop OAuth login and first binding.

## 决策

设备身份、绑定、轮换和撤销必须由服务器端事实、明确目的的密码学和严格 wire 契约
共同约束。客户端自报身份、安装标识或普通会话不能替代持有证明、范围校验、并发控制或
撤销语义。

## 当前实现

macOS Native 在独立 Keychain item 中保存稳定 Device ID、Key ID 与 Ed25519 seed。系统浏览器
完成 Account Web 会话验证后，Cloud 创建两分钟、账户范围、数据库只存 nonce digest 的一次性
challenge。签名 transcript 同时绑定 account/device/key/challenge、PKCE challenge、固定 client、
固定 redirect、nonce digest 与 expiry。Cloud 在同一账户事务中锁定并验证 challenge、当前
Security Epoch 与活动公钥；验签成功后原子消费 challenge 并写入 OAuth authorization code。

首次安装没有 binding 时，同一 challenge 保存 proposed public key 和发起授权的 Account Web
session digest。只有该 Web 会话由五分钟内的密码或 Passkey 认证创建，且第二段浏览器授权仍使用
同一会话，才允许继续；challenge 期限取两分钟与剩余重新认证窗口中的较短值。Native 自签成功且
账户仍有设备槽位时，事务创建 `device_bindings` 与 version 1 active `device_signing_keys`；已移除
设备、Web 会话替换、公钥替换、错误签名、过期、重放或槽位耗尽全部失败关闭。code exchange 前
再次检查 binding 与 active key，防止 challenge 与换 token 之间发生撤销。

Grant/Lease 私钥仍由 Cloud 的自托管 OpenBao Transit 托管；Desktop 只携带 build-pinned、分目的
Ed25519 公钥 allowlist，并在 Bearer Grant 拉取后完成外层 Grant 与内层 Lease 双重验签。生产
OpenBao 集群、workload identity、seal/HSM 和实际 key version 仍需要部署资格证据。

## 后果

设备 key rotation 与 recovery 继续使用既有 `device_identity_challenges` 设计面，落地时必须要求
旧钥或恢复流程证明并原子推进 key version；不得把普通 OAuth session 当作轮换证明。生产发布
必须先发布同时包含旧/新 Grant 与 Lease 公钥的签名/notarized Desktop，再切换 OpenBao signing
version，最后通过后续发布按撤销策略移除旧 `kid`。
