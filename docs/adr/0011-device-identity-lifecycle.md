# ADR-0011：设备身份使用 Nonce、双 PoP 轮换与强类型签名 Envelope

状态：Accepted

日期：2026-08-01

修订：2026-08-03（Lifetime Entitlement 与 Active 移除隔离）

## 背景

设备公钥、Key ID 和版本字段本身不能证明密钥由当前设备持有，也不能阻止被盗 Auth Session 替换公钥、Nonce 重放、并发轮换或旧 Token 被另一解析器接受。设备绑定、签名凭证和撤销后的迟到事实需要一套共同但严格域分离的协议。

## 决策

设备签名算法固定为 Ed25519。私钥由 Rust Secure Host 生成并保存在 OS Keychain/Credential Manager；普通 TypeScript、Cloud 和备份永不获得私钥。

首次绑定由 Cloud `devices` 模块在已重新认证的账号 Session 下签发一次性短期 Challenge。Challenge 绑定 `schema_version/algorithm=Ed25519/challenge_id/account_id/device_id/purpose/nonce/proposed_key_id/proposed_public_key_fingerprint/expected_key_version/expires_at/reauth_proof_id`。完成绑定必须提交新私钥对版本化、长度定界、域分离 Transcript 的 PoP；服务端原子消费 Challenge 并创建 `Bound(v1)`。V1 Transcript 域固定 `GOODDEALER-DEVICE-IDENTITY-V1\0`，其后按 `schemaVersion/algorithm/purpose/challengeId/accountId/deviceId/nonce/proposedKeyId/proposedPublicKeyFingerprint/expectedKeyVersion/expiresAt/reauthProofId` 顺序，以每字段 `uint32_be(UTF-8 byte length) + UTF-8 bytes` 编码；schemaVersion 与 expectedKeyVersion 使用规范无符号十进制字符串。不得以 V1 domain 或“当前只支持 Ed25519”为由省略 Wire 中的 schemaVersion/algorithm。

正常轮换先以当前版本 CAS 创建 Rotation Challenge，随后要求旧钥和新钥分别对同一 Transcript 提交 PoP。服务端在一个事务中消费 Challenge、把旧版本标记为 Rotated，并创建 `Bound(vN+1)`。旧钥不可用时进入独立 Recovery/Rebind 流程：要求账号重新认证，撤销旧设备 Session、Lease 与签名能力；不能伪装成普通轮换。

移除设备把绑定标记为 Removed、推进 Credential Epoch，并立即撤销该设备在线 Auth Session、Cloud Scope、OfflineDeviceLease/ActiveDeviceLease 的后续续签与未消费 Challenge。若移除的是当前 Active，服务端保存旧 `offline_execute_until` 为账号级 `exclusive_execution_block_until`：设备名额可以立即释放，新设备可以完成绑定并进入 Cloud Read-Only View，但在该截止前不得向任何其他设备签发平台执行权。Credential Epoch 只能即时阻断服务端能力，不能宣称可以撤回离线设备已经持有的外部平台访问。

设备自报时间不证明撤销前已发生；撤销后到达的 ExecutionFact 与 DeviceAuditEvent 必须验证域分离签名、Key ID/Version、Credential/Lease Epoch、可信时间锚点、单调增量和各自防重放序列。设备已经 Removed 时，Secure Host 只能从独立、追加式 evidence-spool 的 `RemovedEvidenceSpool` 窄读口读取两类已持久化、脱敏的原始签名 Envelope：Cloud `removed_at` 前形成的记录；以及 `removed_at` 后、本机尚未确认撤销、可信 `request_start_boundary/occurred_at` 不晚于原 `offline_execute_until` 且原 Lease/批准仍有效的记录。它们按以下专用协议提交 evidence-only Ingest；该入口不授予 Session、Scope、业务库查询、Mutation/Proposal 或平台能力。

Cloud 在移除事务创建服务端签名 `RemovedDeviceTombstone`：`tombstone_id/schema_version/account_id/device_id/removed_at/offline_execute_until/credential_epoch_before/credential_epoch_after/allowed_evidence_kinds/old_signing_keys[{key_id,key_version,public_key_fingerprint}]/issued_at/signature`。无 Session 的公开窄 Route 先以 `account_id + device_id` 固定定位当前 Tombstone ID（不得枚举其他账号/设备），再取得一次性 `RemovedEvidenceChallenge`：`challenge_id/tombstone_id/tombstone_digest/account_id/device_id/key_id/key_version/purpose=removed_evidence_ingest/removal_observed_anchor_id/removal_observed_monotonic_delta_ms/nonce/batch_digest/stream_ranges/issued_at/expires_at/jti`。客户端提交 Tombstone、Challenge、原始签名 Envelope 批次及旧私钥对 `GOODDEALER-REMOVED-EVIDENCE-POP-V1` 长度定界 Transcript 的实时 PoP；Transcript 规范覆盖带实际 Cloud 签名的完整 Challenge，因此同时绑定 Tombstone digest、batch digest 和 stream ranges，历史 Envelope 签名不能替代该实时 PoP。

