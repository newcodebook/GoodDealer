# GoodDealer 共享 Cloud 开发环境运行手册

## 适用范围

本文件是共享 GoodDealer Cloud 开发部署的事实源，供开发者和开发 agent 查询环境拓扑、运行边界、
安全检查、发布约束和故障定位。它描述的是授权集成开发环境，不是生产、预发布、客户发行或 Gate
资格。OpenBao 的密钥、seal/unseal、AppRole 和恢复操作由[开发 OpenBao 运行手册](DEVELOPMENT_OPENBAO.md)
拥有；本机 PostgreSQL 与 `.env.local` 由[本地开发环境](LOCAL_ENVIRONMENT.md)拥有。

任何 agent 在操作 VPS 前都必须获得当前用户对该次远程变更的明确授权。只读状态检查不能被解释为
修改、发布、重建数据库、轮换凭据或变更 Cloudflare 的授权。

## 当前共享拓扑

```text
Desktop / developer
  -> https://api.gooddealer.com or https://account.gooddealer.com
  -> Cloudflare orange-cloud proxy
  -> per-host Nginx + Let's Encrypt sites on 207.180.208.139
  -> GoodDealer Cloud on 127.0.0.1:3100
       -> PostgreSQL 18 on 127.0.0.1:55433
       -> OpenBao TLS on 127.0.0.1:8200
       -> Mailpit SMTP/API on 127.0.0.1:1025/8025
  -> self-hosted Provider worker (systemd, 5-second bounded drain)
```

| 资源 | 当前事实 |
| --- | --- |
| 公网 origin | `https://api.gooddealer.com`；Cloudflare 橙云开启。 |
| VPS | `207.180.208.139`；同机还运行其他业务，禁止覆盖全局 Nginx、Docker 或防火墙配置。 |
| Cloud 服务 | `gooddealer-cloud-development.service`；专用 `gooddealer` 用户；只监听 `127.0.0.1:3100`。 |
| Account Web | `https://account.gooddealer.com`；静态文件位于 `/var/www/account.gooddealer.com`，同源 `/v1/*` 与 `/billing/approval/*` 代理到 Cloud。当前 release 以 staging 组合部署注册、Resend 验证邮件、密码登录、session discovery、恢复和服务端退出；真实无数据库权限测试用户已走通完整旅程。 |
| Provider worker | `gooddealer-provider-worker-development.service`；专用 Unix/数据库身份；每 5 秒有界 drain provider operation、receipt、reconciliation、due-authority 与 release 作业。 |
| 开发邮件 | `gooddealer-mailpit-development.service`；无持久数据库，SMTP/API 分别只监听 `127.0.0.1:1025` 与 `127.0.0.1:8025`，不经 Nginx 或 Cloudflare 暴露。 |
| Migration 服务 | `gooddealer-cloud-development-migrate.service`；专用 `gooddealer-migrator` 用户；按发布运行的 oneshot，常态为 `inactive`。 |
| Cloud 发布目录 | `/opt/gooddealer-development/releases/<release-id>`；`/opt/gooddealer-development/current` 指向当前版本。 |
| Node/pnpm | Node `26.12.1`、pnpm `12.16.1`，必须与仓库 `package.json` 的 `packageManager` 和 `engines` 一致；当前 release 已使用这组精确工具链安装依赖并构建。 |
| PostgreSQL | `gooddealer-postgres-development` 容器；PostgreSQL `18.4`；只映射 `127.0.0.1:55433`。该版本低于仓库锁定的 18.6 资格版本，只是开发运行事实。 |
| 数据库 | `gooddealer_development`；migrator `gooddealer_cloud_owner` 与普通 App、Account API、Identity capability issuer、Provider ingress、Provider worker 五个 runtime 登录角色相互隔离。当前 ledger 为 25 条有序 migration，包含 account recovery、commercial entitlement snapshot 和 default-workspace capability policy；五池与对应 grant 已核验。 |
| PostgreSQL 持久卷 | `gooddealer-postgres-development-data`；禁止因测试、发布或排障重建。 |
| Nginx 站点 | `/etc/nginx/conf.d/api.gooddealer.com.conf`；只拥有该域名，不得修改其他站点。 |
| Account Nginx 站点 | `/etc/nginx/conf.d/account.gooddealer.com.conf`；Cloudflare origin lock、HSTS、CSP 与 `no-store` 已启用。 |
| TLS | `/etc/letsencrypt/live/api.gooddealer.com/`；Certbot 自动续期。 |
| OpenBao | `openbao.service`；仅 `127.0.0.1:8200`，不经过 Nginx、不开放公网域名。 |

