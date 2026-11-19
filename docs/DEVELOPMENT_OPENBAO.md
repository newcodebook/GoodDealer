# GoodDealer 开发 OpenBao 运行手册

## 适用范围

本文件拥有开发 OpenBao 的管理、签名与恢复边界。共享 Cloud 的发布和数据库由
[共享 Cloud 开发环境运行手册](DEVELOPMENT_CLOUD.md)拥有。这里的实测是开发集成证据，
不代表生产 HA、HSM、目标设备旅程或 Desktop 发行资格。

## 当前实例与保留实例

2026-11-19，用户授权恢复遗失的开发管理密钥后，新建隔离的 OpenBao v2，未覆盖旧 Raft、
快照、服务或公开验证材料。当前 Cloud 已切换到 v2；旧实例的 AppRole 登录实测被拒绝，
不能把旧实例仍处于 unsealed 状态当作恢复能力。

| 项目 | 当前 v2 | 保留旧实例 |
| --- | --- | --- |
| OpenBao | `2.6.2`，`openbao-dev-v2.service` | `openbao.service` |
| Unix 用户 | `openbao-dev-v2` | 原服务用户保持 |
| API / cluster | `127.0.0.1:8220` / `127.0.0.1:8221` | `127.0.0.1:8200` / `127.0.0.1:8201` |
| Raft | `/opt/openbao-dev-v2/data`，`0700` | `/opt/openbao/data` 保留 |
| 配置与 TLS | `/etc/openbao-dev-v2/` | `/opt/openbao/` 保留 |
| file audit | `/var/log/openbao-dev-v2/audit.json`，`0600` | 原审计文件保留 |
| Cloud 配置 | `/etc/gooddealer/openbao-dev-v2/` | `/etc/gooddealer/openbao/` 保留 |

两套实例只监听 loopback，不经 Nginx、不开放公网。v2 复用仍有效的开发 CA/服务器证书，
私钥仅在服务器受控目录复制，TLS 校验始终开启。v2 使用单节点 Raft、1 share / threshold 1；
重启后须由持有恢复材料的操作者手动 unseal。旧实例不能替代 v2 的当前签名用途。

## 访问与恢复材料

当前管理入口是 `root@207.180.208.139`，本机 SSH 身份文件是 `/home/sean/.ssh/id_rsa`。
需要人工 API 管理时建立 `8220:127.0.0.1:8220` 的 SSH 隧道，使用
`BAO_ADDR=https://127.0.0.1:8220` 与受控目录中的 `ca.crt`。不得设置 `BAO_SKIP_VERIFY`。
这些路径用于定位，不是打印文件内容的授权。

本机 `/home/sean/.config/gooddealer/openbao-dev-v2` 为 `0700`；以下文件均为 `0600`：

- `init.json`：v2 root token 与 unseal material；当前响应字段为 `keys_base64`，不要套用旧字段名。
- `initial.snap`：完成五用途与 AppRole 配置后的加密 Raft 快照。
- `ca.crt`、`public-keys.json`、`desktop-registry.json`：公开验证材料。

初始化响应和快照经 SSH 直接流入该目录的独占、拒绝符号链接文件，文件及目录均 fsync 后发布；
没有写入仓库、普通临时文件或工具输出。VPS 不保存 root token、unseal key 或 `init.json`。
快照检查覆盖受限 tar 成员、长度和 SHA256SUMS；没有执行恢复演练，不能据此宣称灾难恢复已验证。
恢复材料的另一份受控加密备份和异地恢复演练仍待完成。

运行时 RoleID/SecretID 仅在 VPS `/etc/gooddealer/openbao-dev-v2/authority-approle.json`，
由 `root:gooddealer` 持有、权限 `0640`；没有下载到本机。SecretID 有效期七天，必须在到期前
通过受控管理流程重新签发、原子替换并验证 Cloud。不要把 root token 放入环境变量、命令参数、
日志或 Cloud 配置。unseal 或签发 SecretID 时从受控文件经 stdin 直接送到验证 TLS 的固定 API；
不得回显响应、重定向到普通临时文件或在聊天中传递材料。

## 五种用途与最小权限

v2 `transit` mount 中的五把 Ed25519 key 均为 version 1、不可导出、不可明文备份、不可删除、
非 derived。每种用途独立 name、kid 与材料：

