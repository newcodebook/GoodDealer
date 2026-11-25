# Afternic 整批下架、后台执行与重开对账

基线 `35d409a`。完整任务见 [实施目标](../IMPLEMENTATION_GOAL.md)；此前连接与库存归集切片不等于完整 Listing 功能。
本切片先实现真实下架旅程；创建 Listing、改价、私有所有权验证、DNS、其他平台和恢复要求继续保留。

## 客户行为与持久合同

- 批量页选择当前 Afternic 连接及最多 500 个已有域名，Host 从该连接最新一次完整库存中实际返回的 Listing 生成持久预览；清楚显示观察时间、状态和价格。预览不是实时 GET，不从扫描缺项推断缺席。
- 15 分钟内批准整个固定预览一次。planRef+planHash 绑定完整有序目标、原始 Listing、源 scan/observation、资产代次、连接 incarnation/凭据代次、绑定摘要/代次和适配版本。目标变化需新预览；重复批准同一引用不创建第二 operation。
- 每项先精确 GET。状态变化转冲突；已缺席可直接完成；完全匹配才原子提交唯一 running claim，然后执行一次 DELETE。写响应不代表完成，任何响应/失败后均精确 GET 对账。
- 已 running/未知的项重开只做 GET，不再次 DELETE。跨新计划也不能绕过同连接 incarnation/凭据代次与同域名的未决请求。GET 失败或仍存在时持久退避，30→900 秒，合法 Retry-After 可延长；其他独立项继续。
- 精确认证缺席、原 unlisted 观察、窄对账回执、原绑定 detach 和聚合结果在同一事务/最终栅栏提交。读投影仅凭该精确回执保留本次已下架事实；普通 detach、撤销、代次变化不能伪装成功，新 incarnation 优先。
- 本地资产保留。非资金整批批准后自动执行；不包含费用、出价或其他资金授权。
- 交接屏障阻止新预览、批准、claim 与 DELETE 发送；已派发 GET 仍可对账。存在任何下架尝试时拒绝空 execution_fact/device_audit 证明（包括 queued 与终结历史、重开）。只有真实两流来源、上传与确认接入后才能移除此临时拒绝，不能将其算作已完成交接。

## 所有权与实现范围

- device_architecture_review：local-storage 追加迁移 `202611180004`、schema/读投影、私有 afternic_delist 业务与 Host facade/测试和最小 public exports。复用现有 plan/item/operation/attempt/result，仅增加窄不可变 Afternic 对账事实；单 writer 不变。
- standby_native：Core 私有电源通知边界、Afternic 专用 Native worker、原 ProviderLane 内后台逐项调度、三个 raw IPC/注册/生成物及精确命令策略。不另建执行 lane，不让 Service 拥有数据库。
- standby_cloud：client-core 严格 unknown 合同、目的明确的 adapter、现有批量页的下架预览/批准/历史和 i18n/测试；role 降级即时撤去动作，失去响应只读状态，不自动重建或批准。
- root：ADR-0006 电源通知的窄 unsafe 例外、exact public surface/unsafe policy、独立审查与共享面收敛、最终检查/文档/独立提交。构建者不能接受自身结果。

所有请求及外层响应为 schemaVersion 1，未知字段拒绝；nullable planRef 必须显式出现。预览/批准返回有界计划，status 返回最近 50 项摘要及可选单项详情。
Renderer 仅见本地 opaque planRef/planHash 和脱敏事实，不见绑定、远端账号、凭据代次/slot proof 或 HTTP 原始响应。
Native 持有非序列化 Work/Claim，只有数据库 queued→running 胜者获得 Claim，恢复只能取得 Reconcile Work。

## 休眠与发送边界

使用真正 Windows/macOS 系统电源通知，不以移动端 Tauri 生命周期或定时轮询替代。仅两处私有 OS 注册/注销文件允许 ADR-0006 的窄 unsafe 边界，公开面只有安全门禁和 bounded 信号。
系统事件先发布原子失效意图；旧 power epoch 在休眠和唤醒后都不能恢复发送。短最终提交持守门禁，网络等待不持锁。
注册失败禁止新写入；已派发操作在当前授权下可继续只读对账。退出关闭并 drain 原 lane，销毁先关闭状态后注销，晚到回调不得重新开启。

## 验收与声明

覆盖重复批准/并发 claim、批准字段篡改、跨租户/代次、权限撤回、最终栅栏失败、发送前后崩溃、未知结果/缺席、真实 SQLCipher 重开、旧绑定不复活、后台空轮询不改变 readGeneration。
更新通用迁移 manifest、精确导出/命令/生成物和当前文档；运行模块/数据库检查、独立评估及根 pnpm check。Native sleep/wake 状态机测试不替代 Windows/macOS 目标编译与实机；真实 Afternic 账号、OS custody/capture 和发行资格必须分别取证，不能开放空资格清单冒充交付。
