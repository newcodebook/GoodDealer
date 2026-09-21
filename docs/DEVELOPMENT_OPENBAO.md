# GoodDealer 开发 OpenBao 运行手册

## 适用范围

本文件记录 GoodDealer 开发环境当前使用的单节点 OpenBao。它只用于 Cloud、Desktop 授权与审计
签名的开发和集成验证，不是生产集群、HA、HSM、生产 workload identity 或发行资格证据。

## 当前实例

- OpenBao `2.6.2` 运行在 `207.180.208.139`，systemd 服务名为 `openbao.service`。
- OpenBao API 仅监听服务器 `127.0.0.1:8200`，不开放公网端口；Cloud 在同机直接访问，开发者
  人工管理时必须使用 SSH 隧道。
- 存储是 `/opt/openbao/data` 的单节点 Raft；TLS 使用开发 CA，最低 TLS 版本为 1.2。
- 声明式 file audit device 写入 `/var/log/openbao/audit.json`，权限为 `0600`；logrotate 每日轮换、
  保留 14 份并在轮换后向 OpenBao 发送 `SIGHUP`。
- 服务器重启后保持 sealed，必须由持有本机恢复材料的开发运维人员手动 unseal。开发实例使用
  1 share / threshold 1；这便于当前开发，但不满足生产职责分离或高可用要求。

## 访问

保持以下隧道会话运行：

```sh
ssh -i "$HOME/documents/id_rsa" \
  -L 8200:127.0.0.1:8200 \
  root@207.180.208.139
```

另一个终端使用本机保存的开发 CA：

```sh
export BAO_ADDR=https://127.0.0.1:8200
export BAO_CACERT="$HOME/.config/gooddealer/openbao-dev/ca.crt"
bao status
```

不得设置 `BAO_SKIP_VERIFY`，也不得将 root token、unseal key 或 AppRole SecretID 写入仓库、普通
环境文件、命令参数、日志或错误信息。

## 恢复材料

本机目录 `$HOME/.config/gooddealer/openbao-dev` 权限为 `0700`，包含：

- `ca.crt` 与 `public-keys.json`：公开验证材料，权限 `0644`；
- `init.json`：root token 与 unseal key，权限 `0600`；
- `authority-approle.json`：开发 authority 的 AppRole RoleID/SecretID，权限 `0600`；
- `initial.snap`：初始化后的加密 Raft 快照，权限 `0600`。

VPS 不保留 `init.json`、unseal key 或 root token。开发 Cloud 运行所需的 AppRole RoleID/SecretID
保存在 `/etc/gooddealer/openbao/authority-approle.json`，文件由 `root:gooddealer` 持有且权限为
`0640`；systemd 服务以专用 `gooddealer` 用户读取。`init.json` 与 `initial.snap` 必须另行进入受控、
加密的开发备份；丢失 unseal key 将无法在重启后恢复实例，泄露它、快照或 VPS 上的 SecretID
都会破坏相应开发边界。AppRole SecretID 有效期为 7 天，到期前由 root 操作者重新签发并原子替换
VPS 与受控本机副本，然后重启 Cloud 服务验证。

服务重启后的 unseal 通过标准输入提交，避免把 key 放入进程参数：

```sh
jq -c '{key:.unseal_keys_b64[0]}' \
  "$HOME/.config/gooddealer/openbao-dev/init.json" |
curl --fail --silent --show-error \
  --cacert "$HOME/.config/gooddealer/openbao-dev/ca.crt" \
  --header 'Content-Type: application/json' \
  --data-binary @- \
  https://127.0.0.1:8200/v1/sys/unseal >/dev/null
```

## 密钥与最小权限

Transit mount 为 `transit`。五把不可导出、不可明文备份、不可删除的 Ed25519 v1 key 分别用于：

- `gooddealer-dev-desktop-authorization-grant`；
- `gooddealer-dev-active-device-lease`；
- `gooddealer-dev-user-audit`；
- `gooddealer-dev-staff-audit`；
- `gooddealer-dev-service-audit`。