Cloud 当前使用 [`apps/cloud/src/entrypoints/development-server.ts`](../apps/cloud/src/entrypoints/development-server.ts)
作为现有 API 组合根。它把 Identity、Desktop OAuth 与公共 Cloud route 放在同一端口，并要求普通 App、Account
API、Identity capability issuer、Provider ingress、Provider worker 五个相互隔离的 runtime pool。独立的
[`development-migrate.ts`](../apps/cloud/src/entrypoints/development-migrate.ts) 由 oneshot 服务以
`gooddealer-migrator` 身份和 Owner URL 应用迁移；Owner 凭据不进入常驻 Cloud 进程。仓库当前
greenfield catalog 当前有 25 项：M001–M017、M019 后接 M020，再依次包含
`202609140001-sync-v2-ledger`、`202609150001-workspace-checkpoint-v2` 和
`202609150002-cloudflare-dns-observation`、`202609210001-account-recovery`、
`202609220001-commercial-entitlement-snapshot` 和
`202609220002-account-default-workspace-capability-policy`。M015 已是规范化商业 baseline，不存在 M018 compatibility
migration；M019 前必须由角色管理员运行受控 role provisioning，M020 增加 Account access challenge
与加密邮件 outbox；后续 migration 分别增加密码恢复、challenge-bound outbox、Session 撤销、商业权威读取 façade
和默认个人工作区 capability policy。当前 staging 数据库已通过正常 migrator 应用完整 catalog；不得通过修改 ledger
或 checksum alias 绕过漂移检查。
开发组合根已装配独立 Identity ingress、Argon2id 账号访问服务、loopback Mailpit outbox worker，以及
Stripe 官方 SDK 的 test-mode catalog、Checkout、webhook 和退款 adapter；PayPal 保持失败关闭。
同一 API 组合根只有在 `GOODDEALER_DEPLOYMENT_ENV=staging`、
`GOODDEALER_EMAIL_PROVIDER=resend`、`GOODDEALER_RESEND_API_KEY` 由 secret custody 注入、
`GOODDEALER_IDENTITY_FROM_EMAIL` 为已验证 Resend 发件地址且 `GOODDEALER_ACCOUNT_ORIGIN` 为精确 HTTPS
origin 时才允许 Resend；任何缺失都会在启动时失败关闭。API key 不进入仓库、普通环境示例、日志或数据库。
独立的 self-hosted Provider worker 执行持久化作业，不依赖第三方 scheduler 服务。

Nginx 443 只接受 Cloudflare 官方代理网段的连接，且以连接对端地址判定来源；直接访问源站或伪造
`CF-Connecting-IP` 均返回 `403`。通过可信 Cloudflare 对端后，Nginx 重建真实客户端地址、覆盖
`X-Forwarded-For`，并执行每客户端边缘限流；Fastify 只信任同机 loopback Nginx 这一跳。

## 配置和秘密边界

VPS 上的配置位置只用于定位和权限审查，不能把内容输出到终端、对话、日志或工单：

| 文件 | 允许内容 | 权限 |
| --- | --- | --- |
| `/etc/gooddealer/cloud-runtime.env` | App、Account API、Identity issuer、Provider ingress、Provider worker 五个独立 PostgreSQL URL；Identity verification pepper、outbox key、独立 browser namespace HMAC key 和独立 Workspace sync cursor/confirmation HMAC key；以及非秘密文件定位和 loopback host/port。禁止 Owner URL，禁止五个 runtime 身份共用凭据；四个 key 必须分别为独立 32-byte base64url 值。 | `root:gooddealer 0640` |
| `/etc/gooddealer/cloud-migration.env` | 仅 Owner PostgreSQL URL；禁止 App URL 和运行时配置。 | `root:gooddealer-migrator 0640` |
| `/etc/gooddealer/provider-worker/development.env` | 仅 Provider worker 所需 PostgreSQL URL、Provider 配置定位和有界 drain 设置。 | `root:gooddealer-provider 0640` |
| `/etc/gooddealer/commercial/development.json` | Stripe test-mode API/webhook secrets 与 catalog ID；PayPal 未配置。 | `root:gooddealer-provider 0640` |
| `/etc/gooddealer/postgres.env` | PostgreSQL 容器管理凭据。 | `root:root 0600` |
| `/etc/gooddealer/openbao/authority-approle.json` | 开发 AppRole RoleID/SecretID。 | `root:gooddealer 0640` |
| `/etc/gooddealer/openbao/public-keys.json` | OpenBao 地址、每 purpose 的 active key/version 与 1–8 把重叠 verifier key。 | `root:gooddealer 0640` |
| `/etc/gooddealer/openbao/ca.crt` | 开发 CA。 | `root:gooddealer 0640` |

