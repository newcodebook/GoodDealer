# 当前实现与源码入口

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
  设备切换 request/advance/status/cancel 已组合 Native 协调器；客户设备管理页面仍需组合。
- `local-storage` 的 [desktop_local_host](../crates/local-storage/src/desktop_local_host/mod.rs)
  是唯一数据库与事务聚合所有者，内部按授权、业务、同步、Provider 协调和恢复拆分。
  私有实现与数据库、密钥、文件 handle 不成为跨 crate API。

## Provider

- 当前实际 Service 为 Secure Host 私有的 Cloudflare Zone/DNS 只读实现，包括固定来源 HTTPS、
  Native 凭据录入和 custody、观察、撤销和被拒凭据清除。Renderer 不接收 Token。
- 接入向导已组合连接创建/激活，设置已组合连接维护；单独主动观察的完整客户入口仍需交付。
- [Host 资格登记](../crates/local-storage/src/active_workspace/capability_qualification.rs)当前为空。
  创建、激活和观察因此被拒绝；减少凭据持有的撤销、清除和恢复流程不依赖能力取得资格。
  完成对应真实资格后要同步更新合同、准入与客户旅程，不能仅修改清单宣称完成。
- 十二平台角色、能力目录和不可执行 manifest 骨架已存在；其余平台的实际 Service 仍需实现。
  Rust 与 TypeScript 读取合同按 [ADR-0027](adr/0027-multi-platform-domain-providers-and-marketplaces.md)一致扩展；
  名录和展示名称不授予 Provider 执行能力，销售聚合的临时位图也已扩容以保留全部平台。
- [ADR-0027](adr/0027-multi-platform-domain-providers-and-marketplaces.md)已明确已确认官方能力使用官方 API，当前其余缺口全部自研私有 HTTP 接口；
  [公开核查](PROVIDER_API_REVIEW.md)已补充接口语义与社区线索，尚未新增私有会话 custody、Service 或执行资格。

## Cloud 与 Account Web

- [公共 HTTP 组合](../apps/cloud/src/entrypoints/http.ts)与
  [公共业务路由](../apps/cloud/src/entrypoints/routes/public/boundary.ts)包含账号激活、Desktop Grant、
  billing checkout/status/cancel/fixed-term confirm/首购退款，以及按应用端口条件组合的
  workspace sync、Cloudflare 观察副本、设备切换和设备列表/self-report。
  声明了 route 不代表任意环境都已配置其依赖；具体可达面由对应 composition 和运行配置决定。
- Identity、Desktop OAuth、支付 webhook 与 worker 由各自入口组合；身份、租户范围和商业权威
  由服务器派生。Cloudflare ingress 接收允许字段的业务观察副本，不接受 Provider 凭据或代为请求 Provider。
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
