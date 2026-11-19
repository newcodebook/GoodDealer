# 当前实现与源码入口

恢复持续实施任务时，先读 [完整任务目标与约束](IMPLEMENTATION_GOAL.md)，再核对本页、Git 与执行台账；本页的局部实现不能缩减总任务。

本文件记录开发状态，不重新定义产品范围。功能目标来自产品需求、用户决策和适用 ADR；
营销和设计材料不构成技术指令。未实现、未组合、未取得真实环境证据是不同的交付工作，
不能互相替代，也不能自动成为永久限制。最新需求对谈见 [产品对谈](PRODUCT_DISCOVERY.md)。

## Desktop 与 Native Host

- [生产根组件](../apps/desktop/src/app.tsx)组合启动、登录、锁定、首次接入引导和工作区。
  [工作区入口](../apps/desktop/src/app/workspace-view.tsx)组合资产库、详情、续费、销售、DNS、
  批量任务、人工任务、历史、冲突和设置；存在页面不意味着它展示的每项 Provider 操作已经可执行。
- 资产手动创建、编辑、删除和按同步代次约束的重新添加走本地 SQLCipher；业务状态与 Outbox
  在同一事务提交。设置已组合存储行修复及 Cloudflare 被拒凭据的撤销/清除维护入口，均由 Host
  重新验证授权、代次和请求，不由 UI 自行裁决。
- [Native 注册表](../apps/desktop/src-tauri/src/main.rs)、[command manifest](../apps/desktop/src-tauri/build.rs)
  与 [WebView capability](../apps/desktop/src-tauri/capabilities/local-app.json)定义命令面。
  设备切换 request/advance/status/cancel 已组合 Native 协调器。设置“设备”已组合真实目录读取与本机命名：
  Native 固定 list/self 路由、按本机构建目标报告平台、校验当前设备并移除签名元数据；名称持久化于 Cloud。
  保存结果未知时先刷新对账，普通业务同步不清空未保存输入。Standby 现在可读目录；本机命名仍只允许 Active，
  角色降级立即移除改名入口，不依赖旧设置投影。交接按钮在目标引导闭环交付前不开放。
- Desktop 登录/刷新现已在同一事务终结默认工作区的过期引导：烧毁 pending epoch、消费能力与 nonce、释放 checkpoint pin，
  再按原授权规则分配更高 epoch。未到期、孤立或不一致记录继续阻断；同事务内 Lease 签发失败时整体回滚。
  引导步骤与激活在外部 I/O 后以数据库当前时钟复核期限。引导开始后的取消和目标引导仍未完成。
- Desktop OAuth/刷新支持第二台已绑定设备以 Standby 登录；Cloud/Host 使用严格 v5 角色交换，Active 内层为 v4 Grant 与 v1 Lease 双签名，
  Standby 使用独立用途签名 v1。Cloud 在锁定服务器状态派生角色，签名后重查会话/撤销/期限；精确当前引导目标的 floor 为 pending−1，其余设备为 highest allocated。
- Native custody 独立保存安装与身份绑定的 security/issuedAt/Lease/商业地板，建立标记和记录缺项均拒绝；持久读回后再发布角色，
  Active→Standby 保留本地库并原子停写。新机无副本显示 `standby_awaiting_replica`、设备目录及刷新授权，不伪造空资产库。
  有副本只读，Provider、Outbox 和业务写入均拒绝；普通交接的 Cloud 回执、持久 attempt、原 barrier 与 Native 最后本机 Active epoch 全部匹配后，专用 Inbox gate 允许只读同步。
  Cloud 响应丢失后重开先查状态；未消费且当前仍为 Active 时只恢复 Native 保存的同一签名请求。强制接管、证据缺失、旧 epoch 与 retired cursor 均保持冻结。
  Windows 复用同一授权合同与纯地板模型并补齐接口；目标编译尚未取证，底层 custody 仍未实现，本轮不宣称双系统完整可用。
- 普通交接 switch view 使用严格 v2 回执；Cloud 从唯一已消费 proof、释放原因为 normal_handoff 的来源 Lease 及匹配目标能力派生，不从工作流 status 推断成功。
  本地追加迁移 `202611180002` 保存不可变 attempt/receipt/refusal；已签完整请求只进 Native custody。Native 授权地板 v3 保存具名 capabilities，并单独记最后本机 Active epoch，旧地板升级保留所有拒绝重放信息：v1 缺失的历史 Active epoch 保持未知，v2 已记录的值保持不变；旧商业记录仅映射历史 Cloudflare observe 权限。
  来源后台会对账和续作，但完整目标引导、移交确认界面与强制接管仍未完成，不能据此宣称双设备换机已可用。