| Purpose | Transit name | 当前 kid |
| --- | --- | --- |
| Active Grant | `gooddealer-dev-v2-desktop-authorization-grant` | `gooddealer-dev-v2-grant-v1` |
| Lease | `gooddealer-dev-v2-active-device-lease` | `gooddealer-dev-v2-lease-v1` |
| Standby Grant | `gooddealer-dev-v2-desktop-standby-grant` | `gooddealer-dev-v2-standby-v1` |
| Execution Context | `gooddealer-dev-v2-desktop-execution-context` | `gooddealer-dev-v2-context-v1` |
| Bootstrap Capability | `gooddealer-dev-v2-bootstrap-capability` | `gooddealer-dev-v2-bootstrap-v1` |

`gooddealer-dev-authority-v2` policy 只有上述五个 `transit/sign/<name>` 的 `update` 权限。
AppRole 的 token TTL 为 900 秒、最大 3600 秒，SecretID 与 token 都限定 `127.0.0.1/32`。
Cloud 只接受 `default` 与该 policy；实际 workload 的 key 管理、rotate、export 与 policy 管理
capability 均实测为 deny。运行时短期 token 只在 `OpenBaoAppRoleTokenSource` 内存中缓存。

`public-keys.json` 严格包含 schemaVersion、address、transitMount，以及 grant/lease/standby/context/
bootstrap 五个 keyring。每个 keyring 的 active 精确引用 verifierKeys 中的一项。当前 verifier
数量依次为 2/2/1/1/1：旧 Grant 与 Lease 的验证对象逐字段保留，当前签名只用 v2。
跨用途共享 name、kid、公钥或未知字段均被源码拒绝。保留旧验证公钥不恢复旧签名能力。

2026-11-19 在新 release 中，以受限 `gooddealer` 进程运行真实 `OpenBaoTransitSigner`、
`OpenBaoAppRoleTokenSource` 和生产 keyring parser：五用途签名成功，二十次错用途公钥验签全部
拒绝。探针使用公开历史协议 fixture claims，没有签发当前账户授权，也不替代真实登录、
Standby 交接、引导、强制接管或业务执行的正向验收。

Transit 401/403 只失效被拒绝的内存 token，重新登录并重试一次；旧请求不能清除并发新 token。
响应错误只产生通用失败，不输出 OpenBao wire、SecretID、签名或 token。

## Desktop 公开 registry 与本机开发

当前公开 registry 位于本机受控目录的 `desktop-registry.json`，SHA256 为：

```text
1eabbd28707953d3d36f3f183e8602aa6c41f47c94bae430a07680918e027223
```

从同一份公开 keyring 本机生成两次，并以 VPS 已部署 runtime 配置和 `gooddealer` 进程再生成，
哈希一致。源码边界把 OpenBao raw base64 公钥转换为 Ed25519 SPKI，再生成 Desktop raw base64url。
生成入口仍为 `pnpm --silent --filter @gooddealer/cloud desktop-registry`；该命令必须明确选择
`GOODDEALER_OPENBAO_PUBLIC_KEYS_FILE`，不依赖可能指向旧实例的默认路径。输出直接写入受控文件，
构建日志只记录摘要，不打印完整 registry。

Desktop 构建输入为 `GOODDEALER_DESKTOP_AUTHORIZATION_KEYS_JSON` 与固定 HTTPS origin
`https://api.gooddealer.com/`。registry 的五个 wire purpose 是 `grant_v3`、`active_device_lease_v1`、
`standby_grant_v1`、`execution_context_v1`、`bootstrap_capability_v1`；Active Grant envelope 当前为 v4，
registry 中既有 purpose 名称不据此改写。Desktop 不从运行时网络下载信任根。

仅启动 Desktop 不需要 OpenBao AppRole 或服务器秘密。本机 Cloud 使用本机 PostgreSQL profile 和
独立受控凭据；不得把 VPS runtime 凭据下载到 `.env.local`。使用隧道调用开发 OpenBao 时，Node
启动前必须用 `NODE_EXTRA_CA_CERTS` 指定受控 CA，并配置独立授权的 AppRole 来源。旧两用途配置
或默认旧路径不能作为五用途配置的兼容方案。

后续轮换先生成同时包含旧/新 verifier 的 registry 并发布相应 Desktop，再切换 Cloud active。
历史签名仍需验证时保留旧 verifier。此 v2 是用户授权的开发环境恢复；旧构建不认识新签名 key，
使用当前环境必须重新构建并采用上述公开 registry，不能关闭验签。

## 当前限制

单 VPS、单节点、手动 unseal、七天 SecretID 均为开发运行约束；没有 HA、HSM seal、异地恢复演练、
生产监控或第二审计设备。新实例的长期 audit 轮换与告警尚待配置验证。实际 Transit 签名已经取证，
真实账号设备旅程、业务授权、Windows/macOS 平台资格和发行资格仍分别取证。