禁止执行会回显环境或秘密的命令，包括无过滤的 `systemctl show`、`docker inspect`、`env`、`printenv`、
`cat /etc/gooddealer/*`、`set -x` 或携带连接串/Token 的命令参数。诊断日志必须在输出前对
`postgresql://`、`token`、`secret`、`password`、`role_id` 和 `secret_id` 做脱敏。VPS 不保存 OpenBao
root token、unseal key 或 `init.json`。

仓库根 `.env.local` 只属于当前 checkout 的本机 PostgreSQL profile，不能复制到 VPS，也不能用 VPS
连接串覆盖它。共享 VPS 凭据同样不能下载到 `.env.local`、仓库或普通 agent 临时文件。

## 安全的只读状态检查

以下检查不读取秘密内容，可用于开始工作前确认环境仍与本手册一致：

```sh
systemctl is-active gooddealer-cloud-development gooddealer-provider-worker-development \
  gooddealer-mailpit-development openbao nginx docker
systemctl show gooddealer-cloud-development-migrate.service --property=ActiveState,Result
systemctl is-enabled gooddealer-cloud-development
docker ps --filter name=^/gooddealer-postgres-development$ \
  --format '{{.Names}} {{.Status}} {{.Ports}}'
ss -lnt | grep -E '127\.0\.0\.1:(1025|8025|3100|55433|8200)'
nginx -t
openssl x509 \
  -in /etc/letsencrypt/live/api.gooddealer.com/fullchain.pem \
  -noout -subject -issuer -dates
```

预期结果是六个常驻服务均为 `active`，migrator 为 `inactive` 且最近 `Result=success`，Cloud 服务为
`enabled`，PostgreSQL 为 `healthy`，Cloud、PostgreSQL、OpenBao 和 Mailpit 的五个端口都只绑定
loopback，Nginx 配置测试成功，证书 SAN/有效期覆盖
`api.gooddealer.com` 与 `account.gooddealer.com`。Nginx 现有其他站点
可能产生 `_` default server 冲突警告；只要 `nginx -t` 成功且 `api.gooddealer.com` 精确 server block
存在，该遗留警告不是修改其他站点的授权。

数据库结构检查必须从容器内以管理身份执行，只输出非秘密事实：

```sh
docker exec gooddealer-postgres-development \
  psql -X -At -U postgres -d gooddealer_development \
  -c 'SELECT count(*) FROM gooddealer_cloud_migrations'
```

当前共享 staging 数据库从空库应用证据覆盖完整 25 条 migration，并核验 Identity
capability roles、五个 runtime 登录与 façade grants。仓库当前 M015 SQL 的预期 checksum 是
`dc59e2bf2d2b83e1f91fe3aa5ae88caf47533727a600ab8e4f879a89338ae11e`，M019 的预期 checksum 是
`5d623459d97102796a8798de744191028a91bd12e2bcea5dc2fc8eb066b6e4b9`，其 closed purpose allowlist 包含
`refund_request`。当前源码 catalog 应有 25 个条目：M001–M017、M019、M020、上述三个同步/观察
migration、`202609210001-account-recovery`、`202609220001-commercial-entitlement-snapshot` 和
`202609220002-account-default-workspace-capability-policy`。每次部署必须先只读核验完整有序 ledger；缺失项只能通过受限 migrator 正常应用，不能直接改 ledger。应用后还需对商业表/约束/index/policy/function/grant、M019
roles/memberships、同步 v2 ledger/checkpoint/Cloudflare observation schema 与五个 runtime 登录身份
取得不含业务行和秘密的结构快照。

当前 M015 不提供 legacy purchase-ledger 到规范化聚合的 compatibility migration；M018 也不存在。
因此任何共享数据库若已应用不同 checksum 的旧 M015，都必须停止普通 migration/deployment，并由
具名数据处置决议选择受控重建或显式迁移方案。不得添加 checksum alias、`IF NOT EXISTS` 绕过、
改写 ledger、猜测表存在即兼容，或直接在共享数据上运行 greenfield M015/M019。M019 前还必须由
PostgreSQL 角色管理员审查并运行
`apps/cloud/scripts/provision-identity-capability-roles.sql`；migration 自身不会创建或弱化角色。

### PostgreSQL 18.6 非破坏升级门禁

共享 PostgreSQL 18.4 不属于仓库的 PostgreSQL 18.6 资格证据。升级必须由 Platform Operations
Owner 明确授权，并满足以下门禁；普通代码发布不得隐式执行版本升级：

