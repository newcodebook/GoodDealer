# 本地开发环境

## 配置事实源

仓库根目录的 `.env.local` 是当前 checkout 的本地环境唯一事实源。它保存本机开发凭据和
资源定位，不进入 Git；`.env.example` 只定义变量名称、URL 形态和默认资源名称，不保存可用
口令。在 Unix/macOS 上该文件及其安全链接的目标必须为当前用户所有且权限为 `0600`；Windows
必须使用只允许当前用户读取的等价 ACL。测试命令显式加载根目录文件，调用者已经提供的环境
变量优先，因此 CI 和独立验证环境不会被本地配置覆盖。

该事实源只适用于本机 profile，不拥有共享 VPS。`api.gooddealer.com`、远程 systemd/Nginx、
PostgreSQL 容器和远程秘密边界见[共享 Cloud 开发环境运行手册](DEVELOPMENT_CLOUD.md)。不得把
远程连接串或 AppRole 凭据复制进 `.env.local`，也不得用本机测试命令重建共享数据库。

任何需要数据库的本地命令都应复用这些具名连接，不得在脚本、文档、对话或临时命令中另造
默认数据库、角色或连接串：

- `GOODDEALER_POSTGRES_OWNER_URL`：迁移、受控测试夹具和维护验证使用的非超级用户 Owner
  连接串；它不是 Cloud 生产应用连接串，也不是 Desktop 数据库。
- `GOODDEALER_POSTGRES_APP_URL`：启用最小权限和租户 RLS 的 Cloud 应用角色连接串。
  该角色不依赖数据库 `TEMP` 权限；加固环境撤销 `TEMP` 时，持久化测试会验证拒绝，未撤销时则验证
  `pg_temp` 同名表不能劫持显式限定的生产查询。
- `GOODDEALER_POSTGRES_ACCOUNT_API_URL`：`gd_account_api` 的账号业务事务池；只能消费 Identity
  签发并绑定目标 PID/XID、nonce、purpose 和 session 的一次性 capability。
- `GOODDEALER_POSTGRES_IDENTITY_ISSUER_URL`：`gd_identity_capability_issuer` 的独立签发池；只能调用
  Identity capability issuer，不能取得账号业务表权限。
- `GOODDEALER_POSTGRES_PROVIDER_INGRESS_URL`：`gd_provider_ingress` 的全局 Provider webhook receipt
  写入池；只能提交验签后的 account-blind receipt，不能选择账号或执行 reconciliation。
- `GOODDEALER_POSTGRES_PROVIDER_WORKER_URL`：`gd_provider_worker` 的后台工作池；只能领取数据库签发的
  targetless/bound work lease，并以 lease token 完成精确 Provider operation、reconciliation、due 或 release 工作。

Desktop 运行数据库是由 Host 管理的本地 SQLCipher Active Workspace。它不使用上述变量，
也不允许把第三方账号、Provider Account ID、凭据绑定、密钥或 Token 写入 Cloud PostgreSQL。

## 默认本机资源

默认开发 profile 固定使用：

| 资源 | 固定名称 |
| --- | --- |
| PostgreSQL database | `gooddealer_test` |
| Migration/fixture role | `gooddealer_cloud_owner` |
| Runtime/RLS role | `gooddealer_cloud_app` |
| Account API role | `gd_account_api` |
| Identity capability issuer role | `gd_identity_capability_issuer` |
| Provider ingress role | `gd_provider_ingress` |
| Provider worker role | `gd_provider_worker` |
| Identity ownership roles | `gd_identity_owner`, `gd_identity_definer`（均为 `NOLOGIN`） |

同一 checkout 内的人工开发、Codex 任务和多轮对话共享这套配置。不得因为当前 shell 未设置变量
就创建另一套默认资源；先读取 `.env.local`。同一 Git clone 的 linked worktree 默认复用主工作树
的 profile：开始数据库工作前复制或安全链接主工作树的 `.env.local`，不得自行创建另一套同名或
临时默认资源。需要轮换本地口令时，同时更新 PostgreSQL role 和主工作树 `.env.local`，再同步
各 linked worktree，并保持数据库及角色名称不变。

## 初始化与运行

1. 确认本机运行仓库要求的 PostgreSQL 版本。
2. 以本机 PostgreSQL 角色管理员运行
   `apps/cloud/scripts/provision-identity-capability-roles.sql`，再为五个 runtime pool 分别配置
   `gooddealer_cloud_app`、`gd_account_api`、`gd_identity_capability_issuer`、`gd_provider_ingress`、
   `gd_provider_worker` 登录凭据。所有角色必须
   `NO SUPERUSER NO BYPASSRLS NO CREATEROLE`；Identity owner/definer 必须 `NOLOGIN`，迁移角色仅有
   `SET TRUE, INHERIT FALSE` 的受控 membership。`gooddealer_cloud_owner` 拥有本机数据库。
3. 以拒绝 group/other 访问的权限创建 `.env.local`，再填写只用于本机的不同口令。Unix/macOS
   使用以下命令；Windows 使用只允许当前用户读取的等价 ACL，不得依赖继承的宽权限：

   ```sh
   umask 077
   cp .env.example .env.local
   chmod 600 .env.local
   test "$(stat -f '%Lp' .env.local 2>/dev/null || stat -c '%a' .env.local)" = 600
   ```

   已存在的文件或 linked worktree 安全链接也必须执行同一权限检查；检查只读取 metadata，
   不得输出文件内容或完整连接串。
4. 从仓库根目录运行 migration 前，确认六个连接 URL 分别解析到预期角色且账号 API、Identity
   issuer、Provider ingress、Provider worker 凭据互不复用。M015/M019 会在创建 capability schema
   前失败关闭地复核这些角色与 membership。
5. 从仓库根目录运行 `pnpm test:postgres`。命令自动读取 `.env.local`；不需要先在 shell 中
   export 变量。

不得提交 `.env.local`、输出完整连接串，或把本地凭据复用到 CI、预发布或生产。CI 使用工作流
显式提供的隔离测试凭据；生产凭据由部署环境的秘密管理系统注入。

## 并行开发与隔离

普通并行开发共享默认 profile，但 PostgreSQL 集成套件必须通过仓库命令串行运行；测试配置
已关闭文件并行，避免 migration、TRUNCATE 和租户夹具相互竞争。不要同时启动两次默认 profile
的 PostgreSQL 套件。

确实需要并行执行破坏性数据库测试时，必须显式创建命名隔离 profile：独立 database、独立
migrator/App/Account API/Identity issuer roles 和该 checkout 自己的 `.env.local`。隔离名称应包含稳定的工作树标识，不得替换
或模糊默认 profile，也不得把隔离凭据写回 `.env.example`。