上述名称是领域语义名；`protocol/devices` 的唯一 JSON Wire 使用 strict lowerCamelCase，并冻结为两个独立服务端签名类型。Tombstone 顶层固定 `schemaVersion/typ=gd.removed-device-tombstone.v1/iss=https://accounts.gooddealer.com/aud=gooddealer-device/removed-evidence/kid/keyPurpose=gooddealer.devices.removed-tombstone.v1/tombstoneId/accountId/deviceId/removedAt/offlineExecuteUntil/credentialEpochBefore/credentialEpochAfter/allowedEvidenceKinds/oldSigningKeys[{keyId,keyVersion,publicKeyFingerprint}]/issuedAt/signature`；非 Active 设备没有旧离线窗口时 `offlineExecuteUntil=null`。Challenge 顶层固定 `schemaVersion/typ=gd.removed-evidence-challenge.v1/iss=https://accounts.gooddealer.com/aud=gooddealer-device/removed-evidence/kid/keyPurpose=gooddealer.devices.removed-evidence-challenge.v1/challengeId/tombstoneId/tombstoneDigest/accountId/deviceId/keyId/keyVersion/purpose=removed_evidence_ingest/removalObservedAnchorId/removalObservedMonotonicDeltaMs/nonce/batchDigest/streamRanges/issuedAt/expiresAt/jti/signature`。Tombstone 与 Challenge 的服务端签名 Transcript 分别为 `GOODDEALER-REMOVED-DEVICE-TOMBSTONE-V1` 和 `GOODDEALER-REMOVED-EVIDENCE-CHALLENGE-V1`，覆盖除 signature 外按 Schema 固定顺序排列的完整字段，以版本化长度定界编码签名，不签普通 JSON 字符串。

PoP 使用的 `tombstoneDigest` 唯一算法为 `SHA-256("GOODDEALER-REMOVED-DEVICE-TOMBSTONE-DIGEST-V1" || uint32_be(canonical_signed_tombstone_length) || canonical_signed_tombstone_bytes)`。`canonical_signed_tombstone_bytes` 是上述 Tombstone 服务端签名 Transcript 的完整 bytes，再追加 `uint32_be(signature_utf8_length) || signature_utf8_bytes`；因此它绑定 strict Schema 全字段及实际签名，不依赖 JSON 属性顺序、空白或调用方重新序列化。任何 Tombstone 字段、数组顺序、签名或非规范编码变化都会得到不同 digest；Challenge 的 `tombstoneDigest` 与客户端重算值必须是同一 32-byte digest 的 base64url 无 padding 编码。

`streamRanges` 是按下述规范键严格升序、无重复的数组：`{streamKind: execution_fact | workspace_device_audit | account_device_audit, workspaceId: string | null, leaseEpoch: safe-integer | null, credentialEpoch: safe-integer, firstSequence, lastSequence, count}`；execution/workspace audit 要求 workspaceId 与 leaseEpoch，account audit 两者必须为 null。一个批次只能使用同一 `keyId + keyVersion`，包含其他历史 Key 的记录必须拆成另一 Challenge/PoP 批次。批内 Envelope 按 `(streamKind, workspaceId-or-empty, leaseEpoch-or-0, credentialEpoch, sequence, envelopeId)` 升序；Range 必须精确覆盖批内记录且 `count` 匹配，不能声明空洞或批外序号。`batchDigest = SHA-256("GOODDEALER-REMOVED-EVIDENCE-BATCH-V1" || count_u32_be || repeated(uint32_be(canonical_envelope_length) || canonical_envelope_bytes))`，canonical Envelope 是设备最初签名的 Wire bytes，排除 Cloud 元数据。`canonical_signed_challenge_bytes` 是 Challenge 服务端签名 Transcript 的完整 bytes，再追加 `uint32_be(signature_utf8_length) || signature_utf8_bytes`。PoP Transcript 唯一编码固定为 `GOODDEALER-REMOVED-EVIDENCE-POP-V1 || uint32_be(canonical_signed_challenge_length) || canonical_signed_challenge_bytes`；因此 PoP 覆盖 Challenge 的 `schemaVersion/typ/iss/aud/kid/keyPurpose`、`tombstoneId/tombstoneDigest/purpose`、账号/设备/Key、锚点、Nonce、batch digest、规范 stream ranges、时效/JTI 及实际 Cloud 签名，不再维护另一份可能漏字段的选择性列表。任何 Tombstone、Challenge 签名、排序、Range、Key Version 或摘要不一致都在逐记录 Ingest 前失败关闭。