1. 记录当前容器 image digest、`server_version`、extension 版本、完整 migration ledger 和无业务值的
   schema fingerprint；任何无法解释的漂移都先停止。
2. 对现有 volume 建立可恢复、受限且有保留期的快照/备份，并在隔离副本上完成恢复演练；不得以
   空库、重建共享 volume 或只记录“备份成功”代替恢复观察。
3. 在隔离副本上使用固定 digest 的 PostgreSQL 18.6，先验证启动和 schema/ledger 不变，再运行完整
   `pnpm test:postgres`、迁移前缀/幂等检查和授权负向测试。测试不得连接共享数据库。
4. 维护窗口内停止 Cloud 与 migrator 写入，确认无活动客户端并再次取得备份和 ledger 摘要；随后
   仅替换获批容器版本并复用原 volume。不得删除 volume、ledger、表或 RLS policy。
5. 重新开放流量前确认 18.6、容器健康、完整 ledger/checksum、schema fingerprint、角色
   `NOSUPERUSER NOBYPASSRLS`、loopback 监听、失败关闭冒烟和 OpenBao 冒烟。任一项失败即保持服务
   关闭，并从升级前快照执行已演练的恢复方案；不能用降级二进制直接打开已升级数据目录冒险回滚。

## 公网失败关闭冒烟

这些请求不需要账号或秘密，验证 Cloudflare、TLS、Nginx 和 Cloud 路由已经连通：

```sh
curl --silent --show-error --output /dev/null --write-out '%{http_code}\n' \
  https://api.gooddealer.com/

curl --silent --show-error --output /dev/null --write-out '%{http_code}\n' \
  --header 'Content-Type: application/x-www-form-urlencoded' \
  --data 'bad=body' \
  https://api.gooddealer.com/v1/desktop-oauth/token

curl --silent --show-error --output /dev/null --write-out '%{http_code}\n' \
  --header 'Content-Type: application/json' \
  --data '{}' \
  https://api.gooddealer.com/v1/devices/authorization-grant
```

当前预期依次为 `401`、`400`、`401`。这些状态是失败关闭证据，不是故障。不能在共享环境中创建
伪造 session、device binding、Entitlement 或 refresh token 来制造 `200`。共享开发环境另以一次性
staging 测试账号完成注册 `202`、Resend 实际投递、验证 `200`、host-only Secure/HttpOnly/SameSite=Lax
Cookie、session `200`、刷新后的 session discovery `200` 和退出后的旧 session `401`；这组 staging 冒烟不授权
生产邮件、公开客户注册或 live 商业声明。完整 Desktop OAuth/Grant 正向验收仍需受控身份和真实设备流程。

源站封闭必须另外验证，强制把域名解析到源站 IP 后预期 `403`；带伪造
`CF-Connecting-IP` 的同类请求也必须是 `403`。Cloudflare 官方 CIDR 变化时必须从官方端点更新
`geo` 与 `set_real_ip_from` 两份完全一致的清单，经 `nginx -t` 和上述负向探针验证后才能 reload。

OpenBao 正向冒烟必须验证 AppRole 登录、Lease/Grant 两把 Transit key、固定版本和 Cloud 本地
Ed25519 复验，同时只输出布尔结果。不得直接输出短期 token、签名、SecretID 或完整 OpenBao wire。
探针实现和轮换要求见[开发 OpenBao 运行手册](DEVELOPMENT_OPENBAO.md)。

## 发布和回滚约束

共享 VPS 目前是人工发布，没有仓库内可重复部署脚本。Agent 不得把下列规则自行解释为发布授权：

1. 发布前使用仓库锁定的 Node `26.12.1` 运行根 `pnpm check`，并确认 `git diff --check` 通过。
2. 先只读检查目标 release id、Cloud 端口、systemd unit 和 `current` 链接；目标必须不存在。
3. 复制到新的 `/opt/gooddealer-development/releases/<release-id>`，明确排除 `.git`、`.env*`、
   `.specability`、`node_modules`、`target`、本机恢复材料和所有秘密。
4. 在新目录按 `pnpm-lock.yaml` 安装依赖，使用锁定 Node/pnpm 运行 Cloud typecheck、Desktop registry
   生成检查和 Account Web build；不得在线升级依赖版本。
5. 只在新版本验证通过后原子切换 `current`，运行并确认
   `gooddealer-cloud-development-migrate.service` 成功；失败时在重启 Cloud 前回退链接并停止发布。