- `local-storage` 的 [desktop_local_host](../crates/local-storage/src/desktop_local_host/mod.rs)
  是唯一数据库与事务聚合所有者，内部按授权、业务、同步、Provider 协调和恢复拆分。
  私有实现与数据库、密钥、文件 handle 不成为跨 crate API。
- `active_workspace/business/` 已按资产、Provider 观察、读投影、同步收发、冲突、checkpoint、wire 和修复
  拆分私有实现及测试；仍共享一个数据库 owner。Host 工作区授权与备份工件状态已明确分离，保持同一锁和 epoch。
- Native Provider facade 已分离 Cloudflare 私有适配；Unix custody 的 OS 密钥库细节已提取私有后端。
  Windows custody 尚未实现，仍是下一轮必须完成的原生功能。

## Provider

- Cloudflare Zone/DNS 只读 Service 位于 Secure Host 私有实现，包括固定来源 HTTPS、
  Native 凭据录入和 custody、观察、撤销和被拒凭据清除。Renderer 不接收 Token。
- 接入向导已组合连接创建/激活，设置已组合连接维护；单独主动观察的完整客户入口仍需交付。
- [Host 资格登记](../crates/local-storage/src/active_workspace/capability_qualification.rs)当前为空。
  创建、激活和观察因此被拒绝；减少凭据持有的撤销、清除和恢复流程不依赖能力取得资格。
  完成对应真实资格后要同步更新合同、准入与客户旅程，不能仅修改清单宣称完成。
- Afternic 官方 API Service 已组合进 Native 和设置：受限凭据录入/托管 → 完整分页库存扫描 → 同事务导入新资产与 Outbox、连接范围 Listing 绑定/观察 → 设置展示扫描计数；历史删除或待重新添加的资产跳过，既有用户字段保留。
  原始所有权状态保持，不把市场库存解释成注册商所有权。重开 prepared 使用当前授权加载原 incarnation/generation/proof 的凭据；缺槽进入修复，不能重新录入覆盖。
  撤销先持久阻止使用，再清除 Native slot，确认清除后隐藏连接，保留资产和审计历史。未获得平台权限仍允许本地清理。
  macOS 有原生掩码录入实现，Linux/macOS 有 custody 源码；Windows custody 和 Linux/Windows 录入仍待完成，实际账号与目标 OS 未验收，资格清单保持拒绝。
- Active Grant 的 commercialAuthority v2 是精确封闭 capability 集合：Afternic observe/write、Cloudflare observe；write 必须含 observe。空集合仍允许有授权的本地业务。
  Cloud 只取锁定 Licensing 快照的精确交集；Host floor/runtime/最终提交栅栏包括集合，权限变化不能复用旧 admission。逻辑 Grant 签名用途仍为 `.v3`，不随 wire 升版创建新用途。
- 十二平台角色、能力目录和不可执行 manifest 已存在；除 Cloudflare 与 Afternic 外的实际 Service 仍需实现。
  Rust 与 TypeScript 读取合同按 [ADR-0027](adr/0027-multi-platform-domain-providers-and-marketplaces.md)一致扩展；
  名录和展示名称不授予 Provider 执行能力，销售聚合的临时位图也已扩容以保留全部平台。
- [ADR-0027](adr/0027-multi-platform-domain-providers-and-marketplaces.md)已明确已确认官方能力使用官方 API，当前其余缺口全部自研私有 HTTP 接口；
  [公开核查](PROVIDER_API_REVIEW.md)已补充接口语义与社区线索，尚未新增私有会话 custody、Service 或执行资格。

- 本地新增迁移 `202611180001`：原资源绑定表支持连接范围的 Listing、多市场/多账户和 detached 历史；
  Registrar/DNS 单资源约束及已有数据保持。追加 `202611180003` 为 Afternic 连接 publication、完整扫描回执和原始 Listing 详情提供持久事实；观察关联原绑定与代次，销售/资产投影支持同市场多连接，断连后的历史不存在结果降为 unknown。
  追加 `202611180004` 复用原 operation plans/items/attempts/results，保存 Afternic 下架的不可变对账事实；不新增 Listing repository。