Host 准备恢复 Cloud 连接时先进入对账屏障，停止新平台请求，让已提交请求完成或隔离为 `outcome_unknown` 并持久化对应 Envelope，再查询撤销状态。首次验证 Tombstone 时，Host 原子持久化 `removal_observed_anchor_id + removal_observed_monotonic_delta_ms`，停止 Worker/Sequencer、关闭业务库，并把旧私钥状态转为 `removed_evidence_pop_only`；此后只允许签 `GOODDEALER-REMOVED-EVIDENCE-POP-V1`，禁止新签普通 Fact/Audit/Lease/ApprovedOperation 或业务授权。

服务端在一个事务中验证 Tombstone 签名与当前 Removed 状态、Key ID/Version、Challenge purpose/到期/JTI/Nonce、removal-observed anchor、规范 batch digest/stream ranges、PoP、批次大小/速率，以及每条原始 Envelope 的签名、Credential/Lease Epoch、可信时间和序列。记录必须满足 `removed_at` 前已形成，或同时满足 `removed_at` 后、本机 removal-observed 前、`request_start_boundary/occurred_at <= offline_execute_until` 且原 Lease/批准有效；本机确认撤销后新签的普通记录全部拒绝或隔离。Challenge 单次消费；`(tombstone_id,batch_digest)` 和每个 Envelope ID/digest 幂等，相同 ID 不同内容、跨 Tombstone/设备/Key 重放均失败关闭。ExecutionFact 额外验证当时有效的 ApprovedOperation/Plan 授权摘要；DeviceAuditEvent 按事件类型验证账号、设备、操作或安全授权上下文，不能一律伪造 Operation 授权。`protocol/devices` 拥有 Tombstone/Challenge/PoP Wire 与 Golden Corpus，Cloud `devices` 拥有 Challenge/Tombstone/一次消费，execution-ledger/audit 拥有逐 Envelope 裁决。全部 eligible 记录取得不可变接收/隔离回执并满足本地审计保留条件后，Host 才原子擦除 Spool 记录、Spool Key 和旧私钥；任一 Key 缺失均失败关闭，不得降级为无 PoP 上传。失败记录不能恢复当前权限；User/Staff/Service AuditEvent 使用独立服务端链。

除永久离线 Sunset Credential 外，账号作用域的服务端签名在线凭证使用强类型 JSON Wire Envelope，至少包含 `typ/iss/aud/kid/schemaVersion/accountId/deviceId/accountSecurityEpoch/jti/issuedAt/expiresAt/payload/signature`。领域文档和内部模型使用 snake_case 语义名，`protocol/devices` Codec 显式一对一映射到 lowerCamelCase Wire；签名 canonical bytes 与 strict unknown-field 校验只接受 Wire 名，禁止同时接受两种大小写。Sunset Credential 使用无账号/设备/Epoch/JTI/到期字段的独立永久 Envelope。不同凭证使用独立签名 Key，或由不可混淆的 Key Purpose 做密码学域分离；解析器先固定期望 `typ + iss + aud + schemaVersion + key purpose`，再验签和解析 Payload。未知字段、未知版本、非规范编码、账号 Security Epoch 回退和跨类型输入全部拒绝，日常与 Sunset 解析器必须双向拒绝。

签名预映像不是普通 JSON 字符串。协议使用版本化、长度定界的确定性编码；Rust、Cloud 和 TypeScript 共享正负 Golden Corpus，但私钥签名和最终验证只能调用经过审查的密码学库，不能自行实现 Ed25519。

## 后果

- `protocol/devices` 拥有公开 DTO；Cloud `devices` 拥有 Challenge、绑定、版本 CAS 和撤销事实；Rust `device-identity` 拥有私钥、Transcript 与签名 Port。
- 同一账号的并发绑定/轮换必须由数据库唯一约束和事务验证，不能只靠进程锁。
- R0-06 在密码学 Golden Vector、Rust/Cloud 联合实现、并发 Fixture、Key 轮换/撤销和迟到事实矩阵完成前保持 `In Progress`。

## 不采用的方案

- 不把安装 ID、硬件指纹、Auth Session 或 Passkey 当作设备私钥 PoP。
- 不允许只凭新钥签名替换当前公钥。
- 不复用 Sunset Signing Key、Recipe Key 或日常 Auth/Lease Key。
