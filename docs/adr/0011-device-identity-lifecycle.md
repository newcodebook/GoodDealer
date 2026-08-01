# ADR-0011：设备身份使用 Nonce、双 PoP 轮换与强类型签名 Envelope

状态：Accepted

日期：2026-08-01

## 背景

设备公钥、Key ID 和版本字段本身不能证明密钥由当前设备持有，也不能阻止被盗 Auth Session 替换公钥、Nonce 重放、并发轮换或旧 Token 被另一解析器接受。设备绑定、签名凭证和撤销后的迟到事实需要一套共同但严格域分离的协议。

## 决策

设备签名算法固定为 Ed25519。私钥由 Rust Secure Host 生成并保存在 OS Keychain/Credential Manager；普通 TypeScript、Cloud 和备份永不获得私钥。

首次绑定由 Cloud `devices` 模块在已重新认证的账号 Session 下签发一次性短期 Challenge。Challenge 绑定 `challenge_id/account_id/device_id/purpose/nonce/proposed_key_id/proposed_public_key_fingerprint/expected_key_version/expires_at/reauth_proof_id`。完成绑定必须提交新私钥对版本化、长度定界、域分离 Transcript 的 PoP；服务端原子消费 Challenge 并创建 `Bound(v1)`。

正常轮换先以当前版本 CAS 创建 Rotation Challenge，随后要求旧钥和新钥分别对同一 Transcript 提交 PoP。服务端在一个事务中消费 Challenge、把旧版本标记为 Rotated，并创建 `Bound(vN+1)`。旧钥不可用时进入独立 Recovery/Rebind 流程：要求账号重新认证，撤销旧设备 Session、Lease 与签名能力；不能伪装成普通轮换。

移除设备把绑定标记为 Removed、推进 Credential Epoch，并撤销该设备 Auth Session、OfflineDeviceLease、ActiveDeviceLease 与未消费 Challenge。设备自报时间不证明撤销前已发生；撤销后到达的执行事实必须同时验证预先签发且当时有效的操作授权、Key Version、Lease Epoch、可信时间界限和防重放标识，否则进入隔离区且不能恢复当前权限。

所有服务端签名凭证使用强类型 Envelope，至少包含 `typ/iss/aud/kid/schema_version/account_id/device_id/jti/issued_at/expires_at/payload/signature`。不同凭证使用独立签名 Key，或由不可混淆的 Key Purpose 做密码学域分离；解析器先固定期望 `typ + iss + aud + schema_version + key purpose`，再验签和解析 Payload。未知字段、未知版本、非规范编码和跨类型输入全部拒绝。

签名预映像不是普通 JSON 字符串。协议使用版本化、长度定界的确定性编码；Rust、Cloud 和 TypeScript 共享正负 Golden Corpus，但私钥签名和最终验证只能调用经过审查的密码学库，不能自行实现 Ed25519。

## 后果

- `protocol/devices` 拥有公开 DTO；Cloud `devices` 拥有 Challenge、绑定、版本 CAS 和撤销事实；Rust `device-identity` 拥有私钥、Transcript 与签名 Port。
- 同一账号的并发绑定/轮换必须由数据库唯一约束和事务验证，不能只靠进程锁。
- R0-06 在密码学 Golden Vector、Rust/Cloud 联合实现、并发 Fixture、Key 轮换/撤销和迟到事实矩阵完成前保持 `In Progress`。

## 不采用的方案

- 不把安装 ID、硬件指纹、Auth Session 或 Passkey 当作设备私钥 PoP。
- 不允许只凭新钥签名替换当前公钥。
- 不复用 Sunset Signing Key、Recipe Key 或日常 Auth/Lease Key。