- 批量页已组合 Afternic 下架：选择连接与最多 500 个已有域名，从最新完整库存生成 15 分钟持久预览，整批批准一次；历史和详情读取实际持久结果。
  每项精确 GET 与冻结前像匹配后，数据库只发出一个 DELETE claim；任何写响应之后以及重开遗留 running/unknown 都先 GET，绝不自动重发 DELETE。
  精确缺席、unlisted 观察、原绑定 detach 与聚合结果同事务提交；未知/仍存在持久只读退避，完整保留合法 Retry-After。旧绑定和普通 detach 不能伪造成功。
  UI 换选计划、工作区替换和角色降级撤去旧批准入口；丢失预览/批准响应只查状态。
- 此下架 worker 与批准入口接入 Windows/macOS 系统电源通知及 epoch 栅栏：休眠/退出阻断，唤醒不得复用旧许可；注册失败禁止新写，当前授权下仍可只读对账。
  共享原 ProviderLane，每轮处理一项再接收维护/退出请求。旧连接/刷新等路径尚未统一接入此电源栅栏，不能据本切片宣称所有 Provider 操作均已满足休眠要求。
  两个 OS 电源模块已取得原样源码目标编译证据，尚无完整应用目标构建或实机休眠证据。真实 Afternic 资格仍为空，新执行仍拒绝。
- 已有下架尝试时，普通交接拒绝声明 execution_fact/device_audit 为空；交接屏障同时拒绝新下架预览、批准、claim 与发送，已发请求仍可只读对账。两流的真实本地来源、上传与 Cloud 确认尚未组合，此临时拒绝需在完整两流接入后移除。
- Afternic 创建 Listing、改价、私有所有权验证与必要 DNS 步骤继续实施；当前下架旅程源码不等于完整 Afternic 或跨市场客户闭环。

## Cloud 与 Account Web

- [公共 HTTP 组合](../apps/cloud/src/entrypoints/http.ts)与
  [公共业务路由](../apps/cloud/src/entrypoints/routes/public/boundary.ts)包含账号激活、Desktop Grant、
  billing checkout/status/cancel/fixed-term confirm/首购退款，以及按应用端口条件组合的
  workspace sync、Cloudflare 观察副本、设备切换和设备列表/self-report。
  声明了 route 不代表任意环境都已配置其依赖；具体可达面由对应 composition 和运行配置决定。
- Identity、Desktop OAuth、支付 webhook 与 worker 由各自入口组合；身份、租户范围和商业权威
  由服务器派生。设备目录读/报告锁定当前会话、刷新族、绑定与有效签名密钥，撤销或 rotated 密钥拒绝。
  Cloudflare ingress 接收允许字段的业务观察副本，不接受 Provider 凭据或代为请求 Provider。
- [唯一迁移目录](../apps/cloud/src/db/migrations.ts)维护迁移顺序和校验和；本文件不复制数量。
  包括后续设备交接、mutation receipt、删除/重新添加代次和设备 self-report 的追加迁移。
  数据库是否实际应用这些迁移，必须依据相应环境的运行记录。
- Account Web 已组合账户访问和商业旅程；已有 staging 观察与其具体限制见
  [开发 Cloud](DEVELOPMENT_CLOUD.md)。这些记录不能替代生产支付、邮件或发行证据。

## 恢复与发行工作

换机云恢复与独立业务备份均为明确需要交付的能力。现有 GDBK v1 是安装绑定格式；其私有
开发组合和 rebootstrap 故障协议已有测试，但生产 native 文件、密钥 custody 和恢复链路
尚未完成，生产入口仍拒绝执行。当前实现不能作为跨设备或灾难恢复方案。
恢复场景和设计修订见 [ADR-0023](adr/0023-business-backup-and-recovery.md)，现有格式边界见
[数据生命周期](DATA_LIFECYCLE.md) 与 [ADR-0023](adr/0023-business-backup-and-recovery.md)。

生产 OpenBao、托管数据库、支付/销售地区、Provider 实际行为、最终原生构件和稳定发行仍需
各自的实现与验证。证据分类与验收见 [验证边界](VERIFICATION.md)；本文件不宣称关闭任何 Gate。
