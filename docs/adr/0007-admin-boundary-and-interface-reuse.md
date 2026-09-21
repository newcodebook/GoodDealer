# ADR-0007：未来 Public、Admin 与作业面保持分离

状态：Accepted.

## 决策

客户公开面、内部管理面和后台作业必须拥有独立的身份、授权、路由和业务组合边界。
它们可以共享严格协议和拥有模块的端口，但不得共享无范围的数据库访问、会话或业务权限。

## 当前实现

Cloud 公共面已注册账号激活、Desktop Grant 与账号 billing，Desktop OAuth 和 payment webhook
使用独立入口；Admin 仍只有边界探针。作业面只注册 Licensing 拥有的五类 durable commercial job，
并经窄应用端口执行。共享开发环境已经部署 systemd self-managed worker，但仓库组合与开发运行均
不证明生产 scheduler/worker 资格或 live provider 行为。

## 后果

任何未来路由或作业需由具体领域注册，验证不可信输入，执行服务器端租户隔离，并建立
可观察的授权与副作用证据。共享契约不能替代这些组合要求。
