# ADR-0024：域名 Provider 能力覆盖与资金操作确认

状态：Accepted

## 决策

GoodDealer 的 Provider 接入范围以域名资产生命周期为边界，不扩展到 Provider 的非域名产品。
对纳入范围的能力建立版本化、逐项可审计的 capability manifest；每项能力必须标明实现状态、
最小权限、风险、审批、幂等、异步结果、未知结果对账、补偿可能性和真实资格状态。未实现、
Provider 不支持、项目暂不需要或尚未资格化的能力必须保持不可执行并在 manifest 中显式标记。

域名范围包括：Provider 连接与资源发现、域名/Zone 绑定、DNS 记录、DNSSEC、Nameserver、
注册商状态、注册、续费、转入、转出、转移锁、联系人、WHOIS 隐私、转移授权码和相关监控。
CDN、WAF、Workers、Pages、边缘规则及非域名账户能力不属于本边界。

所有注册、续费、转入、转出及其他付费操作都必须是单项用户确认。确认绑定具体资产、Provider
资源绑定摘要、计划摘要、条款摘要及其展示文本、金额、币种、报价有效期、报价摘要和一次性 nonce；
不能用批量确认或长期授权替代。Host 从当前本地绑定与 Provider 报价重新核对这些字段，过期、
绑定变更或 nonce 重放都拒绝；确认引用本身不是支付授权。
Provider 页面回跳只构成不可信的 reconciliation hint，不能作为成功、付款或资源状态回执。

## 执行不变量

- Renderer 只提交本地资产、绑定和计划引用，不提交 URL、Token、Provider raw body 或付款凭据。
- 外部请求发出后崩溃或超时必须进入 `outcome_unknown`，完成 Provider 对账前禁止盲目重试。
- 批量操作逐项记录结果；只有 Provider 提供可验证能力时才声明补偿或回滚。
- 本地 SQLCipher 是业务权威；Cloud 只保存允许字段和脱敏观察/结果摘要。
- 每次执行前重新验证 Grant、Lease、商业 entitlement、凭据代次、资源绑定和 Provider 前置条件。

## 实施边界

协议目录位于 `packages/protocol`；Provider endpoint、wire、凭据和网络权威继续由对应的
`secure-host-core` 私有 Service 拥有；本地计划和操作复用 `local-storage` 已有
`operation_plans`、`operation_attempts` 和 `operation_results`，不得另建通用 Provider 代理。

现有资产的本地 Provider 绑定由 `local-storage` 从已提交且已验证的 Zone 观察派生并原子持久化；它不是 Provider API
写入，也不创建资产。`client-core` 提供必需的窄 `PortfolioProviderBindingPort`，边界返回 `unknown` 并由唯一 validating wrapper
验证请求、回执、实体相关性及代次。首次提交严格返回 expected + 1；重放允许返回后续提交后的当前 Host 代次，但不得低于 expected。Desktop
具体适配器实现该窄端口；宽泛的注入式 `LocalBusinessPort` 保留可选绑定方法，直到资产详情 UI 暴露绑定动作，避免要求只读适配器实现写能力。当前没有绑定 UI 动作。

本决策扩大目标范围，不自动开放任何新执行路径。当前 Cloudflare Host 仍只实现 Zone/DNS
只读观察，新增写入、Registrar 和监控命令必须分别完成具名权限、生产组合、受控测试和资格审查。
当前协议中的覆盖目录仅用于阻止遗漏和标明不可执行状态，还不是完成资格审查的 Provider-specific
manifest；最小权限、幂等与对账行为必须由逐项真实证据确定，不能猜测后填入执行许可。
