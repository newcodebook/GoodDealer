# GoodDealer 域名所有权验证工作流

状态：Draft
更新日期：2026-08-03

## 1. 目标与边界

Verification 负责把“取得平台挑战 → 找到权威 DNS/注册商 → 安全写入 → 等待传播 → 触发平台验证 → 确认结果 → 保留或清理”编排为可恢复 Workflow。

模块边界：

- `client-core/verification` 拥有 VerificationAttempt、状态机、策略和 DAG 编排，不直接产生外部副作用。
- `client-core/dns` 拥有 DnsAuthoritySnapshot、RRset 读取/写入计划和传播证据。
- `client-core/registration` 独占 Nameserver Delegation 变更。
- `client-core/operations` 拥有 Operation、Attempt、ApprovedOperation、资源锁和执行结果。
- `client-core/browser-automation` 拥有 BrowserSessionConsent/Grant；automation-host 只凭 AutomationExecutionTicket 执行动作。
- Connector 负责平台/DNS 能力适配和证据要求，不拥有工作流状态。

TXT Challenge 与 NS Delegation Challenge 不得共用写入实现。TXT 调用 DNS 能力；NS 调用 Registration 高风险流程，并与同域名 DNS 写入互斥。

## 2. VerificationAttempt

```text
VerificationAttempt
  attempt_id
  domain_asset_id
  marketplace_connection_id
  method: txt | nameserver | manual
  challenge_ref                 # 仅设备本地 opaque ref
  challenge_fingerprint
  dns_binding_id | registrar_binding_id
  dns_authority_snapshot_id
  required_evidence_level
  retention_policy
  operation_id
  status
  acquired_at
  expires_at
```

权威状态：

```text
acquiring_challenge
  -> waiting_user_login
  -> ready_to_plan
  -> waiting_approval
  -> writing_dns | changing_nameserver | manual_action_required
  -> waiting_dns
  -> ready_to_verify
  -> verifying
  -> waiting_remote
  -> verified

任意非终态 -> expired | cancelled | outcome_unknown | manual_action_required
任意持有设备本地挑战引用的非终态 -> requires_challenge_reacquisition
requires_challenge_reacquisition -> acquiring_challenge
verified -> cleanup_pending | retained
```

规则：

- 挑战过期后禁止继续触发平台验证；旧记录清理是新的、可预览 Operation。
- 取消 `waiting_dns` 只停止后续节点，不自动删除已写记录。
- `outcome_unknown` 只允许确认，不能重复最终提交。
- 清理与验证不是同一个原子事务；平台要求长期保留时进入 `retained`。

## 3. 获取挑战与浏览器授权

优先使用 Verification API。没有 API 时：

1. 用户授予 BrowserSessionConsent，在隔离窗口自行登录；Consent 不需要 Operation Plan，也没有业务自动化权限。
2. 首版软件只提供页面步骤提示并检查 Origin/登录状态；用户把页面显示的挑战复制到 Secure Host 输入通道。BrowserSessionConsent 不授权 Probe 读取挑战内容。
3. 原始值写入 Rust Host-owned challenge vault/OS 安全存储并返回 `challenge_ref`；普通 TypeScript、Active Workspace 和 Cloud 只使用指纹/脱敏预览。原始值不得进入普通 verification 表、Mutation、ExecutionFact、Audit Payload、日志、Crash 或 BackupExportSchema。
4. 触发 Verify 等业务动作必须在计划获批后另建 BrowserAutomationGrant，并由 Secure Host 签发 AutomationExecutionTicket。未来若自动读取挑战，也必须先形成绑定 VerificationAttempt、允许字段和 Recipe Hash 的可审阅动作计划，不得扩大 BrowserSessionConsent 权限。

密码、2FA、CAPTCHA、Cookie、原始挑战值和 Browser Profile 永不上传 Cloud。

## 4. 权威 DNS 发现

`client-core/dns` 创建：

```text
DnsAuthoritySnapshot
  snapshot_id
  domain_asset_id
  zone_apex
  delegated_nameservers[]
  dnssec_status
  candidate_dns_bindings[]
  selected_dns_binding_id
  confidence: exact | inferred | ambiguous | none
  evidence[]
  observed_at
```

发现流程：

1. 查询父区当前 NS 委派和 DNSSEC 状态。
2. 计算 Zone Apex，匹配已连接 ProviderConnection 中实际可见的 Zone。
3. 保存匹配证据、时间和置信度。
4. `exact` 才可自动进入计划；`ambiguous/none` 必须由用户选择正确连接、建立新连接或转人工。

副作用前重新读取委派。委派、Zone、ProviderConnection 或 DNSSEC 前置条件变化时只使受影响域名 `needs_replan`，不作废无关计划项。

## 5. TXT/RRset 安全写入

Connector 必须声明：

```text
DnsWriteSemantics
  granularity: record | rrset
  supports_conditional_write
  remote_version_kind: etag | revision | hash | none
```

Planner 保存：

```text
RecordSetPrecondition
  fqdn
  type
  normalized_values[]
  normalized_rrset_hash
  remote_version
  ttl
  observed_at
```

执行规则：

- 写入前重新读取目标 RRset；Hash/远端版本不一致则进入冲突并重新规划。
- `record` API 只新增目标值；`rrset` API 必须把现有值与目标值合并后整体提交。
- 不允许覆盖或删除同名 SPF、DKIM、DMARC 或其他 TXT 值。
- 写入后重新读取，必须确认目标值存在且原有值没有丢失。
- Connector 无条件写且无法安全表达并发前置条件时，降低为人工流程或要求最终前再次确认。

