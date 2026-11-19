# Standby 授权切片独立评估

范围：[Task Frame](../phase0/STANDBY_AUTHORIZATION_TASK_FRAME.md)。评估的是本地源码组合和测试，不是生产部署、真实设备切换或原生发行资格。

## Host / Native / Renderer

独立评估者 `device_architecture_review`，最终 PASS。发现并交回主代理修复四项问题：

- 持久地板的 nullable 字段必须出现，不能由 serde 将缺失键默认为 None。
- 已建立地板后缺失 Native 记录不能当成首次授权；建立标记与记录必须匹配。
- Windows 条件模块必须复用同一纯地板合同并声明新增接口。仅静态确认接口遗漏已修复；Windows backend 仍不可用，未获得目标编译或运行证据。
- Active→Standby 时设置页须立即依据当前 Host presentation 隐藏改名入口，不能依赖尚未刷新的连接或设备投影。

最后的 Active 替换拒绝顺序调整也已独立核查：不兼容授权在持久地板写入之前失败关闭；专项 1/1 与 Standby 13/13 重新通过。

独立复跑：Standby Host 13 项、地板 5 项（其中 2 项与 Standby 筛选重叠）、Secure Host verifier 4 项、Tauri Standby 2 项、Renderer 初次 60 项；修复后再次运行地板 5 项、Renderer 39 项和差异检查均通过。

## Cloud

独立评估者 `standby_native`（没有实现 Cloud），PASS。核查锁定服务器状态派生角色、签名后复查时效/撤销、三用途密钥隔离、pending 目标精确例外、路由与应用二次准入。交回 Cloud 构建者修复过时注释和跨模块深导入，使用 devices 公共出口。

独立复跑关键单元测试 84 项、PostgreSQL 18.6 UTF8 的 OAuth 37 项与目录 12 项，共 49 项通过。数据库为本任务临时实例，非生产系统。

## 仍需交付

普通交接的持久成功回执和 Standby Inbox、目标引导/强制接管/云恢复、实际第三用途 OpenBao key/策略部署、Windows custody 和双系统实机演练均未由本切片交付。Standby Inbox 当前安全冻结，已有库保留；测试 key-store adapter 不构成 OS 托管资格。最终根检查和提交证据由主代理记录到执行台账。