6. Migration 成功后重启 `gooddealer-cloud-development.service` 和
   `gooddealer-provider-worker-development.service`，再以受限权限安装 Account Web 静态构件。确认服务 active、端口仍为
   loopback、migration catalog 一致，并以 `/proc/<pid>/environ` 的布尔检查证明存在 App URL 且
   不存在 Owner URL，再执行
   公网失败关闭与 OpenBao 正向冒烟。
7. 不得就地修改当前 release、覆盖 `/etc/nginx/nginx.conf`、删除其他 Nginx 站点、复用其他容器端口、
   清理未知 Docker 资源或把 OpenBao `8200` 暴露公网。

代码回滚只能把 `current` 原子指回已验证的前一 release 并重启服务。数据库 migration 是前向且带
checksum 的；只有确认旧代码与当前 schema 兼容时才能回滚代码。禁止通过删除表、migration ledger
或 PostgreSQL volume 回滚。若 schema 不兼容，停止并制定具名恢复方案。

## Desktop 开发构建输入

共享环境的 Desktop 构建固定使用：

```text
https://api.gooddealer.com/（Desktop 固定 origin）
GOODDEALER_DESKTOP_AUTHORIZATION_KEYS_JSON=<由公开 OpenBao 材料生成的单行 registry JSON>
```

registry 必须通过以下命令从 `public-keys.json` 确定性生成，不能从运行时网络下载，也不能手写或
从 OpenBao 同一签名响应中取得：

```sh
pnpm --silent --filter @gooddealer/cloud desktop-registry
```

两项都是 Desktop 编译期信任输入。构建日志不得输出完整 registry；验证时只检查 schema version、
两个独立 purpose、每个 purpose 至少一把 key、全局唯一 `kid` 与 Ed25519 公钥。轮换构建必须先从
同时含旧/新 verifier key 的配置生成 registry 并发布 Desktop，再切换对应 purpose 的 `active` 引用；
旧 envelope 窗口结束后才从 Cloud verifier 和后续 Desktop registry 中撤旧。

## 常见故障定位

| 现象 | 检查顺序 | 禁止操作 |
| --- | --- | --- |
| Cloudflare `410` | 确认精确 Nginx server block、证书和 loopback Cloud；`410` 通常表示请求落入默认站点。 | 不覆盖全局 default server。 |
| `502` / 连接拒绝 | 检查 Cloud systemd 状态、journal 脱敏摘要、`127.0.0.1:3100` 和 PostgreSQL health。 | 不把 Cloud 改为 `0.0.0.0`。 |
| Cloud 重启循环 | 先检查锁定 Node 路径、release 中 `apps/cloud/node_modules/tsx`、独立 migrator 最近结果和 OpenBao seal 状态。 | 不打印 EnvironmentFile、把 Owner URL 放回 runtime unit 或跳过 migration。 |
| Transit 签名失败 | 检查 OpenBao active/unsealed、AppRole SecretID 是否过期、开发 CA 和固定 key version。 | 不使用 root token 运行 Cloud，不关闭 TLS 校验。 |
| TLS/Cloudflare 错误 | 检查源站证书有效期、`nginx -t`、Certbot renewal 和域名 server block。 | 不修改 Cloudflare SSL 模式或 DNS，除非用户另行授权。 |
| migration 数量/摘要漂移 | 对比 `apps/cloud/src/db/migrations.ts` 和数据库 ledger，停止发布。 | 不编辑 ledger、不强行标记 migration 已应用。 |

## 当前限制

- 单 VPS、单 PostgreSQL 容器、单节点 OpenBao；没有 HA、自动 unseal、HSM seal、异地恢复演练或
  生产监控/告警。
- AppRole SecretID 是七天有效的开发例外，需要受控人工轮换；生产必须改为 OpenBao Agent 或平台
  workload identity。
- 已用 Cloudflare 官方 IP allowlist 封闭 443 源站，但尚未启用 Authenticated Origin Pulls，且网段
  更新仍依赖人工维护；该开发源站不能被称为生产网络边界。
- staging 注册/验证/登录页面和已验证 Resend transactional-email Provider 已部署，但没有生产邮件、
  反滥用容量或公开客户注册资格；也没有任何 live-mode 商户、税务/销售地区资格、退款生产资格、
  完整客户管理网页或受控数据导出流程。Stripe test-mode Checkout、webhook 与由 Account Web 发起、
  Cloud worker 执行的首购退款仅是开发集成证据。
- macOS 签名、公证与官方渠道发行保持延期；该环境不能证明 Desktop 客户构件可发行。

这些限制不得通过 README 文案、测试夹具、手工数据库行或临时 Nginx/Cloudflare 规则绕过。
