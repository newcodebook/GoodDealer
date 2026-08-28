# 本地开发环境

## 配置事实源

仓库根目录的 `.env.local` 是当前 checkout 的本地环境唯一事实源。它保存本机开发凭据和
资源定位，不进入 Git；`.env.example` 只定义变量名称、URL 形态和默认资源名称，不保存可用
口令。测试命令显式加载根目录文件，调用者已经提供的环境变量优先，因此 CI 和独立验证环境
不会被本地配置覆盖。

任何需要数据库的本地命令都应复用这两个变量，不得在脚本、文档、对话或临时命令中另造
默认数据库、角色或连接串：

- `GOODDEALER_POSTGRES_OWNER_URL`：迁移、受控测试夹具和维护验证使用的非超级用户 Owner
  连接串；它不是 Cloud 生产应用连接串，也不是 Desktop 数据库。
- `GOODDEALER_POSTGRES_APP_URL`：启用最小权限和租户 RLS 的 Cloud 应用角色连接串。

Desktop 运行数据库是由 Host 管理的本地 SQLCipher Active Workspace。它不使用上述变量，
也不允许把第三方账号、Provider Account ID、凭据绑定、密钥或 Token 写入 Cloud PostgreSQL。

## 默认本机资源

默认开发 profile 固定使用：

| 资源 | 固定名称 |
| --- | --- |
| PostgreSQL database | `gooddealer_test` |
| Migration/fixture role | `gooddealer_cloud_owner` |
| Runtime/RLS role | `gooddealer_cloud_app` |

同一 checkout 内的人工开发、Codex 任务和多轮对话共享这套配置。不得因为当前 shell 未设置变量
就创建另一套默认资源；先读取 `.env.local`。同一 Git clone 的 linked worktree 默认复用主工作树
的 profile：开始数据库工作前复制或安全链接主工作树的 `.env.local`，不得自行创建另一套同名或
临时默认资源。需要轮换本地口令时，同时更新 PostgreSQL role 和主工作树 `.env.local`，再同步
各 linked worktree，并保持数据库及角色名称不变。

## 初始化与运行

1. 确认本机运行仓库要求的 PostgreSQL 版本。
2. 以本机 PostgreSQL 管理身份创建上述两个 `NO SUPERUSER NO BYPASSRLS` 角色，并由
   `gooddealer_cloud_owner` 拥有 `gooddealer_test`。
3. 从 `.env.example` 创建 `.env.local`，填写只用于本机的不同口令。
4. 从仓库根目录运行 `pnpm test:postgres`。命令自动读取 `.env.local`；不需要先在 shell 中
   export 变量。

不得提交 `.env.local`、输出完整连接串，或把本地凭据复用到 CI、预发布或生产。CI 使用工作流
显式提供的隔离测试凭据；生产凭据由部署环境的秘密管理系统注入。

## 并行开发与隔离

普通并行开发共享默认 profile，但 PostgreSQL 集成套件必须通过仓库命令串行运行；测试配置
已关闭文件并行，避免 migration、TRUNCATE 和租户夹具相互竞争。不要同时启动两次默认 profile
的 PostgreSQL 套件。

确实需要并行执行破坏性数据库测试时，必须显式创建命名隔离 profile：独立 database、独立
owner/app roles 和该 checkout 自己的 `.env.local`。隔离名称应包含稳定的工作树标识，不得替换
或模糊默认 profile，也不得把隔离凭据写回 `.env.example`。