## 6. DNS 传播证据

```text
PropagationEvidence
  attempt_id
  authoritative_results[]
  recursive_results[]
  queried_at
  ttl
  negative_ttl
  dnssec_result
  quorum_policy
  status
```

- 先查询当前权威 NS，再查询产品约定的多个递归解析器；单个本机缓存命中不算传播完成。
- 权威结果已更新而递归仍旧时保持 `waiting_dns`，按 TTL/负缓存退避。
- `NXDOMAIN`、`NODATA`、`SERVFAIL`、DNSSEC 验证失败和挑战过期是不同状态，不能统一成“未传播”。
- 传播完成条件由连接器策略声明，并在 UI 显示各来源证据和读取时间。

## 7. 验证结果与证据等级

```text
VerificationEvidence
  evidence_id
  verification_attempt_id
  workflow_node_id
  source: api | authoritative_dns | recursive_dns | page | artifact | user
  evidence_level
  observed_at
  remote_ref
  artifact_ref
  payload_redacted
```

- automation-host 的 Observation 不能直接把 Attempt 标为 `verified`。
- API、官方结果报告或重新加载后的官方结果页达到 Connector 声明的证据等级后，才可完成。
- 无机器通道时允许 USER_CONFIRMED，但审计和 UI 必须明确其证据等级。
- Cloud 只同步脱敏证据摘要、等级、时间和远端引用；完整允许证据保留本地。

## 8. 秘密 Sync Projection

原始 Challenge 使用 opaque `challenge_ref`，不得进入通用 Workspace Entity DTO、Active Workspace 业务列或备份投影；只有 Rust Host-owned vault 可以解析该引用。

Cloud `workspace/state/verification` 与 DNS 投影只能包含：

- 域名、记录名称/类型、脱敏预览、稳定 fingerprint。
- VerificationAttempt 的非秘密状态、时间和证据等级。
- DnsAuthoritySnapshot 的非秘密委派/Binding 摘要。
- Operation 的脱敏状态与 ExecutionFact；旧 Epoch 事实通过服务端裁决后显示 LateExecutionEvent 分类。

Outbox 必须通过显式 Sync Projection Schema 构造，禁止先序列化本地实体再“清洗”。通用 DNS 读取重新读到挑战值时，仍按 Verification 关联执行字段级秘密分类。

## 9. 设备切换与恢复

- Grant、AutomationExecutionTicket、Browser Session、Cookie 和原始挑战不迁移。
- 新 Active 没有 `challenge_ref` 时，Attempt 进入 `requires_challenge_reacquisition`，不得恢复旧执行队列。
- 重新取得挑战后比较 fingerprint；一致仍需重新检查委派/RRset 并生成新计划，不一致则旧 Attempt 过期。
- 旧 Epoch 已发生的 DNS/平台执行结果始终走 ExecutionFact Ingest，服务端验证通过后增加 LateExecutionEvent 分类；旧批准、Ticket 和未开始动作不可复用。

## 10. 验收要求

- Cloudflare TXT Happy Path 保留同名 TXT，并以权威+递归证据完成 Atom/Afternic 验证。
- 委派 NS 与已连接 Zone 不一致或无法唯一匹配时零写入。
- 写入前 RRset 外部变化时进入 `needs_replan`，不覆盖远端。
- 敏感挑战值不出现在 Mutation、Cloud DB、日志、Crash Report 或 Staff 诊断包。
- NS Challenge 使用 Registration 高风险批准和资源锁，不复用普通 TXT 路径。
- 挑战传播期间过期时不触发 Verify；旧记录清理另建 Operation。
- 设备切换后旧 Grant、批准、Ticket、Profile 和挑战引用不可复用。
- 页面最终点击后崩溃只进入确认路径，不重复提交。

## 11. 开源 DNS 验证参考

完整来源和许可证见 [OPEN_SOURCE_REFERENCES.md](OPEN_SOURCE_REFERENCES.md)。

- [go-acme/lego](https://github.com/go-acme/lego) 的 Spaceship DNS Provider 可迁移 Zone 发现、TXT Present/Cleanup、传播超时与 Fixture；必须改为 GoodDealer Secure Host 凭据路径，并保留同名 TXT。
- [libdns](https://github.com/libdns/libdns) 的增量 Record Port 比整区同步更接近本文件 RRset 安全模型，可作为 DnsReader/DnsWriter 接口参考。
- [ExternalDNS](https://github.com/kubernetes-sigs/external-dns) 可借鉴 Desired → Plan → Provider、dry-run、所有权标记和 Fake Provider 测试；不得为借用其模型而擅自写入额外所有权 TXT。
- [DNSControl](https://github.com/DNSControl/dnscontrol) 只借鉴 IR、Preview 和 Provider 测试矩阵。其整区声明可能删除未声明记录，禁止直接用于验证 TXT 写入。

上述项目都不提供 GoodDealer 的 DnsAuthoritySnapshot、RRset Hash、委派匹配、VerificationAttempt、秘密 Projection、ApprovedOperation 或证据等级。上游 `Present/Cleanup` 成功只能证明请求执行，不能把 Attempt 标记为 `verified`。
