# ADR-0014：服务器审计签名使用不可导出的受管 KMS/HSM 密钥

状态：Accepted production security design; no production signer is provisioned.

## 决策

每个生产环境的 `user_audit`、`staff_audit` 与 `service_audit` 目的各使用独立、不可导出的
受管 KMS/HSM 非对称签名密钥。KMS/HSM 必须支持当前审计签名 transcript 所需的算法和可验证
公钥；私钥不能导出到应用、CI、开发者工作站、配置、日志或数据库。

审计应用身份只可对其被分配的键执行签名，且只能接收已规范化的审计 transcript。它不能
创建、删除、导出或重新授权密钥，也不能把签名接口变成通用签名服务。Security Custodian
拥有密钥策略；Platform Operations Owner 负责运行环境。创建、轮换、禁用或紧急替换必须有
两者的可审计批准，且两项职责不得由同一运行时身份兼任。

轮换至少每年进行一次，并在疑似泄露、策略变化或算法不再适用时立即进行。新键开始签名
前必须按 M013 追加规范的 `audit_signing_key_transition` 记录，并以
`signing_key_transition_id` 保持审计链连续性。不存在软件私钥、测试键提升或其他回退签名器。

## 理由

审计签名需要可验证的独立密钥边界，但应用服务器不应拥有可复制的根秘密。不可导出的
KMS/HSM、最小签名权限和职责分离能把密钥泄露、部署误操作和单人权限滥用限制在可审计的
边界内。

## 当前实现

M013 已接入 Cloud 迁移目录，但默认生产签名构造仍拒绝。本 ADR 不声明 KMS/HSM、生产键、
批准、轮换、托管数据库或部署已经存在。