`gooddealer-dev-authority` AppRole 只可签前两把授权 key；token TTL 为 15 分钟、最大 TTL 为 1 小时，
并绑定 `127.0.0.1/32`。登录响应的 policy 必须精确落在 `default` 与
`gooddealer-dev-authority` allowlist 内，出现任何额外 policy 时 Cloud 失败关闭。它不能读取、创建或轮换 key，也不能签三个 audit key。Cloud 仍须通过
`OpenBaoTransitSigner` 只使用 `public-keys.json` 为每个 purpose 明确选择的 active key/version 签名，
同时把该 purpose 的 1–8 把 verifier key 安装到 Cloud/Desktop 验签边界。轮换期 verifier 集合同时
保留旧/新 key，active 只指向新 key；旧 envelope 窗口结束后再从集合中撤旧。配置严格拒绝未知字段、
缺失 active 引用、重复 `(name, version)`、`kid` 或公钥材料，以及 Grant/Lease 共享 name、`kid` 或材料。
Transit 返回 401/403 时，Cloud 仅失效本次被拒绝的内存 token，重新执行一次 AppRole 登录并重试；
并发请求已取得的新 token 不会被旧请求清除。任何非成功响应体都会先取消，再重试或返回通用失败。

## 共享 Cloud 调用

共享 Cloud 的域名、Nginx、systemd、PostgreSQL、发布、回滚、状态检查和公网冒烟统一由
[共享 Cloud 开发环境运行手册](DEVELOPMENT_CLOUD.md)定义。本文件只拥有 OpenBao 管理和签名
边界；不得在这里维护第二份 Cloud 部署步骤。

## 本机启动授权开发闭环

保持 SSH 隧道运行后，从仓库根目录先以有限生命周期入口运行 migration，再启动只监听 loopback
的开发 Cloud。开发 CA 必须在 Node 进程启动时显式加入信任链；不得关闭 TLS 校验。常驻组合根只
读取 App URL；AppRole 凭据从受限文件按需读取，短期 token 只缓存在内存：

```sh
pnpm --filter @gooddealer/cloud migrate:development

NODE_EXTRA_CA_CERTS="$HOME/.config/gooddealer/openbao-dev/ca.crt" \
  pnpm --filter @gooddealer/cloud start:development
```

该服务把 `/v1/desktop-oauth/*` 与公开 Grant 路由组合在同一 loopback 端口。Desktop 仍要求
HTTPS Cloud origin；共享开发构建使用 `https://api.gooddealer.com`，纯本机端口则必须放在开发
反向代理或受认证 tunnel 后面，不能把 HTTP origin 编入 Desktop。账号激活 subject 未配置时失败
关闭；共享开发 Cloud 的 Stripe test-mode checkout 使用独立商业配置，不由 OpenBao 配置决定。

Desktop 构建所需的 registry 由同一份公开材料确定性生成。OpenBao Transit 原生返回的 32 字节
base64 公钥会在部署输入边界转换为 Ed25519 SPKI，再输出 Desktop 的 raw base64url 格式：

```json
{
  "schemaVersion": 1,
  "address": "https://127.0.0.1:8200",
  "transitMount": "transit",
  "grant": {
    "active": { "name": "gooddealer-dev-desktop-authorization-grant", "version": 2, "kid": "grant-v2" },
    "verifierKeys": [
      { "name": "gooddealer-dev-desktop-authorization-grant", "version": 1, "kid": "grant-v1", "publicKeyPem": "<Ed25519 public key>" },
      { "name": "gooddealer-dev-desktop-authorization-grant", "version": 2, "kid": "grant-v2", "publicKeyPem": "<Ed25519 public key>" }
    ]
  },
  "lease": {
    "active": { "name": "gooddealer-dev-active-device-lease", "version": 2, "kid": "lease-v2" },
    "verifierKeys": [
      { "name": "gooddealer-dev-active-device-lease", "version": 1, "kid": "lease-v1", "publicKeyPem": "<Ed25519 public key>" },
      { "name": "gooddealer-dev-active-device-lease", "version": 2, "kid": "lease-v2", "publicKeyPem": "<Ed25519 public key>" }
    ]
  }
}
```

同一 purpose 可用同一 Transit name 的不同 version；`active` 必须精确引用 `verifierKeys` 中一项。

```sh
pnpm --silent --filter @gooddealer/cloud desktop-registry
```

把该命令的单行 JSON 输出作为 `GOODDEALER_DESKTOP_AUTHORIZATION_KEYS_JSON` 构建变量；Desktop
固定使用 `https://api.gooddealer.com/`。两项都是编译期信任输入，不从运行时网络下载。

## 当前限制

该实例没有 HA、自动 unseal、HSM seal、第二审计设备、异地恢复演练或生产监控；PostgreSQL 和
Cloud 也只是单机开发部署。它满足当前开发集成所需的公网 HTTPS、真实 PostgreSQL migration、
Transit、TLS、AppRole、最小权限和审计观察，但不能原地升级为生产环境或用于客户发行。
